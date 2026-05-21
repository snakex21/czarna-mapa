@echo off
title Budowa EXE - Mapa Czarna (Go + WebView2)
cd /d "%~dp0.."

echo ========================================
echo    MAPA KATASTRALNA - BUDOWA .EXE
echo    Go + WebView2
echo ========================================
echo.

where go >nul 2>&1
if %errorlevel% neq 0 (
    echo [BLAD] Go nie znaleziony!
    echo Zainstaluj: https://go.dev/dl/
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
    exit /b 1
)

if exist "resources\app.ico" (
    where rsrc >nul 2>&1
    if %errorlevel% equ 0 (
        echo [INFO] Generowanie zasobu ikony...
        rsrc -arch amd64 -ico resources\app.ico -o rsrc.syso
        if %errorlevel% neq 0 (
            echo [BLAD] rsrc nie powiodlo sie!
            exit /b 1
        )
    ) else (
        echo [WARN] rsrc nie znaleziony - uzywam istniejacego rsrc.syso, jesli jest.
    )
)

echo.
echo [INFO] Budowanie aplikacji...
go build -ldflags="-H windowsgui" -o "Mapa Katastralna Czarna.exe" .
if %errorlevel% neq 0 (
    echo [BLAD] Budowa nie powiodla sie!
    exit /b 1
)

echo.
echo [INFO] Aktualizacja paczki portable...
if not exist "dist\MapaKatastralnaCzarna_Portable" mkdir "dist\MapaKatastralnaCzarna_Portable"
copy /Y "Mapa Katastralna Czarna.exe" "dist\MapaKatastralnaCzarna_Portable\Mapa Katastralna Czarna.exe" >nul
if exist "data" xcopy "data" "dist\MapaKatastralnaCzarna_Portable\data\" /E /I /Y >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path 'dist\MapaKatastralnaCzarna_Portable\*' -DestinationPath 'dist\MapaKatastralnaCzarna_Portable.zip' -Force"
if %errorlevel% neq 0 (
    echo [WARN] Nie udalo sie utworzyc ZIP, ale EXE zostal zbudowany.
)

echo.
echo ========================================
echo    GOTOWE!
echo    Mapa Katastralna Czarna.exe
echo    dist\MapaKatastralnaCzarna_Portable\
echo    dist\MapaKatastralnaCzarna_Portable.zip
echo ========================================
