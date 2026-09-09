@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
echo.
echo Modo desarrollo: http://localhost:3000  (con hot-reload)
echo Escenario OBS:   http://localhost:3000/
echo Jugadores:       http://localhost:3000/players
echo Calibracion:     http://localhost:3000/calibrate
start "" http://localhost:3000/
start "" http://localhost:3000/players
start "" http://localhost:3000/calibrate
call npm run dev