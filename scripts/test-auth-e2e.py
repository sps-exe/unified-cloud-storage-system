#!/usr/bin/env python3
import json
import urllib.request
import urllib.error
import http.cookiejar
import sys
import uuid
import time
import subprocess

BASE_URL = "http://localhost:4000/api"

class TestRunner:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.cookie_jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookie_jar))

    def request(self, method, path, data=None, headers=None):
        url = f"{BASE_URL}{path}"
        body = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Content-Type", "application/json")
        if headers:
            for k, v in headers.items():
                req.add_header(k, v)

        try:
            res = self.opener.open(req)
            content = res.read().decode("utf-8")
            return res.status, json.loads(content) if content else {}, res.headers
        except urllib.error.HTTPError as e:
            content = e.read().decode("utf-8")
            try:
                parsed = json.loads(content)
            except Exception:
                parsed = {"raw": content}
            return e.code, parsed, e.headers
        except Exception as e:
            return 0, {"error": str(e)}, {}

    def test(self, name, condition, details=""):
        if condition:
            print(f"  ✅ PASS: {name}")
            self.passed += 1
        else:
            print(f"  ❌ FAIL: {name} — {details}")
            self.failed += 1

def run_tests():
    print("=" * 60)
    print("UCSS Phase 2 — Authentication System Integration Tests")
    print("=" * 60)

    runner = TestRunner()
    test_id = str(uuid.uuid4())[:8]
    test_email = f"test_{test_id}@ucss.dev"
    test_password = "Password123!@#"
    display_name = f"Test Engineer {test_id}"

    # ─── 1. Registration ────────────────────────────────────────────────────────
    print("\n[Suite 1: Registration (POST /api/auth/register)]")
    status, body, headers = runner.request("POST", "/auth/register", {
        "email": test_email,
        "password": test_password,
        "displayName": display_name
    })

    runner.test("Register user returns 201 Created", status == 201, f"Status: {status}")
    runner.test("Response body ok: true", body.get("ok") is True)
    user = body.get("data", {}).get("user", {})
    runner.test("Returned user email matches input", user.get("email") == test_email.lower())
    runner.test("Returned user displayName matches", user.get("displayName") == display_name)
    access_token = body.get("data", {}).get("accessToken")
    runner.test("Access token returned", bool(access_token and len(access_token) > 20))

    # Check cookies in jar
    cookie_names = [c.name for c in runner.cookie_jar]
    runner.test("Refresh token cookie set (ucss_refresh_token)", "ucss_refresh_token" in cookie_names)

    # ─── 2. Duplicate Registration ──────────────────────────────────────────────
    print("\n[Suite 2: Duplicate Email Conflict]")
    status, body, _ = runner.request("POST", "/auth/register", {
        "email": test_email,
        "password": test_password
    })
    runner.test("Duplicate registration returns 409 Conflict", status == 409, f"Status: {status}")
    runner.test("Conflict error code is CONFLICT", body.get("error", {}).get("code") == "CONFLICT")

    # ─── 3. Password Complexity Validation ──────────────────────────────────────
    print("\n[Suite 3: Validation Constraints]")
    status, body, _ = runner.request("POST", "/auth/register", {
        "email": f"weak_{test_id}@ucss.dev",
        "password": "weak"
    })
    runner.test("Weak password returns 400 Bad Request", status == 400, f"Status: {status}")
    runner.test("Error code is VALIDATION_ERROR", body.get("error", {}).get("code") == "VALIDATION_ERROR")

    status, body, _ = runner.request("POST", "/auth/register", {
        "email": "invalid-email-format",
        "password": test_password
    })
    runner.test("Malformed email returns 400 Bad Request", status == 400, f"Status: {status}")

    # ─── 4. Login ───────────────────────────────────────────────────────────────
    print("\n[Suite 4: Login (POST /api/auth/login)]")
    # Fresh runner to isolate cookies
    login_runner = TestRunner()
    status, body, _ = login_runner.request("POST", "/auth/login", {
        "email": test_email,
        "password": test_password
    })
    runner.test("Valid login returns 200 OK", status == 200, f"Status: {status}")
    runner.test("Login returns access token", bool(body.get("data", {}).get("accessToken")))
    login_token = body.get("data", {}).get("accessToken", "")

    # Invalid password
    status, body, _ = login_runner.request("POST", "/auth/login", {
        "email": test_email,
        "password": "WrongPassword123!"
    })
    runner.test("Wrong password returns 401 Unauthorized", status == 401, f"Status: {status}")
    runner.test("Error code is UNAUTHORIZED", body.get("error", {}).get("code") == "UNAUTHORIZED")

    # Non-existent email
    status, body, _ = login_runner.request("POST", "/auth/login", {
        "email": "nobody@ucss.dev",
        "password": test_password
    })
    runner.test("Non-existent user returns 401 Unauthorized", status == 401, f"Status: {status}")

    # ─── 5. Authenticated Profile & Stats (GET /api/auth/me) ────────────────────
    print("\n[Suite 5: Protected Route & Unified Storage Stats (GET /api/auth/me)]")
    status, body, _ = runner.request("GET", "/auth/me", headers={"Authorization": f"Bearer {login_token}"})
    runner.test("Authenticated profile returns 200 OK", status == 200, f"Status: {status}")
    runner.test("User ID returned in profile", bool(body.get("data", {}).get("id")))
    storage = body.get("data", {}).get("storage", {})
    runner.test("Storage totalQuotaBytes is present", "totalQuotaBytes" in storage)
    runner.test("Storage totalUsedBytes is present", "totalUsedBytes" in storage)
    runner.test("Storage activeAccountsCount is integer", isinstance(storage.get("activeAccountsCount"), int))

    # Missing auth header
    status, body, _ = runner.request("GET", "/auth/me")
    runner.test("Missing Authorization header returns 401 Unauthorized", status == 401, f"Status: {status}")

    # Forged auth token
    status, body, _ = runner.request("GET", "/auth/me", headers={"Authorization": "Bearer forged.invalid.token"})
    runner.test("Invalid Authorization token returns 401 Unauthorized", status == 401, f"Status: {status}")

    # ─── 6. Refresh Token Rotation (POST /api/auth/refresh) ────────────────────
    print("\n[Suite 6: Refresh Token (POST /api/auth/refresh)]")
    # login_runner has the cookie in jar
    status, body, _ = login_runner.request("POST", "/auth/refresh")
    runner.test("Refresh token endpoint returns 200 OK", status == 200, f"Status: {status}")
    new_access_token = body.get("data", {}).get("accessToken")
    runner.test("Fresh access token issued", bool(new_access_token and len(new_access_token) > 20))

    # Fresh runner without cookie
    empty_runner = TestRunner()
    status, body, _ = empty_runner.request("POST", "/auth/refresh")
    runner.test("Refresh without cookie returns 401 Unauthorized", status == 401, f"Status: {status}")

    # ─── 7. Logout (POST /api/auth/logout) ──────────────────────────────────────
    print("\n[Suite 7: Logout (POST /api/auth/logout)]")
    status, body, headers = login_runner.request("POST", "/auth/logout")
    runner.test("Logout returns 200 OK", status == 200, f"Status: {status}")
    runner.test("Logout returns success message", body.get("data", {}).get("message") == "Logged out successfully")

    # ─── 8. Audit Log Database Verification ────────────────────────────────────
    print("\n[Suite 8: Database Audit Log Verification (SQL)]")
    psql_cmd = f"psql -U ucss_user -d ucss_db -t -A -c \"SELECT action, resource_type FROM audit_logs WHERE action = 'AUTH_LOGIN' ORDER BY created_at DESC LIMIT 1;\""
    res = subprocess.run(["sh", "-c", psql_cmd], capture_output=True, text=True)
    runner.test("Database contains AUTH_LOGIN audit log", "AUTH_LOGIN|USER" in res.stdout.strip(), f"Result: {res.stdout.strip()}")

    # Cleanup test user
    cleanup_cmd = f"psql -U ucss_user -d ucss_db -c \"DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email = '{test_email.lower()}'); DELETE FROM users WHERE email = '{test_email.lower()}';\""
    subprocess.run(["sh", "-c", cleanup_cmd], capture_output=True, text=True)

    print("\n" + "=" * 60)
    print(f"RESULTS: {runner.passed} Passed, {runner.failed} Failed")
    print("=" * 60)

    if runner.failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_tests()
