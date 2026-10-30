@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv (echo Aja ensin asenna.bat & pause & exit /b 1)
.venv\Scripts\python -m pip install -q -r requirements.txt
.venv\Scripts\python kotiagentti.py --lampopumppu %1
echo.
pause
