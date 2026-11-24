"""
DevSentry Selenium Test Automation Runner
========================================
Orchestrates launching the client server (if not already running),
executing the Selenium test suite via pytest, and producing test results.
"""

import os
import sys
import time
import socket
import subprocess

def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1.0)
        return s.connect_ex((host, port)) == 0

def start_client_server():
    print("[1/3] Checking if frontend client is running on port 5173...")
    if is_port_in_use(5173):
        print(" -> Client is already running on http://127.0.0.1:5173.")
        return None

    npm_bin = "npm.cmd" if sys.platform.startswith("win") else "npm"
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    client_dir = os.path.join(repo_root, "client")
    print(f" -> Starting Vite preview server ({npm_bin} run start in client/)...")
    process = subprocess.Popen(
        [npm_bin, "run", "start"],
        cwd=client_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        shell=sys.platform.startswith("win"),
    )

    # Wait up to 15 seconds for port 5173 to become available
    for _ in range(15):
        time.sleep(1)
        if is_port_in_use(5173):
            print(" -> Client server is ready on http://127.0.0.1:5173.")
            return process

    print(" [!] Warning: Client server did not report port 5173 within 15 seconds.")
    return process

def run_tests(args):
    print("\n[2/3] Running Selenium E2E Tests via pytest...")
    os.makedirs("reports", exist_ok=True)
    test_dir = os.path.dirname(os.path.abspath(__file__))
    cmd = [
        sys.executable,
        "-m",
        "pytest",
        test_dir,
        "-v",
        "--tb=short",
    ] + args

    result = subprocess.run(cmd)
    return result.returncode

def main():
    extra_args = sys.argv[1:]
    server_process = None
    try:
        server_process = start_client_server()
        code = run_tests(extra_args)
        print("\n[3/3] Selenium test execution finished.")
        sys.exit(code)
    finally:
        if server_process is not None:
            print(" -> Stopping background client server...")
            server_process.terminate()
            try:
                server_process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server_process.kill()

if __name__ == "__main__":
    main()
