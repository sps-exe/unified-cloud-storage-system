#!/usr/bin/env python3
"""
================================================================================
UCSS Phase 8 — Native WebDAV (RFC 4918) & HTTP 206 Range Streaming Verification
================================================================================
Validates:
  1. WebDAV OPTIONS: DAV headers, allowed verbs (PROPFIND, GET, PUT, DELETE, MOVE, etc.)
  2. WebDAV Authentication: Basic Auth challenge and credentials check
  3. WebDAV PROPFIND: RFC 4918 multistatus XML response for root folder and files
  4. WebDAV LOCK & UNLOCK: macOS Finder compatibility
  5. HTTP 206 Range Streaming: Partial byte streaming with Content-Range headers
  6. Query token authentication: Media tag support (?token=...)
================================================================================
"""

import base64
import json
import sys
import urllib.request
import urllib.error

BASE_URL = "http://localhost:4000"
TEST_EMAIL = "sps.social01@gmail.com"
TEST_PASSWORD = "Password123!"

passed = 0
failed = 0

def check(name, condition, extra=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  \033[92m✔ PASS\033[0m: {name}")
    else:
        failed += 1
        print(f"  \033[91m✖ FAIL\033[0m: {name} {extra}")

print("\n" + "=" * 75)
print("🚀 STARTING PHASE 8: WEBDAV (RFC 4918) & RANGE STREAMING VERIFICATION")
print("=" * 75 + "\n")

# 1. Login to obtain access token
print("[1/5] Authenticating test session...")
login_data = json.dumps({"email": TEST_EMAIL, "password": TEST_PASSWORD}).encode()
req = urllib.request.Request(f"{BASE_URL}/api/auth/login", data=login_data, headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req) as resp:
        body = json.loads(resp.read().decode())
        token = body["data"]["accessToken"]
        check("Obtained JWT access token for test user", bool(token))
except Exception as e:
    print(f"Failed to login: {e}")
    sys.exit(1)

# 2. Test WebDAV OPTIONS
print("\n[2/5] Testing WebDAV OPTIONS (RFC 4918 Discovery)...")
req = urllib.request.Request(f"{BASE_URL}/webdav", method="OPTIONS")
try:
    with urllib.request.urlopen(req) as resp:
        check("OPTIONS responded HTTP 200 OK", resp.status == 200)
        dav_header = resp.headers.get("DAV", "")
        check("DAV header includes class 1 & 2", "1, 2" in dav_header)
        allow_methods = resp.headers.get("Allow", "")
        check("Allow header includes PROPFIND", "PROPFIND" in allow_methods)
        check("Allow header includes PUT and MOVE", "PUT" in allow_methods and "MOVE" in allow_methods)
        check("Allow header includes LOCK and UNLOCK", "LOCK" in allow_methods and "UNLOCK" in allow_methods)
except Exception as e:
    check("OPTIONS request failed", False, str(e))

# 3. Test WebDAV Basic Auth & PROPFIND
print("\n[3/5] Testing WebDAV PROPFIND & Basic Authentication...")
req_unauth = urllib.request.Request(f"{BASE_URL}/webdav", method="PROPFIND")
try:
    urllib.request.urlopen(req_unauth)
    check("Unauthenticated PROPFIND rejected", False, "Expected 401")
except urllib.error.HTTPError as e:
    check("Unauthenticated PROPFIND returns 401 Unauthorized", e.code == 401)
    auth_header = e.headers.get("www-authenticate", "")
    check("WWW-Authenticate Basic realm challenge present", "Basic realm=" in auth_header)

auth_str = f"{TEST_EMAIL}:{TEST_PASSWORD}"
b64_auth = base64.b64encode(auth_str.encode()).decode()
headers = {
    "Authorization": f"Basic {b64_auth}",
    "Depth": "1",
    "Content-Type": "application/xml; charset=utf-8",
}
req_prop = urllib.request.Request(f"{BASE_URL}/webdav", headers=headers, method="PROPFIND")
try:
    with urllib.request.urlopen(req_prop) as resp:
        body = resp.read().decode()
        check("Authenticated PROPFIND returns 207 Multi-Status", resp.status == 207)
        check("Response contains multistatus XML root", "<D:multistatus" in body or "<d:multistatus" in body)
        check("Response includes root collection href", "<D:href>/webdav/</D:href>" in body)
        check("Response defines standard DAV properties", "resourcetype" in body and "displayname" in body)
except Exception as e:
    check("PROPFIND request failed", False, str(e))

# 4. Test WebDAV LOCK / UNLOCK macOS Finder compatibility
print("\n[4/5] Testing WebDAV LOCK and UNLOCK Handshake...")
lock_headers = {
    "Authorization": f"Basic {b64_auth}",
    "Timeout": "Second-3600",
}
req_lock = urllib.request.Request(f"{BASE_URL}/webdav/test-file.txt", headers=lock_headers, method="LOCK")
try:
    with urllib.request.urlopen(req_lock) as resp:
        lock_token = resp.headers.get("lock-token", "")
        check("LOCK responds HTTP 200 OK", resp.status == 200)
        check("LOCK generates opaquelocktoken", "opaquelocktoken:" in lock_token)

    unlock_headers = {
        "Authorization": f"Basic {b64_auth}",
        "Lock-Token": lock_token,
    }
    req_unlock = urllib.request.Request(f"{BASE_URL}/webdav/test-file.txt", headers=unlock_headers, method="UNLOCK")
    with urllib.request.urlopen(req_unlock) as resp:
        check("UNLOCK responds HTTP 204 No Content", resp.status == 204)
except Exception as e:
    check("LOCK/UNLOCK handshake failed", False, str(e))

# 5. Test HTTP 206 Partial Content Range Streaming
print("\n[5/5] Testing HTTP 206 Partial Content Range Streaming...")
# Fetch existing file list to get file ID
req_files = urllib.request.Request(f"{BASE_URL}/api/files", headers={"Authorization": f"Bearer {token}"})
try:
    with urllib.request.urlopen(req_files) as resp:
        data = json.loads(resp.read().decode())["data"]
        files = data if isinstance(data, list) else data.get("files", [])
        if not files:
            print("  (Warning: No files currently in database to test partial stream)")
        else:
            file_id = files[0]["id"]
            total_size = files[0]["sizeBytes"]

            # Request byte range 0-100
            range_headers = {
                "Authorization": f"Bearer {token}",
                "Range": "bytes=0-100",
            }
            req_stream = urllib.request.Request(f"{BASE_URL}/api/files/{file_id}/stream", headers=range_headers)
            with urllib.request.urlopen(req_stream) as resp:
                check("Partial range request returns HTTP 206 Partial Content", resp.status == 206)
                check("Accept-Ranges: bytes header present", resp.headers.get("accept-ranges") == "bytes")
                content_range = resp.headers.get("content-range", "")
                check("Content-Range header formatted correctly", content_range.startswith("bytes 0-100/"))
                chunk = resp.read()
                check("Returned chunk length matches range (101 bytes)", len(chunk) == 101)

            # Test token query param for HTML5 video/audio elements (?token=...)
            req_token_stream = urllib.request.Request(f"{BASE_URL}/api/files/{file_id}/stream?token={token}", headers={"Range": "bytes=0-50"})
            with urllib.request.urlopen(req_token_stream) as resp:
                check("Query param ?token=... authenticates successfully (HTTP 206)", resp.status == 206)
                check("Query token stream returns exact requested bytes", len(resp.read()) == 51)
except Exception as e:
    check("Streaming test failed", False, str(e))

print("\n" + "=" * 75)
print(f"PHASE 8 TEST RESULTS: {passed} PASSED | {failed} FAILED")
print("=" * 75 + "\n")

if failed > 0:
    sys.exit(1)
