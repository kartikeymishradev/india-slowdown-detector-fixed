"""
Gemini + Google Search grounding fetcher.

Uses Gemini's built-in google_search tool to look up indicators that have
no free official API (PMI, unemployment, credit growth, etc.) and asks the
model to return ONLY a strict JSON object extracted from the search results.

Caching: results are cached in-memory for CACHE_TTL_SECONDS so we don't
burn through the free-tier grounding quota (5,000 prompts/month) on every
page refresh.

This is best-effort. If the key is missing, the call fails, or the model's
output isn't valid JSON, we return None and the caller falls back to
config.json values. We never let this crash the app.
"""

import os
import json
import time
import re

CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 hours — plenty fresh for monthly-ish data
_cache = {"data": None, "ts": 0}

GEMINI_KEY = os.environ.get("GEMINI_API_KEY")

FIELDS_PROMPT = """Search for the most recent, official values of these India economic indicators and return ONLY a JSON object — no markdown, no explanation, no code fences.

Fields to find (use the latest available figure, prefer official sources: RBI, MOSPI, S&P Global/HSBC, CMIE, Ministry of Commerce):
- pmi: latest HSBC/S&P Global India Manufacturing PMI value (number)
- pmi_month: the month/year this PMI value is for (string, e.g. "May 2026")
- credit_growth: RBI scheduled commercial bank non-food credit growth YoY % (number)
- unemployment: CMIE or PLFS urban unemployment rate % (number)
- agri_gva: latest Agriculture GVA growth YoY % from MOSPI (number)
- repo_rate: RBI's current policy repo rate % as set by the Monetary Policy Committee (number)
- next_mpc_meeting: dates of the next scheduled RBI MPC meeting (string, e.g. "5-7 Aug 2026")
- export_growth: latest merchandise exports YoY growth % from Ministry of Commerce (number)
- source_note: one short string naming the sources actually used

Respond with strictly this JSON shape and nothing else:
{"pmi": 0.0, "pmi_month": "", "credit_growth": 0.0, "unemployment": 0.0, "agri_gva": 0.0, "repo_rate": 0.0, "next_mpc_meeting": "", "export_growth": 0.0, "source_note": ""}

If you cannot find a confident value for a field, omit that key entirely rather than guessing."""


def _extract_json(text):
    """Pull a JSON object out of model text, tolerating stray markdown fences."""
    text = text.strip()
    text = re.sub(r"^```(json)?", "", text).strip()
    text = re.sub(r"```$", "", text).strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def fetch_grounded_indicators():
    """Return a dict of live-ish indicators via Gemini + Google Search grounding,
    or None if unavailable for any reason (no key, API error, bad parse)."""

    now = time.time()
    if _cache["data"] is not None and (now - _cache["ts"]) < CACHE_TTL_SECONDS:
        return _cache["data"]

    if not GEMINI_KEY:
        return None

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=GEMINI_KEY)

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=FIELDS_PROMPT,
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
            ),
        )

        text = response.text or ""
        parsed = _extract_json(text)
        if not parsed:
            print("⚠️  Gemini grounding: could not parse JSON from response")
            return None

        # Basic sanity checks so garbage never reaches the model/UI
        clean = {}
        if "pmi" in parsed and 30 <= float(parsed["pmi"]) <= 70:
            clean["pmi"] = round(float(parsed["pmi"]), 1)
            clean["pmi_month"] = parsed.get("pmi_month", "")
        if "credit_growth" in parsed and 0 <= float(parsed["credit_growth"]) <= 30:
            clean["credit_growth"] = round(float(parsed["credit_growth"]), 2)
        if "unemployment" in parsed and 0 <= float(parsed["unemployment"]) <= 25:
            clean["unemployment"] = round(float(parsed["unemployment"]), 2)
        if "agri_gva" in parsed and -10 <= float(parsed["agri_gva"]) <= 15:
            clean["agri_gva"] = round(float(parsed["agri_gva"]), 2)
        # Repo rate moves in small steps and rarely strays outside 2-10% in
        # practice — reject anything wilder as a likely hallucination
        if "repo_rate" in parsed and 2 <= float(parsed["repo_rate"]) <= 10:
            clean["repo_rate"] = round(float(parsed["repo_rate"]), 2)
            if parsed.get("next_mpc_meeting"):
                clean["next_mpc_meeting"] = parsed["next_mpc_meeting"]
        if "export_growth" in parsed and -60 <= float(parsed["export_growth"]) <= 60:
            clean["export_growth"] = round(float(parsed["export_growth"]), 2)
        clean["source_note"] = parsed.get("source_note", "Gemini + Google Search grounding")
        clean["fetched_at"] = time.strftime("%d %b %Y, %I:%M %p")

        if len(clean) <= 2:  # only source_note/fetched_at, nothing useful parsed
            return None

        _cache["data"] = clean
        _cache["ts"] = now
        return clean

    except Exception as e:
        print(f"⚠️  Gemini grounding failed: {e}")
        return None


