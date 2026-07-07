"""
Train economic slowdown detection model on REAL Indian economic data.
Sources: MOSPI, RBI, Ministry of Commerce, S&P Global, RBI OBICUS, NSE
Data: training_data_v2.csv (52 quarters, FY2013-FY2025)
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

# ── Load CSV ──────────────────────────────────────────────────────────────────
csv_path = os.path.join(os.path.dirname(__file__), 'training_data_v2.csv')
df = pd.read_csv(csv_path)

print("=" * 58)
print("INDIA ECONOMIC SLOWDOWN DETECTOR — MODEL TRAINING v2")
print("=" * 58)
print(f"\nLoaded: {csv_path}")
print(f"Dataset: {len(df)} quarters ({df['quarter'].iloc[0]} to {df['quarter'].iloc[-1]})")

# ── Encode label ──────────────────────────────────────────────────────────────
label_map = {'Stable': 0, 'Warning': 1, 'Slowdown': 2}
df['label_enc'] = df['label'].map(label_map)

# ── Derived features ──────────────────────────────────────────────────────────
df['pmi_below50']       = (df['pmi_manufacturing'] < 50).astype(int)
df['export_neg']        = (df['exports_yoy'] < 0).astype(int)
df['core_sector_weak']  = (df['core_sector_growth'] < 2).astype(int)
df['cap_util_low']      = (df['capacity_utilization'] < 72).astype(int)
df['gdp_momentum']      = df['gdp_growth'].diff().fillna(0)
df['earnings_weak']     = (df['corporate_earnings_growth'] < 5).astype(int)

# ── Features ──────────────────────────────────────────────────────────────────
FEATURES = [
    'gdp_growth', 'cpi_inflation', 'unemployment', 'exports_yoy',
    'repo_rate', 'pmi_manufacturing', 'wpi_inflation',
    'core_sector_growth', 'capacity_utilization',
    'corporate_earnings_growth', 'pfce_growth', 'inr_usd',
    # Derived
    'pmi_below50', 'export_neg', 'core_sector_weak',
    'cap_util_low', 'gdp_momentum', 'earnings_weak'
]

X = df[FEATURES].fillna(df[FEATURES].median())
y = df['label_enc']

print(f"Features: {len(FEATURES)}")
print(f"\nLabel distribution:")
label_names = {0:'Stable', 1:'Warning', 2:'Slowdown'}
for lbl, cnt in y.value_counts().sort_index().items():
    print(f"  {label_names[lbl]:10s}: {cnt:2d} quarters ({cnt/len(y)*100:.0f}%)")

# ── Ensemble: RF + GBM soft voting ───────────────────────────────────────────
rf = RandomForestClassifier(
    n_estimators=150, max_depth=5,
    min_samples_split=3, min_samples_leaf=2,
    class_weight='balanced', random_state=42
)
gb = GradientBoostingClassifier(
    n_estimators=100, max_depth=3,
    learning_rate=0.08, random_state=42
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
    bar = '#' * int(imp * 50)
    print(f"  {feat:30s}: {imp:.3f}  {bar}")

# ── Save ──────────────────────────────────────────────────────────────────────
out_dir = os.path.dirname(__file__) or '.'
joblib.dump(pipeline, os.path.join(out_dir, 'model.pkl'))

print(f"\n Model saved -> model/model.pkl")
print(f" Trained on {len(df)} quarters with {len(FEATURES)} features")
print("\nNew features vs v1:")
print("  + core_sector_growth    (8-core industry index)")
print("  + capacity_utilization  (RBI OBICUS)")
print("  + corporate_earnings    (Nifty 50 PAT YoY)")
print("  + pfce_growth           (Private consumption)")
print("  + wpi_inflation         (Wholesale prices)")
print("  + inr_usd               (Exchange rate)")