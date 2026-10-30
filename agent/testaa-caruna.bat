@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv (echo Aja ensin asenna.bat & pause & exit /b 1)
.venv\Scripts\python kotiagentti.py --caruna
echo.
pause
