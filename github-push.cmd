@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ISO50001-EMS - Safe GitHub push helper
REM Usage:
REM   Double click this file in the project root, or run:
REM   github-push.cmd "commit message"

cd /d "%~dp0"

echo.
echo ==========================================
echo  ISO50001-EMS GitHub Push Helper
echo ==========================================
echo.

REM 1) Check this is a git repo
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [HATA] Bu dosya Git repo kokunde calismiyor.
  echo Dosyayi ISO50001-EMS klasorunun icine koyup tekrar calistirin.
  pause
  exit /b 1
)

REM 2) Show current branch
for /f "tokens=*" %%b in ('git branch --show-current') do set BRANCH=%%b
if "%BRANCH%"=="" (
  echo [HATA] Aktif branch bulunamadi.
  pause
  exit /b 1
)

echo Aktif branch: %BRANCH%
echo.

REM 3) Protect .env
if exist ".env" (
  echo [OK] .env bulundu. Git'e eklenmemesi icin kontrol edilecek.
)

git check-ignore .env >nul 2>&1
if exist ".env" (
  if errorlevel 1 (
    echo [UYARI] .env .gitignore tarafindan ignore edilmiyor gibi gorunuyor.
    echo .env dosyasini GitHub'a gondermek guvenli degil.
    echo Once .gitignore icine .env ekleyin.
    pause
    exit /b 1
  )
)

REM 4) Show working tree
echo Mevcut degisiklikler:
git status --short
echo.

REM 5) If nothing changed, exit
git diff --quiet && git diff --cached --quiet
if not errorlevel 1 (
  echo [BILGI] Commitlenecek degisiklik yok. Calisma agaci temiz.
  pause
  exit /b 0
)

REM 6) Optional commit message
set MSG=%~1
if "%MSG%"=="" (
  set /p MSG=Commit mesaji yazin ^(bos birakirsan otomatik mesaj kullanilir^): 
)

if "%MSG%"=="" (
  for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set TODAY=%%a-%%b-%%c
  set MSG=chore: update project files
)

echo.
echo Commit mesaji: "%MSG%"
echo.

REM 7) Stage all changes, then explicitly unstage secrets/local files
git add -A

git restore --staged .env >nul 2>&1
git restore --staged .env.* >nul 2>&1

REM 8) Safety check for staged sensitive files
git diff --cached --name-only | findstr /R /I "^\.env$ ^\.env\." >nul 2>&1
if not errorlevel 1 (
  echo [HATA] .env veya .env.* stage edilmis gorunuyor. Islem durduruldu.
  git status --short
  pause
  exit /b 1
)

REM 9) If no staged changes after secret cleanup, exit
git diff --cached --quiet
if not errorlevel 1 (
  echo [BILGI] Stage edilen degisiklik kalmadi. Commit atilmadi.
  git status --short
  pause
  exit /b 0
)

echo Stage edilen dosyalar:
git diff --cached --name-only
echo.

set /p CONFIRM=Commit ve push yapilsin mi? ^(E/H^): 
if /I not "%CONFIRM%"=="E" (
  echo Islem iptal edildi. Stage durumu korunuyor.
  pause
  exit /b 0
)

REM 10) Commit
git commit -m "%MSG%"
if errorlevel 1 (
  echo [HATA] Commit basarisiz oldu.
  pause
  exit /b 1
)

REM 11) Pull latest changes first to avoid non-fast-forward push
echo.
echo Uzak branch ile senkronize ediliyor: origin/%BRANCH%
git pull --rebase origin %BRANCH%
if errorlevel 1 (
  echo [HATA] Pull/Rebase basarisiz oldu. Conflict olabilir.
  echo Conflictleri cozumleyip tekrar deneyin.
  pause
  exit /b 1
)

REM 12) Push
echo.
echo GitHub'a push ediliyor...
git push origin %BRANCH%
if errorlevel 1 (
  echo [HATA] Push basarisiz oldu.
  pause
  exit /b 1
)

echo.
echo [OK] Degisiklikler GitHub'a pushlandi.
git status --short
echo.
pause
exit /b 0
