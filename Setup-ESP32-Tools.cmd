@echo off
cd /d "%~dp0"
powershell -NoProfile -File "%~dp0scripts\Setup-ESP32-Tools.ps1"
pause
