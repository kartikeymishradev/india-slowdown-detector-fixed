<div align="center">

# ArthSpandan

**AI-powered macroeconomic intelligence platform for tracking India's economic pulse and detecting early slowdown signals.**

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

## ML Model

* **Algorithm:** Ensemble (Random Forest + Gradient Boosting, Soft Voting)
* **Training Data:** 52 quarterly observations (FY2013 Q1 – FY2025 Q4)
* **Features:** 18 macroeconomic and high-frequency indicators (12 raw + 6 derived)
* **Output:** Stable / Warning / Slowdown + Confidence Score
* **5-Fold Cross Validation Accuracy:** ~80%
* **Leave-One-Out Accuracy:** ~78%
* **Data Sources:** MOSPI, RBI, CMIE, Ministry of Commerce, S&P Global, DPIIT, NSE

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

---

## API Endpoints

| Method | Endpoint           | Description                |
| ------ | ------------------ | -------------------------- |
| GET    | `/`                | Dashboard UI               |
| GET    | `/api/predict`     | ML Prediction + Risk Score |
| GET    | `/api/indicators`  | Indicator Data             |
| GET    | `/api/sector/<id>` | Sector Details             |
| GET    | `/api/health`      | Health Check               |

---

## Features

- AI-powered macroeconomic slowdown prediction
- Real-time economic indicator dashboard
- Multi-sector risk analysis
- Interactive macroeconomic visualizations
- Explainable AI-generated economic insights
- RESTful API architecture
- Responsive cross-device interface
- One-click deployment with Vercel

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
