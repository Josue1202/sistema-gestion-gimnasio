@echo off
cd /d "%~dp0"
echo Iniciando el sistema del gimnasio...
docker compose up -d
echo.
docker compose ps
echo.
echo Listo. Abre:  http://localhost:3000
pause
