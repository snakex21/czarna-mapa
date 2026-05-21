@echo off
title Budowa EXE - Mapa Czarna (Go + Wails)
cd /d "%~dp0.."
echo ========================================
echo    MAPA KATASTRALNA - BUDOWA .EXE
echo    Go + Wails
echo ========================================
echo.
where go >nul 2>&1
if %errorlevel% neq 0 (
    echo [BLAD] Go nie znaleziony!
    echo Zainstaluj: https://go.dev/dl/
    pause
    exit /b 1
)
where wails >nul 2>&1
if %errorlevel% neq 0 (
    echo [BLAD] Wails CLI nie znaleziony!
    echo Zainstaluj: go install github.com/wailsapp/wails/v2/cmd/wails@latest
    pause
    exit /b 1
)
if not exist "data\czarna.db" (
    echo [INFO] Brak bazy - uruchamiam migracje...
    if exist "tools\migrate_data.py" (
        python tools\migrate_data.py
    ) else (
        echo [WARN] Nie znaleziono skryptu migracji. Baza zostanie utworzona automatycznie.
    )
)
echo.
echo [INFO] Pobieranie zaleznosci...
go mod tidy
if %errorlevel% neq 0 (
    echo [BLAD] go mod tidy nie powiodlo sie!
    pause
    exit /b 1
)
echo.
echo [INFO] Budowanie aplikacji... (pierwszy build pobiera zaleznosci)
echo.
wails build
if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo    GOTOWE! Plik EXE w:
    echo    build\bin\
    echo ========================================
) else (
    echo [BLAD] Budowa nie powiodla sie!
)
pause
