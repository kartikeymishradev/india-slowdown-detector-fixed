"""
Gemini + Google Search grounding fetcher.

Uses Gemini's built-in google_search tool to look up indicators that have
no free official API (PMI, unemployment, credit growth, etc.) and asks the
model to return ONLY a strict JSON object extracted from the search results.

API KEY STRATEGY
-----------------
Each Gemini-calling feature uses its OWN pool of API keys so that one
feature's usage can't exhaust another feature's free-tier quota:

    GEMINI_API_KEY_GROUNDING  -> fetch_grounded_indicators()   (used by /api/predict)
    GEMINI_API_KEY_EXTENDED   -> fetch_extended_indicators()   (used by /api/predict)
    GEMINI_API_KEY_ANALYZE    -> generate_analysis()           (used by /api/analyze)
    GEMINI_API_KEY_LEARN      -> used directly in app.py's /api/learn route

AUTOMATIC FALLBACK CHAIN (multiple keys per feature)
------------------------------------------------------
Each of the env vars above can hold ONE key, or a COMMA-SEPARATED LIST of
keys, e.g.:

    GEMINI_API_KEY_GROUNDING=AIza...key1,AIza...key2,AIza...key3

When a feature needs to call Gemini, it tries each key in the list in
order. If a key returns a quota/rate-limit error (HTTP 429 / RESOURCE_EXHAUSTED),
that key is marked "exhausted" for the rest of the day (since the free tier
limit is a DAILY quota, not per-minute) and the NEXT key in the list is tried
automatically — no manual .env editing or redeploying required mid-day.

If a feature-specific env var isn't set at all, it falls back to the shared
GEMINI_API_KEY env var (which can also be a comma-separated list), so this
stays backward compatible with a single-key setup.

Exhausted-key tracking is in-memory and per-day: once a key 429s, we remember
its "cooldown until" timestamp (rounded up to the next UTC midnight, matching
Gemini's free-tier daily reset) and skip straight past it on later calls
without wasting a real API round-trip finding out it's still exhausted.
Note: on serverless platforms (Vercel) this in-memory tracking only persists
within a single warm container, so a cold start may "forget" that a key was
exhausted and re-try it once — this is harmless, it'll just get a quick 429
and move to the next key in the chain.

BURST PROTECTION (important for /api/predict)
------------------------------------------------
fetch_grounded_indicators() and fetch_extended_indicators() run on EVERY
hit to /api/predict, which fires automatically on every page load — this
is the highest-traffic, least user-controlled path in the app. A traffic
burst (e.g. a LinkedIn post going out) could mean many page loads within
the same minute, each one a candidate Gemini call.

To protect against this we use a MIN_CALL_INTERVAL_SECONDS cooldown that is
separate from (and shorter than) the long CACHE_TTL_SECONDS: even if the
6-hour cache is "expired" (e.g. due to a serverless cold start resetting
in-memory state), we will not call Gemini again until at least
MIN_CALL_INTERVAL_SECONDS has passed since the last attempt — successful
or not. Any request inside that cooldown window just gets whatever stale
cached data exists (or None, letting the caller fall back to config.json).

This trades a little freshness for a hard ceiling on how often Gemini can
possibly be called, no matter how many concurrent visitors hit the page.
"""

import os
import json
import time
import re
import tempfile
import traceback

CACHE_TTL_SECONDS = 6 * 60 * 60        # 6 hours — normal "data still fresh" window
MIN_CALL_INTERVAL_SECONDS = 90          # hard floor: never call Gemini more often than this,
                                         # regardless of cache state — this is what actually
                                         # protects the free-tier RPM limit during traffic bursts
_cache = {"data": None, "ts": 0, "last_attempt": 0}


