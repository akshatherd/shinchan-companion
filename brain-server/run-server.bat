@echo off
setlocal
cd /d "%~dp0" || exit /b 1
if not exist ".venv\Scripts\python.exe" (
  echo Creating Python virtual environment...
  py -3 -m venv .venv
  if errorlevel 1 python -m venv .venv
  if errorlevel 1 exit /b 1
)
call ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.txt
if errorlevel 1 exit /b 1
if not exist ".env" copy /Y ".env.example" ".env" >nul
if not defined MUSE_HOST set "MUSE_HOST=0.0.0.0"
if not defined MUSE_PORT set "MUSE_PORT=8000"
echo Brain server is starting on http://%MUSE_HOST%:%MUSE_PORT%
".venv\Scripts\python.exe" -m uvicorn main:app --host "%MUSE_HOST%" --port "%MUSE_PORT%" --reload
