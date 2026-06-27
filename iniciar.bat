@echo off
title Kick Backend

:: Verificar Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado. Descargalo de https://nodejs.org
    pause
    exit /b 1
)

:: Verificar e instalar dependencias si no existen
if not exist "node_modules\" (
    echo [INFO] Instalando dependencias...
    call npm install
)

:: Cargar credenciales desde .env si existen y no están en entorno
if "%KICK_CLIENT_ID%"=="" if exist ".env" (
    for /f "tokens=1,* delims==" %%a in (.env) do set "%%a=%%b"
)

echo.
echo [INICIO] Kick Backend - http://localhost:3000
echo.
:: Abrir navegador y arrancar servidor en paralelo
start msedge --app="http://localhost:3000" --no-first-run
call node server.js

pause
