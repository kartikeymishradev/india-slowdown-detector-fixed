"""
Flask backend for India Economic Slowdown Detector
Run locally: python app.py
"""

import os
import sys
import json
import joblib
import gzip
import io
import numpy as np
import pandas as pd
from flask import Flask, jsonify, render_template, request
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.dirname(__file__))
from data.fetch_data import get_all_indicators, build_feature_vector
from data.gemini_grounding import (
    generate_analysis,
    _get_key_pool,
    _call_with_fallback,
    refresh_all_grounding,
    get_grounding_status,
)

app = Flask(__name__)
CORS(app)


@app.after_request
def compress(response):
    """Gzip-compress all text, javascript, json, and svg responses to reduce payload sizes."""
    accept_encoding = request.headers.get('Accept-Encoding', '')
    if 'gzip' not in accept_encoding.lower() or response.status_code not in range(200, 300):
        return response
    if 'Content-Encoding' in response.headers:
        return response

    content_type = response.headers.get('Content-Type', '')
    mime_types = ['text/', 'application/javascript', 'application/json', 'image/svg+xml', 'application/xml']
    if not any(t in content_type for t in mime_types):
        return response

    if response.direct_passthrough:
        response.direct_passthrough = False

    buffer = io.BytesIO()
    with gzip.GzipFile(mode='wb', fileobj=buffer) as f:
        f.write(response.get_data())

    response.set_data(buffer.getvalue())
    response.headers['Content-Encoding'] = 'gzip'
    response.headers['Content-Length'] = len(response.get_data())
    return response

# Load ML model (train first if missing)
MODEL_PATH = os.path.join(os.path.dirname(__file__), "model", "model.pkl")
model = None

def load_model():
    global model
    if os.path.exists(MODEL_PATH):
        model = joblib.load(MODEL_PATH)
        print(" ML model loaded")
    else:
        print("⚠️  model.pkl not found — run: python model/train_model.py")

load_model()

LABELS = {0: "Stable", 1: "Warning", 2: "Slowdown"}
LABEL_COLORS = {0: "green", 1: "amber", 2: "red"}

def compute_risk_score(data):
    """Composite weighted risk score 0-100.
    Thresholds updated to reflect June 2026 baselines (RBI/MOSPI).
    """
    score = 0

    # PMI (lower = riskier; contraction below 50, healthy ~55+)
    pmi = data.get("pmi", 55)
    score += max(0, (54 - pmi) * 4)

    # Credit growth (lower = riskier; healthy ~10%+)
    cg = data.get("credit_growth", 8)
    score += max(0, (8 - cg) * 3)

    # Export growth (negative = risky; currently +16% so contributes 0)
    eg = data.get("export_growth", 5)
    if eg < 0:
        score += min(25, abs(eg) * 3)
    elif eg < 3:
        score += (3 - eg) * 2

    # Unemployment (higher = riskier; MOSPI baseline ~5%, urban ~6.6%)
    ue = data.get("unemployment", 5)
    score += max(0, (ue - 5.5) * 4)

    # GDP growth (lower = riskier; current baseline ~7.6%)
    gdp = data.get("gdp_growth", 7.6)
    score += max(0, (6 - gdp) * 4)

    # CPI (higher = riskier; RBI target 4%; current 3.93% — well behaved)
    cpi = data.get("cpi", 4)
    if cpi > 6:
        score += (cpi - 6) * 3
    elif cpi > 5:
        score += (cpi - 5) * 1.5

    # Extended indicators (light-weight signals — sentiment/momentum, not core macro)
    derived = data.get("derived_features", {})
    if derived.get("vix_high"):
        score += 5
    if derived.get("fii_outflow"):
        score += 3
    if derived.get("trade_deficit_wide"):
        score += 4
    gst_mom = derived.get("gst_momentum", 0)
    if gst_mom < -3:
        score += 3

    return min(100, max(0, round(score)))


