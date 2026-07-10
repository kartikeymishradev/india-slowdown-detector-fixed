<div align="center">

# 🇮🇳 India Economic Slowdown Detector

**AI-powered early warning system for economic slowdown detection**

[![Python](https://img.shields.io/badge/Python-3.11-blue?style=flat-square&logo=python)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-3.0-black?style=flat-square&logo=flask)](https://flask.palletsprojects.com)
[![scikit-learn](https://img.shields.io/badge/scikit--learn-1.4-orange?style=flat-square&logo=scikit-learn)](https://scikit-learn.org)
[![Gemini AI](https://img.shields.io/badge/Gemini-2.5_Flash-4285F4?style=flat-square&logo=google)](https://ai.google.dev)
[![Chart.js](https://img.shields.io/badge/Chart.js-4.4-pink?style=flat-square)](https://chartjs.org)
[![Render](https://img.shields.io/badge/Deployed-Render-46E3B7?style=flat-square)](https://render.com)

**[🔗 Live Demo](https://india-slowdown-detector.onrender.com)**

</div>

---

## What it does

Combines **Machine Learning** and **30+ high-frequency economic indicators** across 5 sectors to detect early signals of economic slowdown in India — before they appear in quarterly GDP numbers.

---

## Indicator Coverage (3 Categories)

### Core Activity
| Indicator | Source |
|-----------|--------|
| GST Collections (₹ Cr) | GST Council |
| UPI Transaction Volume (B) | NPCI |
| Electricity Demand (BU) | POSOCO / Grid India |
| Railway Freight Traffic (MT) | Indian Railways |
| E-Way Bills YoY Growth | GST Portal |
| PMI Services | S&P Global |

### Industrial & Credit
| Indicator | Source |
|-----------|--------|
| Core Sector IIP (8 industries) | MOSPI |
| PMI Manufacturing | S&P Global / HSBC |
| Bank Credit Growth YoY | RBI |
| Fuel Consumption – Diesel (MMT) | PPAC |
| Forex Reserves ($B) | RBI Weekly |
| Fiscal Deficit (% of GDP) | Ministry of Finance |

### External & Market
| Indicator | Source |
|-----------|--------|
| India VIX | NSE India |
| FII Net Flows (₹ Cr) | SEBI / NSDL |
| DII Net Flows (₹ Cr) | SEBI |
| Trade Balance ($B) | Ministry of Commerce |
| Import Growth YoY | MoC |
| INR Volatility | RBI |

---

## ML Model

- **Algorithm:** Ensemble — Random Forest + Gradient Boosting (soft voting)
- **Training data:** 32 quarterly observations, India 2018 Q1 – 2025 Q4
- **Features:** 12 core + derived (GDP, CPI, unemployment, exports, credit, PMI, agri GVA, repo rate, momentum flags)
- **Output:** Stable / Warning / Slowdown + confidence %
- **5-Fold CV Accuracy: 78.6%** | LOO Accuracy: 68.8%
- **Data sources:** MOSPI, RBI, CMIE, Ministry of Commerce, S&P Global

---

## Key Features

- **Live risk score** (0–100) updated from real data sources
- **3-tab indicator dashboard** — Core Activity / Industrial & Credit / External & Market
- **Tooltips** on every indicator with data source links
- **AI Analysis** — Gemini generates a paragraph-level economic assessment
- **Learn & Ask section** — 15 indicator definitions with real examples + Gemini chatbot for public education
- **Historical comparison chart** — 2019 slowdown vs COVID crash vs current

---

## Run Locally

```bash
# 1. Clone
git clone https://github.com/YOUR_USERNAME/india-slowdown-detector.git
cd india-slowdown-detector

# 2. Install
pip install -r requirements.txt

# 3. Create .env file
echo "GEMINI_API_KEY=your_key_here" > .env

# 4. Train ML model (only needed once)
python model/train_model.py

# 5. Start server
python app.py

# 6. Open browser → http://localhost:5000
```

Get a free Gemini API key at: https://aistudio.google.com/apikey

---

## Deploy on Render (Free)

```bash
git init && git add . && git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/india-slowdown-detector.git
git push -u origin main
```

1. Go to [render.com](https://render.com) → New Web Service
2. Connect your GitHub repo
3. Add Environment Variable: `GEMINI_API_KEY` = your key
4. Click Deploy — live URL in ~3 minutes ✅

---

## Project Structure

```
india-slowdown-detector/
├── app.py                  # Flask server + REST API (includes /api/learn)
├── model/
│   ├── train_model.py      # Ensemble ML training on real Indian data
│   ├── model.pkl           # Saved trained model
│   └── training_data.csv   # Real quarterly data 2018–2025
├── data/
│   ├── fetch_data.py       # Live data fetcher (GitHub open datasets)
│   └── gemini_grounding.py # Gemini + Google Search grounding
├── templates/index.html    # Full dashboard UI
├── static/
│   ├── style.css
│   └── script.js           # Charts + indicator tabs + Learn & Ask
├── .env                    # API keys (never commit this)
├── .gitignore
├── requirements.txt
├── render.yaml
└── README.md
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Dashboard UI |
| GET | `/api/predict` | ML prediction + risk score + all indicators |
| GET | `/api/indicators` | Raw indicator data |
| GET | `/api/sector/<id>` | Sector detail |
| POST | `/api/analyze` | Gemini AI analysis (sends indicator snapshot) |
| POST | `/api/learn` | Gemini chatbot for Learn & Ask section |
| GET | `/api/health` | Server health check |

---

## Research

**Paper:** *AI Driven Early Detection of Economic Slowdown in India Using Multi Sector High Frequency Indicators*

Presented at **NCMPCS-2026** — National Conference on Machine Learning and Predictive Analytics Using Computational Science, organized by Department of CSE, FOET, Dr. Shakuntala Misra National Rehabilitation University, Lucknow (March 2026).

---

<div align="center">
Built by <b>Kartikey Mishra</b> &nbsp;·&nbsp; DSMNRU Lucknow
</div>