# ──────────────────────────────────────────────────────────────────────────────
# EXTENDED INDICATORS — second, separately-cached Gemini+Search grounding call
# for the 10 additional high-frequency indicators shown in the
# "Additional Indicators" dashboard section.
# ──────────────────────────────────────────────────────────────────────────────

EXTENDED_CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 hours, same cadence as the main call
_extended_cache = {"data": None, "ts": 0}

EXTENDED_FIELDS_PROMPT = """Search for the most recent, official values of these India high-frequency economic indicators and return ONLY a JSON object — no markdown, no explanation, no code fences.

Fields to find (use the latest available figure, prefer official sources: GST Council, NPCI, POSOCO/Grid-India, Indian Railways, GSTN e-way bill portal, PPAC, S&P Global/HSBC, NSE India, NSDL):
- pmi_services: latest HSBC/S&P Global India Services PMI value (number)
- pmi_services_month: the month/year this Services PMI value is for (string, e.g. "May 2026")
- gst_collection: latest monthly GST collection in INR crore (number)
- gst_collection_month: month this GST figure is for (string)
- upi_volume: latest monthly UPI transaction volume in billions of transactions (number)
- electricity_demand: latest monthly electricity demand/consumption in Billion Units, BU (number)
- railway_freight: latest monthly railway freight loading in Million Tonnes, MT (number)
- eway_bill_growth: latest e-way bill generation YoY growth % (number)
- diesel_consumption_growth: latest petroleum/diesel consumption YoY growth % (number)
- india_vix: latest India VIX (volatility index) closing value (number)
- fii_net_flow: latest month's FII (Foreign Institutional Investor) net flow into Indian equities in INR crore, negative if net outflow (number)
- source_note: one short string naming the sources actually used

Respond with strictly this JSON shape and nothing else:
{"pmi_services": 0.0, "pmi_services_month": "", "gst_collection": 0.0, "gst_collection_month": "", "upi_volume": 0.0, "electricity_demand": 0.0, "railway_freight": 0.0, "eway_bill_growth": 0.0, "diesel_consumption_growth": 0.0, "india_vix": 0.0, "fii_net_flow": 0.0, "source_note": ""}

If you cannot find a confident value for a field, omit that key entirely rather than guessing."""


