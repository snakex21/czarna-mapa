@echo off
setlocal
title Budowa EXE - Mapa Czarna (Go + WebView2)
cd /d "%~dp0.."

echo ========================================
echo    MAPA KATASTRALNA - BUDOWA .EXE
echo    Go + WebView2 (CGO)
echo ========================================
echo.
echo Uzycie: scripts\build.bat          - exe + paczka portable (dist\)
echo         scripts\build.bat nopack   - tylko exe
echo.

where go >nul 2>&1
if %errorlevel% neq 0 (
    echo [BLAD] Go nie znaleziony! Zainstaluj: https://go.dev/dl/
    exit /b 1
)
where gcc >nul 2>&1
if %errorlevel% neq 0 (
    echo [BLAD] gcc nie znaleziony! webview_go wymaga CGO - zainstaluj MinGW-w64 ^(np. MSYS2^).
    exit /b 1
)
set CGO_ENABLED=1

if not exist "data\czarna.db" (
    echo [WARN] Brak data\czarna.db - baza zostanie utworzona pusta przy pierwszym starcie.
)

rem Uwaga: build NIE robi "go mod tidy" (nie modyfikuje repozytorium).

if not exist "resources\app.ico" goto build
where rsrc >nul 2>&1
if errorlevel 1 (
    echo [INFO] rsrc nie znaleziony - uzywam istniejacego rsrc.syso.
    goto build
)
echo [INFO] Generowanie zasobu ikony...
rsrc -arch amd64 -ico resources\app.ico -o rsrc.syso
if errorlevel 1 (
    echo [BLAD] rsrc nie powiodlo sie!
    exit /b 1
)

:build

echo.
echo [INFO] Budowanie aplikacji (-trimpath -s -w)...
go build -trimpath -ldflags="-s -w -H windowsgui" -o "Mapa Katastralna Czarna.exe" .
if %errorlevel% neq 0 (
    echo [BLAD] Budowa nie powiodla sie!
    exit /b 1
)
if /i "%~1"=="nopack" goto done

echo.
echo [INFO] Budowanie paczki portable...
set "PKG=dist\MapaKatastralnaCzarna_Portable"
if exist "%PKG%" (
    echo [BLAD] %PKG% juz istnieje - usun go recznie przed nowym buildem.
    exit /b 1
)
mkdir "%PKG%\data"
copy /Y "Mapa Katastralna Czarna.exe" "%PKG%\" >nul
rem Tylko dane startowe: bez logow, cache, backupow, stanu okna i danych roboczych.
robocopy data "%PKG%\data" /E /NFL /NDL /NJH /NJS /NP ^
    /XD obj_thumbs backups json point_photos locations ^
    /XF app.log window_state.json window_state.json.tmp owner_data_to_import.json launcher_db_config.json *.db-wal *.db-shm *.db-journal
if %errorlevel% geq 8 (
    echo [BLAD] Kopiowanie danych nie powiodlo sie!
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%PKG%\*' -DestinationPath '%PKG%.zip' -CompressionLevel Optimal -Force; (Get-FileHash '%PKG%.zip' -Algorithm SHA256).Hash.ToLower() + '  MapaKatastralnaCzarna_Portable.zip' | Out-File -Encoding ascii '%PKG%.zip.sha256'"
if %errorlevel% neq 0 (
    echo [WARN] Nie udalo sie utworzyc ZIP, ale EXE zostal zbudowany.
)

:done
echo.
echo ========================================
echo    GOTOWE!
echo    Mapa Katastralna Czarna.exe
if /i not "%~1"=="nopack" echo    %PKG%.zip (+ .sha256)
echo ========================================
