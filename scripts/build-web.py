#!/usr/bin/env python3
import os
import subprocess
import sys

WEB_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../apps/web"))
VITE_JS = os.path.abspath(os.path.join(os.path.dirname(__file__), "../apps/web/node_modules/vite/bin/vite.js"))
LOG_FILE = "/tmp/vite_build.log"

NODE_BIN = "node"

print("Building production Vite bundle...")
with open(LOG_FILE, "w") as log:
    res_vite = subprocess.run(
        [NODE_BIN, VITE_JS, "build"],
        cwd=WEB_DIR,
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=subprocess.STDOUT
    )

with open(LOG_FILE, "r") as log:
    output = log.read()
    print(output)

print("Vite build finished with exit code:", res_vite.returncode)
sys.exit(res_vite.returncode)
