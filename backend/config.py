import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

# ---- Earth Engine ----------------------------------------------------------
EE_PROJECT = os.getenv("EE_PROJECT", "").strip()
EE_SERVICE_ACCOUNT = os.getenv("EE_SERVICE_ACCOUNT", "").strip()
EE_KEY_FILE = os.getenv("EE_KEY_FILE", "").strip()

FRONTEND_DIR = ROOT / "frontend"

# ---- Signal thresholds (tweak freely) ---------------------------------------
ALERT_MIN_FIRE_PIXELS = 1      # fires + raised SO2 together  -> "alert"
ALERT_SO2_RATIO = 1.5          # SO2 vs the area's own 30-day normal
WATCH_FIRE_PIXELS = 10         # lots of fire alone           -> "watch"
WATCH_SO2_RATIO = 2.0          # SO2 far above normal alone   -> "watch"

CACHE_SECONDS = 3600
