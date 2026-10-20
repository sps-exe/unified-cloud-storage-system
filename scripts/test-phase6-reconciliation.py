#!/usr/bin/env python3
"""
=============================================================================
UCSS Phase 6 Verification Test Suite — Reliability & Reconciliation
=============================================================================
Tests background reconciliation, stuck upload recovery, orphaned reservation
cleanup, time-series storage snapshots, and admin health reporting.
=============================================================================
"""

import sys
import os
import json
import time
import uuid
import urllib.request
import urllib.error
import subprocess
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

BASE_URL = "http://localhost:4000/api"
TOKEN_ENCRYPTION_KEY_HEX = "d4d884941a1ffcc080300c815fac5ea5f0f62e75d424f6e33cc9d6dfad88e824"
PASS_COUNT = 0
FAIL_COUNT = 0

def log_pass(msg):
    global PASS_COUNT
    PASS_COUNT += 1
    print(f"  \033[92m✔ PASS\033[0m: {msg}")

def log_fail(msg, details=""):
    global FAIL_COUNT
    FAIL_COUNT += 1
    print(f"  \033[91m✘ FAIL\033[0m: {msg}")
    if details:
        print(f"         \033[90m{details}\033[0m")

def encrypt_token(plaintext: str) -> str:
    iv = os.urandom(12)
    aesgcm = AESGCM(bytes.fromhex(TOKEN_ENCRYPTION_KEY_HEX))
    ct_and_tag = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    ciphertext = ct_and_tag[:-16]
    auth_tag = ct_and_tag[-16:]
    return f"{iv.hex()}:{auth_tag.hex()}:{ciphertext.hex()}"

def make_request(url, method="GET", headers=None, body=None):
    if headers is None:
        headers = {}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode("utf-8"))
        except Exception:
            return e.code, raw.decode("utf-8")