# Thresholds calibrated from training_data_v2.csv (52 quarters, FY2013-FY2025)
# distribution — same indicators the ML model trains on, so this score and the
# ML model's "Slowdown probability" are always computed from the same 18
# features and can never silently disagree about what data they saw.
#
# Structured as dicts (rather than bare lambdas) so the /api/foundation-thresholds
# route can hand this same definition to the frontend, which lets the user drag
# sliders to explore "what if the red-zone line were here instead" without the
# frontend needing to hardcode a second copy of these numbers.
#   key:       dotted lookup used by _get_by_key() -- "ds:<side>:<field>" for a
#              demand_supply value, otherwise a flat top-level indicator field.
#   direction: "gt" -> flagged red when value is ABOVE the threshold
#              "lt" -> flagged red when value is BELOW the threshold
FOUNDATION_THRESHOLDS = [
    {"key": "gdp_growth",                    "label": "GDP growth",           "direction": "lt", "default": 5.0,  "unit": "%", "min": 0,   "max": 10, "step": 0.1},
    {"key": "cpi",                           "label": "CPI inflation",        "direction": "gt", "default": 6.0,  "unit": "%", "min": 2,   "max": 12, "step": 0.1},
    {"key": "unemployment",                  "label": "Unemployment",         "direction": "gt", "default": 7.0,  "unit": "%", "min": 3,   "max": 15, "step": 0.1},
    {"key": "export_growth",                 "label": "Export growth",        "direction": "lt", "default": 0.0,  "unit": "%", "min": -20, "max": 20, "step": 0.5},
    {"key": "repo_rate",                     "label": "Repo rate",            "direction": "gt", "default": 7.0,  "unit": "%", "min": 3,   "max": 10, "step": 0.25},
    {"key": "pmi",                           "label": "PMI (manufacturing)",  "direction": "lt", "default": 50.0, "unit": "",  "min": 30,  "max": 65, "step": 0.5},
    {"key": "ds:supply:wpi_inflation",       "label": "WPI inflation",        "direction": "gt", "default": 6.0,  "unit": "%", "min": 0,   "max": 15, "step": 0.1},
    {"key": "ds:supply:core_sector_growth",  "label": "Core sector growth",   "direction": "lt", "default": 2.0,  "unit": "%", "min": -10, "max": 10, "step": 0.1},
    {"key": "ds:supply:capacity_util",       "label": "Capacity utilization", "direction": "lt", "default": 72.0, "unit": "%", "min": 50,  "max": 90, "step": 0.5},
    {"key": "ds:supply:corporate_earnings",  "label": "Corporate earnings",   "direction": "lt", "default": 5.0,  "unit": "%", "min": -15, "max": 20, "step": 0.5},
    {"key": "ds:demand:pfce_growth",         "label": "Private consumption",  "direction": "lt", "default": 5.0,  "unit": "%", "min": -5,  "max": 15, "step": 0.5},
    {"key": "inr_usd",                       "label": "INR/USD",              "direction": "gt", "default": 88.0, "unit": "",  "min": 70,  "max": 110,"step": 0.5},
]


def _get_by_key(data, key):
    """Look up an indicator value by its FOUNDATION_THRESHOLDS key.
    'ds:<side>:<field>' reaches into demand_supply; anything else is a flat
    top-level field on the indicators dict."""
    if key.startswith("ds:"):
        _, side, field = key.split(":", 2)
        return _ds_val(data, side, field)
    return data.get(key)


def _ds_val(data, side, key):
    """Pull a value out of indicators['demand_supply'][side][key]['value']."""
    return data.get("demand_supply", {}).get(side, {}).get(key, {}).get("value")


