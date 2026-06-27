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

:: Verificar credenciales
if "%KICK_CLIENT_ID%"=="" (
    echo [INFO] KICK_CLIENT_ID no detectado.
    set /p KICK_CLIENT_ID="Ingresa tu Client ID: "
)
if "%KICK_CLIENT_SECRET%"=="" (
    set /p KICK_CLIENT_SECRET="Ingresa tu Client Secret: "
)

echo.
echo [INICIO] Kick Backend - http://localhost:3000
echo.
call node server.js

pause
