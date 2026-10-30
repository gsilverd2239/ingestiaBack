@echo off
cd /d "%~dp0\.."
echo ====================================================
echo   Desinstalando ingestIA de Servicios de Windows...
echo ====================================================
node service-uninstall.js
pause
