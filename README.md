<div align="center">

# 🇮🇳 India Economic Slowdown Detector

**AI-powered early warning system for economic slowdown detection**

[![Python](https://img.shields.io/badge/Python-3.11-blue?style=flat-square\&logo=python)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-3.0-black?style=flat-square\&logo=flask)](https://flask.palletsprojects.com)
[![scikit-learn](https://img.shields.io/badge/scikit--learn-1.4-orange?style=flat-square\&logo=scikit-learn)](https://scikit-learn.org)
[![Chart.js](https://img.shields.io/badge/Chart.js-4.4-pink?style=flat-square)](https://chartjs.org)
[![Vercel](https://img.shields.io/badge/Deployed-Vercel-black?style=flat-square\&logo=vercel)](https://vercel.com)

**[🔗 Live Demo](https://india-slowdown-detector.vercel.app/)**  ·  **[📄 Research Paper](#)**  ·  **[📊 Training Data](model/training_data.csv)**

</div>

---

## 🔍 What it does

Combines **Machine Learning** and **high-frequency economic indicators** from 5 sectors to detect early signals of economic slowdown in India — before they appear in quarterly GDP releases.

| Sector               | Indicator                 | Source               |
| -------------------- | ------------------------- | -------------------- |
| 🏭 Manufacturing     | PMI (S&P Global)          | S&P Global / HSBC    |
| 🏦 Banking & Finance | Credit Growth YoY         | RBI SCB Data         |
| 🌾 Agriculture       | GVA Growth                | MOSPI                |
| 🚢 Trade & Exports   | Merchandise Export Growth | Ministry of Commerce |
| 👥 Employment        | Urban Unemployment Rate   | CMIE CPHS            |

---

## 🤖 ML Model

* **Algorithm:** Ensemble (Random Forest + Gradient Boosting, Soft Voting)
* **Training Data:** 32 quarterly observations (2018 Q1 – 2025 Q4)
* **Features:** 12 macroeconomic and high-frequency indicators
* **Output:** Stable / Warning / Slowdown + Confidence Score
* **5-Fold Cross Validation Accuracy:** 78.6%
* **Leave-One-Out Accuracy:** 68.8%
* **Data Sources:** MOSPI, RBI, CMIE, Ministry of Commerce, S&P Global

---

## 🚀 Run Locally

```bash
# Clone repository
git clone https://github.com/YOUR_USERNAME/india-slowdown-detector.git

# Enter project folder
cd india-slowdown-detector

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

## ☁️ Deploy on Vercel

### Push Repository

```bash
git init
git add .
git commit -m "Initial Commit"
git remote add origin https://github.com/YOUR_USERNAME/india-slowdown-detector.git
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

## 📁 Project Structure

```text
india-slowdown-detector/
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

## 🔌 API Endpoints

| Method | Endpoint           | Description                |
| ------ | ------------------ | -------------------------- |
| GET    | `/`                | Dashboard UI               |
| GET    | `/api/predict`     | ML Prediction + Risk Score |
| GET    | `/api/indicators`  | Indicator Data             |
| GET    | `/api/sector/<id>` | Sector Details             |
| GET    | `/api/health`      | Health Check               |

---

## 📊 Features

* Real-time economic indicator dashboard
* Machine learning based slowdown prediction
* Sector-wise risk analysis
* Interactive visualizations using Chart.js
* REST API architecture
* Responsive web interface
* One-click cloud deployment with Vercel

---

## 📚 Research

**Paper Title**

*AI Driven Early Detection of Economic Slowdown in India Using Multi Sector High Frequency Indicators*

Presented at:

**National Conference on Machine Learning and Predictive Analytics Using Computational Science (NCMPCS-2026)**

Department of Computer Science & Engineering, FOET
Dr. Shakuntala Misra National Rehabilitation University, Lucknow
March 2026

---

## ⚠️ Disclaimer

This project is intended for academic research and educational purposes. Predictions are generated using historical macroeconomic data and machine learning models and should not be interpreted as official economic forecasts or financial advice.

---

<div align="center">

Built by **Kartikey Mishra**
B.Tech CSE (AI & Financial Management)
Dr. Shakuntala Misra National Rehabilitation University, Lucknow

</div>
