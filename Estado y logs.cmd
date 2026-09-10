@echo off
cd /d "%~dp0"
docker compose ps
echo.
echo --- Ultimas lineas de la app ---
docker compose logs --tail 30 app
echo.
echo (cierra esta ventana cuando termines)
pause