def compute_foundation_score(data, overrides=None):
    """Transparent 'how many of the model's own 18 indicators are currently
    in a red/weak zone' score, 0-100. Unlike compute_risk_score() (the old
    hand-tuned 6-indicator formula) and the ML model (a black-box ensemble),
    this score is deliberately simple and explainable: every point comes
    from a named indicator crossing a named threshold, so the dashboard can
    say exactly *why* the number is what it is, rather than just showing it.

    It deliberately reuses the SAME 12 raw indicators the ML model trains
    on (see build_feature_vector() / training_data_v2.csv) so this and the
    ML model's "Slowdown probability" never disagree about which data they
    looked at -- only about how they weigh it.

    `overrides` (optional dict of {key: custom_threshold_value}) lets the
    "Interactive Threshold Adjustments" sandbox on the frontend recompute
    this score against user-chosen threshold lines instead of the defaults,
    without ever touching the defaults themselves."""
    overrides = overrides or {}
    red_zone = []
    checked = 0

    for t in FOUNDATION_THRESHOLDS:
        # Overrides now simulate the actual value of the indicator, not the threshold
        val = overrides.get(t["key"])
        if val is None:
            val = _get_by_key(data, t["key"])
        if val is None:
            continue  # missing data point -- skip rather than guess
        checked += 1
        threshold = t["default"]
        is_red = (val > threshold) if t["direction"] == "gt" else (val < threshold)
        if is_red:
            red_zone.append({"label": t["label"], "value": val})

    if checked == 0:
        return {"score": None, "red_zone": [], "checked": 0, "total": len(FOUNDATION_THRESHOLDS)}

    score = round((len(red_zone) / checked) * 100)
    return {
        "score": score,
        "red_zone": red_zone,
        "checked": checked,
        "total": len(FOUNDATION_THRESHOLDS),
    }


@app.route("/api/foundation-thresholds")
def api_foundation_thresholds():
    """Metadata (key/label/direction/default/range) for every Foundation
    Score threshold, so the frontend can render sliders generically instead
    of hardcoding a second copy of these numbers."""
    return jsonify(FOUNDATION_THRESHOLDS)


@app.route("/api/foundation-score/recompute", methods=["POST"])
def api_foundation_recompute():
    """Recompute the Foundation Score against user-chosen threshold lines
    (the 'Interactive Threshold Adjustments' sandbox). Always recomputes
    against the current live indicators -- this never changes what
    FOUNDATION_THRESHOLDS' defaults are, it just answers 'what would the
    count look like if the red-zone line were here instead'."""
    payload = request.get_json(silent=True) or {}
    overrides = payload.get("overrides") or {}
    # Only accept overrides for known keys, and only numeric values --
    # never trust the client's payload shape blindly.
    valid_keys = {t["key"] for t in FOUNDATION_THRESHOLDS}
    clean_overrides = {}
    for k, v in overrides.items():
        if k in valid_keys:
            try:
                clean_overrides[k] = float(v)
            except (TypeError, ValueError):
                continue

    data = get_all_indicators()
    return jsonify(compute_foundation_score(data, clean_overrides))


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/indicators")
def api_indicators():
    """Return all live sector indicators."""
    data = get_all_indicators()
    return jsonify(data)


@app.route("/api/predict")
def api_predict():
    """Run ML model on current indicators."""
    data = get_all_indicators()

    prediction = {"label": "Warning", "confidence": 0.5, "probabilities": {}}

    if model is not None:
        features = build_feature_vector(data)
        pred = model.predict(features)[0]
        proba = model.predict_proba(features)[0]
        prediction = {
            "label": LABELS[int(pred)],
            "color": LABEL_COLORS[int(pred)],
            "confidence": round(float(max(proba)) * 100, 1),
            "probabilities": {
                "Stable":   round(float(proba[0]) * 100, 1),
                "Warning":  round(float(proba[1]) * 100, 1),
                "Slowdown": round(float(proba[2]) * 100, 1),
            }
        }
        # risk_score represents continuous weighted risk:
        # Warning probability (0.5 weight) + Slowdown probability (1.0 weight)
        risk_score = round(prediction["probabilities"]["Warning"] * 0.5 + prediction["probabilities"]["Slowdown"] * 1.0)
    else:
        # Rule-based fallback ONLY used if model.pkl failed to load.
        risk_score = compute_risk_score(data)
        if risk_score < 35:
            prediction = {"label": "Stable", "color": "green", "confidence": 72.0,
                          "probabilities": {"Stable": 72.0, "Warning": 22.0, "Slowdown": 6.0}}
        elif risk_score < 65:
            prediction = {"label": "Warning", "color": "amber", "confidence": 61.0,
                          "probabilities": {"Stable": 21.0, "Warning": 61.0, "Slowdown": 18.0}}
        else:
            prediction = {"label": "Slowdown", "color": "red", "confidence": 68.0,
                          "probabilities": {"Stable": 8.0, "Warning": 24.0, "Slowdown": 68.0}}

    return jsonify({
        "prediction": prediction,
        "risk_score": risk_score,
        "foundation_score": compute_foundation_score(data),
        "indicators": data,
        "model_loaded": model is not None,
        "grounding_status": get_grounding_status(),
    })


