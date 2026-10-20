#!/usr/bin/env python3
import sys
import subprocess

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/run.py <command> [args...]")
        sys.exit(1)

    cmd = sys.argv[1:]
    res = subprocess.run(
        cmd,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        start_new_session=True,
        timeout=300
    )

    if res.stdout:
        print(res.stdout, end="")
    if res.stderr:
        print(res.stderr, file=sys.stderr, end="")
    sys.exit(res.returncode)

if __name__ == "__main__":
    main()