# ──────────────────────────────────────────────────────────────────────────────
# DISK-BASED PERSISTENCE
# ──────────────────────────────────────────────────────────────────────────────
# On Vercel (serverless) the in-memory dicts above can be wiped between
# invocations whenever a cold start spins up a fresh container. To make the
# "last refreshed X minutes ago" badge and the manual-refresh-only behavior
# actually reliable, we ALSO persist the cached grounding data — primarily to
# Upstash Redis (works on Vercel), with a local disk file as a secondary
# fallback for local dev or if Redis env vars aren't configured.
#
# This is a best-effort durability layer, not a database — if Redis is
# unavailable for any reason, we fall back to disk, and if that's also
# unavailable we fall back to the in-memory state (which may be None on a
# true cold start), and the caller's existing config.json fallback kicks in
# as the final safety net.

# ── Upstash Redis cache (Vercel-persistent) ──────────────────────────────────
# Falls back to disk cache if Redis env vars not set (local dev).
# Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel env vars.
_REDIS_URL   = os.environ.get("UPSTASH_REDIS_REST_URL") or os.environ.get("KV_REST_API_URL")
_REDIS_TOKEN = os.environ.get("UPSTASH_REDIS_REST_TOKEN") or os.environ.get("KV_REST_API_TOKEN")
_REDIS_KEY   = "grounding_cache_v1"

# IMPORTANT: use tempfile.gettempdir() rather than a hardcoded path or a path
# relative to this file's directory. Vercel's deployed function filesystem is
# READ-ONLY except for the system temp directory -- writing anywhere under
# the project folder (e.g. "<project>/tmp") will raise a "Read-only file
# system" error in production. tempfile.gettempdir() resolves correctly on
# both Windows (local dev) and Linux (Vercel) without needing an OS check.
# This disk path is only ever used as a fallback if Redis isn't configured,
# but it still needs to not crash on Vercel if it's ever reached.
_CACHE_FILE = os.path.join(
    os.environ.get("GROUNDING_CACHE_DIR", tempfile.gettempdir()), "grounding_cache.json"
)


