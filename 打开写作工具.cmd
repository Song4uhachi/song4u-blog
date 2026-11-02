@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm run write
if errorlevel 1 pause