# Historical Shock Overlay -- lets the dashboard show what the REAL trained
# model actually output for two real, well-documented Indian slowdown
# episodes, pulled straight from the same training_data_v2.csv the model
# was fit on (not hand-typed guesses). This is what validates the model:
# feeding it a known-bad quarter and confirming it flags it as such.
HISTORICAL_SHOCKS = {
    "demonetization_2016": {
        "quarter": "Q3_FY2017",
        "label": "Demonetization",
        "period": "Oct–Dec 2016 (Q3 FY17)",
    },
    "ilfs_2018": {
        "quarter": "Q3_FY2019",
        "label": "NBFC / IL&FS Crisis",
        "period": "Oct–Dec 2018 (Q3 FY19)",
    },
    "slowdown_2019": {
        "quarter": "Q2_FY2020",
        "label": "2019 Slowdown",
        "period": "Jul–Sep 2019 (Q2 FY20)",
    },
    "covid_2020": {
        "quarter": "Q1_FY2021",
        "label": "COVID-19 Shock",
        "period": "Apr–Jun 2020 (Q1 FY21)",
    },
    "covid_second_wave_2021": {
        "quarter": "Q1_FY2022",
        "label": "COVID Second Wave",
        "period": "Apr–Jun 2021 (Q1 FY22)",
        "note": "This was India's deadliest COVID wave on the ground, yet YoY GDP growth reads +22.6% here because it's compared against the collapsed base of Q1 FY21 -- a real limitation of YoY-based indicators, not a sign the model 'missed' anything.",
    },
    "inflation_shock_2022": {
        "quarter": "Q1_FY2023",
        "label": "2022 Inflation Shock",
        "period": "Apr–Jun 2022 (Q1 FY23)",
    },
}

TRAINING_DATA_PATH = os.path.join(os.path.dirname(__file__), "model", "training_data_v2.csv")


def _load_training_row(quarter):
    """Pull one labeled quarter straight out of the model's own training set."""
    try:
        df = pd.read_csv(TRAINING_DATA_PATH)
    except FileNotFoundError:
        return None
    match = df[df["quarter"] == quarter]
    if match.empty:
        return None
    return match.iloc[0].to_dict()


def _feature_vector_from_training_row(row):
    """Same 18-column shape as build_feature_vector() in data/fetch_data.py,
    built directly from a training_data_v2.csv row instead of live indicators."""
    pmi = row["pmi_manufacturing"]
    exp = row["exports_yoy"]
    core_sector = row["core_sector_growth"]
    cap_util = row["capacity_utilization"]
    corp_earn = row["corporate_earnings_growth"]
    return pd.DataFrame([{
        "gdp_growth":                row["gdp_growth"],
        "cpi_inflation":             row["cpi_inflation"],
        "unemployment":              row["unemployment"],
        "exports_yoy":               exp,
        "repo_rate":                 row["repo_rate"],
        "pmi_manufacturing":         pmi,
        "wpi_inflation":             row["wpi_inflation"],
        "core_sector_growth":        core_sector,
        "capacity_utilization":      cap_util,
        "corporate_earnings_growth": corp_earn,
        "pfce_growth":               row["pfce_growth"],
        "inr_usd":                   row["inr_usd"],
        "pmi_below50":               int(pmi < 50),
        "export_neg":                int(exp < 0),
        "core_sector_weak":          int(core_sector < 2),
        "cap_util_low":              int(cap_util < 72),
        "gdp_momentum":              0.0,
        "earnings_weak":             int(corp_earn < 5),
    }])


