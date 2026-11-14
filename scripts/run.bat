@echo off
title Dev - Mapa Czarna (Go + WebView2)
cd /d "%~dp0.."
echo ========================================
echo    MAPA KATASTRALNA - TRYB DEV
echo    go run (okno WebView2 + konsola z logami)
echo ========================================
echo.
where go >nul 2>&1
if %errorlevel% neq 0 (
    echo [BLAD] Go nie znaleziony! Zainstaluj: https://go.dev/dl/
    pause
    exit /b 1
)
set CGO_ENABLED=1
go run .
pause
