@echo off
cd /d "%~dp0"

start "EnYS API" powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0start-api.ps1"
timeout /t 5 >nul
start "EnYS Web" powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0start-web.ps1"
timeout /t 3 >nul
start http://localhost:5000