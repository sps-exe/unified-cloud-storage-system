#!/usr/bin/env python3
"""
=============================================================================
UCSS Phase 7 Verification Test Suite — Frontend Web Application
=============================================================================
Verifies production bundle generation, asset serving, SPA routing fallback,
and security headers for the unified React + Tailwind CSS client.
=============================================================================
"""

import sys
import os
import re
import urllib.request
import urllib.error

BASE_URL = "http://localhost:4000"
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

def make_request(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "UCSS-Test-Client", "Connection": "close"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read(), resp.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers

def main():
    print("\n" + "=" * 75)
    print("🚀 STARTING PHASE 7 VERIFICATION: FRONTEND APPLICATION & ASSETS")
    print("=" * 75)

    # ─── Step 1: Root HTML Serving ────────────────────────────────────────────
    print("\n[1/4] Verifying root HTML delivery...")
    status, body_bytes, headers = make_request(f"{BASE_URL}/")
    html = body_bytes.decode("utf-8")

    if status == 200 and "text/html" in headers.get("Content-Type", ""):
        log_pass("Root path (/) returns HTTP 200 with text/html")
    else:
        log_fail("Root path did not return text/html", (status, headers))

    if "<title>UCSS — Unified Cloud Storage System</title>" in html:
        log_pass("HTML contains expected application title")
    else:
        log_fail("Application title missing from HTML", html[:200])

    if '<div id="root"></div>' in html:
        log_pass("React mount root element present (<div id=\"root\"></div>)")
    else:
        log_fail("React root element missing from HTML")

    # ─── Step 2: Static Assets Verification ───────────────────────────────────
    print("\n[2/4] Verifying Vite-bundled JavaScript and CSS assets...")
    js_match = re.search(r'src="(/assets/index[^"]*\.js)"', html)
    css_match = re.search(r'href="(/assets/index[^"]*\.css)"', html)

    if js_match:
        js_path = js_match.group(1)
        status, js_bytes, js_headers = make_request(f"{BASE_URL}{js_path}")
        if status == 200 and len(js_bytes) > 50000:
            log_pass(f"JS bundle served successfully ({len(js_bytes)} B): {js_path}")
        else:
            log_fail("JS bundle failed to load or too small", (status, len(js_bytes)))
    else:
        log_fail("JS bundle script tag not found in HTML")

    if css_match:
        css_path = css_match.group(1)
        status, css_bytes, css_headers = make_request(f"{BASE_URL}{css_path}")
        if status == 200 and "text/css" in css_headers.get("Content-Type", ""):
            log_pass(f"Tailwind CSS stylesheet served successfully ({len(css_bytes)} B): {css_path}")
        else:
            log_fail("CSS stylesheet failed to load", (status, css_headers))
    else:
        log_fail("CSS stylesheet link tag not found in HTML")

    # ─── Step 3: SPA Client-Side Routing Fallback ─────────────────────────────
    print("\n[3/4] Testing Single Page Application (SPA) routing fallback...")
    for route in ["/dashboard", "/files", "/settings"]:
        status, body, h = make_request(f"{BASE_URL}{route}")
        if status == 200 and '<div id="root"></div>' in body.decode("utf-8"):
            log_pass(f"Route '{route}' properly falls back to index.html for client routing")
        else:
            log_fail(f"Route '{route}' failed fallback", status)

    # ─── Step 4: Security Headers Verification ────────────────────────────────
    print("\n[4/4] Verifying HTTP security headers (Helmet)...")
    sec_headers = [
        "X-Content-Type-Options",
        "X-Frame-Options",
        "Strict-Transport-Security",
    ]
    for h in sec_headers:
        if h in headers:
            log_pass(f"Security header present: {h} = {headers.get(h)}")
        else:
            log_fail(f"Missing security header: {h}")

    # ─── Summary ─────────────────────────────────────────────────────────────
    print("\n" + "=" * 75)
    print(f"PHASE 7 TEST RESULTS: {PASS_COUNT} PASSED | {FAIL_COUNT} FAILED")
    print("=" * 75)

    if FAIL_COUNT > 0:
        print("❌ SOME TESTS FAILED")
        sys.exit(1)
    else:
        print("🎉 ALL PHASE 7 CRITERIA VERIFIED SUCCESSFULLY (100%)")
        sys.exit(0)

if __name__ == "__main__":
    main()