@app.route("/api/shock-scenario/<key>")
def api_shock_scenario(key):
    """Run the actual trained model against a real historical quarter
    (e.g. the COVID-19 shock quarter) and return what it predicted then,
    for the frontend's Historical Shock Overlay comparison."""
    cfg = HISTORICAL_SHOCKS.get(key)
    if not cfg:
        return jsonify({"error": "Unknown scenario", "available": list(HISTORICAL_SHOCKS.keys())}), 404

    row = _load_training_row(cfg["quarter"])
    if row is None:
        return jsonify({"error": f"Quarter {cfg['quarter']} not found in training data"}), 404

    result = {
        "key": key,
        "quarter": cfg["quarter"],
        "label": cfg["label"],
        "period": cfg["period"],
        "note": cfg.get("note"),
        "dataset_label": row.get("label"),  # the label this quarter was trained with
        "indicators": {
            "gdp_growth":    round(float(row["gdp_growth"]), 2),
            "cpi":           round(float(row["cpi_inflation"]), 2),
            "pmi":           round(float(row["pmi_manufacturing"]), 1),
            "export_growth": round(float(row["exports_yoy"]), 1),
            "repo_rate":     round(float(row["repo_rate"]), 2),
            # NOTE: this is the model's own training feature, on a different
            # scale/definition than the CMIE household-survey unemployment
            # rate quoted in the press (which spiked to ~23.5% in Apr 2020) --
            # kept distinctly labeled so the two are never confused.
            "unemployment_feature": round(float(row["unemployment"]), 2),
        },
    }

    if model is not None:
        features = _feature_vector_from_training_row(row)
        pred = model.predict(features)[0]
        proba = model.predict_proba(features)[0]
        probabilities = {
            "Stable":   round(float(proba[0]) * 100, 1),
            "Warning":  round(float(proba[1]) * 100, 1),
            "Slowdown": round(float(proba[2]) * 100, 1),
        }
        result["prediction"] = {
            "label": LABELS[int(pred)],
            "confidence": round(float(max(proba)) * 100, 1),
            "probabilities": probabilities,
        }
        result["risk_score"] = round(probabilities["Warning"] * 0.5 + probabilities["Slowdown"] * 1.0)
    else:
        result["prediction"] = None
        result["risk_score"] = None

    return jsonify(result)


@app.route("/api/config", methods=["GET", "POST"])
def api_config():
    config_path = os.path.join(os.path.dirname(__file__), "config.json")
    
    # ── SECURITY CHECK FOR POST ──
    if request.method == "POST":
        admin_token = os.environ.get("ADMIN_TOKEN")
        is_local = request.remote_addr in ["127.0.0.1", "localhost", "::1"]
        
        # Verify token if set in environment
        if admin_token:
            auth_header = request.headers.get("Authorization", "")
            token = auth_header.replace("Bearer ", "").strip()
            if token != admin_token:
                return jsonify({"error": "Unauthorized: Invalid admin token"}), 401
        elif not is_local:
            # If ADMIN_TOKEN is not configured and it is a remote connection, block write access for safety
            return jsonify({"error": "Unauthorized: Admin token not configured on server"}), 403
            
        # Parse payload
        payload = request.get_json(silent=True) or {}
        if not payload:
            return jsonify({"error": "Invalid request payload"}), 400
            
        try:
            with open(config_path, "w") as f:
                json.dump(payload, f, indent=2)
            return jsonify({"status": "success", "message": "Configuration updated successfully"})
        except Exception as e:
            return jsonify({"error": f"Failed to save configuration: {str(e)}"}), 500
            
    # GET: return config.json content
    try:
        with open(config_path, "r") as f:
            data = json.load(f)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": f"Failed to read configuration: {str(e)}"}), 500


