# Labeling Methodology & Macro-Data Documentation

This document traces the empirical basis, qualitative definitions, and modeling decisions behind the dataset labeling and scale configurations used in the India Economic Slowdown Detector model.

---

## 1. Labeling Methodology

Economic slowdowns in India do not have a binary quantitative threshold like the Western definition of a "Technical Recession" (two consecutive quarters of negative GDP growth), which is extremely rare in a developing economy. 

Therefore, labels in `training_data_v2.csv` (`Stable`, `Warning`, `Slowdown`) were systematically assigned using a composite multi-criteria approach based on structural stress indicators rather than a single variable:

*   **Stable (Label 0)**: Quarters characterized by robust GDP growth (typically > 6.5%), healthy purchasing manager indices (Manufacturing PMI > 53), steady credit expansion, and moderate inflation. No structural interventions required.
*   **Warning (Label 1)**: Quarters showing early signs of vulnerability, such as softening GDP growth, rising core sector stagnation, weakening consumer spending (PFCE), or high inflation necessitating aggressive RBI rate interventions.
*   **Slowdown (Label 2)**: Quarters where structural deceleration was clear. This was cross-referenced with:
    1.  **MOSPI Annual Growth Reports**: Quarters aligning with official fiscal decelerations (e.g., FY 2019-20 slowdown, COVID-19 contractions in FY 2020-21).
    2.  **RBI OBICUS Survey Data**: Quarters where capacity utilization dropped significantly below its long-term average (e.g., below 70%).
    3.  **Labour Bureau & CMIE Stress Signals**: Quarters matching sharp peaks in unemployment alongside declining exports.

---

## 2. Unemployment Scale Mismatch (CMIE vs. PLFS)

### The Discrepancy
The "unemployment" feature in the historical dataset matches the monthly household survey figures published by CMIE (Centre for Monitoring Indian Economy) rather than the official PLFS (Periodic Labour Force Survey) quarterly reports. PLFS data generally shows a lower unemployment rate due to differing definitions of active job seekers and informal labor inclusion.

### Engineering & Modeling Rationale
1.  **Grounded Live-Pipeline Feasibility**: The primary design requirement of the live dashboard is to fetch recent data via Gemini AI search grounding. PLFS official data is released with a lag of 3 to 6 months, whereas CMIE data is released monthly with negligible lag. Using CMIE definitions allows the live AI pipeline to fetch current, real-time rates dynamically.
2.  **StandardScaler Normalization**: Because the ML model utilizes `StandardScaler()`, absolute percentage differences are scaled relative to each feature's historical mean and standard deviation. The model learns *deviations from the mean* (relative stress peaks) rather than the absolute scale, rendering the choice of data source robust for pattern classification.
