<div align="center">

# 🇮🇳 ArthSpandan

**AI-powered early-warning system for economic slowdown detection in India**

[![Python](https://img.shields.io/badge/Python-3.11-blue?style=flat-square&logo=python)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-3.1-black?style=flat-square&logo=flask)](https://flask.palletsprojects.com)
[![scikit-learn](https://img.shields.io/badge/scikit--learn-1.5-orange?style=flat-square&logo=scikit-learn)](https://scikit-learn.org)
[![Gemini AI](https://img.shields.io/badge/Gemini-2.5_Flash-4285F4?style=flat-square&logo=google)](https://ai.google.dev)
[![Chart.js](https://img.shields.io/badge/Chart.js-4.4-pink?style=flat-square)](https://chartjs.org)
[![Vercel](https://img.shields.io/badge/Deployed-Vercel-000000?style=flat-square&logo=vercel)](https://vercel.com)

**[🔗 Live Demo](https://arthspandan.vercel.app)**

</div>

---

## What it does

ArthSpandan combines a **trained ML ensemble** and **30+ real-time economic indicators** to flag early signs of an economic slowdown in India — before they show up in official quarterly GDP data, which is typically confirmed 45–90 days late.

Every number the dashboard shows is designed to be **traceable and explainable**, not a black box:

- A **live ML risk score** (0–100) from a Random Forest + Gradient Boosting ensemble
- A separate, plain-English **Foundation Score** — a transparent count of how many indicators are past a known weak-zone threshold (e.g. `4/12`), computed independently of the ML model so the two can never silently disagree about what they saw
- A **Historical Shock Overlay** that runs the *same trained model* against real past Indian economic episodes (Demonetization, the NBFC/IL&FS crisis, the 2019 slowdown, COVID-19, the 2022 inflation shock) — pulled straight from the model's own training data, not re-estimated for demo purposes
- Both the flattering (5-fold CV) and the stricter (Leave-One-Out) accuracy are shown side by side, on purpose

---

## Key features

**Overview dashboard**
- Live macro indicators (GDP growth, CPI, repo rate, INR/USD, exports, unemployment)
- ML Model Prediction card with confidence breakdown across Stable / Warning / Slowdown
- Sector Health grid (Manufacturing, Banking & Finance, Agriculture, Trade & Exports, Employment)
- Foundation Score with an **interactive threshold sandbox** — drag any indicator's red-zone line and the backend recomputes the score live, without touching the real defaults
- Historical Shock Overlay comparing today against real historical crisis quarters

**Indicators & Trends**
- Demand & Supply indicator breakdown (MOSPI, RBI, SIAM, NSE, CGA sourced)
- High-frequency indicators (GST, NPCI, Grid-India, Railways)
- 12-month trend charts, feature importance chart, historical GDP/export/unemployment comparison

**AI Analysis & Learn & Ask**
- One-click Gemini-generated economic analysis grounded in the day's live indicators
- A chat assistant that answers plain-English questions about the economy, **aware of today's actual dashboard numbers** (risk score, Foundation Score red-zone items, key indicators) when relevant
- Suggestion chips mix a shuffled evergreen bank with chips generated live from today's data
- Metric names in AI answers are hover-able tooltips showing the live value

**Model Methodology modal**
- Click the ML Model card to see CV vs LOO accuracy explained, feature importance, and training setup — an honest accounting of what the model can and can't be trusted for

**Export & reporting**
- Download all current indicators as CSV
- Print-to-PDF report export (clean layout, no navigation chrome)

**Admin panel** (token-protected)
- Edit live config values and fallback defaults
- Add a new labeled quarter and trigger a full model retrain from the browser
- Force-refresh AI-grounded data on demand
- Raw config viewer + system diagnostics

---

## ML model

- **Algorithm:** Soft-voting ensemble — Random Forest + Gradient Boosting, wrapped in a `StandardScaler` pipeline
- **Class imbalance handling:** `class_weight='balanced'` on the Random Forest; since scikit-learn's `GradientBoostingClassifier` doesn't support `class_weight` directly, per-sample weights are computed via `compute_sample_weight('balanced', y)` and routed through the pipeline (`clf__sample_weight`) so both estimators train balanced
- **Training data:** 52 real quarterly observations, FY2013–FY2025 (label distribution: 13 Stable / 28 Warning / 11 Slowdown)
- **Features:** 18 (12 raw indicators + 6 engineered: PMI-below-50, export-negative, core-sector-weak, capacity-utilization-low, GDP momentum, earnings-weak)
- **Validation:** both 5-fold stratified CV and Leave-One-Out are reported — LOO is the more conservative, honest estimate on a small, time-correlated dataset. Exact current numbers are visible live in the app's **About** section and **Model Methodology** modal (they update automatically after any retrain, so this README intentionally doesn't hardcode a number that would go stale)
- **Labeling methodology:** documented in [`model/LABELING_METHODOLOGY.md`](model/LABELING_METHODOLOGY.md), including the known CMIE-vs-PLFS unemployment scale caveat
- **Data sources:** MOSPI, RBI, CMIE, Ministry of Commerce, S&P Global

---

## Tech stack

Python · Flask · scikit-learn · pandas · Gemini 2.5 Flash (grounded search) · Chart.js · Vercel · Upstash Redis (serverless-safe rate limiting & model persistence)

---

## Project structure

```
arthspandan/
├── app.py                       # Flask server, all REST routes, security/rate-limiting
├── config.json                  # Manually-curated indicator values + fallback defaults
├── vercel.json                  # Vercel function config, cron (daily grounding refresh), headers
├── requirements.txt
├── Procfile                     # gunicorn entrypoint (non-Vercel hosts)
├── test_security.py             # Manual verification script for rate limits / auth / input validation
├── model/
│   ├── train_model.py           # Ensemble training pipeline
│   ├── model.pkl                # Trained model (committed — loaded instantly on cold start)
│   ├── model_metadata.json      # Quarter count / date range / CV & LOO accuracy, shown live in-app
│   ├── training_data_v2.csv     # 52 labeled quarters, FY2013–FY2025
│   └── LABELING_METHODOLOGY.md  # How ground-truth labels were assigned
├── data/
│   ├── fetch_data.py            # Live indicator fetching + config.json fallback logic
│   └── gemini_grounding.py      # Gemini + Google Search grounding, API key pool/rotation
├── templates/
│   └── index.html               # Full dashboard UI
└── static/
    ├── style.css / style.min.css
    └── script.js / script.min.js
```

---

## Run locally

```bash
# 1. Clone
git clone https://github.com/kartikeymishradev/india-slowdown-detector-fixed.git
cd india-slowdown-detector-fixed

# 2. Install
pip install -r requirements.txt

# 3. Create a .env file (see Environment Variables below)
echo "GEMINI_API_KEY=your_key_here" > .env

# 4. Train the model (only needed if model/model.pkl isn't already committed,
#    or after changing training_data_v2.csv)
python model/train_model.py

# 5. Start the server
python app.py

# 6. Open http://localhost:5000
```

Get a free Gemini API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Shared fallback key used by every Gemini-powered feature if a feature-specific key isn't set. Comma-separated list supported for rotation. |
| `GEMINI_API_KEY_GROUNDING` | No | Overrides the shared key for live indicator grounding (`/api/predict`, `/api/refresh-grounding`) |
| `GEMINI_API_KEY_EXTENDED` | No | Overrides the shared key for extended high-frequency indicator grounding |
| `GEMINI_API_KEY_ANALYZE` | No | Overrides the shared key for the AI Analysis feature |
| `GEMINI_API_KEY_LEARN` | No | Overrides the shared key for the Learn & Ask chatbot |
| `ADMIN_TOKEN` | **Yes, in production** | Protects `/api/config`, `/api/admin/*`, `/api/refresh-grounding`. Without this set on a public deployment, admin auth denies all access by default (fail-closed). |
| `ADMIN_USER` | No | Defaults to `admin` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` / `KV_REST_API_TOKEN`) | Recommended in production | Makes rate limiting, admin login backoff, and retrained-model persistence survive serverless cold starts. Falls back to in-memory (per-instance only) if unset. |
| `DATA_GOV_IN_API_KEY` | No | Optional additional live data source |
| `PORT` | No | Defaults to `5000` locally |
| `FLASK_ENV` | No | Set to `development` for Flask debug/auto-reload locally |
| `GROUNDING_CACHE_DIR` | No | Override where the on-disk grounding cache is stored |

---

## Deployment (Vercel)

The project deploys as a single Flask app on Vercel:

- `vercel.json` sets a 60s max function duration and a daily cron (`/api/refresh-grounding` at 18:30 UTC) to keep AI-grounded indicators warm
- Set all required env vars above in **Vercel → Project → Settings → Environment Variables**
- `model.pkl` is committed to the repo and loads instantly on every cold start; if Upstash Redis is configured, a background thread checks for a newer retrained model and swaps it into memory without needing a redeploy

---

## API endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Dashboard UI |
| GET | `/api/predict` | ML prediction + risk score + Foundation Score + all indicators |
| GET | `/api/indicators` | Raw indicator data |
| GET | `/api/sector/<id>` | Sector detail |
| GET | `/api/foundation-thresholds` | Threshold metadata for the interactive sandbox sliders |
| POST | `/api/foundation-score/recompute` | Recompute Foundation Score against custom threshold overrides |
| GET | `/api/shock-scenario/<key>` | Run the real trained model against a real historical quarter |
| POST | `/api/analyze` | Gemini AI Analysis (grounded in current indicators) |
| POST | `/api/learn` | Gemini chatbot for Learn & Ask, dashboard-context-aware |
| GET/POST | `/api/config` | Admin: view/edit live config (token-protected) |
| POST | `/api/admin/add-quarter` | Admin: append a new labeled quarter to the training set |
| POST | `/api/admin/retrain` | Admin: retrain the model on the current training set |
| POST | `/api/refresh-grounding` | Admin/cron: force-refresh AI-grounded indicators |
| GET | `/api/health` | Server + model + configured-key health check |

---

## Security notes

- Admin routes are token-protected and **fail closed**: if `ADMIN_TOKEN` isn't set, production access is denied rather than opened
- Client IP for rate limiting is read from `X-Forwarded-For` (which Vercel's edge overwrites and protects from spoofing), never from client-suppliable headers alone
- Public and admin-auth endpoints are rate-limited, with exponential backoff on repeated failed admin logins
- Admin input (e.g. adding a new quarter) is validated for type, format, length, and rejects unexpected extra fields before touching the training set

---

## Research

**Paper:** *AI-Driven Early Detection of Economic Slowdown in India Using Multi-Sector High-Frequency Indicators*

Presented at **NCMPCS-2026** — National Conference on Machine Learning and Predictive Analytics Using Computational Science, Department of CSE, FOET, Dr. Shakuntala Misra National Rehabilitation University, Lucknow.

---

<div align="center">
Built by <b>Kartikey Mishra</b> &amp; <b>Mridul Singh Jadaun</b> &nbsp;·&nbsp; DSMNRU Lucknow
</div>
