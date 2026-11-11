#!/usr/bin/env bash
# mac / linux: ./start.sh   (on mac you can also double-click start.command)
cd "$(dirname "$0")"
PY="$(command -v python3 || command -v python)"
if [ -z "$PY" ]; then echo "python isn't installed. get it from https://www.python.org/downloads/"; exit 1; fi
[ -d .venv ] || { echo "first-time setup, this takes a minute..."; "$PY" -m venv .venv; }
. .venv/bin/activate
pip install -q -r requirements.txt
python run.py