def fetch_extended_indicators():
    """Return a dict of the 10 extended high-frequency indicators via Gemini +
    Google Search grounding, or None if unavailable for any reason (no key,
    API error, bad parse). Cached separately from fetch_grounded_indicators()
    so the two calls don't share or reset each other's quota window."""

    now = time.time()
    if _extended_cache["data"] is not None and (now - _extended_cache["ts"]) < EXTENDED_CACHE_TTL_SECONDS:
        return _extended_cache["data"]

    if not GEMINI_KEY:
        return None

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=GEMINI_KEY)

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=EXTENDED_FIELDS_PROMPT,
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
            ),
        )

        text = response.text or ""
        parsed = _extract_json(text)
        if not parsed:
            print("⚠️  Extended grounding: could not parse JSON from response")
            return None

        # Sanity-bound every field so a hallucinated number never reaches the UI
        clean = {}
        if "pmi_services" in parsed and 30 <= float(parsed["pmi_services"]) <= 70:
            clean["pmi_services"] = round(float(parsed["pmi_services"]), 1)
            clean["pmi_services_month"] = parsed.get("pmi_services_month", "")
        if "gst_collection" in parsed and 50000 <= float(parsed["gst_collection"]) <= 500000:
            clean["gst_collection"] = round(float(parsed["gst_collection"]), 0)
            clean["gst_collection_month"] = parsed.get("gst_collection_month", "")
        if "upi_volume" in parsed and 1 <= float(parsed["upi_volume"]) <= 50:
            clean["upi_volume"] = round(float(parsed["upi_volume"]), 2)
        if "electricity_demand" in parsed and 50 <= float(parsed["electricity_demand"]) <= 300:
            clean["electricity_demand"] = round(float(parsed["electricity_demand"]), 1)
        if "railway_freight" in parsed and 50 <= float(parsed["railway_freight"]) <= 250:
            clean["railway_freight"] = round(float(parsed["railway_freight"]), 1)
        if "eway_bill_growth" in parsed and -50 <= float(parsed["eway_bill_growth"]) <= 80:
            clean["eway_bill_growth"] = round(float(parsed["eway_bill_growth"]), 2)
        if "diesel_consumption_growth" in parsed and -40 <= float(parsed["diesel_consumption_growth"]) <= 60:
            clean["diesel_consumption_growth"] = round(float(parsed["diesel_consumption_growth"]), 2)
        if "india_vix" in parsed and 5 <= float(parsed["india_vix"]) <= 90:
            clean["india_vix"] = round(float(parsed["india_vix"]), 2)
        if "fii_net_flow" in parsed and -100000 <= float(parsed["fii_net_flow"]) <= 100000:
            clean["fii_net_flow"] = round(float(parsed["fii_net_flow"]), 0)
        clean["source_note"] = parsed.get("source_note", "Gemini + Google Search grounding")
        clean["fetched_at"] = time.strftime("%d %b %Y, %I:%M %p")

        if len(clean) <= 2:  # only source_note/fetched_at, nothing useful parsed
            return None

        _extended_cache["data"] = clean
        _extended_cache["ts"] = now
        return clean

    except Exception as e:
        print(f"⚠️  Extended grounding failed: {e}")
        return None


def generate_analysis(indicators, prediction, risk_score):
    """Generate a narrative AI analysis paragraph using Gemini (no grounding
    needed here — we already have the numbers, just want commentary)."""

    if not GEMINI_KEY:
        return None

    try:
        from google import genai

        client = genai.Client(api_key=GEMINI_KEY)

        prompt = f"""You are an expert Indian economic analyst. Analyze these current indicators and give a concise 3-4 paragraph insight in clear, simple English.

Current Economic Status: {prediction.get('label', 'Unknown')} (Risk Score: {risk_score}/100)
Confidence: {prediction.get('confidence', 0)}%

Key Indicators:
- GDP Growth: {indicators.get('gdp_growth')}%
- CPI Inflation: {indicators.get('cpi')}%
- Repo Rate: {indicators.get('repo_rate')}%
- INR/USD: Rs {indicators.get('inr_usd')}
- Export Growth YoY: {indicators.get('export_growth')}%
- Unemployment: {indicators.get('unemployment')}%
- PMI: {indicators.get('pmi')}
- Credit Growth: {indicators.get('credit_growth')}%

Structure your answer as:
1. Overall assessment
2. Key risks to watch
3. Positive signals
4. Short-term outlook (next 1-2 quarters)

Be specific to India's current economic context. Do not use markdown headers, just flowing paragraphs."""

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        return response.text

    except Exception as e:
        print(f"⚠️  Gemini analysis failed: {e}")
        return None
