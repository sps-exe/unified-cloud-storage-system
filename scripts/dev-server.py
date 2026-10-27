#!/usr/bin/env python3
import sys
import os
import shutil
import signal
import subprocess
import time
import urllib.request
import json

PID_FILE = "/tmp/ucss_api.pid"
LOG_FILE = "/tmp/ucss_api.log"
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
API_DIR = os.path.join(REPO_ROOT, "apps/api")
PORT = 4000

NODE_BIN = shutil.which("node") or "node"
LOCAL_ESBUILD = os.path.join(REPO_ROOT, "node_modules/.bin/esbuild")
ESBUILD_BIN = LOCAL_ESBUILD if os.path.exists(LOCAL_ESBUILD) else (shutil.which("esbuild") or "esbuild")

def get_pid():
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, "r") as f:
                pid = int(f.read().strip())
            # Check if process is still running
            os.kill(pid, 0)
            return pid
        except (ValueError, OSError):
            pass

    # Fallback: check who is listening on PORT
    try:
        res = subprocess.run(["lsof", "-ti", "-sTCP:LISTEN", f":{PORT}"], capture_output=True, text=True)
        if res.returncode == 0 and res.stdout.strip():
            pid = int(res.stdout.strip().splitlines()[0])
            with open(PID_FILE, "w") as f:
                f.write(str(pid))
            return pid
    except Exception:
        pass

    return None

def build_bundle():
    print("Building apps/api bundle...")
    with open("/tmp/api_build.log", "w") as b_log:
        build = subprocess.run(
            [
                ESBUILD_BIN,
                "src/server.ts",
                "--bundle",
                "--platform=node",
                "--format=esm",
                "--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
                "--external:@prisma/client",
                "--external:@ucss/database",
                "--external:pg-native",
                "--outfile=dist/server.js"
            ],
            cwd=API_DIR,
            stdin=subprocess.DEVNULL,
            stdout=b_log,
            stderr=b_log,
            start_new_session=True
        )
    if build.returncode != 0:
        with open("/tmp/api_build.log") as b_log:
            print("Build failed:", b_log.read())
        sys.exit(1)
    print("Build completed.")

def start(force_build=False):
    pid = get_pid()
    if pid:
        print(f"API server already running with PID {pid}")
        return

    dist_server = os.path.join(API_DIR, "dist/server.js")
    if force_build or not os.path.exists(dist_server):
        build_bundle()
    else:
        print("Using existing apps/api bundle (dist/server.js).")

    with open(LOG_FILE, "a") as log_f:
        proc = subprocess.Popen(
            [NODE_BIN, "dist/server.js"],
            cwd=API_DIR,
            stdout=log_f,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True
        )
    pid = proc.pid
    with open(PID_FILE, "w") as f:
        f.write(str(pid))
    print(f"Server started in background with PID {pid}. Waiting for health check...")
    for i in range(360):
        time.sleep(0.5)
        try:
            req = urllib.request.urlopen(f"http://localhost:{PORT}/api/health", timeout=1)
            if req.status == 200:
                body = json.loads(req.read().decode())
                print(f"✅ Server is healthy! Response: {body}")
                return
        except Exception:
            pass

    print("⚠️ Server did not respond to health check within 180s. Recent logs:")
    logs()

def stop():
    pid = get_pid()
    if not pid:
        print("Server is not running.")
        if os.path.exists(PID_FILE):
            os.remove(PID_FILE)
        return

    print(f"Stopping server (PID {pid})...")
    try:
        os.kill(pid, signal.SIGTERM)
        for _ in range(10):
            time.sleep(0.5)
            try:
                os.kill(pid, 0)
            except OSError:
                break
        else:
            os.kill(pid, signal.SIGKILL)
    except OSError:
        pass

    if os.path.exists(PID_FILE):
        os.remove(PID_FILE)
    print("Server stopped.")

def status():
    pid = get_pid()
    if not pid:
        print("Server is NOT running.")
        sys.exit(1)

    print(f"Server is running with PID {pid}.")
    try:
        req = urllib.request.urlopen(f"http://localhost:{PORT}/api/health", timeout=2)
        body = json.loads(req.read().decode())
        print(f"Health check: HTTP {req.status}")
        print(json.dumps(body, indent=2))
    except Exception as e:
        print(f"Health check failed: {e}")
        sys.exit(1)

def logs():
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, "r") as f:
            lines = f.readlines()
        print("".join(lines[-30:]))
    else:
        print("No log file found.")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "start":
        start()
    elif cmd == "build":
        build_bundle()
    elif cmd == "stop":
        stop()
    elif cmd == "restart":
        stop()
        start(force_build=True)
    elif cmd == "status":
        status()
    elif cmd == "logs":
        logs()
    else:
        print("Usage: dev-server.py {start|stop|restart|build|status|logs}")
        sys.exit(1)
