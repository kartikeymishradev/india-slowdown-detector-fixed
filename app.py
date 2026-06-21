"""
Flask backend for India Economic Slowdown Detector
Run locally: python app.py
"""

import os
import sys
import json
import joblib
import numpy as np
from flask import Flask, jsonify, render_template, request
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.dirname(__file__))
from data.fetch_data import get_all_indicators, build_feature_vector
from data.gemini_grounding import generate_analysis

app = Flask(__name__)
CORS(app)

# Load ML model (train first if missing)
MODEL_PATH = os.path.join(os.path.dirname(__file__), "model", "model.pkl")
model = None

def load_model():
    global model
    if os.path.exists(MODEL_PATH):
        model = joblib.load(MODEL_PATH)
        print("✅ ML model loaded")
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
    risk_score = compute_risk_score(data)

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
    else:
        # Rule-based fallback if model not trained yet
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
        "indicators": data,
        "model_loaded": model is not None
    })


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
    Uses GEMINI_API_KEY_LEARN if set, otherwise falls back to the shared
    GEMINI_API_KEY, so this stays backward compatible with a single-key setup.
    """
    learn_key = os.environ.get("GEMINI_API_KEY_LEARN") or os.environ.get("GEMINI_API_KEY")

    if not learn_key:
        return jsonify({"answer": "The Gemini API key isn't configured on this server. Please contact the admin."}), 200

    payload  = request.get_json(silent=True) or {}
    question = (payload.get("question") or "").strip()
    history  = payload.get("history", [])  # last few turns for context

    if not question:
        return jsonify({"answer": "I didn't catch a question there. Please type something."}), 200

    if len(question) > 500:
        return jsonify({"answer": "Could you shorten your question a little, please?"}), 200

    try:
        from google import genai

        client = genai.Client(api_key=learn_key)

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
- This is for educational purposes only -- don't repeat the "I'm not a financial advisor" disclaimer too often{history_text}

User's question: {question}

Your answer:"""

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )

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


@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "model_loaded": model is not None,
        "gemini_keys_configured": {
            "shared": bool(os.environ.get("GEMINI_API_KEY")),
            "grounding": bool(os.environ.get("GEMINI_API_KEY_GROUNDING")),
            "extended": bool(os.environ.get("GEMINI_API_KEY_EXTENDED")),
            "analyze": bool(os.environ.get("GEMINI_API_KEY_ANALYZE")),
            "learn": bool(os.environ.get("GEMINI_API_KEY_LEARN")),
        }
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV") == "development"
    print(f"🚀 Starting server on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=debug)
