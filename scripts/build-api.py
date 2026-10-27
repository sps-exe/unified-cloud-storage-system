#!/usr/bin/env python3
import os
import subprocess
import sys

API_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../apps/api"))
ESBUILD_BIN = "/Users/sps/Desktop/DATABASE UNLIMITED/ucss/node_modules/.pnpm/@esbuild+darwin-arm64@0.25.12/node_modules/@esbuild/darwin-arm64/bin/esbuild"

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
res = subprocess.run(cmd, cwd=API_DIR, stdin=subprocess.DEVNULL, start_new_session=True)
print("Build finished with code:", res.returncode)
sys.exit(res.returncode)
