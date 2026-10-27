#!/usr/bin/env python3
import os
import shutil
import subprocess
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
API_DIR = os.path.join(REPO_ROOT, "apps/api")

# Dynamically locate esbuild binary
LOCAL_ESBUILD = os.path.join(REPO_ROOT, "node_modules/.bin/esbuild")
ESBUILD_BIN = LOCAL_ESBUILD if os.path.exists(LOCAL_ESBUILD) else (shutil.which("esbuild") or "esbuild")

cmd = [
    ESBUILD_BIN,
    "src/server.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    "--external:@prisma/client",
    "--external:@ucss/database",
    "--external:pg-native",
    "--external:googleapis",
    "--external:@googleapis/drive",
    "--outfile=dist/server.js"
]

print("Running esbuild...")
res = subprocess.run(cmd, cwd=API_DIR, stdin=subprocess.DEVNULL)
print("Build finished with code:", res.returncode)
sys.exit(res.returncode)
