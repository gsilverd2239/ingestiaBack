@echo off
cd /d "%~dp0\.."
echo ====================================================
echo   Instalando ingestIA como Servicio de Windows...
echo ====================================================
node service-install.js
pause
