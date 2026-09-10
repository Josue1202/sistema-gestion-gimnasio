@echo off
cd /d "%~dp0"
echo Deteniendo el sistema (los datos NO se borran)...
docker compose stop
echo.
echo Detenido. Para volver a encender: "Iniciar sistema.cmd"
pause
