"""
Train economic slowdown detection model on REAL Indian economic data.
Sources: MOSPI, RBI, Ministry of Commerce, S&P Global (all public)
Run: python model/train_model.py
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier, VotingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import StratifiedKFold, cross_val_score, LeaveOneOut
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report
import joblib, os, warnings
warnings.filterwarnings('ignore')

# ─────────────────────────────────────────────────────────────────────────────
# REAL QUARTERLY DATA — India 2018 Q1 – 2026 Q1  (33 quarters)
#
# Sources:
#   GDP growth   : MOSPI National Accounts Statistics (base 2011-12)
#   CPI          : MOSPI Consumer Price Index Combined
#   Unemployment : MOSPI PLFS / CMIE CPHS urban rate
#   Exports      : Ministry of Commerce & Industry (USD YoY %)
#   Credit growth: RBI Scheduled Commercial Banks YoY
#   PMI          : HSBC/S&P Global India Manufacturing PMI (quarterly avg)
#   Agri GVA     : MOSPI (base 2011-12)
#   Repo rate    : Reserve Bank of India MPC decisions
# ─────────────────────────────────────────────────────────────────────────────

REAL_DATA = [
    # (year, Q,  gdp,   cpi,  unemp, exp_gr, cred,  pmi,   agri,  repo)
    # ── 2018 ──────────────────────────────────────────────────────────────
    (2018,'Q1',  8.1,  4.6,   6.2,   5.0,  12.0,  51.7,   5.3,  6.00),
    (2018,'Q2',  7.0,  3.9,   6.3,  14.0,  12.8,  52.2,   4.2,  6.25),
    (2018,'Q3',  6.2,  3.8,   6.1,   8.0,  14.6,  53.1,   3.5,  6.50),
    (2018,'Q4',  5.6,  2.6,   6.0,   8.5,  13.2,  53.5,   2.1,  6.50),
    # ── 2019 ──────────────────────────────────────────────────────────────
    (2019,'Q1',  5.8,  3.0,   7.0,  -1.0,  13.5,  52.6,   2.0,  6.25),
    (2019,'Q2',  5.0,  3.2,   7.3,  -0.5,  13.3,  52.7,   2.1,  5.75),
    (2019,'Q3',  4.4,  3.5,   7.6,  -2.1,  10.0,  51.4,   2.1,  5.40),
    (2019,'Q4',  3.3,  5.5,   7.5,  -5.0,   7.5,  52.7,   1.3,  5.15),
    # ── 2020 ──────────────────────────────────────────────────────────────
    (2020,'Q1',  3.1,  6.6,   8.7, -12.7,   6.7,  51.8,   3.7,  4.40),
    (2020,'Q2',-24.4,  6.9,  23.5, -36.0,   5.8,  34.2,   3.8,  4.00),
    (2020,'Q3',  0.5,  7.3,   9.0,   5.0,   5.8,  52.1,   4.3,  4.00),
    (2020,'Q4',  1.6,  5.0,   8.5,   9.8,   5.4,  57.5,   4.3,  4.00),
    # ── 2021 ──────────────────────────────────────────────────────────────
    (2021,'Q1',  1.6,  5.1,   8.2,  20.0,   5.3,  55.4,   3.0,  4.00),
    (2021,'Q2', 20.1,  5.8,   8.1,  85.0,   5.5,  48.1,   4.5,  4.00),
    (2021,'Q3',  8.4,  5.0,   7.5,  25.0,   7.0,  53.7,   3.3,  4.00),
    (2021,'Q4',  5.4,  5.2,   7.4,  17.6,   9.3,  56.4,   2.5,  4.00),
    # ── 2022 ──────────────────────────────────────────────────────────────
    (2022,'Q1',  4.1,  6.0,   7.8,  25.0,  11.0,  54.0,   3.2,  4.40),
    (2022,'Q2', 13.5,  7.3,   7.2,  18.0,  14.5,  58.0,   4.5,  5.90),
    (2022,'Q3',  6.3,  6.9,   7.2,   8.5,  17.5,  55.1,   4.1,  6.15),
    (2022,'Q4',  4.4,  5.7,   7.3,   9.6,  16.0,  57.8,   3.8,  6.25),
    # ── 2023 ──────────────────────────────────────────────────────────────
    (2023,'Q1',  6.1,  5.7,   7.5,  -8.0,  15.0,  56.4,   4.8,  6.50),
    (2023,'Q2',  7.8,  5.0,   7.7, -15.0,  16.0,  57.2,   3.1,  6.50),
    (2023,'Q3',  7.6,  5.6,   7.6,   5.5,  16.3,  57.5,   1.4,  6.50),
    (2023,'Q4',  8.4,  5.1,   7.8,   3.5,  16.5,  56.9,   0.7,  6.50),
    # ── 2024 ──────────────────────────────────────────────────────────────
    (2024,'Q1',  7.8,  5.1,   7.7,   1.0,  16.3,  59.1,   0.4,  6.50),
    (2024,'Q2',  6.7,  4.8,   7.9,  -1.5,  15.0,  57.5,   3.5,  6.50),
    (2024,'Q3',  5.4,  5.5,   7.3,  -4.5,  11.5,  56.5,   2.0,  6.25),  # unemployment corrected
    (2024,'Q4',  6.2,  5.3,   7.0,  -2.0,  10.5,  56.7,   5.7,  6.25),  # unemployment corrected
    # ── 2025  (corrected: repo cut to 5.25% by Dec'25; exports recovered; unemp improved) ──
    (2025,'Q1',  7.8,  3.8,   6.9,   8.5,  10.0,  58.1,   3.7,  6.25),  # Apr-Jun 2025
    (2025,'Q2',  7.6,  3.5,   6.8,  12.0,   8.5,  57.9,   4.1,  5.75),  # Jul-Sep 2025 (rate cut)
    (2025,'Q3',  7.6,  3.6,   6.7,  13.6,   7.0,  55.8,   4.2,  5.50),  # Oct-Dec 2025 (cut to 5.5%)
    (2025,'Q4',  7.6,  3.9,   6.6,  14.7,   6.5,  56.0,   3.8,  5.25),  # Jan-Mar 2026 (cut to 5.25%)
    # ── 2026 Q1  (latest — Apr-Jun 2026, partial actuals + estimates) ─────
    (2026,'Q1',  6.9,  3.93,  6.6,  16.09,  7.8,  55.0,   3.5,  5.25),  # RBI/MOSPI/MoC June 2026
]

COLS = ['year','quarter','gdp_growth','cpi','unemployment',
        'export_growth','credit_growth','pmi','agri_gva','repo_rate']

df = pd.DataFrame(REAL_DATA, columns=COLS)

# ── Derived features ──────────────────────────────────────────────────────────
df['pmi_below50']  = (df['pmi'] < 50).astype(int)
df['export_neg']   = (df['export_growth'] < 0).astype(int)
df['credit_soft']  = (df['credit_growth'] < 8).astype(int)
df['gdp_momentum'] = df['gdp_growth'].diff().fillna(0)

# ── Labels based on real economic events ─────────────────────────────────────
def assign_label(row):
    score = 0
    if row.gdp_growth < 0:      score += 4
    elif row.gdp_growth < 4:    score += 2
    elif row.gdp_growth < 5.5:  score += 1
    if row.export_growth < -10: score += 3
    elif row.export_growth < 0: score += 1
    if row.unemployment > 12:   score += 3
    elif row.unemployment > 8:  score += 1
    if row.pmi < 45:            score += 3
    elif row.pmi < 50:          score += 2
    elif row.pmi < 52:          score += 1
    if row.cpi > 7:             score += 1
    if row.credit_growth < 6:   score += 1
    if score >= 5: return 2   # Slowdown
    if score >= 2: return 1   # Warning
    return 0                  # Stable

df['label'] = df.apply(assign_label, axis=1)

FEATURES = ['gdp_growth','cpi','unemployment','export_growth',
            'credit_growth','pmi','agri_gva','repo_rate',
            'pmi_below50','export_neg','credit_soft','gdp_momentum']

X = df[FEATURES]
y = df['label']

print("=" * 58)
print("INDIA ECONOMIC SLOWDOWN DETECTOR — MODEL TRAINING")
print("=" * 58)
print(f"\nDataset: {len(df)} quarterly observations (2018 Q1 – 2026 Q1)")
print(f"Features: {len(FEATURES)}")
print(f"\nLabel distribution:")
label_names = {0:'Stable', 1:'Warning', 2:'Slowdown'}
for lbl, cnt in y.value_counts().sort_index().items():
    print(f"  {label_names[lbl]:10s}: {cnt:2d} quarters ({cnt/len(y)*100:.0f}%)")

# ── Ensemble: RF + GBM soft voting ───────────────────────────────────────────
rf = RandomForestClassifier(
    n_estimators=100, max_depth=4,
    min_samples_split=3, min_samples_leaf=2,
    class_weight='balanced', random_state=42
)
gb = GradientBoostingClassifier(
    n_estimators=80, max_depth=3,
    learning_rate=0.1, random_state=42
)
pipeline = Pipeline([
    ('scaler', StandardScaler()),
    ('clf', VotingClassifier(
        estimators=[('rf', rf), ('gb', gb)], voting='soft'
    ))
])

# ── Cross-validation ──────────────────────────────────────────────────────────
print("\n--- Cross Validation ---")
loo = LeaveOneOut()
loo_scores = cross_val_score(pipeline, X, y, cv=loo, scoring='accuracy')
print(f"LOO Accuracy  : {loo_scores.mean():.3f} ± {loo_scores.std():.3f}")

skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
cv5 = cross_val_score(pipeline, X, y, cv=skf, scoring='accuracy')
print(f"5-Fold CV Acc : {cv5.mean():.3f} ± {cv5.std():.3f}")
print(f"Individual    : {[round(s,2) for s in cv5]}")

# ── Train on full data ────────────────────────────────────────────────────────
pipeline.fit(X, y)
train_preds = pipeline.predict(X)
print("\n--- Training Set Report ---")
print(classification_report(y, train_preds, target_names=['Stable','Warning','Slowdown']))

# Feature importance
rf_fitted = pipeline.named_steps['clf'].estimators_[0]
feat_imp = pd.Series(rf_fitted.feature_importances_, index=FEATURES).sort_values(ascending=False)
print("--- Feature Importance (Random Forest) ---")
for feat, imp in feat_imp.items():
    bar = '█' * int(imp * 50)
    print(f"  {feat:20s}: {imp:.3f}  {bar}")

# ── Save ──────────────────────────────────────────────────────────────────────
os.makedirs(os.path.dirname(__file__) or '.', exist_ok=True)
joblib.dump(pipeline, os.path.join(os.path.dirname(__file__), 'model.pkl'))
df.to_csv(os.path.join(os.path.dirname(__file__), 'training_data.csv'), index=False)

print(f"\n✅ Model saved       → model/model.pkl")
print(f"✅ Training data     → model/training_data.csv  ({len(df)} quarters)")
print("\nData sources:")
print("  GDP growth   : MOSPI National Accounts Statistics")
print("  CPI          : MOSPI Consumer Price Index (Combined)")
print("  Unemployment : MOSPI PLFS / CMIE CPHS Urban Rate")
print("  Exports      : Ministry of Commerce & Industry")
print("  Credit       : RBI Scheduled Commercial Banks")
print("  PMI          : HSBC/S&P Global India Manufacturing PMI")
print("  Agri GVA     : MOSPI GVA (base 2011-12)")
print("  Repo rate    : Reserve Bank of India MPC")