def _redis_get():
    """Fetch cache from Upstash Redis. Returns parsed dict or None.

    Uses Upstash's body-array command format: POST to the bare REST_URL with
    a JSON array body like ["GET", key] -- this is the format Upstash's own
    docs recommend for any command whose argument could contain special
    characters, since path-based commands (REST_URL/get/key) have to be
    careful about URL-encoding and have practical length limits."""
    if not _REDIS_URL or not _REDIS_TOKEN:
        return None
    try:
        import urllib.request
        body = json.dumps(["GET", _REDIS_KEY]).encode()
        req = urllib.request.Request(
            _REDIS_URL,
            data=body,
            headers={
                "Authorization": f"Bearer {_REDIS_TOKEN}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            result = json.loads(r.read())
        if result.get("result"):
            return json.loads(result["result"])
    except Exception as e:
        print(f"[WARN] Redis GET failed: {e}")
    return None


def _redis_set(data):
    """Save cache to Upstash Redis with 25-hour TTL. Best-effort.

    IMPORTANT: this previously built the request as
        f"{_REDIS_URL}/set/{_REDIS_KEY}/ex/90000"
    with the JSON payload only in the request body. That's wrong for
    Upstash's path-style command format -- path-style commands expect the
    VALUE itself to be part of the path (REST_URL/set/key/value), so "ex" and
    "90000" were being parsed as extra command arguments with no value ever
    provided, which is exactly the "400 Bad Request" we were seeing in
    production logs. Switched to Upstash's recommended body-array format:
    POST a JSON array ["SET", key, value, "EX", ttl_seconds] to the bare
    REST_URL. This also sidesteps any URL length/encoding limits on the
    (potentially large) JSON blob we're storing as the value."""
    if not _REDIS_URL or not _REDIS_TOKEN:
        return
    try:
        import urllib.request
        value_str = json.dumps(data)
        body = json.dumps(["SET", _REDIS_KEY, value_str, "EX", 90000]).encode()
        req = urllib.request.Request(
            _REDIS_URL,
            data=body,
            headers={
                "Authorization": f"Bearer {_REDIS_TOKEN}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            result = json.loads(r.read())
        if result.get("error"):
            print(f"[WARN] Redis SET returned error: {result['error']}")
        else:
            print("[OK] Redis SET succeeded: Grounding cache successfully saved to Upstash Redis")
    except Exception as e:
        print(f"[WARN] Redis SET failed: {e}")


def _load_disk_cache():
    """Load cache — local disk file only (fast, no network block)."""
    def _apply(target_cache, section):
        if not section:
            return
        if section.get("data"):
            target_cache["data"] = section["data"]
        raw_ts = section.get("ts")
        if raw_ts and float(raw_ts) > 0:
            target_cache["ts"] = float(raw_ts)

    try:
        if not os.path.exists(_CACHE_FILE):
            return
        with open(_CACHE_FILE, "r") as f:
            saved = json.load(f)
        _apply(_cache, saved.get("grounding"))
        _apply(_extended_cache, saved.get("extended"))
        print("[OK] Cache loaded from disk")
    except Exception as e:
        print(f"[WARN] Could not load grounding cache from disk: {e}")


def _save_disk_cache():
    """Save cache — tries Redis first (Vercel), also saves to disk (local dev)."""
    payload = {"grounding": _cache, "extended": _extended_cache}
    # Save to Redis
    _redis_set(payload)
    # Also save to disk (local dev fallback)
    try:
        os.makedirs(os.path.dirname(_CACHE_FILE), exist_ok=True)
        with open(_CACHE_FILE, "w") as f:
            json.dump(payload, f)
    except Exception as e:
        print(f"[WARN] Could not save grounding cache to disk: {e}")


_last_redis_sync = 0
_redis_sync_in_flight = False


def sync_cache_if_needed():
    """Sync cache from Upstash Redis asynchronously in a background thread
    if we haven't checked in the last 60 seconds. This avoids blocking the request thread."""
    global _last_redis_sync, _redis_sync_in_flight
    now = time.time()
    
    # Always load from local disk file first if memory cache is empty
    if _cache["data"] is None and _extended_cache["data"] is None:
        _load_disk_cache()
        
    if now - _last_redis_sync > 60:
        _last_redis_sync = now
        if not _redis_sync_in_flight:
            _redis_sync_in_flight = True
            import threading
            def _bg_sync():
                global _redis_sync_in_flight
                try:
                    saved = _redis_get()
                    if saved:
                        def _apply(target_cache, section):
                            if not section:
                                return
                            if section.get("data"):
                                target_cache["data"] = section["data"]
                            raw_ts = section.get("ts")
                            if raw_ts and float(raw_ts) > 0:
                                target_cache["ts"] = float(raw_ts)
                        _apply(_cache, saved.get("grounding"))
                        _apply(_extended_cache, saved.get("extended"))
                        print("[OK] Grounding cache synced from Upstash Redis (background)")
                        # Also save to local disk file so next container boot reads fast
                        try:
                            payload = {"grounding": _cache, "extended": _extended_cache}
                            os.makedirs(os.path.dirname(_CACHE_FILE), exist_ok=True)
                            with open(_CACHE_FILE, "w") as f:
                                json.dump(payload, f)
                        except:
                            pass
                except Exception as e:
                    print(f"[WARN] Background Redis cache sync failed: {e}")
                finally:
                    _redis_sync_in_flight = False
                    
            threading.Thread(target=_bg_sync, daemon=True).start()


# ──────────────────────────────────────────────────────────────────────────────
# MULTI-KEY FALLBACK CHAIN
# ──────────────────────────────────────────────────────────────────────────────

# key string -> unix timestamp until which this key should be skipped
# (because it last failed with a quota/rate-limit error)
_exhausted_until = {}


def _is_quota_error(exc):
    """True if this exception looks like a Gemini quota/rate-limit error
    (HTTP 429 / RESOURCE_EXHAUSTED), as opposed to some other failure
    (bad key, network error, etc.) that retrying a different key won't fix
    but that also isn't worth blacklisting a key over."""
    msg = str(exc)
    name = type(exc).__name__
    return (
        "429" in msg
        or "RESOURCE_EXHAUSTED" in msg
        or "RESOURCE_EXHAUSTED" in name
        or "quota" in msg.lower()
    )


def _seconds_until_next_utc_midnight():
    """Gemini's free-tier daily quota resets at midnight UTC (Pacific time
    for some products, but the per-day quota in practice resets close to
    UTC midnight) — we use UTC midnight as a safe, slightly conservative
    cooldown so an exhausted key isn't retried again until the quota almost
    certainly has reset."""
    now = time.time()
    seconds_today = now % 86400
    return 86400 - seconds_today + 60  # +60s safety margin


def _get_key_pool(specific_env_var):
    """Return an ordered list of candidate API keys for a feature.

    Reads the feature-specific env var (which may be a single key or a
    comma-separated list of keys). If that env var isn't set, falls back
    to the shared GEMINI_API_KEY env var (also comma-separated-list-aware).
    Keys already known to be exhausted today are filtered out, but if ALL
    keys are exhausted we still return the full original list — better to
    let the real API call fail with a clear error than to silently return
    nothing when a key might have recovered."""
    raw = os.environ.get(specific_env_var) or os.environ.get("GEMINI_API_KEY") or ""
    keys = [k.strip() for k in raw.split(",") if k.strip()]
    if not keys:
        return []

    now = time.time()
    fresh = [k for k in keys if _exhausted_until.get(k, 0) <= now]
    return fresh if fresh else keys


def _call_with_fallback(api_key_pool, make_request):
    """Try make_request(api_key) for each key in api_key_pool, in order.
    On a quota/rate-limit error, mark that key exhausted until the next
    UTC midnight and move to the next key. On any other exception (like a 504
    timeout or gateway error), still log it and proceed to the next key in
    the pool. Once every key has been tried, re-raise the last exception so
    the caller's fallback-to-cache logic applies.

    Returns the result of the first successful call."""
    last_exc = None
    for api_key in api_key_pool:
        try:
            return make_request(api_key)
        except Exception as e:
            last_exc = e
            if _is_quota_error(e):
                cooldown = _seconds_until_next_utc_midnight()
                _exhausted_until[api_key] = time.time() + cooldown
                print(
                    f"⚠️  Gemini key ending …{api_key[-6:]} hit quota limit, "
                    f"marking exhausted for ~{int(cooldown/3600)}h, trying next key"
                )
            else:
                print(
                    f"⚠️  Gemini key ending …{api_key[-6:]} failed with transient error: {e}. Trying next key in pool..."
                )
            continue  # try the next key in the pool
    # Every key in the pool was exhausted (or pool was empty)
    if last_exc:
        raise last_exc
    raise RuntimeError("No Gemini API keys configured for this feature")


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
- gdp_growth: the headline Real GDP Growth YoY % for the LATEST released quarter, taken
  EXCLUSIVELY from MOSPI's official provisional/quarterly GDP estimate press release.
  Do NOT return private bank (SBI Ecowrap, ICRA, Nomura, etc.) forecasts, IMF/World Bank
  projections, nominal GDP, or GVA growth -- only MOSPI's official real GDP YoY figure.
- gdp_growth_period: the quarter/period this GDP figure is for (string, e.g. "Q4 FY2025-26")
- cpi: the latest MONTHLY headline (all-India, combined) CPI inflation YoY %, as released by
  MOSPI's monthly CPI press release. Do NOT return an annual/calendar-year average, food
  inflation (CFPI), core inflation, rural-only, or urban-only sub-indices -- only the single
  latest month's headline combined CPI YoY number.
- cpi_month: the month/year this CPI figure is for (string, e.g. "May 2026")
- source_note: one short string naming the sources actually used

Respond with strictly this JSON shape and nothing else:
{"pmi": 0.0, "pmi_month": "", "credit_growth": 0.0, "unemployment": 0.0, "agri_gva": 0.0, "repo_rate": 0.0, "next_mpc_meeting": "", "export_growth": 0.0, "gdp_growth": 0.0, "gdp_growth_period": "", "cpi": 0.0, "cpi_month": "", "source_note": ""}

If you cannot find a confident value for a field from an official source, omit that key entirely rather than guessing or substituting a sub-index/forecast."""


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


def fetch_grounded_indicators(force=False):
    """Return a dict of live-ish indicators via Gemini + Google Search grounding,
    or None if unavailable for any reason (no key, API error, bad parse,
    or a burst-protection cooldown is active).

    By default (force=False) this NEVER calls Gemini itself -- it only
    returns whatever is already in the cache (in-memory or disk-persisted),
    however old that is. This is what lets /api/predict be called on every
    page load without ever silently burning quota in the background.

    Pass force=True to actually call Gemini and refresh the cache -- this is
    what the manual "Refresh AI Data" button (and the periodic background
    timer) should use, via refresh_all_grounding() below.

    Uses GEMINI_API_KEY_GROUNDING (comma-separated list supported, falls back
    to GEMINI_API_KEY). Automatically tries the next key in the pool if one
    hits its daily quota."""

    now = time.time()

    if not force:
        # Read-only path: just hand back whatever we've got, no Gemini call,
        # no matter how stale. Freshness is now entirely the job of the
        # manual/periodic refresh path.
        sync_cache_if_needed()
        return _cache["data"]

    # Only apply burst cooldown if not a manual force-refresh
    if not force and (now - _cache["last_attempt"]) < MIN_CALL_INTERVAL_SECONDS:
        return _cache["data"]

    _cache["last_attempt"] = now

    key_pool = _get_key_pool("GEMINI_API_KEY_GROUNDING")
    if not key_pool:
        return _cache["data"]

    try:
        from google import genai
        from google.genai import types

        def _request(api_key):
            # Explicit HTTP timeout so a slow Gemini call fails fast and
            # returns a clean error instead of running past Vercel's
            # serverless function timeout.
            client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=20000))
            return client.models.generate_content(
                model="gemini-2.5-flash",
                contents=FIELDS_PROMPT,
                config=types.GenerateContentConfig(
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                    temperature=0.0,
                ),
            )

        response = _call_with_fallback(key_pool, _request)

        text = response.text or ""
        parsed = _extract_json(text)
        if not parsed:
            print("⚠️  Gemini grounding: could not parse JSON from response")
            return _cache["data"]

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
        if "repo_rate" in parsed and 2 <= float(parsed["repo_rate"]) <= 10:
            clean["repo_rate"] = round(float(parsed["repo_rate"]), 2)
            if parsed.get("next_mpc_meeting"):
                clean["next_mpc_meeting"] = parsed["next_mpc_meeting"]
        if "export_growth" in parsed and -60 <= float(parsed["export_growth"]) <= 60:
            clean["export_growth"] = round(float(parsed["export_growth"]), 2)
        # Real GDP growth YoY -- sanity band rules out nominal-USD or
        # multi-year-stale figures being mistaken for the current quarter.
        if "gdp_growth" in parsed and -10 <= float(parsed["gdp_growth"]) <= 15:
            clean["gdp_growth"] = round(float(parsed["gdp_growth"]), 2)
            clean["gdp_growth_period"] = parsed.get("gdp_growth_period", "")
        # Headline monthly CPI YoY -- sanity band rules out an annual average
        # or a sub-index (food/core) sneaking in under the wrong label.
        if "cpi" in parsed and 0 <= float(parsed["cpi"]) <= 15:
            clean["cpi"] = round(float(parsed["cpi"]), 2)
            clean["cpi_month"] = parsed.get("cpi_month", "")
        clean["source_note"] = parsed.get("source_note", "Gemini + Google Search grounding")
        clean["fetched_at"] = time.strftime("%d %b %Y, %I:%M %p")

        if len(clean) <= 2:
            return _cache["data"]

        _cache["data"] = clean
        _cache["ts"] = now
        _save_disk_cache()
        return clean

    except Exception as e:
        print(f"⚠️  Gemini grounding failed: {type(e).__name__}: {e}")
        traceback.print_exc()
        return _cache["data"]


# ──────────────────────────────────────────────────────────────────────────────
# EXTENDED INDICATORS — second, separately-cached Gemini+Search grounding call
# for the 10 additional high-frequency indicators shown in the
# "Additional Indicators" dashboard section.
# Uses GEMINI_API_KEY_EXTENDED (comma-separated list supported, falls back to
# GEMINI_API_KEY). Same burst-protection cooldown + key-fallback strategy as
# fetch_grounded_indicators() above.
# ──────────────────────────────────────────────────────────────────────────────

EXTENDED_CACHE_TTL_SECONDS = 6 * 60 * 60
EXTENDED_MIN_CALL_INTERVAL_SECONDS = 90
_extended_cache = {"data": None, "ts": 0, "last_attempt": 0}

# Now that both _cache and _extended_cache exist, try to hydrate them from
# whatever was last persisted to disk (best-effort, see _load_disk_cache above).
_load_disk_cache()

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


def fetch_extended_indicators(force=False):
    """Return a dict of the 10 extended high-frequency indicators via Gemini +
    Google Search grounding, or None if unavailable for any reason (no key,
    API error, bad parse, or burst-protection cooldown active). Cached
    separately from fetch_grounded_indicators() so the two calls don't share
    or reset each other's quota window.

    By default (force=False) this NEVER calls Gemini -- only refresh_all_grounding()
    (force=True) does, via the manual "Refresh AI Data" button or the periodic
    background timer.

    Uses GEMINI_API_KEY_EXTENDED (comma-separated list supported, falls back
    to GEMINI_API_KEY)."""

    now = time.time()

    if not force:
        sync_cache_if_needed()
        return _extended_cache["data"]

    # Only apply burst cooldown if not a manual force-refresh
    if not force and (now - _extended_cache["last_attempt"]) < EXTENDED_MIN_CALL_INTERVAL_SECONDS:
        return _extended_cache["data"]

    _extended_cache["last_attempt"] = now

    key_pool = _get_key_pool("GEMINI_API_KEY_EXTENDED")
    if not key_pool:
        return _extended_cache["data"]

    try:
        from google import genai
        from google.genai import types

        def _request(api_key):
            client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=20000))
            return client.models.generate_content(
                model="gemini-2.5-flash",
                contents=EXTENDED_FIELDS_PROMPT,
                config=types.GenerateContentConfig(
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                    temperature=0.0,
                ),
            )

        response = _call_with_fallback(key_pool, _request)

        text = response.text or ""
        parsed = _extract_json(text)
        if not parsed:
            print("⚠️  Extended grounding: could not parse JSON from response")
            return _extended_cache["data"]

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

        if len(clean) <= 2:
            return _extended_cache["data"]

        _extended_cache["data"] = clean
        _extended_cache["ts"] = now
        _save_disk_cache()
        return clean

    except Exception as e:
        print(f"⚠️  Extended grounding failed: {type(e).__name__}: {e}")
        traceback.print_exc()
        return _extended_cache["data"]


# ──────────────────────────────────────────────────────────────────────────────
# AI NARRATIVE ANALYSIS — cached so repeated "Analyze" clicks don't hammer the
# same Gemini key and trip rate limits. Cache key includes risk_score + label
# so a genuinely new prediction still gets a fresh narrative.
# Uses GEMINI_API_KEY_ANALYZE (comma-separated list supported, falls back to
# GEMINI_API_KEY).
# ──────────────────────────────────────────────────────────────────────────────

ANALYSIS_CACHE_TTL_SECONDS = 30 * 60
ANALYSIS_MIN_CALL_INTERVAL_SECONDS = 20  # cheap extra guard against rapid double-clicks
_analysis_cache = {"text": None, "ts": 0, "key": None, "last_attempt": 0}


def generate_analysis(indicators, prediction, risk_score):
    """Generate a narrative AI analysis paragraph using Gemini (no grounding
    needed here — we already have the numbers, just want commentary).

    Uses GEMINI_API_KEY_ANALYZE (comma-separated list supported, falls back
    to GEMINI_API_KEY)."""

    key_pool = _get_key_pool("GEMINI_API_KEY_ANALYZE")
    if not key_pool:
        return None

    cache_key = f"{risk_score}-{prediction.get('label')}"
    now = time.time()

    if (
        _analysis_cache["text"] is not None
        and _analysis_cache["key"] == cache_key
        and (now - _analysis_cache["ts"]) < ANALYSIS_CACHE_TTL_SECONDS
    ):
        return _analysis_cache["text"]

    if (now - _analysis_cache["last_attempt"]) < ANALYSIS_MIN_CALL_INTERVAL_SECONDS:
        # Someone double-clicked or two users hit it within the same window --
        # serve whatever we last had rather than firing a second Gemini call.
        return _analysis_cache["text"]

    _analysis_cache["last_attempt"] = now

    try:
        from google import genai
        from google.genai import types

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

        def _request(api_key):
            client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=12000))
            return client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(temperature=0.0),
            )

        response = _call_with_fallback(key_pool, _request)
        text = response.text

        if not text:
            print("⚠️  Gemini analysis: empty response text")
            return _analysis_cache["text"]

        _analysis_cache["text"] = text
        _analysis_cache["ts"] = now
        _analysis_cache["key"] = cache_key
        return text

    except Exception as e:
        print(f"⚠️  Gemini analysis failed: {type(e).__name__}: {e}")
        traceback.print_exc()
        return _analysis_cache["text"]


# ──────────────────────────────────────────────────────────────────────────────
# MANUAL / PERIODIC REFRESH — used by the "Refresh AI Data" button and the
# frontend's background timer. This is the ONLY path that actually calls
# Gemini for the grounding + extended indicators; /api/predict always reads
# whatever this last saved (see force=False default above).
# ──────────────────────────────────────────────────────────────────────────────

def refresh_all_grounding():
    """Force-refresh both the main grounding indicators and the extended
    indicators concurrently by calling Gemini in parallel threads (respecting
    the multi-key fallback chain on each). This keeps the total execution time
    well below Vercel's 15-second Hobby plan serverless timeout limit.

    This never raises -- each underlying fetch already swallows its own
    exceptions and returns the last-known-good cached value on failure."""
    from concurrent.futures import ThreadPoolExecutor
    
    with ThreadPoolExecutor(max_workers=2) as executor:
        f_grounding = executor.submit(fetch_grounded_indicators, force=True)
        f_extended = executor.submit(fetch_extended_indicators, force=True)
        grounding_result = f_grounding.result()
        extended_result = f_extended.result()
        
    return {
        "grounding_updated": grounding_result is not None,
        "extended_updated": extended_result is not None,
        "grounding_last_updated": _cache.get("ts", 0),
        "extended_last_updated": _extended_cache.get("ts", 0),
    }


def get_grounding_status():
    """Lightweight status info for the frontend's 'Last refreshed X min ago'
    badge -- how old is each cache right now, in seconds. Returns None for a
    timestamp if that cache has never been successfully populated.
    Uses in-memory values to guarantee zero blocking on database requests."""
    sync_cache_if_needed()
    now = time.time()

    # In-memory ts (warm container, same process).
    # Use None sentinel — ts==0 means "never fetched", NOT a valid timestamp.
    g_ts = _cache.get("ts") or None      # converts 0 → None
    e_ts = _extended_cache.get("ts") or None

    return {
        "grounding_age_seconds": int(now - g_ts) if g_ts else None,
        "extended_age_seconds":  int(now - e_ts) if e_ts else None,
    }