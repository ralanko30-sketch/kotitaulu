@echo off
chcp 65001 >nul
echo Pysäytetään agentti ja poistetaan automaattinen käynnistys...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-CimInstance Win32_Process -Filter \"name='pythonw.exe'\" | Where-Object { $_.CommandLine -like '*kotiagentti.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force };" ^
  "Remove-Item -ErrorAction SilentlyContinue ([Environment]::GetFolderPath('Startup')+'\Kotitaulu-agentti.lnk')"
echo Valmis. Voit nyt poistaa tämän kansion, jos et enää tarvitse agenttia.
pause
