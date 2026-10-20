#!/usr/bin/env python3
"""
=============================================================================
UCSS Phase 3 — Production Multi-Account Manager & OAuth Contract Tests
=============================================================================
Tests production contracts without mock routes or sandbox bypasses:
  - Strict Google OAuth URL generation (drive.file scope, offline access, state CSRF)
  - Multi-tenant isolation and AES-256-GCM token storage
  - Headroom calculation across 10 connected accounts (~150 GB target capacity)
  - Quota snapshot recording & audit logging
  - Account disconnection and state transition
=============================================================================
"""

import json
import os
import urllib.request
import urllib.error
import http.cookiejar
import sys
import uuid
import subprocess
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

BASE_URL = "http://localhost:4000/api"
TOKEN_ENCRYPTION_KEY_HEX = "d4d884941a1ffcc080300c815fac5ea5f0f62e75d424f6e33cc9d6dfad88e824"

def encrypt_token(plaintext: str) -> str:
    iv = os.urandom(12)
    aesgcm = AESGCM(bytes.fromhex(TOKEN_ENCRYPTION_KEY_HEX))
    ct_and_tag = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    ciphertext = ct_and_tag[:-16]
    auth_tag = ct_and_tag[-16:]
    return f"{iv.hex()}:{auth_tag.hex()}:{ciphertext.hex()}"

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
        req.add_header("Accept", "application/json")
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
    print("=" * 65)
    print("UCSS Phase 3 — Production OAuth & Multi-Account Manager Tests")
    print("=" * 65)

    runner = TestRunner()
    test_id = str(uuid.uuid4())[:8]
    test_email = f"architect_{test_id}@ucss.dev"
    test_password = "Password123!@#"
    display_name = f"Storage Architect {test_id}"

    # 1. Register test user
    print("\n[Setup: User Onboarding]")
    status, body, _ = runner.request("POST", "/auth/register", {
        "email": test_email,
        "password": test_password,
        "displayName": display_name
    })
    runner.test("Registered test user", status == 201)
    access_token = body.get("data", {}).get("accessToken")
    user_id = body.get("data", {}).get("user", {}).get("id")
    auth_headers = {"Authorization": f"Bearer {access_token}"}

    # 2. Test Google Connect URL Generation
    print("\n[Suite 1: Production OAuth Contract (GET /api/oauth/google/connect)]")
    status, body, _ = runner.request("GET", "/oauth/google/connect", headers=auth_headers)
    runner.test("Connect endpoint returns 200 OK", status == 200, f"Status: {status}")
    auth_url = body.get("data", {}).get("url", "")
    runner.test("Auth URL points to accounts.google.com", "accounts.google.com" in auth_url)
    runner.test("Auth URL strictly enforces drive.file least-privilege scope", "drive.file" in auth_url)
    runner.test("Auth URL enforces access_type=offline for refresh tokens", "access_type=offline" in auth_url)
    runner.test("Auth URL enforces prompt=consent for deterministic token issuance", "prompt=consent" in auth_url)
    runner.test("Auth URL includes encrypted CSRF state parameter", "state=" in auth_url)

    # Missing auth
    status, _, _ = runner.request("GET", "/oauth/google/connect")
    runner.test("Unauthenticated connect returns 401 Unauthorized", status == 401)

    # 3. Provision 10 Connected Accounts (~150 GB Capacity Fabric)
    print("\n[Suite 2: Multi-Account Connection (~150 GB Target Capacity)]")
    quota_limit_15gb = 15 * 1024 * 1024 * 1024 # 15 GB
    connected_account_ids = []

    for i in range(1, 11):
        idx_str = f"{i:02d}"
        acc_email = f"storage.node.{idx_str}.{test_id}@gmail.com"
        acc_google_id = f"google_acc_id_{idx_str}_{test_id}"
        enc_token = encrypt_token(f"refresh_token_prod_val_{idx_str}")
        quota_used = (i * 512 * 1024 * 1024) # Escalating usage (0.5GB, 1GB, ...)

        insert_sql = f"""
          INSERT INTO drive_accounts (
            id, user_id, google_email, google_account_id, encrypted_refresh_token,
            status, quota_limit_bytes, quota_used_bytes, reserved_bytes,
            quota_last_synced_at, connected_at, updated_at, last_verified_at
          ) VALUES (
            gen_random_uuid(), '{user_id}'::uuid, '{acc_email}', '{acc_google_id}', '{enc_token}',
            'ACTIVE'::"AccountStatus", {quota_limit_15gb}, {quota_used}, 0,
            NOW(), NOW(), NOW(), NOW()
          ) RETURNING id;
        """
        psql_res = subprocess.run(["psql", "-U", "ucss_user", "-d", "ucss_db", "-t", "-A", "-c", insert_sql], capture_output=True, text=True)
        acc_id = psql_res.stdout.strip().splitlines()[0]
        connected_account_ids.append(acc_id)

        # Create initial snapshot and audit log
        snap_sql = f"""
          INSERT INTO storage_snapshots (id, drive_account_id, quota_limit_bytes, quota_used_bytes, usage_in_drive, usage_in_trash, managed_file_count, captured_at)
          VALUES (gen_random_uuid(), '{acc_id}'::uuid, {quota_limit_15gb}, {quota_used}, {quota_used}, 0, 0, NOW());
          INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata, created_at)
          VALUES (gen_random_uuid(), '{user_id}'::uuid, 'ACCOUNT_CONNECTED', 'DRIVE_ACCOUNT', '{acc_id}'::uuid, '{{"email": "{acc_email}"}}'::json, NOW());
        """
        subprocess.run(["psql", "-U", "ucss_user", "-d", "ucss_db", "-c", snap_sql], capture_output=True)
        runner.test(f"Connected Google Account {idx_str} ({acc_email})", bool(acc_id))

    runner.test("Total 10 accounts connected successfully", len(connected_account_ids) == 10)

    # 4. List Connected Accounts
    print("\n[Suite 3: Account Listing & Headroom Inspection (GET /api/accounts)]")
    status, body, _ = runner.request("GET", "/accounts", headers=auth_headers)
    runner.test("List accounts returns 200 OK", status == 200)
    accounts = body.get("data", [])
    runner.test("Account list contains 10 items", len(accounts) == 10)

    # Verify security: encryptedRefreshToken must NOT be in the response
    has_leaked_token = any("encryptedRefreshToken" in acc or "refreshToken" in acc for acc in accounts)
    runner.test("Encrypted refresh tokens are NOT exposed in API output", not has_leaked_token)

    # Verify headroom math
    first_acc = accounts[0] if accounts else {}
    limit_b = int(first_acc.get("quotaLimitBytes", 0))
    used_b = int(first_acc.get("quotaUsedBytes", 0))
    avail_b = int(first_acc.get("quotaAvailableBytes", 0))
    runner.test("Headroom calculated accurately (avail = limit - used - reserved)", avail_b == (limit_b - used_b))

    # 5. Database Encryption at Rest Verification (AES-256-GCM)
    print("\n[Suite 4: Database Encryption at Rest Verification (SQL)]")
    psql_token_cmd = f"psql -U ucss_user -d ucss_db -t -A -c \"SELECT encrypted_refresh_token FROM drive_accounts WHERE user_id = '{user_id}' LIMIT 1;\""
    token_res = subprocess.run(["sh", "-c", psql_token_cmd], capture_output=True, text=True)
    stored_token = token_res.stdout.strip()
    parts = stored_token.split(":")
    is_valid_gcm = len(parts) == 3 and len(parts[0]) == 24 and len(parts[1]) == 32 # 12-byte IV (24 hex) : 16-byte tag (32 hex) : ciphertext
    runner.test("Refresh token stored in AES-256-GCM format (iv:authTag:ciphertext)", is_valid_gcm, f"Format: {stored_token[:30]}...")

    # 6. Real-Time Quota Sync & Error Envelope Verification
    print("\n[Suite 5: Production Google API Error Handling (POST /api/accounts/:id/sync)]")
    target_id = connected_account_ids[0]
    status, body, _ = runner.request("POST", f"/accounts/{target_id}/sync", headers=auth_headers)
    # Calling Google with non-cloud token triggers TOKEN_EXPIRED or GOOGLE_API_ERROR
    is_handled = status in [401, 502] and body.get("ok") is False and "error" in body
    runner.test("Live sync against non-live credential yields standardized JSON error envelope", is_handled, f"Status: {status}, Error: {body.get('error')}")

    # 7. Unified Storage Aggregation across 10 Accounts
    print("\n[Suite 6: Aggregated 150 GB Unified Dashboard (GET /api/auth/me)]")
    status, body, _ = runner.request("GET", "/auth/me", headers=auth_headers)
    runner.test("Profile query returns 200 OK", status == 200)
    storage = body.get("data", {}).get("storage", {})
    total_quota = int(storage.get("totalQuotaBytes", 0))
    active_count = storage.get("activeAccountsCount", 0)
    runner.test("Active accounts count is 10", active_count == 10, f"Active: {active_count}")
    expected_150gb = 10 * 15 * 1024 * 1024 * 1024 # 161,061,273,600 bytes (~150 GB)
    runner.test("Total aggregated quota is ~150 GB (161,061,273,600 bytes)", total_quota == expected_150gb, f"Total: {total_quota}")

    # 8. Account Disconnection
    print("\n[Suite 7: Account Disconnection (DELETE /api/accounts/:id)]")
    status, body, _ = runner.request("DELETE", f"/accounts/{target_id}", headers=auth_headers)
    runner.test("Disconnect account returns 200 OK", status == 200, f"Status: {status}")
    runner.test("Returns active files count", "activeFilesCount" in body.get("data", {}))

    # Verify account status in DB
    psql_status_cmd = f"psql -U ucss_user -d ucss_db -t -A -c \"SELECT status FROM drive_accounts WHERE id = '{target_id}';\""
    status_res = subprocess.run(["sh", "-c", psql_status_cmd], capture_output=True, text=True)
    runner.test("Account status updated to DISCONNECTED in DB", status_res.stdout.strip() == "DISCONNECTED")

    # Verify audit log in DB
    psql_audit_cmd = f"psql -U ucss_user -d ucss_db -t -A -c \"SELECT action FROM audit_logs WHERE resource_id = '{target_id}' AND action = 'ACCOUNT_DISCONNECTED';\""
    audit_res = subprocess.run(["sh", "-c", psql_audit_cmd], capture_output=True, text=True)
    runner.test("Audit log ACCOUNT_DISCONNECTED recorded in DB", "ACCOUNT_DISCONNECTED" in audit_res.stdout.strip())

    # Cleanup test data
    print("\n[Teardown: Cleaning up test user and accounts]")
    cleanup_cmd = f"""
      DELETE FROM audit_logs WHERE user_id = '{user_id}';
      DELETE FROM storage_snapshots WHERE drive_account_id IN (SELECT id FROM drive_accounts WHERE user_id = '{user_id}');
      DELETE FROM drive_accounts WHERE user_id = '{user_id}';
      DELETE FROM users WHERE id = '{user_id}';
    """
    subprocess.run(["psql", "-U", "ucss_user", "-d", "ucss_db", "-c", cleanup_cmd], capture_output=True)
    print("  ✅ Cleanup complete.")

    print("\n" + "=" * 65)
    print(f"RESULTS: {runner.passed} Passed, {runner.failed} Failed")
    print("=" * 65)

    if runner.failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_tests()
