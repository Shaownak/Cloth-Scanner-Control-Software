@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS, then run this launcher again.
  pause
  exit /b 1
)
node scripts/show-keys.js
echo.
echo Open http://localhost:8090 and enter the operator key above.
node working-software/src/server.js
pause
