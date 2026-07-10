import requests
import time

BASE_URL = "http://127.0.0.1:5000"

def test_public_rate_limiting():
    print(">>> Testing public rate limiting (GET /api/predict)...")
    success_count = 0
    blocked = False
    for i in range(70):
        try:
            r = requests.get(f"{BASE_URL}/api/predict")
            if r.status_code == 200:
                success_count += 1
            elif r.status_code == 429:
                print(f"[OK] Blocked at request {i+1} with 429: {r.json()}")
                blocked = True
                break
        except Exception as e:
            print(f"Connection failed: {e}")
            break
    if not blocked:
        print(f"[FAIL] Rate limit of 60 not hit. Success count: {success_count}")

def test_input_validation():
    print(">>> Testing strict schema validation (POST /api/admin/add-quarter)...")
    
    headers = {
        "X-Admin-User": "admin",
        "X-Admin-Token": "test_token" # CORRECT TOKEN to pass authentication!
    }

    # 1. Test missing fields
    bad_payload1 = {"quarter": "Q1_FY2026"}
    r = requests.post(f"{BASE_URL}/api/admin/add-quarter", json=bad_payload1, headers=headers)
    print(f"Missing fields test: Status {r.status_code}, Response: {r.json()}")
    
    # 2. Test invalid quarter regex format
    bad_payload2 = {
        "quarter": "Q5_FY2026", # Invalid quarter index (Q5)
        "gdp_growth": 7.2, "cpi_inflation": 5.1, "wpi_inflation": 3.2,
        "pmi_manufacturing": 58.1, "repo_rate": 6.5, "exports_yoy": 15.8,
        "core_sector_growth": 4.5, "capacity_utilization": 74.0,
        "corporate_earnings_growth": 12.0, "pfce_growth": 6.1,
        "inr_usd": 83.5, "unemployment": 6.8, "label": "Stable"
    }
    r = requests.post(f"{BASE_URL}/api/admin/add-quarter", json=bad_payload2, headers=headers)
    print(f"Invalid regex format test: Status {r.status_code}, Response: {r.json()}")

    # 3. Test extra keys rejection
    bad_payload3 = {
        "quarter": "Q1_FY2026",
        "gdp_growth": 7.2, "cpi_inflation": 5.1, "wpi_inflation": 3.2,
        "pmi_manufacturing": 58.1, "repo_rate": 6.5, "exports_yoy": 15.8,
        "core_sector_growth": 4.5, "capacity_utilization": 74.0,
        "corporate_earnings_growth": 12.0, "pfce_growth": 6.1,
        "inr_usd": 83.5, "unemployment": 6.8, "label": "Stable",
        "attacker_payload_extra": "malicious"
    }
    r = requests.post(f"{BASE_URL}/api/admin/add-quarter", json=bad_payload3, headers=headers)
    print(f"Extra keys test: Status {r.status_code}, Response: {r.json()}")

    # 4. Test type mismatch (float expected, got string)
    bad_payload4 = {
        "quarter": "Q1_FY2026",
        "gdp_growth": "invalid_string",
        "cpi_inflation": 5.1, "wpi_inflation": 3.2,
        "pmi_manufacturing": 58.1, "repo_rate": 6.5, "exports_yoy": 15.8,
        "core_sector_growth": 4.5, "capacity_utilization": 74.0,
        "corporate_earnings_growth": 12.0, "pfce_growth": 6.1,
        "inr_usd": 83.5, "unemployment": 6.8, "label": "Stable"
    }
    r = requests.post(f"{BASE_URL}/api/admin/add-quarter", json=bad_payload4, headers=headers)
    print(f"Type mismatch test: Status {r.status_code}, Response: {r.json()}")

def test_brute_force_backoff():
    print("\n>>> Testing admin brute force exponential backoff locks...")
    headers = {
        "X-Admin-User": "admin",
        "X-Admin-Token": "completely_wrong_token_12345"
    }
    
    print("Sending wrong credentials several times...")
    for attempts in range(1, 6):
        start = time.time()
        r = requests.post(f"{BASE_URL}/api/config", json={}, headers=headers)
        elapsed = time.time() - start
        print(f"Attempt {attempts}: Status {r.status_code}, Response: {r.json()}, Took: {elapsed:.2f}s")
        time.sleep(0.5)

if __name__ == "__main__":
    test_input_validation()
    test_brute_force_backoff()
    test_public_rate_limiting()
