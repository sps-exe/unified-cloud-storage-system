#!/usr/bin/env python3
"""
=============================================================================
UCSS Strict TypeScript Typecheck Sweep
=============================================================================
Runs tsc --noEmit across all monorepo packages and validates 0 errors.
=============================================================================
"""

import os
import subprocess
import sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TSC_PATH = os.path.join(PROJECT_ROOT, "apps/web/node_modules/typescript/bin/tsc")

PACKAGES = [
    ("apps/web", os.path.join(PROJECT_ROOT, "apps/web/tsconfig.json")),
    ("apps/api", os.path.join(PROJECT_ROOT, "apps/api/tsconfig.json")),
]

failed = False

print("=" * 70)
print("🔍 STRICT TYPESCRIPT VERIFICATION SWEEP")
print("=" * 70)

for name, tsconfig in PACKAGES:
    print(f"\nChecking [{name}]...")
    cmd = ["node", TSC_PATH, "--project", tsconfig, "--noEmit"]
    res = subprocess.run(
        cmd,
        cwd=os.path.dirname(tsconfig),
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        start_new_session=True,
    )
    if res.returncode == 0:
        print(f"  \033[92m✔ PASS\033[0m: {name} compiled with ZERO type errors.")
    else:
        print(f"  \033[91m✖ FAIL\033[0m: {name} type errors:\n{res.stdout}\n{res.stderr}")
        failed = True

print("\n" + "=" * 70)
if failed:
    print("❌ TYPECHECK FAILED")
    sys.exit(1)
else:
    print("✅ ALL PACKAGES PASSED STRICT TYPECHECKING (0 ERRORS)")
    print("=" * 70)
