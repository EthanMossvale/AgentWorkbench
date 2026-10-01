@echo off
setlocal
where node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or is not on PATH. Install Node.js 24 first.
  pause
  exit /b 1
)
node "%~dp0scripts\start-dev.mjs" %*
set "AWB_EXIT_CODE=%ERRORLEVEL%"
if not "%AWB_EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Development startup failed. The details are shown above.
  pause
)
exit /b %AWB_EXIT_CODE%
