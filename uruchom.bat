@echo off
title Mapa Katastralna Czarna
cd /d "%~dp0"
echo ========================================
echo    MAPA KATASTRALNA GMINY CZARNA
echo ========================================
echo.
echo Uruchamianie aplikacji...
echo.
where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo [BLAD] Rust/Cargo nie znaleziony!
    echo Zainstaluj: https://rustup.rs
    pause
    exit /b 1
)
if not exist "data\czarna.db" (
    echo [INFO] Baza danych nie istnieje.
    echo [INFO] Uruchamiam migracje danych...
    python tools\migrate_data.py
)
echo.
echo [OK] Start Tauri dev...
echo.
cargo tauri dev
pause
