@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Aja ensin asenna.bat
  pause
  exit /b 1
)
.venv\Scripts\python.exe kotiagentti.py --liike 60
echo.
pause