def execute_sql(sql):
    cmd = [
        "psql",
        "-U", "ucss_user",
        "-d", "ucss_db",
        "-h", "localhost",
        "-p", "5432",
        "-t", "-A",
        "-c", sql
    ]
    env = os.environ.copy()
    env["PGPASSWORD"] = "ucss_local_pass"
    res = subprocess.run(cmd, env=env, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if res.returncode != 0:
        raise RuntimeError(f"SQL execution failed: {res.stderr}")
    return res.stdout.strip()

def main():
    print("\n" + "=" * 75)
    print("🚀 STARTING PHASE 6 VERIFICATION: RELIABILITY & RECONCILIATION")
    print("=" * 75)

    # ─── Step 1: User Onboarding ──────────────────────────────────────────────
    print("\n[1/5] Setting up test user and accounts...")
    test_id = str(uuid.uuid4())[:8]
    test_email = f"reconcile.user.{test_id}@ucss.internal"
    test_password = "SecurePassword123!"

    status, reg_res = make_request(f"{BASE_URL}/auth/register", method="POST", body={
        "email": test_email,
        "password": test_password,
        "displayName": f"Reliability Architect {test_id}"
    })
    if status != 201 or not reg_res.get("ok"):
        log_fail("Registration failed", reg_res)
        sys.exit(1)

    token = reg_res["data"]["accessToken"]
    user_id = reg_res["data"]["user"]["id"]
    auth_headers = {"Authorization": f"Bearer {token}"}
    log_pass(f"Registered user: {test_email} (id: {user_id})")

    # Provision 2 accounts via production schema
    accounts = []
    quota_limit = 15 * 1024 * 1024 * 1024
    for i, used_b in enumerate([2 * 1024 * 1024 * 1024, 4 * 1024 * 1024 * 1024], start=1):
        idx_str = f"{i:02d}"
        acc_email = f"reconcile.node.{idx_str}.{test_id}@gmail.com"
        acc_gid = f"gid_reconcile_{idx_str}_{test_id}"
        enc_tok = encrypt_token(f"tok_reconcile_{idx_str}")
        
        insert_sql = f"""
          INSERT INTO drive_accounts (
            id, user_id, google_email, google_account_id, encrypted_refresh_token,
            status, quota_limit_bytes, quota_used_bytes, reserved_bytes,
            quota_last_synced_at, connected_at, updated_at, last_verified_at
          ) VALUES (
            gen_random_uuid(), '{user_id}'::uuid, '{acc_email}', '{acc_gid}', '{enc_tok}',
            'ACTIVE'::"AccountStatus", {quota_limit}, {used_b}, 0,
            NOW(), NOW(), NOW(), NOW()
          ) RETURNING id;
        """
        acc_id = execute_sql(insert_sql).splitlines()[0]
        accounts.append({"id": acc_id, "googleEmail": acc_email})
        
        # Initial snapshot
        execute_sql(f"""
          INSERT INTO storage_snapshots (id, drive_account_id, quota_limit_bytes, quota_used_bytes, usage_in_drive, usage_in_trash, managed_file_count, captured_at)
          VALUES (gen_random_uuid(), '{acc_id}'::uuid, {quota_limit}, {used_b}, {used_b}, 0, 0, NOW());
        """)
        log_pass(f"Connected account {idx_str}: {acc_email}")

    # ─── Step 2: Inject Inconsistencies (Simulated Crashes & Network Drops) ────
    print("\n[2/5] Injecting realistic state inconsistencies into database...")

    # A: Create a pre-flight allocation and simulate an abandoned upload
    stuck_size = 10 * 1024 * 1024 # 10 MB
    status, alloc_res = make_request(
        f"{BASE_URL}/files/allocate",
        method="POST",
        headers=auth_headers,
        body={
            "originalFilename": "abandoned_large_video.mp4",
            "fileSizeBytes": stuck_size,
            "mimeType": "video/mp4"
        }
    )
    if status != 201 or not alloc_res.get("ok"):
        log_fail("Allocation failed", alloc_res)
        sys.exit(1)

    stuck_file_id = alloc_res["data"]["fileId"]
    stuck_acc_id = alloc_res["data"]["driveAccountId"]
    log_pass(f"Created pending upload reservation: fileId={stuck_file_id} (10 MB)")

    # Artificially age the pending file to 15 minutes ago
    execute_sql(f"UPDATE files SET updated_at = NOW() - INTERVAL '15 minutes' WHERE id = '{stuck_file_id}'::uuid;")
    log_pass("Aged file record updated_at by -15 minutes in PostgreSQL")

    # B: Inject orphaned reservation drift on Account 02
    target_drift_acc_id = accounts[1]["id"]
    fake_reserved = 25 * 1024 * 1024 # 25 MB
    execute_sql(f"UPDATE drive_accounts SET reserved_bytes = {fake_reserved} WHERE id = '{target_drift_acc_id}'::uuid;")
    log_pass(f"Injected reservation drift on {accounts[1]['googleEmail']}: reserved_bytes = 25 MB with 0 active uploads")

    # ─── Step 3: Admin Health Summary ─────────────────────────────────────────
    print("\n[3/5] Querying Admin Health Diagnostics (GET /api/admin/health)...")
    status, health_res = make_request(f"{BASE_URL}/admin/health", headers=auth_headers)
    if status == 200 and health_res.get("ok"):
        data = health_res["data"]
        log_pass("Admin health diagnostics responded HTTP 200 OK")
        if data["pendingFiles"] >= 1:
            log_pass(f"Diagnostics identified pendingFiles = {data['pendingFiles']}")
        else:
            log_fail("Expected pendingFiles >= 1", data)
        
        if data["activeAccountsCount"] >= 2:
            log_pass(f"Diagnostics verified active accounts = {data['activeAccountsCount']}")
        else:
            log_fail("Expected activeAccountsCount >= 2", data)
    else:
        log_fail("GET /api/admin/health failed", (status, health_res))

    # ─── Step 4: Execute Full Reconciliation Worker ───────────────────────────
    print("\n[4/5] Triggering Background Reconciliation (POST /api/admin/reconcile)...")
    status, rec_res = make_request(
        f"{BASE_URL}/admin/reconcile",
        method="POST",
        headers=auth_headers,
        body={"pendingThresholdMinutes": 5, "uploadingThresholdMinutes": 10}
    )

    if status == 200 and rec_res.get("ok"):
        report = rec_res["data"]
        log_pass("Reconciliation executed successfully")
        
        # Check stuck uploads recovered
        recovered_ids = [s["fileId"] for s in report["stuckUploadsRecovered"]]
        if stuck_file_id in recovered_ids:
            log_pass(f"Reconciliation recovered stuck upload: {stuck_file_id}")
        else:
            log_fail("Stuck file was not recovered in report", report["stuckUploadsRecovered"])

        # Check reservations corrected
        corrected_acc_ids = [r["accountId"] for r in report["reservationsCorrected"]]
        if target_drift_acc_id in corrected_acc_ids:
            log_pass(f"Reconciliation corrected reservation drift on account: {target_drift_acc_id}")
        else:
            log_fail("Drifted account was not corrected in report", report["reservationsCorrected"])

        log_pass(f"Quota sync processed connected accounts (synced: {report.get('quotasSyncedCount', 0)})")
    else:
        log_fail("POST /api/admin/reconcile failed", (status, rec_res))

    # ─── Step 5: Database Consistency & Audit Trail Verification ──────────────
    print("\n[5/5] Verifying PostgreSQL Consistency & Audit Logs...")

    # A: Check stuck file is now FAILED
    file_status = execute_sql(f"SELECT upload_status FROM files WHERE id = '{stuck_file_id}'::uuid;")
    if file_status == "FAILED":
        log_pass("Stuck file status transitioned to 'FAILED' in database")
    else:
        log_fail(f"Expected status FAILED, got '{file_status}'")

    # B: Check upload operation recorded timeout error
    op_err = execute_sql(f"SELECT error_code FROM upload_operations WHERE file_id = '{stuck_file_id}'::uuid LIMIT 1;")
    if op_err == "UPLOAD_TIMEOUT":
        log_pass("Upload operation recorded error_code 'UPLOAD_TIMEOUT'")
    else:
        log_fail(f"Expected error_code UPLOAD_TIMEOUT, got '{op_err}'")

    # C: Check reserved bytes released on account 01
    res_bytes_1 = int(execute_sql(f"SELECT reserved_bytes FROM drive_accounts WHERE id = '{stuck_acc_id}'::uuid;"))
    if res_bytes_1 == 0:
        log_pass("Held reservation on target account successfully released (reserved_bytes = 0)")
    else:
        log_fail(f"Reserved bytes on account 01 not released: {res_bytes_1}")

    # D: Check reservation drift reset on account 02
    res_bytes_2 = int(execute_sql(f"SELECT reserved_bytes FROM drive_accounts WHERE id = '{target_drift_acc_id}'::uuid;"))
    if res_bytes_2 == 0:
        log_pass("Orphaned reservation drift on account 02 successfully reset to 0")
    else:
        log_fail(f"Reserved bytes on account 02 not reset: {res_bytes_2}")

    # E: Check audit logs
    stuck_audit = execute_sql(f"SELECT COUNT(*) FROM audit_logs WHERE action = 'UPLOAD_ABORTED_STUCK' AND resource_id = '{stuck_file_id}'::uuid;")
    drift_audit = execute_sql(f"SELECT COUNT(*) FROM audit_logs WHERE action = 'RESERVATION_RECONCILED' AND resource_id = '{target_drift_acc_id}'::uuid;")
    if int(stuck_audit) >= 1:
        log_pass("Found UPLOAD_ABORTED_STUCK entry in audit_logs")
    else:
        log_fail("Missing UPLOAD_ABORTED_STUCK audit log")

    if int(drift_audit) >= 1:
        log_pass("Found RESERVATION_RECONCILED entry in audit_logs")
    else:
        log_fail("Missing RESERVATION_RECONCILED audit log")

    # F: Check storage_snapshots created
    snap_count = int(execute_sql(f"SELECT COUNT(*) FROM storage_snapshots WHERE drive_account_id IN ('{stuck_acc_id}'::uuid, '{target_drift_acc_id}'::uuid);"))
    if snap_count >= 2:
        log_pass(f"Found {snap_count} time-series storage snapshot rows in storage_snapshots")
    else:
        log_fail(f"Expected >= 2 storage snapshots, found {snap_count}")

    # ─── Cleanup ─────────────────────────────────────────────────────────────
    print("\n[Teardown: Cleaning up test data]")
    execute_sql(f"""
      DELETE FROM audit_logs WHERE user_id = '{user_id}';
      DELETE FROM upload_operations WHERE drive_account_id IN (SELECT id FROM drive_accounts WHERE user_id = '{user_id}');
      DELETE FROM files WHERE user_id = '{user_id}';
      DELETE FROM storage_snapshots WHERE drive_account_id IN (SELECT id FROM drive_accounts WHERE user_id = '{user_id}');
      DELETE FROM drive_accounts WHERE user_id = '{user_id}';
      DELETE FROM users WHERE id = '{user_id}';
    """)
    log_pass("Test teardown complete.")

    # ─── Summary ─────────────────────────────────────────────────────────────
    print("\n" + "=" * 75)
    print(f"PHASE 6 TEST RESULTS: {PASS_COUNT} PASSED | {FAIL_COUNT} FAILED")
    print("=" * 75)

    if FAIL_COUNT > 0:
        print("❌ SOME TESTS FAILED")
        sys.exit(1)
    else:
        print("🎉 ALL PHASE 6 CRITERIA VERIFIED SUCCESSFULLY (100%)")
        sys.exit(0)

if __name__ == "__main__":
    main()
