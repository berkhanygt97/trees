@echo off
title Casino Royale - LAN host
cd /d "%~dp0\.."

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   Get it from https://nodejs.org  ^(the LTS button^), then run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\three" (
  echo   First run - installing the game. This takes a minute...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   Install failed. You need an internet connection for this one step.
    pause
    exit /b 1
  )
)

echo.
echo   Starting the casino. Leave this window open while you play.
echo   Close it to shut the casino down.
echo.
call npm start
pause