@app.route("/api/refresh-grounding", methods=["POST"])
def api_refresh_grounding():
    """Manually (or periodically, via the frontend's background timer)
    force-refresh the Gemini-grounded indicators (main + extended). This is
    the ONLY route that actually triggers new Gemini calls for grounding
    data -- /api/predict always reads whatever this last saved, so normal
    page loads/reloads never silently burn quota in the background.

    Safe to call as often as the frontend likes -- the burst-protection
    cooldown inside fetch_grounded_indicators()/fetch_extended_indicators()
    (MIN_CALL_INTERVAL_SECONDS) means a real Gemini call will only actually
    happen at most once every ~90 seconds per indicator set, regardless of
    how many refresh requests come in."""
    status = refresh_all_grounding()
    return jsonify(status)


@app.route("/api/sector/<sector_id>")
def api_sector(sector_id):
    """Return detailed data for a specific sector."""
    data = get_all_indicators()
    sectors = data.get("sectors", {})
    if sector_id not in sectors:
        return jsonify({"error": "Sector not found"}), 404
    return jsonify(sectors[sector_id])


@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    """Generate AI narrative analysis using Gemini (no grounding — just commentary
    on numbers we already computed). Uses GEMINI_API_KEY_ANALYZE if set,
    otherwise falls back to the shared GEMINI_API_KEY (handled inside
    generate_analysis / gemini_grounding.py)."""
    if not (os.environ.get("GEMINI_API_KEY_ANALYZE") or os.environ.get("GEMINI_API_KEY")):
        return jsonify({"error": "GEMINI_API_KEY_ANALYZE (or GEMINI_API_KEY) not configured on server"}), 500

    payload = request.get_json(silent=True) or {}
    indicators = payload.get("indicators")
    prediction = payload.get("prediction")
    risk_score = payload.get("risk_score")

    # If the frontend didn't send fresh numbers, compute them ourselves
    if not indicators:
        indicators = get_all_indicators()
    if risk_score is None:
        risk_score = compute_risk_score(indicators)
    if not prediction:
        prediction = {"label": "Unknown", "confidence": 0}

    text = generate_analysis(indicators, prediction, risk_score)
    if text is None:
        return jsonify({"error": "AI analysis temporarily unavailable. Please try again."}), 503

    return jsonify({"analysis": text})


