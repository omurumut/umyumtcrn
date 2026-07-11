@echo off
setlocal
cd /d "%~dp0"

pnpm.cmd --filter @workspace/ems-dashboard run dev
exit /b %ERRORLEVEL%
