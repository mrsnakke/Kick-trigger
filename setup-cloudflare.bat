@echo off
title Setup Cloudflare Tunnel
echo ============================================
echo   Setup Cloudflare Tunnel para Kick Backend
echo ============================================
echo.

:: Verificar cloudflared
where cloudflared >nul 2>nul
if %errorlevel% neq 0 (
    echo Paso 0: Instalar cloudflared
    echo   Descargalo de: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    echo   O con winget:  winget install cloudflare.cloudflared
    echo.
    pause
    exit /b 1
)
echo [OK] cloudflared encontrado
echo.

:: Login
echo Paso 1: Autenticar cloudflared con tu cuenta Cloudflare
echo   Se abrira el navegador para iniciar sesion.
echo.
pause
cloudflared tunnel login
echo.

:: Crear tunnel
echo Paso 2: Crear el tunel nombrado
set /p TUNNEL_NAME="Nombre del tunel (ej: kick-backend): "
if "%TUNNEL_NAME%"=="" set TUNNEL_NAME=kick-backend
cloudflared tunnel create %TUNNEL_NAME%
echo.

:: DNS
echo Paso 3: Crear DNS route
set /p CF_DOMAIN="Subdominio a usar (ej: webhook.tudominio.com): "
cloudflared tunnel route dns %TUNNEL_NAME% %CF_DOMAIN%
echo.

:: Actualizar .env
echo Paso 4: Configurando .env
set ENV_FILE=.env
if exist %ENV_FILE% (
    findstr /v "CF_TUNNEL_NAME CF_DOMAIN" %ENV_FILE% > %TEMP%\env-tmp.txt
    echo CF_TUNNEL_NAME=%TUNNEL_NAME% >> %TEMP%\env-tmp.txt
    echo CF_DOMAIN=%CF_DOMAIN% >> %TEMP%\env-tmp.txt
    move /y %TEMP%\env-tmp.txt %ENV_FILE% >nul
) else (
    echo CF_TUNNEL_NAME=%TUNNEL_NAME% > %ENV_FILE%
    echo CF_DOMAIN=%CF_DOMAIN% >> %ENV_FILE%
)
echo.
echo ============================================
echo   LISTO! Configuracion completada.
echo.
echo   Ahora ejecuta: iniciar.bat
echo   La URL de tu webhook sera:
echo   https://%CF_DOMAIN%/webhook/kick
echo ============================================
pause
