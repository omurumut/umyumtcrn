@echo off
setlocal
cd /d "%~dp0"

if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" set "%%A=%%~B"
  )
)

set "PORT=8080"
set "NODE_ENV=development"

pnpm.cmd --filter @workspace/api-server run dev:win
exit /b %ERRORLEVEL%
