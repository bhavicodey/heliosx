@echo off
setlocal
title FireScout
cd /d "%~dp0"
set "PY="
py -3.12 --version >nul 2>nul && set "PY=py -3.12"
if not defined PY py -3.13 --version >nul 2>nul && set "PY=py -3.13"
if not defined PY py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY python --version >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python not installed. Install Python 3.12 from https://www.python.org/downloads/
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment...
  %PY% -m venv .venv
  if errorlevel 1 goto :failed
)
echo Installing application dependencies...
".venv\Scripts\python.exe" -m pip install --prefer-binary -r requirements.txt
if errorlevel 1 (
  echo.
  echo Dependency installation failed. The application was not started.
  echo If this mentions PyYAML or C++ Build Tools, install Python 3.12,
  echo delete the .venv folder, and run start.bat again.
  goto :failed
)
echo Starting FireScout...
".venv\Scripts\python.exe" run.py
if errorlevel 1 goto :failed
pause
exit /b 0
:failed
echo.
echo FireScout setup failed. Copy the error messages above if you need help.
pause
exit /b 1
