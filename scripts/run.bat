@echo off
title Dev - Mapa Czarna (Go + Wails)
cd /d "%~dp0.."
echo ========================================
echo    MAPA KATASTRALNA - TRYB DEV
echo    Go + Wails (hot-reload)
echo ========================================
echo.
where wails >nul 2>&1
if %errorlevel% neq 0 (
    echo [BLAD] Wails CLI nie znaleziony!
    echo Zainstaluj: go install github.com/wailsapp/wails/v2/cmd/wails@latest
    pause
    exit /b 1
)
echo [INFO] Uruchamianie w trybie dev z hot-reload...
wails dev
pause
