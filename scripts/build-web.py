#!/usr/bin/env python3
import os
import signal
import subprocess
import sys

# Prevent macOS terminal job control from freezing background subshells
for sig in [getattr(signal, 'SIGTTIN', None), getattr(signal, 'SIGTTOU', None), getattr(signal, 'SIGTSTP', None)]:
    if sig is not None:
        signal.signal(sig, signal.SIG_IGN)

WEB_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../apps/web"))
VITE_JS = os.path.abspath(os.path.join(os.path.dirname(__file__), "../apps/web/node_modules/vite/bin/vite.js"))

print("Building production Vite bundle...")
res_vite = subprocess.run(
    ["node", VITE_JS, "build"],
    cwd=WEB_DIR,
    stdin=subprocess.DEVNULL,
    start_new_session=True
)
print("Vite build finished with exit code:", res_vite.returncode)
sys.exit(res_vite.returncode)
