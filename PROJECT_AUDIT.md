# Project Audit — India Economic Slowdown Detector

## Scope
- Reviewed backend (`app.py`), data fetch layer (`data/fetch_data.py`), Gemini grounding (`data/gemini_grounding.py`), model training (`model/train_model.py`), config (`config.json`), and README.

## What’s Working Well
- Clear separation between Flask routes, indicator assembly, and AI-grounding logic.
- Strong fallback behavior: live APIs -> Gemini-grounded values -> `config.json` defaults.
- Model training and inference feature sets are aligned via `build_feature_vector()`.
- Burst protection and cache persistence are already considered for Gemini calls.

## Key Risks
- `data/fetch_data.py` still depends on live third-party endpoints and a hardcoded `data.gov.in` API key.
- `fetch_grounded_indicators(force=False)` and `fetch_extended_indicators(force=False)` return cached data only; freshness depends entirely on refresh flow.
- `app.py` imports several private helpers from `data.gemini_grounding` (`_get_key_pool`, `_call_with_fallback`), which tightens coupling.
- `README.md` appears out of sync with current code in places (training data counts / deployment references / feature counts).

## Security / Operational Notes
- Avoid committing or reusing embedded API keys; move the `data.gov.in` key to environment config.
- Consider validating external API payloads more defensively before using them in public responses.
- Disk cache writes in `data/gemini_grounding.py` should ensure the cache directory exists before saving.

## Data / Model Notes
- `model/train_model.py` trains on `training_data_v2.csv` with 18 features and writes `model.pkl`.
- `build_feature_vector()` matches those 18 features, but several default values are still hardcoded and should be kept in sync with `config.json`.
- The prediction endpoint exposes derived fields (`risk_score`, `grounding_status`) cleanly for UI use.

## Frontend / UX Notes
- The current codebase includes static assets and a template-based dashboard, but this audit did not modify UI behavior.
- Any user-facing wording about “live” data should match the actual source priority and cache behavior.

## Suggested Follow-ups
1. Move secrets to environment variables and document them in `README.md`.
2. Add directory creation / write protection around grounding cache persistence.
3. Refresh `README.md` to reflect the current training data, feature counts, and API behavior.
4. Add lightweight tests for `compute_risk_score()` and `build_feature_vector()` alignment.

## Overall Assessment
- The project is structurally solid and already production-aware in its caching/fallback design.
- Main improvements needed are secret handling, documentation consistency, and a few operational hardening steps.
