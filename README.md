<div align="center">

# ArthSpandan

**AI-powered macroeconomic intelligence platform that monitors India's economic pulse using machine learning, real-time indicators, and explainable AI.**

[![Python](https://img.shields.io/badge/Python-3.11-blue?style=flat-square\&logo=python)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-3.0-black?style=flat-square\&logo=flask)](https://flask.palletsprojects.com)
[![scikit-learn](https://img.shields.io/badge/scikit--learn-1.4-orange?style=flat-square\&logo=scikit-learn)](https://scikit-learn.org)
[![Chart.js](https://img.shields.io/badge/Chart.js-4.4-pink?style=flat-square)](https://chartjs.org)
[![Vercel](https://img.shields.io/badge/Deployed-Vercel-black?style=flat-square\&logo=vercel)](https://vercel.com)

**[ Live Demo](https://arthspandan.vercel.app/)**  ·  **[ Research Paper](#)**  ·  **[ Training Data](model/training_data_v2.csv)**

</div>

---

## What it does

ArthSpandan combines **Machine Learning**, **macroeconomic intelligence**, and **high-frequency economic indicators** to detect early warning signs of an economic slowdown in India before they become visible in quarterly GDP releases.

The platform continuously analyzes multiple sectors of the economy and produces an interpretable slowdown risk assessment supported by real-time macroeconomic data.
| Sector               | Indicator                 | Source               |
| -------------------- | ------------------------- | -------------------- |
|  Manufacturing     | PMI (S&P Global)          | S&P Global / HSBC    |
|  Banking & Finance | Credit Growth YoY         | RBI SCB Data         |
|  Agriculture       | GVA Growth                | MOSPI                |
|  Trade & Exports   | Merchandise Export Growth | Ministry of Commerce |
|  Employment        | Urban Unemployment Rate   | CMIE CPHS            |

---

## Vision

ArthSpandan aims to make India's macroeconomic intelligence accessible through explainable AI.

Instead of relying solely on lagging indicators like quarterly GDP, the platform combines multiple leading economic indicators to provide an early assessment of the country's economic momentum, helping researchers, students, policymakers, investors, and businesses make better-informed decisions.

---

## Key Features

- AI-powered Economic Slowdown Prediction
- Explainable AI Insights with Grounded Analysis
- Foundation Score for macroeconomic health
- Historical Shock Overlay for event comparison
- Continuous Weighted Risk Score
- Multi-sector Economic Monitoring
- Live Economic Indicator Dashboard
- One-click ML Model Retraining
- Admin Configuration Dashboard
- Export Reports and Data
- Redis-backed High Performance Caching
- Serverless Deployment on Vercel

---

## ML Model

* **Algorithm:** Ensemble (Random Forest + Gradient Boosting, Soft Voting)
* **Training Data:** 52 quarterly observations (FY2013 Q1 – FY2025 Q4)
* **Features:** 18 macroeconomic and high-frequency indicators (12 raw + 6 derived)
* **Output:** Stable / Warning / Slowdown + Continuous Risk Score (0–100) / Foundation Score / Explainable AI Insights
* **5-Fold Cross Validation Accuracy:** ~80%
* **Leave-One-Out Accuracy:** ~78%
* **Data Sources:** MOSPI, RBI, CMIE, Ministry of Commerce, S&P Global, DPIIT, NSE

---

## Technology Stack

### Backend
- Python
- Flask

### Machine Learning
- scikit-learn
- Random Forest
- Gradient Boosting

### Frontend
- HTML5
- CSS3
- JavaScript
- Chart.js

### AI
- Google Gemini API

### Infrastructure
- Vercel
- Upstash Redis

### Data Sources
- RBI
- MOSPI
- S&P Global
- Ministry of Commerce
- NSE

---


## Run Locally

```bash
# Clone repository
git clone https://github.com/kartikeymishradev/india-slowdown-detector-fixed.git

# Enter project folder
cd india-slowdown-detector-fixed

# Install dependencies
pip install -r requirements.txt

# Train model (first time only)
python model/train_model.py

# Start Flask server
python app.py
```

Open:

```text
http://localhost:5000
```

---

##  Deploy on Vercel

### Push Repository

```bash
git init
git add .
git commit -m "Initial Commit"
git remote add origin https://github.com/YOUR_USERNAME/arthspandan.git
git push -u origin main
```

### Deploy

1. Login to Vercel
2. Click **New Project**
3. Import your GitHub repository
4. Deploy

After deployment:

```text
https://your-project.vercel.app
```

Every GitHub push automatically triggers a new deployment.

---

## Project Structure

```text
arthspandan/
├── app.py
├── vercel.json
├── model/
│   ├── train_model.py
│   ├── model.pkl
│   └── training_data.csv
├── data/
│   └── fetch_data.py
├── templates/
│   └── index.html
├── static/
│   ├── style.css
│   └── script.js
├── requirements.txt
└── README.md
```

## System Architecture

Data Sources
↓
Data Collection
↓
Feature Engineering
↓
Machine Learning Model
↓
Risk Assessment Engine
↓
Foundation Score
↓
AI Explanation Engine
↓
Interactive Dashboard

---

## API Endpoints

| Method | Endpoint | Description |
|---------|------------------------------------|-----------------------------------------------|
| GET | `/` | Dashboard UI |
| GET | `/api/predict` | ML prediction with risk score |
| GET | `/api/indicators` | Latest macroeconomic indicators |
| GET | `/api/sector/<id>` | Sector-specific analysis |
| GET | `/api/health` | Health check endpoint |
| GET | `/api/config` | Retrieve dashboard configuration |
| POST | `/api/config` | Update configuration (Admin) |
| POST | `/api/admin/retrain` | Retrain and deploy ML model |
| POST | `/api/admin/add-quarter` | Add new quarterly training data |
| POST | `/api/foundation-score/recompute` | Recalculate Foundation Score |
| POST | `/api/refresh-grounding` | Refresh AI-grounded macroeconomic analysis |
| GET | `/api/foundation-thresholds` | Retrieve Foundation Score thresholds |
| GET | `/api/shock-scenario/<key>` | Retrieve historical shock scenario definition |
| POST | `/api/analyze` | Generate AI commentary narrative analysis |
| POST | `/api/learn` | Gemini-powered chatbot for economic education |


---

## Features

### Economic Intelligence

- AI-powered macroeconomic slowdown prediction
- Continuous weighted risk scoring
- Foundation Score
- Historical Shock Overlay
- Multi-sector macroeconomic monitoring
- High-frequency indicator tracking

### Artificial Intelligence

- Explainable AI-generated analysis
- Gemini-powered grounded responses
- Machine learning ensemble prediction
- Confidence score estimation

### Dashboard

- Interactive economic charts
- Sector-wise analysis
- Historical trend visualization
- Responsive dashboard
- Export functionality

### Administration

- Secure Admin Dashboard
- Live configuration editor
- One-click ML model retraining
- Quarterly training data manager
- Threshold simulation sandbox

### Infrastructure

- Upstash Redis persistence
- Background synchronization
- Intelligent caching
- Serverless deployment
- Performance optimized

### Security Hardening

- Configurable Rate Limiting: Distinct throttling limits applied to public, auth, and user-action routes
- Failed Authentication Exponential Backoff: Automated lockout with exponential backoff base delay on invalid admin logins
- Strict Input Schema Validation: Strict validation checks (type, regex format, length, bounds) on all POST payloads
- Safe Error Handling: Secure exception processing that hides stack traces and system paths from clients

---

## Performance Optimizations

- Redis-backed caching
- Lazy-loaded charts
- Background data synchronization
- Response compression
- Optimized Lighthouse performance
- Serverless cold-start optimization

---

## Search & Analytics

- Google Search Console
- Google Analytics 4
- Schema.org Structured Data
- robots.txt
- XML Sitemap

---


## Research

**Paper Title**

*AI Driven Early Detection of Economic Slowdown in India Using Multi Sector High Frequency Indicators*

Presented at:

**National Conference on Machine Learning and Predictive Analytics Using Computational Science (NCMPCS-2026)**

Department of Computer Science & Engineering, FOET
Dr. Shakuntala Misra National Rehabilitation University, Lucknow
March 2026

---

## Roadmap

- [x] Economic Slowdown Prediction
- [x] AI Insights
- [x] Foundation Score
- [x] Historical Shock Overlay
- [x] Admin Dashboard
- [x] Model Retraining
- [x] Redis Persistence
- [ ] Economic Forecasting
- [ ] Public API
- [ ] Global Economy Support
- [ ] Mobile Application

---

## Disclaimer

This project is intended for academic research and educational purposes. Predictions are generated using historical macroeconomic data and machine learning models and should not be interpreted as official economic forecasts or financial advice.

---

<div align="center">

Built by Kartikey Mishra

Contributions by Mridul Rajput

B.Tech CSE (AI & Financial Management)
Dr. Shakuntala Misra National Rehabilitation University
Lucknow, India

</div>
