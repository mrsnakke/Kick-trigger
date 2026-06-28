@echo off
cd /d "%~dp0"
echo [OBS-Actions] Cerrando instancia anterior...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r ":4001.*LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul
echo [OBS-Actions] Iniciando servidor...
node index.js
pause
