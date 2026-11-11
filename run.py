"""firescout launcher.   python run.py   ->   opens http://127.0.0.1:8000

First run sets everything up for you:
  1. creates .env from .env.example if it's missing
  2. asks for your google cloud project id if it isn't set yet (and saves it)
  3. opens the google sign-in page if earth engine isn't authenticated yet
"""
import os
import re
import shutil
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
URL = "http://127.0.0.1:8000"


def ensure_env_file() -> None:
    env, example = ROOT / ".env", ROOT / ".env.example"
    if not env.exists():
        if example.exists():
            shutil.copy(example, env)
        else:
            env.write_text("EE_PROJECT=\n", encoding="utf-8")

    text = env.read_text(encoding="utf-8")
    match = re.search(r"^EE_PROJECT=(.*)$", text, re.M)
    current = match.group(1).strip() if match else ""
    if current and current != "your-gcp-project-id":
        return

    print("\n  firescout needs your google cloud project id (the one registered for earth engine).")
    print("  find it at https://console.cloud.google.com  (it looks like  my-project-12345)\n")
    try:
        project = input("  paste your project id and press enter: ").strip()
    except EOFError:
        project = ""
    if not project:
        print("\n  no project id entered. open the .env file, set EE_PROJECT=..., then run again.")
        sys.exit(1)
    if match:
        text = re.sub(r"^EE_PROJECT=.*$", lambda _m: f"EE_PROJECT={project}", text, flags=re.M)
    else:
        text = f"EE_PROJECT={project}\n" + text
    env.write_text(text, encoding="utf-8")
    print("  saved to .env ♡\n")


def ensure_earth_engine() -> None:
    from backend import config, ee_client

    try:
        ee_client.ensure()
        print("  earth engine connected ♡")
        return
    except ee_client.EENotReady as exc:
        print(f"\n  {exc}")

    if config.EE_SERVICE_ACCOUNT:
        return  # service account is configured; the page will show what's wrong
    print("\n  opening google sign-in in your browser (one time only)...\n")
    try:
        import ee
        ee.Authenticate()
        ee_client.ensure()
        print("  earth engine connected ♡")
    except Exception as exc:  # noqa: BLE001
        print(f"\n  couldn't finish sign-in: {exc}")
        print("  the app will still open and tell you what's missing.\n")


if __name__ == "__main__":
    ensure_env_file()
    ensure_earth_engine()

    import uvicorn

    print(f"\n  firescout is running at {URL}  (press ctrl+c to stop)\n")
    threading.Timer(1.5, lambda: webbrowser.open(URL)).start()
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, log_level="warning")
