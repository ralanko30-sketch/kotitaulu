@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Kotitaulun kotiagentin asennus
echo.

where py >nul 2>nul
if errorlevel 1 (
  echo Python puuttuu. Asenna se komennolla:  winget install Python.Python.3.12
  echo ja aja tämä tiedosto sitten uudelleen.
  pause
  exit /b 1
)

if not exist .venv (
  echo Luodaan Python-ympäristö...
  py -3 -m venv .venv || (pause & exit /b 1)
)
echo Asennetaan tarvittavat paketit...
.venv\Scripts\python -m pip install --upgrade pip -q
.venv\Scripts\python -m pip install -r requirements.txt -q || (echo Pakettien asennus epäonnistui. & pause & exit /b 1)

if not exist config.json (
  copy config.example.json config.json >nul
  echo.
  echo Avaan config.json-tiedoston. Täytä siihen sivun osoite, agenttiavain,
  echo kameroiden tiedot ja Caruna-tunnukset, tallenna ja aja asenna.bat uudelleen.
  notepad config.json
  pause
  exit /b 0
)

echo.
echo Tehdään testikierros...
.venv\Scripts\python kotiagentti.py --kerran
if errorlevel 1 (
  echo Testikierros epäonnistui, katso virheet yltä.
  pause
  exit /b 1
)

echo.
echo Lisätään agentti käynnistymään automaattisesti kirjautuessa...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Kotitaulu-agentti.lnk');" ^
  "$s.TargetPath='%~dp0.venv\Scripts\pythonw.exe';" ^
  "$s.Arguments='\"%~dp0kotiagentti.py\"';" ^
  "$s.WorkingDirectory='%~dp0';" ^
  "$s.Save()"

start "" "%~dp0.venv\Scripts\pythonw.exe" "%~dp0kotiagentti.py"
echo.
echo Valmis. Agentti pyörii nyt taustalla ja käynnistyy jatkossa itsestään.
echo Loki: %~dp0kotiagentti.log
pause
