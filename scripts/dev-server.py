#!/usr/bin/env python3
import sys
import os
import signal
import subprocess
import time
import urllib.request
import json

PID_FILE = "/tmp/ucss_api.pid"
LOG_FILE = "/tmp/ucss_api.log"
API_DIR = "/Users/sps/Desktop/DATABASE UNLIMITED/ucss/apps/api"
PORT = 4000

NODE_BIN = "/usr/local/bin/node" if os.path.exists("/usr/local/bin/node") else "node"
NATIVE_ESBUILD = "/Users/sps/Desktop/DATABASE UNLIMITED/ucss/node_modules/.pnpm/@esbuild+darwin-arm64@0.25.12/node_modules/@esbuild/darwin-arm64/bin/esbuild"
ESBUILD_BIN = NATIVE_ESBUILD if os.path.exists(NATIVE_ESBUILD) else "../../node_modules/.bin/esbuild"

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

def start():
    pid = get_pid()
    if pid:
        print(f"API server already running with PID {pid}")
        return

    print("Building apps/api bundle...")
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
        capture_output=True,
        text=True,
        start_new_session=True
    )
    if build.returncode != 0:
        print("Build failed:", build.stderr)
        sys.exit(1)
    print("Build completed.")

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
    elif cmd == "stop":
        stop()
    elif cmd == "restart":
        stop()
        start()
    elif cmd == "status":
        status()
    elif cmd == "logs":
        logs()
    else:
        print("Usage: dev-server.py {start|stop|restart|status|logs}")
        sys.exit(1)