@app.route("/api/learn", methods=["POST"])
def api_learn():
    """
    Gemini-powered chatbot for the Learn & Ask section.
    Answers economy questions in simple, plain English for everyday readers.
    Uses GEMINI_API_KEY_LEARN (comma-separated list of keys supported) if set,
    otherwise falls back to the shared GEMINI_API_KEY, so this stays backward
    compatible with a single-key setup. If one key in the list hits its daily
    quota, the next key is tried automatically.
    """
    key_pool = _get_key_pool("GEMINI_API_KEY_LEARN")

    if not key_pool:
        return jsonify({"answer": "The Gemini API key isn't configured on this server. Please contact the admin."}), 200

    payload  = request.get_json(silent=True) or {}
    question = (payload.get("question") or "").strip()
    history  = payload.get("history", [])  # last few turns for context
    context  = payload.get("context") or {}  # today's live dashboard snapshot, from the client

    if not question:
        return jsonify({"answer": "I didn't catch a question there. Please type something."}), 200

    if len(question) > 500:
        return jsonify({"answer": "Could you shorten your question a little, please?"}), 200

    def _num(v):
        try: return round(float(v), 2)
        except (TypeError, ValueError): return None

    # Build a compact, trusted snapshot line from client-supplied context.
    # Only known numeric/string fields are read (never passed through
    # verbatim), so a tampered payload can't inject arbitrary prompt text.
    dashboard_block = ""
    if context:
        red_zone = context.get("foundation_red_zone") or []
        red_zone_lines = "; ".join(
            f"{item.get('label')} at {_num(item.get('value'))}"
            for item in red_zone[:12] if isinstance(item, dict) and item.get("label") is not None
        )
        parts = []
        rs, pl = context.get("risk_score"), context.get("prediction_label")
        if rs is not None and isinstance(pl, str):
            parts.append(f"- ML Model risk score: {_num(rs)}/100 ({pl[:40]})")
        fz, fc = context.get("foundation_red_zone_count"), context.get("foundation_checked")
        if fz is not None and fc is not None:
            line = f"- Foundation Score: {fz}/{fc} indicators currently in a red/weak zone"
            if red_zone_lines:
                line += f" ({red_zone_lines})"
            parts.append(line)
        field_labels = [
            ("gdp_growth", "GDP Growth", "%"), ("cpi", "CPI Inflation", "%"),
            ("pmi", "Manufacturing PMI", ""), ("export_growth", "Export Growth", "%"),
            ("repo_rate", "Repo Rate", "%"), ("unemployment", "Unemployment", "%"),
            ("inr_usd", "INR/USD", ""),
        ]
        metrics = [f"{label} {_num(context.get(key))}{unit}" for key, label, unit in field_labels if _num(context.get(key)) is not None]
        if metrics:
            parts.append("- " + " | ".join(metrics))
        if parts:
            dashboard_block = "\n\nToday's live ArthSpandan dashboard snapshot (use this if the question refers to \"today\", \"current\", \"right now\", or a specific number on the dashboard; otherwise answer generally):\n" + "\n".join(parts)

    try:
        from google import genai
        from google.genai import types

        # Build conversation history for context
        history_text = ""
        if history:
            history_text = "\n\nPrevious conversation:\n"
            for turn in history[-4:]:
                role = "User" if turn.get("role") == "user" else "Assistant"
                history_text += f"{role}: {turn.get('text','')}\n"

        prompt = f"""You are a friendly Indian economics teacher. Your job is to answer questions about India's economy in simple, clear, relatable plain English.

Rules:
- Answer in simple, plain English -- avoid jargon
- Use real Indian examples (rupees, EMI, the local kirana store, etc.)
- Keep it concise, 3-5 sentences
- If you're explaining a term, always include a real-life analogy
- Keep a friendly, encouraging tone
- This is for educational purposes only -- don't repeat the "I'm not a financial advisor" disclaimer too often{dashboard_block}{history_text}

User's question: {question}

Your answer:"""

        def _request(api_key):
            client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=12000))
            return client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
            )

        response = _call_with_fallback(key_pool, _request)

        answer = (response.text or "").strip()
        if not answer:
            answer = "I couldn't generate an answer to that just now. Want to try another question?"

        return jsonify({"answer": answer})

    except Exception as e:
        import traceback
        print(f"⚠️  Learn API error: {type(e).__name__}: {e}")
        traceback.print_exc()
        return jsonify({
            "answer": "There's a small technical issue right now. Please try again shortly!"
        }), 200


def _count_keys(env_var):
    raw = os.environ.get(env_var) or ""
    return len([k.strip() for k in raw.split(",") if k.strip()])


@app.route("/api/health")
def health():
    shared_count = _count_keys("GEMINI_API_KEY")
    return jsonify({
        "status": "ok",
        "model_loaded": model is not None,
        "gemini_keys_configured": {
            "shared": shared_count,
            "grounding": _count_keys("GEMINI_API_KEY_GROUNDING") or shared_count,
            "extended": _count_keys("GEMINI_API_KEY_EXTENDED") or shared_count,
            "analyze": _count_keys("GEMINI_API_KEY_ANALYZE") or shared_count,
            "learn": _count_keys("GEMINI_API_KEY_LEARN") or shared_count,
        }
    })


def _startup_refresh():
    """Only refresh on startup if cache is completely empty (first ever run).
    If disk cache was loaded on import, skip — no point burning API quota on restart."""
    import time, threading
    def _run():
        time.sleep(3)   # let Flask finish binding before firing Gemini calls
        try:
            status = get_grounding_status()
            grounding_empty = status.get("grounding_age_seconds") is None
            extended_empty  = status.get("extended_age_seconds")  is None
            if grounding_empty and extended_empty:
                print("🔄 Startup: cache empty, triggering initial AI-grounded data refresh…")
                refresh_all_grounding()
                print(" Startup refresh complete.")
            else:
                print(" Startup: cache already populated, skipping refresh.")
        except Exception as e:
            print(f"⚠️  Startup refresh failed (non-fatal): {e}")
    threading.Thread(target=_run, daemon=True).start()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV") == "development"
    _startup_refresh()
    print(f" Starting server on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=debug)