"""
Live data fetcher for India Economic Slowdown Detector.

Priority order for each indicator:
  1. Free live APIs (no key required)
  2. config.json (manually updated monthly/quarterly)

Live APIs:
  - INR/USD       : frankfurter.app (ECB, free, no key)
  - CPI / GDP     : github.com/datasets (World Bank open data)
  - Exports YoY   : data.gov.in (Ministry of Commerce)

Hardcoded in config.json (update manually):
  - PMI + sub-indices + trend
  - Repo rate, credit growth, agri GVA, IIP, NPA, forex, fiscal deficit
  - All HF sub-indicators (rabi sowing, reservoir, MSP, EPFO etc.)
"""

import requests, io, json, os, time, threading
from datetime import datetime
import pandas as pd

try:
    from data.gemini_grounding import fetch_grounded_indicators, fetch_extended_indicators
except ImportError:
    from gemini_grounding import fetch_grounded_indicators, fetch_extended_indicators

# ── Short-TTL cache for live external calls ───────────────────────────────────
# fetch_inr_usd() / fetch_exports_yoy() used to be called fresh on EVERY
# /api/predict request. Under load or when the upstream API is slow, their
# timeouts+retries stacked up sequentially (worst case ~6s + ~24s = ~30s),
# which is exactly why /api/predict itself was taking ~28-34s. These
# indicators only change a few times a day at most, so we cache the result
# for a few minutes and serve it instantly on every other request; a slow
# upstream now only ever delays the (rare) background refresh, never a
# normal page load.
# We fetch them asynchronously in a background thread to prevent blocking.
_LIVE_TTL_SECONDS = 5 * 60
_live_cache = {}
_bg_fetching = set()
_bg_lock = threading.Lock()


def _trigger_background_fetch(key, fetch_fn):
    """Spins up a background thread to revalidate a live API value."""
    with _bg_lock:
        if key in _bg_fetching:
            return
        _bg_fetching.add(key)

    def _run():
        try:
            value = fetch_fn()
            if value is not None:
                _live_cache[key] = {"value": value, "ts": time.time()}
        finally:
            with _bg_lock:
                _bg_fetching.discard(key)

    threading.Thread(target=_run, daemon=True).start()


def _cached_live(key, fetch_fn, ttl=_LIVE_TTL_SECONDS, sync=False):
    """Return a cached value for `key` if still fresh. If expired or missing,
    either fetches synchronously (sync=True) or triggers background-thread
    revalidation (sync=False), guaranteeing zero request thread blocking for async keys."""
    now = time.time()
    entry = _live_cache.get(key)
    if entry:
        if (now - entry["ts"]) < ttl:
            return entry["value"]
        # Cache expired:
        if sync:
            value = fetch_fn()
            if value is not None:
                _live_cache[key] = {"value": value, "ts": now}
                return value
            return entry["value"]  # fallback to stale on failure
        else:
            _trigger_background_fetch(key, fetch_fn)
            return entry["value"]

    # Cache empty:
    if sync:
        value = fetch_fn()
        if value is not None:
            _live_cache[key] = {"value": value, "ts": now}
            return value
        return None
    else:
        _trigger_background_fetch(key, fetch_fn)
        return None


# ── Load config.json ──────────────────────────────────────────────────────────
CONFIG_PATH = os.path.join(os.path.dirname(__file__), '..', 'config.json')
_cached_config = None

