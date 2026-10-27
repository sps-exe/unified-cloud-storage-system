#!/usr/bin/env python3
import os
import subprocess
import sys

WEB_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../apps/web"))
VITE_JS = os.path.abspath(os.path.join(os.path.dirname(__file__), "../apps/web/node_modules/vite/bin/vite.js"))

NODE_BIN = "node"

print("Building production Vite bundle...")
res_vite = subprocess.run(
    [NODE_BIN, VITE_JS, "build"],
    cwd=WEB_DIR,
    stdin=subprocess.DEVNULL,
    capture_output=True,
    text=True
)

print(res_vite.stdout)
if res_vite.stderr:
    print(res_vite.stderr, file=sys.stderr)

print("Vite build finished with exit code:", res_vite.returncode)
sys.exit(res_vite.returncode)
