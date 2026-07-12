@echo off
setlocal
title EnYS Gelistirme Baslat

cd /d "%~dp0"

if not exist "artifacts\api-server\package.json" (
    echo.
    echo HATA: Bu dosyalar ISO50001-EMS proje kokunde olmali.
    echo Mevcut klasor: %CD%
    echo.
    pause
    exit /b 1
)

if not exist ".env" (
    echo.
    echo HATA: Proje kokunde .env dosyasi bulunamadi.
    echo.
    pause
    exit /b 1
)

if not exist "EnYS-API-Watch.mjs" (
    echo.
    echo HATA: EnYS-API-Watch.mjs ayni klasorde bulunamadi.
    echo.
    pause
    exit /b 1
)

echo Eski 8080 portu kapatiliyor...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do (
    taskkill /PID %%P /T /F >nul 2>&1
)

echo API otomatik yenileme penceresi aciliyor...
start "EnYS API - Otomatik Yenileme" cmd.exe /k "cd /d ""%CD%"" && node EnYS-API-Watch.mjs"

timeout /t 3 /nobreak >nul

echo Frontend penceresi aciliyor...
start "EnYS Frontend - Vite" cmd.exe /k "cd /d ""%CD%"" && pnpm.cmd --filter @workspace/ems-dashboard run dev"

echo.
echo EnYS gelistirme ortami baslatildi.
echo API ve frontend ayri pencerelerde calisiyor.
echo.
pause