def load_config():
    global _cached_config
    if _cached_config is not None:
        return _cached_config
        
    # Load local config.json immediately as base
    try:
        with open(CONFIG_PATH, 'r') as f:
            base_config = json.load(f)
    except Exception as e:
        print(f"[WARN] config.json not found or invalid: {e}")
        base_config = {}
        
    # Try fetching overrides from Redis synchronously (under 1-2 seconds)
    redis_url = os.environ.get("UPSTASH_REDIS_REST_URL") or os.environ.get("KV_REST_API_URL")
    redis_token = os.environ.get("UPSTASH_REDIS_REST_TOKEN") or os.environ.get("KV_REST_API_TOKEN")
    redis_key = "config_overrides_v1"
    
    if redis_url and redis_token:
        try:
            import urllib.request
            body = json.dumps(["GET", redis_key]).encode()
            req = urllib.request.Request(
                redis_url,
                data=body,
                headers={
                    "Authorization": f"Bearer {redis_token}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=2.0) as r:
                result = json.loads(r.read())
            if result.get("result"):
                overrides = json.loads(result["result"])
                _cached_config = overrides
                print("[OK] Config overrides loaded synchronously from Upstash Redis")
                return _cached_config
        except Exception as e:
            print(f"[WARN] Redis config load failed (falling back to local): {e}")
            
    _cached_config = base_config
    return _cached_config

# ── Live API fetchers ─────────────────────────────────────────────────────────

def fetch_inr_usd():
    """Live USD/INR with dual API backup (Frankfurter + ExchangeRate-API)."""
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
    
    # Source 1: Frankfurter API
    try:
        r = requests.get("https://api.frankfurter.app/latest?from=USD&to=INR", headers=headers, timeout=3.0)
        if r.status_code == 200:
            val = float(r.json()["rates"]["INR"])
            return round(val, 2)
    except Exception as e:
        print(f"[WARN] Frankfurter USD/INR fetch failed: {e}")

    # Source 2: ExchangeRate-API (Backup)
    try:
        r = requests.get("https://open.er-api.com/v6/latest/USD", headers=headers, timeout=3.0)
        if r.status_code == 200:
            val = float(r.json()["rates"]["INR"])
            return round(val, 2)
    except Exception as e:
        print(f"[WARN] ExchangeRate-API USD/INR backup fetch failed: {e}")
        
    return None


_STALE_DATA_MAX_AGE_YEARS = 1  # a dataset whose latest row is older than this is treated
                                # as unavailable rather than silently shown as "live"


def fetch_cpi_india():
    """CPI India from World Bank open dataset on GitHub.

    IMPORTANT CAVEAT: this dataset's 'CPI' column is a FULL CALENDAR-YEAR
    AVERAGE inflation rate, not a current monthly headline YoY figure, and
    World Bank typically only has the prior full year available (e.g. only
    up to 2024 partway through 2026). Treating that as "today's inflation"
    is materially misleading -- it can differ by a percentage point or more
    from the latest MOSPI monthly release, and mixes up "annual average" with
    "current month" even when the number happens to look plausible.

    We only return a value here if it's within _STALE_DATA_MAX_AGE_YEARS of
    the current year; otherwise we return None so the caller falls back to
    config.json's manually-curated, dated, MOSPI-sourced figure (or, better,
    the Gemini-grounded monthly figure -- see get_all_indicators())."""
    try:
        url = "https://raw.githubusercontent.com/datasets/cpi/master/data/cpi.csv"
        r = requests.get(url, timeout=10)
        if r.status_code == 200:
            df = pd.read_csv(io.StringIO(r.text))
            india = df[df['Country Code'] == 'IND'].sort_values('Year', ascending=False)
            if not india.empty:
                latest = india.iloc[0]
                year = int(latest['Year'])
                if datetime.now().year - year > _STALE_DATA_MAX_AGE_YEARS:
                    return None, None  # too stale to present as current data
                return round(float(latest['CPI']), 2), year
    except Exception:
        pass
    return None, None


def fetch_gdp_growth_india():
    """GDP growth rate India from World Bank open dataset on GitHub.

    IMPORTANT CAVEAT: this computes YoY % change on NOMINAL GDP in current
    USD -- so it bakes in both inflation and INR/USD exchange-rate movement,
    NOT the real GDP growth % that MOSPI/RBI/the press report as "GDP
    growth". World Bank data also typically lags 2+ years. This is a
    fundamentally different -- and usually quite different-looking --
    number from the headline "Real GDP Growth YoY" figure, even though both
    are percentages, so it should never be shown as if it were today's
    official growth rate.

    We only return a value here if it's within _STALE_DATA_MAX_AGE_YEARS of
    the current year; otherwise we return None so the caller falls back to
    config.json's manually-curated MOSPI figure (or, better, the
    Gemini-grounded real-GDP figure -- see get_all_indicators())."""
    try:
        url = "https://raw.githubusercontent.com/datasets/gdp/master/data/gdp.csv"
        r = requests.get(url, timeout=10)
        if r.status_code == 200:
            df = pd.read_csv(io.StringIO(r.text))
            india = df[df['Country Code'] == 'IND'].sort_values('Year')
            india = india.dropna(subset=['Value'])
            if len(india) >= 2:
                india['growth'] = india['Value'].pct_change() * 100
                india = india.dropna(subset=['growth'])
                latest = india.sort_values('Year', ascending=False).iloc[0]
                year = int(latest['Year'])
                if datetime.now().year - year > _STALE_DATA_MAX_AGE_YEARS:
                    return None, None  # too stale to present as current data
                val = round(float(latest['growth']), 2)
                if abs(val) < 30:
                    return val, year
    except Exception:
        pass
    return None, None


def fetch_exports_yoy(retries=1):
    """Merchandise exports YoY from data.gov.in (Ministry of Commerce).
    Retries on transient failures and sanity-checks the result before
    trusting it — a single bad/missing record should never produce a
    wild percentage swing on the dashboard."""
    api_key = os.environ.get("DATA_GOV_IN_API_KEY")
    if not api_key:
        return None
    url = (
        "https://api.data.gov.in/resource/e8b0e12d-f3a3-4cb0-84c9-4e4c7cf89dd0"
        f"?api-key={api_key}"
        "&format=json&limit=2"
    )
    for attempt in range(retries + 1):
        try:
            r = requests.get(url, timeout=4)
            if r.status_code == 200:
                records = r.json().get("records", [])
                if len(records) >= 2:
                    curr = float(records[0].get("value", 0))
                    prev = float(records[1].get("value", 1))
                    if prev > 0:
                        val = round((curr - prev) / prev * 100, 2)
                        # Sanity bound: export YoY swings beyond ±60% in a
                        # single month are almost certainly bad data, not reality
                        if -60 <= val <= 60:
                            return val
            # Non-200 or bad payload — fall through to retry
        except Exception:
            pass
    return None


# ── Build complete indicator set ──────────────────────────────────────────────

def get_all_indicators():
    cfg = load_config()
    
    # Load original base config from file to detect admin overrides
    try:
        with open(CONFIG_PATH, 'r') as f:
            base_config = json.load(f)
    except Exception:
        base_config = {}
        
    macro    = cfg.get("macro", {})
    pmi      = cfg.get("pmi", {})
    trends   = cfg.get("sector_trends", {})
    hf       = cfg.get("hf_indicators", {})
    fallback = cfg.get("fallback_defaults", {})

    sources_live = []

    # ── Live: INR/USD ──────────────────────────────────────────────────────────
    inr_usd = _cached_live("inr_usd", fetch_inr_usd, sync=False)
    if inr_usd is None:
        inr_usd = fallback.get("inr_usd", 94.5)  # last known fallback, see config.json
    else:
        sources_live.append("INR/USD:frankfurter.app")

    # ── CPI ───────────────────────────────────────────────────────────────────
    # NOTE: fetch_cpi_india() is intentionally NOT called here anymore. It
    # pulled from a World Bank annual-average dataset (github.com/datasets/cpi)
    # that is a full CALENDAR-YEAR average, typically 12-18 months stale
    # versus MOSPI's current monthly print, and silently overrode the
    # correct, dated, MOSPI-sourced fallback below whenever it happened to
    # return a row (verified: it was the exact source of a 4.95% vs the
    # real 3.93% mismatch). The Gemini-grounded "cpi" field below (tightly
    # prompted to reject sub-indices/annual-averages) is a materially better
    # "live" source and still gets first priority when available.
    cpi_val = fallback.get("cpi_inflation_pct", 3.93)  # see config.json fallback_defaults
    cpi_yr  = None  # set to a real month string below if Gemini grounding supplies one

    # ── GDP growth ───────────────────────────────────────────────────────────
    # NOTE: fetch_gdp_growth_india() is intentionally NOT called here anymore.
    # It derived a YoY% from the World Bank's NOMINAL GDP in current US$,
    # which conflates real growth, domestic inflation, and INR/USD movement —
    # not the same metric as MOSPI's real GDP growth rate, and 2-3 years
    # stale on top of that (verified: it was the exact source of a 5.86% vs
    # the real 7.8% mismatch). The Gemini-grounded "gdp_growth" field below
    # still gets first priority when available.
    gdp_val = fallback.get("gdp_growth_pct", 7.7)  # see config.json fallback_defaults
    gdp_yr  = None  # set to a real quarter string below if Gemini grounding supplies one

    # ── Live: Exports YoY ─────────────────────────────────────────────────────
    exp_val = _cached_live("exports_yoy", fetch_exports_yoy)
    if exp_val is None:
        exp_val = fallback.get("export_growth_pct", 16.09)  # see config.json fallback_defaults
    else:
        sources_live.append("Exports:data.gov.in")

    # ── From config.json ──────────────────────────────────────────────────────
    pmi_value       = pmi.get("value", 55.0)
    pmi_trend       = pmi.get("trend_12m", [55.0]*12)
    pmi_sub         = pmi.get("sub_indices", {})
    credit_growth   = macro.get("credit_growth", 7.8)
    repo_rate       = macro.get("repo_rate", 5.25)
    next_mpc        = macro.get("next_mpc_meeting", "3–5 Aug 2026")
    unemployment    = macro.get("unemployment", 5.5)
    agri_gva        = macro.get("agri_gva", 3.2)
    npa_ratio       = macro.get("npa_ratio", 2.8)
    forex_reserves  = macro.get("forex_reserves", 622.5)
    fiscal_deficit  = macro.get("fiscal_deficit", 4.9)
    iip_growth      = macro.get("iip_growth", 5.0)

    # ── Gemini + Google Search grounding (best-effort, cached, never crashes) ──
    grounded = fetch_grounded_indicators()
    grounded_fields = []
    if grounded:
        if "pmi" in grounded:
            if pmi_value == 55.0:
                pmi_value = grounded["pmi"]
                grounded_fields.append("pmi")
        if "credit_growth" in grounded:
            if credit_growth == 7.8:
                credit_growth = grounded["credit_growth"]
                grounded_fields.append("credit_growth")
        if "unemployment" in grounded:
            if unemployment == 5.5:
                unemployment = grounded["unemployment"]
                grounded_fields.append("unemployment")
        if "agri_gva" in grounded:
            if agri_gva == 3.2:
                agri_gva = grounded["agri_gva"]
                grounded_fields.append("agri_gva")
        if "repo_rate" in grounded:
            if repo_rate == 5.25:
                repo_rate = grounded["repo_rate"]
                grounded_fields.append("repo_rate")
            if grounded.get("next_mpc_meeting"):
                if next_mpc in ["3–5 Aug 2026", "3–7 Aug 2026", "3-5 Aug 2026", "3-7 Aug 2026"]:
                    next_mpc = grounded["next_mpc_meeting"]
        # Exports: only let grounding fill in if the real data.gov.in API
        # didn't already give us a value — a genuine government source
        # beats an AI-grounded search result when both are available.
        if "export_growth" in grounded and "Exports:data.gov.in" not in sources_live:
            if exp_val == 16.09:
                exp_val = grounded["export_growth"]
                grounded_fields.append("export_growth")
        # GDP growth & CPI: the World Bank fetches above are annual-average /
        # nominal-USD figures that are frequently 1-3 YEARS stale (see the
        # caveats on fetch_cpi_india/fetch_gdp_growth_india) — a Gemini-grounded
        # MOSPI monthly/quarterly figure, when available, is a materially
        # better and more current number and should take priority over them.
        if "gdp_growth" in grounded:
            gdp_val = grounded["gdp_growth"]
            gdp_yr = grounded.get("gdp_growth_period", gdp_yr)
            grounded_fields.append("gdp_growth")
        if "cpi" in grounded:
            cpi_val = grounded["cpi"]
            cpi_yr = grounded.get("cpi_month", cpi_yr)
            grounded_fields.append("cpi")
        if grounded_fields:
            sources_live.append(f"Gemini-grounded:{','.join(grounded_fields)}")

    banking_trend   = trends.get("banking_12m", [7.8]*12)
    agri_trend      = trends.get("agriculture_12m", [3.8]*12)
    employ_trend    = trends.get("employment_12m", [6.6]*12)

    # ── Extended indicators: GST, PMI Services, UPI, Electricity, Railway,
    #    E-way bills, Diesel, India VIX, FII flow — separate Gemini-grounded
    #    call so it has its own cache window and never blocks the main one.
    extended = fetch_extended_indicators()
    extended_fields = []

    pmi_services       = macro.get("pmi_services", 58.0)
    pmi_services_month = ""
    gst_collection      = macro.get("gst_collection", 185000)
    gst_collection_month = ""
    upi_volume          = macro.get("upi_volume", 16.5)
    electricity_demand  = macro.get("electricity_demand", 150.0)
    railway_freight     = macro.get("railway_freight", 128.0)
    eway_bill_growth    = macro.get("eway_bill_growth", 11.0)
    diesel_growth       = macro.get("diesel_consumption_growth", 3.5)
    india_vix           = macro.get("india_vix", 13.2)
    fii_net_flow        = macro.get("fii_net_flow", -2100)

    if extended:
        if "pmi_services" in extended:
            pmi_services = extended["pmi_services"]
            pmi_services_month = extended.get("pmi_services_month", "")
            extended_fields.append("pmi_services")
        if "gst_collection" in extended:
            gst_collection = extended["gst_collection"]
            gst_collection_month = extended.get("gst_collection_month", "")
            extended_fields.append("gst_collection")
        if "upi_volume" in extended:
            upi_volume = extended["upi_volume"]
            extended_fields.append("upi_volume")
        if "electricity_demand" in extended:
            electricity_demand = extended["electricity_demand"]
            extended_fields.append("electricity_demand")
        if "railway_freight" in extended:
            railway_freight = extended["railway_freight"]
            extended_fields.append("railway_freight")
        if "eway_bill_growth" in extended:
            eway_bill_growth = extended["eway_bill_growth"]
            extended_fields.append("eway_bill_growth")
        if "diesel_consumption_growth" in extended:
            diesel_growth = extended["diesel_consumption_growth"]
            extended_fields.append("diesel_consumption_growth")
        if "india_vix" in extended:
            india_vix = extended["india_vix"]
            extended_fields.append("india_vix")
        if "fii_net_flow" in extended:
            fii_net_flow = extended["fii_net_flow"]
            extended_fields.append("fii_net_flow")
        if extended_fields:
            sources_live.append(f"Gemini-grounded-ext:{','.join(extended_fields)}")

    # ── Trade Balance ($B) — calculated from exports/imports, not a separate API ──
    # Uses the trade sector's merchandise export/import figures already in config.json
    trade_hf_cfg = hf
    merch_exports = float(trade_hf_cfg.get("merchandise_exports_usd_b", 45.2))
    merch_imports = float(trade_hf_cfg.get("merchandise_imports_usd_b", 73.4))
    trade_balance = round(merch_exports - merch_imports, 2)

    # ── Derived / calculated features (auto-calculated, not fetched) ────────────
    services_pmi_below50 = int(pmi_services < 50)
    composite_pmi         = round((pmi_value + pmi_services) / 2, 2)
    # GST momentum needs a previous month figure; config.json can supply one,
    # otherwise we report 0.0 (no momentum signal) rather than guessing.
    gst_prev = macro.get("gst_collection_prev_month")
    gst_momentum = round((gst_collection - gst_prev) / gst_prev * 100, 2) if gst_prev else 0.0
    vix_high       = int(india_vix > 20)
    fii_outflow    = int(fii_net_flow < 0)
    trade_deficit_wide = int(trade_balance < -20)

    # ── Build SECTOR_DATA ─────────────────────────────────────────────────────
    sectors = {
        "manufacturing": {
            "name": "Manufacturing (PMI)",
            "desc": "HSBC India Manufacturing PMI (monthly, S&P Global)",
            "value": pmi_value,
            "unit": "",
            "avg": 55.8,
            "threshold": 50.0,
            "higher_good": True,
            # PMI has one economically meaningful line: 50 (expansion vs
            # contraction). Being a bit under the 12-month average while
            # still comfortably above 50 is normal, not a warning sign --
            # so don't downgrade to "Watch" purely for that.
            "warn_below_avg": False,
            "trend": pmi_trend,
            "hf": [
                {"label": "New orders index",     "value": pmi_sub.get("new_orders",  "59.2")},
                {"label": "Output index",         "value": pmi_sub.get("output",      "58.1")},
                {"label": "Employment sub-index", "value": pmi_sub.get("employment",  "53.4")},
                {"label": "Input price index",    "value": pmi_sub.get("input_price", "57.6")},
            ]
        },
        "banking": {
            "name": "Banking & Finance",
            "desc": "RBI — Scheduled Commercial Bank credit growth (YoY %)",
            "value": credit_growth,
            "unit": "%",
            "avg": 12.1,
            "threshold": 5.0,
            "higher_good": True,
            "trend": banking_trend,
            "hf": [
                {"label": "GNPA ratio (RBI FSR)",  "value": f"{npa_ratio}%"},
                {"label": "Repo rate",             "value": f"{repo_rate}%"},
                {"label": "Next MPC meeting",      "value": next_mpc},
                {"label": "Credit growth YoY",     "value": f"{credit_growth}%"},
                {"label": "Deposit growth YoY",    "value": hf.get("deposit_growth_yoy", "10.2%")},
            ]
        },
        "agriculture": {
            "name": "Agriculture",
            "desc": "MOSPI — Agriculture GVA growth YoY (%)",
            "value": agri_gva,
            "unit": "%",
            "avg": 3.5,
            "threshold": 1.5,
            "higher_good": True,
            "trend": agri_trend,
            "hf": [
                {"label": "Rabi sowing (Mha)",    "value": hf.get("rabi_sowing_mha",      "67.2")},
                {"label": "Reservoir levels",     "value": hf.get("reservoir_levels_pct", "68%")},
                {"label": "MSP wheat (₹/qtl)",    "value": hf.get("msp_wheat_per_qtl",    "2425")},
                {"label": "Food inflation (CPI)",  "value": hf.get("food_inflation_cpi",   "4.78%")},
            ]
        },
        "trade": {
            "name": "Trade & Exports",
            "desc": "MoC — Merchandise export growth YoY (%)",
            "value": exp_val,
            "unit": "%",
            "avg": 3.1,
            "threshold": -8.0,
            "higher_good": True,
            "trend": [8.5, 9.6, -8.0, -15.0, 5.5, 3.5, 1.0, -1.5, -4.5, 13.6, 15.83, round(exp_val, 2)],
            "hf": [
                {"label": "Merchandise exports ($B)", "value": str(merch_exports)},
                {"label": "Merchandise imports ($B)", "value": str(merch_imports)},
                {"label": "Trade deficit ($B)",       "value": str(trade_balance)},
                {"label": "Services exports (YoY)",   "value": hf.get("services_exports_yoy", "+13.0%")},
            ]
        },
        "employment": {
            "name": "Employment & Labour",
            "desc": "MOSPI — Urban unemployment rate (%)",
            "value": unemployment,
            "unit": "%",
            "avg": 7.0,
            "threshold": 10.0,
            "higher_good": False,
            "trend": employ_trend,
            "hf": [
                {"label": "Urban unemployment",      "value": f"{unemployment}%"},
                {"label": "Rural unemployment",      "value": hf.get("rural_unemployment",  "5.1%")},
                {"label": "EPFO net additions",      "value": hf.get("epfo_net_additions",  "1.58M")},
                {"label": "Labour force part. rate", "value": hf.get("labour_force_part",   "54.4%")},
            ]
        }
    }

    source_str = (
        "Live: " + ", ".join(sources_live) + " | config.json: PMI/Repo/Credit/Agri/IIP"
        if sources_live else "config.json + fallback defaults"
    )

    field_sources = {
        "gdp_growth":    "ai_grounded" if "gdp_growth" in grounded_fields
                          else "live" if any("GDP" in s for s in sources_live) else "manual",
        "cpi":           "ai_grounded" if "cpi" in grounded_fields
                          else "live" if any("CPI" in s for s in sources_live) else "manual",
        "inr_usd":       "live" if any("INR" in s for s in sources_live) else "manual",
        "export_growth": "live" if "Exports:data.gov.in" in sources_live
                          else "ai_grounded" if "export_growth" in grounded_fields
                          else "manual",
        "pmi":           "ai_grounded" if "pmi" in grounded_fields else "manual",
        "credit_growth": "ai_grounded" if "credit_growth" in grounded_fields else "manual",
        "unemployment":  "ai_grounded" if "unemployment" in grounded_fields else "manual",
        "agri_gva":      "ai_grounded" if "agri_gva" in grounded_fields else "manual",
        "repo_rate":     "ai_grounded" if "repo_rate" in grounded_fields else "manual",
    }

    return {
        "gdp_growth":     gdp_val,
        "gdp_growth_period": gdp_yr,   # e.g. "Q4 FY2025-26" (Gemini) or a WB year (int) or None
        "cpi":            cpi_val,
        "cpi_month":      cpi_yr,      # e.g. "May 2026" (Gemini) or a WB year (int) or None
        "repo_rate":      repo_rate,
        "next_mpc_meeting": next_mpc,
        "inr_usd":        inr_usd,
        "inr_change":     9.9,
        "iip_growth":     iip_growth,
        "pmi":            pmi_value,
        "credit_growth":  credit_growth,
        "export_growth":  exp_val,
        "unemployment":   unemployment,
        "agri_gva":       agri_gva,
        "npa_ratio":      npa_ratio,
        "forex_reserves": forex_reserves,
        "fiscal_deficit": fiscal_deficit,
        "sectors":        sectors,

        # ── Extended high-frequency indicators (Gemini + Search grounded) ──────
        "extended_indicators": {
            "pmi_services":              pmi_services,
            "pmi_services_month":        pmi_services_month,
            "gst_collection":            gst_collection,
            "gst_collection_month":      gst_collection_month,
            "upi_volume":                upi_volume,
            "electricity_demand":        electricity_demand,
            "railway_freight":           railway_freight,
            "eway_bill_growth":          eway_bill_growth,
            "diesel_consumption_growth": diesel_growth,
            "india_vix":                 india_vix,
            "fii_net_flow":              fii_net_flow,
            "trade_balance":             trade_balance,
        },

        # ── Derived / calculated features (auto-calculated from the above) ─────
        "derived_features": {
            "services_pmi_below50": services_pmi_below50,
            "composite_pmi":        composite_pmi,
            "gst_momentum":         gst_momentum,
            "vix_high":             vix_high,
            "fii_outflow":          fii_outflow,
            "trade_deficit_wide":   trade_deficit_wide,
        },

        # ── Demand & Supply Indicators (config-driven, quarterly update) ──────
        "demand_supply":  cfg.get("demand_supply", {}),

        "source":         source_str,
        "field_sources":  field_sources,
        "ai_grounding_note": grounded.get("source_note") if grounded else None,
        "ai_grounding_note_ext": extended.get("source_note") if extended else None,
        "data_note":      "Live where available; AI-grounded (Gemini+Search) for PMI/unemployment/credit/agri/GST/UPI/VIX/FII when reachable; config.json otherwise",
        "last_updated":   datetime.now().strftime("%d %b %Y, %I:%M %p IST"),
    }


def build_feature_vector(data):
    """Build named feature DataFrame for ML model v2.
    18 features matching training_data_v2.csv columns."""
    gdp  = data.get("gdp_growth", 7.7)
    pmi  = data.get("pmi", 55.0)
    exp  = data.get("export_growth", 16.09)
    ds   = data.get("demand_supply", {})
    dem  = ds.get("demand", {})
    sup  = ds.get("supply", {})

    core_sector  = sup.get("core_sector_growth",  {}).get("value", 3.0)
    cap_util     = sup.get("capacity_util",        {}).get("value", 74.0)
    corp_earn    = sup.get("corporate_earnings",   {}).get("value", 8.0)
    wpi          = sup.get("wpi_inflation",        {}).get("value", 3.0)
    pfce         = dem.get("pfce_growth",          {}).get("value", 7.0)

    return pd.DataFrame([{
        "gdp_growth":               gdp,
        "cpi_inflation":            data.get("cpi", 3.93),
        "unemployment":             data.get("unemployment", 5.5),
        "exports_yoy":              exp,
        "repo_rate":                data.get("repo_rate", 5.25),
        "pmi_manufacturing":        pmi,
        "wpi_inflation":            wpi,
        "core_sector_growth":       core_sector,
        "capacity_utilization":     cap_util,
        "corporate_earnings_growth": corp_earn,
        "pfce_growth":              pfce,
        "inr_usd":                  data.get("inr_usd", 84.0),
        # Derived features
        "pmi_below50":              int(pmi < 50),
        "export_neg":               int(exp < 0),
        "core_sector_weak":         int(core_sector < 2),
        "cap_util_low":             int(cap_util < 72),
        "gdp_momentum":             0.0,
        "earnings_weak":            int(corp_earn < 5),
    }])