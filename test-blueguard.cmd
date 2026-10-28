@echo off
setlocal
REM One command for safe API + Mobile automated validation.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0test-blueguard.ps1" %*
exit /b %errorlevel%
