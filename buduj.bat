@echo off
title Budowa EXE - Mapa Czarna
cd /d "%~dp0"
echo ========================================
echo    MAPA KATASTRALNA - BUDOWA .EXE
echo ========================================
echo.
where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo [BLAD] Rust/Cargo nie znaleziony!
    echo Zainstaluj: https://rustup.rs
    pause
    exit /b 1
)
if not exist "data\czarna.db" (
    echo [INFO] Brak bazy - uruchamiam migracje...
    python tools\migrate_data.py
)
echo.
echo [INFO] Budowanie aplikacji... (to moze potrwac kilka minut)
echo.
cargo tauri build
if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo    GOTOWE! Plik EXE w:
    echo    src-tauri\target\release\bundle\
    echo ========================================
) else (
    echo [BLAD] Budowa nie powiodla sie!
)
pause
