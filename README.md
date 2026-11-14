# Mapa Katastralna Czarna — wersja portable desktop v1.3 (w przygotowaniu)

> Aplikacja desktopowa do przeglądania historycznej mapy katastralnej gminy Czarna z 1882 roku.
> Działa jako samodzielny program Windows — bez instalacji, bez serwera, zero konfiguracji.

## Nowości w wersji 1.3 (gałąź `fix/security-v1.3`)

- **Bezpieczeństwo: import backupu ZIP (Zip Slip)** — złośliwy ZIP nie może już zapisać plików poza katalogiem miejscowości. Całe archiwum jest sprawdzane przed zapisem (ścieżki absolutne, `..`, litery dysków, `:`/ADS, backslashe, nazwy urządzeń Windows, symlinki), zapis idzie wyłącznie przez `os.Root`, są limity liczby wpisów i rozmiaru (ochrona przed zip bombą).
- **Bezpieczeństwo: lokalne API** — `/api/rpc` przyjmuje tylko żądania z okna aplikacji: dokładny `Host`, dozwolony `Origin`, `Content-Type: application/json` i losowy token sesji. Strona otwarta w zwykłej przeglądarce nie może już wywołać komend aplikacji (CSRF / DNS rebinding).
- **Zależności** — Go 1.26.11, `golang.org/x/image` v0.48.0, `modernc.org/sqlite` v1.62.0; `govulncheck` bez znalezisk.
- **Backup** — import pełnego backupu z bazą SQLite nie nadpisuje już odtworzonej bazy JSON-em (wcześniej gubił część powiązań działka–właściciel).
- **Portable** — rejestr miejscowości (`data/locations.json`) trzyma ścieżki względne; po przeniesieniu folderu aplikacja nie tworzy pustych baz pod starymi ścieżkami.
- **Mniejszy EXE** — 71 MB → ~32 MB (`-trimpath -s -w`, odchudzone zrzuty ekranu w dokumentacji, usunięty duplikat `mapa.jpg`).
- **Testy i CI** — testy bazy, RPC, importu/eksportu i bezpieczeństwa; GitHub Actions (`go vet`, `go test`, `govulncheck`, build).

## Nowości w wersji 1.2

- **Punkty historyczne (nowa warstwa mapy)** — wzorowane na warstwie z "Projekt Mapa Czarna". Osobna warstwa na mapie dla obiektów specjalnych (dworce, szkoły, kapliczki itp.) z metadanymi: `display_name`, `description`, `source_note` oraz galerią zdjęć. Markery w brązowym kolorze z białym obwodem, kliknięcie otwiera popup z opisem i galerią.
- **Edytor punktów historycznych** — nowa strona `admin_punkty_historyczne.html` (dostępna z `index.html` w sekcji Narzędzia). Edycja metadanych, upload zdjęć do galerii (z podpisami i kolejnością), podgląd miniaturek, zmiana kolejności metodą drag-and-drop lub przyciskami.
- **Galeria zdjęć punktów** — wielozdjęciowa galeria (JPG/PNG/WebP/GIF) per obiekt. Zdjęcia przechowywane w `data/point_photos/`, miniatury generowane na żądanie i cachowane na dysku w `data/obj_thumbs/` (SHA-1 + szerokość → JPEG). Serwowane przez `/point_photos/<plik>` i `/obj_thumb?path=...&w=<px>`.
- **Migracje bazy SQLite** — dodany moduł `internal/db/migrations.go` z automatycznymi migracjami (idempotentne `ensureTable` / `ensureIndex`). Tabele `historical_points_metadata` i `point_photos` powstają w istniejących bazach bez ręcznej przebudowy. Pole `opis` w punkcie działa out-of-the-box.
- **Pamięć stanu okna** — nowy moduł `internal/windowstate` zapisuje do `data/window_state.json` rozmiar, pozycję i stan zmaksymalizowania okna. Przy kolejnym uruchomieniu okno otwiera się w tym samym miejscu. Po odmaksymalizowaniu wraca do ostatniego rozmiaru "normalnego". Działa w tle (polling 2s).
- **Cache nagłówki HTTP** — miniatury mają `Cache-Control: max-age=2592000, immutable` (SHA-1 = unikalne), zdjęcia punktów mają `max-age=86400` (1 dzień). Mniej żądań do serwera, szybsze przeglądanie.
- **Bezpieczne upload-y** — walidacja rozszerzeń (`jpg/jpeg/png/webp/gif`), limit 8 MB na zdjęcie, sanityzacja nazwy pliku (`filepath.Base` + prefix `unix_ts_sha1`), automatyczne cofanie pliku z dysku gdy wpis w bazie się nie powiedzie.
- **Okno "O aplikacji" 1.2** — numer wersji w modalu zaktualizowany.

## Nowości w wersji 1.1

- **Nowy silnik mapy** — MapLibre GL zamiast Leaflet we wszystkich widokach: mapa główna, edytor działek. Płynniejsze zoomowanie, lepsza wydajność.
- **Edytor działek na MapLibre GL** — przepisany z Leaflet/Geoman na mapbox-gl-draw. Przeciąganie punktów podczas dodawania, wybór kategorii z listy, cofanie ostatniego punktu bez kasowania całego szkicu.
- **Zaznaczanie działek** — klikasz właściciela → jego działki podświetlają się fuksjowym kolorem. Rzeczywiste (pełny kolor) i wg protokołu (półprzezroczyste + grubszy obrys).
- **Plakietki `Lp.X`** — na każdej zaznaczonej działce pojawia się etykieta z numerem protokołu właściciela.
- **Tooltip na hover** — najeżdżasz na zaznaczoną działkę → widzisz nazwę właściciela + typ posiadania.
- **Wielu właścicieli** — ze statystyk możesz zobaczyć top 5/10 właścicieli równocześnie, każdy innym kolorem z palety.
- **Focus mode** — w trybie zaznaczenia reszta mapy jest delikatnie przyciemniona, wybrane działki wyciągnięte na plan.
- **Wersja 1.1** — okno „O aplikacji" pokazuje już 1.1, technologie wymienione jako MapLibre GL.
- **Poprawki** — usunięte błędy `line-dasharray` i `promoteId` które blokowały działanie poprzedniej wersji (v1.0).

## Dlaczego powstała?

Pierwszą wersją projektu była aplikacja serwerowa / webowa:
[Projekt-Czarna](https://github.com/snakex21/Projekt-Czarna) — obecnie FastAPI + SQLAlchemy (SQLite lub PostgreSQL), frontend MapLibre (vanilla JS), launcher Tkinter.

Ta aplikacja desktopowa powstała jako niezależna, lokalna wersja portable. Jej celem jest
umożliwienie wygodnego korzystania z mapy katastralnej i danych historycznych bez całego
środowiska serwerowego.

Nie jest to główna wersja projektu dyplomowego, lecz osobne praktyczne
rozwinięcie — przygotowane po to, aby aplikację można było łatwo przekazać,
uruchomić lokalnie, zarchiwizować i przenieść np. na pendrive.

Ta wersja **desktopowa** zastępuje cały stos serwerowy jednym plikiem EXE (~32 MB). Dzięki temu:
- nie potrzebujesz Pythona, PostgreSQL ani serwera,
- uruchamiasz aplikację jak każdy inny program Windows,
- dane są w jednym folderze — łatwe do kopiowania i backupowania,
- możesz przenosić całą aplikację na pendrive.

## Co potrafi aplikacja?

- **Interaktywna mapa katastralna** — przeglądanie działek, właścicieli, obrysów. Silnik MapLibre GL z podkładem satelitarnym, OSM i historycznym (mapa.jpg z 1882 roku). Przeźroczystość podkładu regulowana suwakiem.
- **Punkty historyczne (nowa warstwa)** — specjalne obiekty (dworzec, szkoła, kapliczka itp.) z opisem i galerią zdjęć. Markery, popupy, osobna warstwa renderowana na MapLibre GL.
- **Zaznaczanie i podświetlanie** — wybierz właściciela → jego działki flashują fuksjowym kolorem. Działki rzeczywiste (pełny kolor), wg protokołu (półprzezroczyste + grubszy obrys). Plakietki `Lp.X` na każdej działce.
- **Edytor właścicieli** — dodawanie i edycja protokołów katastralnych ze skanami JPG.
- **Edytor działek** — rysowanie i modyfikacja obiektów na mapie. Również na MapLibre GL, zastępując Leaflet we wszystkich widokach edycyjnych.
- **Edytor punktów historycznych** — pełny panel CRUD dla obiektów specjalnych + galeria (upload, podpisy, kolejność, kasowanie).
- **Genealogia** — drzewo genealogiczne mieszkańców, relacje rodzinne, małżeństwa.
- **Demografia** — dane ludnościowe (katolicy, żydzi, pozostali).
- **Statystyki i porównywarka protokołów** — linki "Pokaż na mapie" przenoszące do podświetlonych działek.
- **Miejscowości** — zarządzanie wieloma lokalizacjami, każda z własną bazą.
- **Pamięć stanu okna** — rozmiar, pozycja i zmaksymalizowanie zapamiętywane między uruchomieniami.
- **Backup i przywracanie** — pełny backup ZIP (JSON, SQLite, protokoły, zdjęcia).

## Szybki start — Portable

1. Pobierz `MapaKatastralnaCzarna_Portable.zip` z [zakładki Releases](../../releases).
2. Rozpakuj cały folder w dowolne miejsce.
3. Uruchom `Mapa Katastralna Czarna.exe`.

> Nie przenoś samego EXE bez folderu `data` — aplikacja potrzebuje go obok siebie.

Wymagania: Windows 10/11 z WebView2 Runtime (w Windows 11 jest wbudowany). Biblioteka MapLibre
i podkłady satelitarny/OSM są ładowane z internetu; dane działek, skany i mapa 1882 są lokalne.

## Gdzie są dane

| Co | Gdzie |
|----|-------|
| Baza, skany, mapa, rejestr miejscowości (tryb portable) | `data\` obok EXE — używany, jeśli istnieje `data\czarna.db` |
| To samo, gdy obok EXE nie ma `data\czarna.db` | `%APPDATA%\czarna-mapa\` |
| Kolejne miejscowości dodane lub przywrócone w aplikacji | `data\locations\<id>\` (własna baza `<id>.db`, skany, mapa) |
| Backupy ZIP | `data\backups\` |
| Log ostatniego uruchomienia | `data\app.log` (z czasami startu `[STARTUP]`) |
| Cache miniatur, stan okna | `data\obj_thumbs\`, `data\window_state.json` |
| Profil WebView2 (localStorage, cache przeglądarki) | `%APPDATA%\Mapa Katastralna Czarna.exe\EBWebView\` |

## Backup i przywracanie

- **Backup**: *Miejscowości → JSON / Backup → Utwórz pełny backup ZIP*. Plik trafia do
  `data\backups\backup_<id>_<data>.zip`. Zaznacz „Baza SQLite robocza / awaryjna”, jeśli backup
  ma być pełną kopią (JSON nie przenosi wszystkich szczegółów powiązań działka–właściciel).
- **Przywracanie**: *Import ZIP → Wybierz plik → Importuj backup ZIP*, potem uruchom program
  ponownie. Miejscowość jest odtwarzana do `data\locations\<id>\`. Jeśli ZIP zawiera bazę,
  to ona jest źródłem prawdy, a JSON z paczki jest pomijany.
- Import przyjmuje tylko ZIP-y w formacie tej aplikacji. Archiwum z podejrzanymi ścieżkami,
  symlinkami lub przekraczające limity (20 000 wpisów, 1 GiB na plik, 4 GiB łącznie,
  ok. 575 MB samego ZIP-a wysyłanego z okna aplikacji) jest odrzucane w całości, bez zapisu.
- Ręczny backup: zamknij aplikację i skopiuj cały folder `data\` (razem z `czarna.db-wal`,
  jeśli istnieje).

## Bezpieczeństwo

- Serwer HTTP aplikacji słucha wyłącznie na `127.0.0.1` (port 57200, a gdy zajęty — losowy).
- Każde żądanie musi mieć `Host: 127.0.0.1:<port>`; nagłówek `Origin` (jeśli jest) musi być
  `http://127.0.0.1:<port>`, a `Sec-Fetch-Site` — `same-origin` lub `none`.
- `/api/rpc` wymaga `POST`, `Content-Type: application/json` i nagłówka `X-Czarna-Token`
  z losowym tokenem (256 bitów) generowanym przy każdym starcie. Token jest wstrzykiwany do
  stron okna aplikacji przez WebView2 (`webview.Init`) i nie jest dostępny pod żadnym adresem HTTP.
- Body RPC jest ograniczone do 768 MiB; serwer ma timeouty nagłówków i połączeń bezczynnych.
- Znane ograniczenia: DevTools WebView2 są włączone także w buildzie release; dane i skany
  w `data\` nie są szyfrowane (każdy z dostępem do folderu może je czytać).

## Wymiana danych z wersją serwerową

Obie wersje (desktopowa i serwerowa) używają tego samego formatu JSON. Dzięki temu możesz:

- wyeksportować dane z jednej aplikacji do folderu `json/`,
- zaimportować je do drugiej przez panel `JSON / Backup`,
- przenosić dane między wersjami bez utraty informacji.

## Technologie

| Warstwa             | Technologia                         |
|---------------------|-------------------------------------|
| Backend / logika    | Go 1.26.11 (CGO)                    |
| Baza danych         | SQLite (`modernc.org/sqlite`)       |
| Silnik mapy         | MapLibre GL 4.7.1                   |
| Frontend            | HTML + CSS + JavaScript (vanilla)   |
| Okno aplikacji      | WebView2 (Microsoft Edge)           |
| Miniatury           | `github.com/disintegration/imaging` |
| Embedowanie         | `//go:embed all:frontend` (Go 1.16+) |

## Struktura folderu

```
czarna-mapa/
├── Mapa Katastralna Czarna.exe   # główny plik wykonywalny
├── data/
│   ├── czarna.db                 # baza SQLite (runtime)
│   ├── protokoly/                # skany protokołów JPG
│   ├── history_photos/           # zdjęcia historyczne
│   ├── mapa.jpg                  # obraz mapy tła
│   ├── locations.json            # rejestr miejscowości
│   └── *.json                    # dane w formacie JSON
├── resources/                    # ikony
├── tools/                        # narzędzia pomocnicze (Python)
└── scripts/                      # skrypty budowania
```

## Budowanie ze źródeł

Wymagania: **Go 1.26.11+** (go.mod wymusi właściwy toolchain), **gcc / MinGW-w64**
(np. z MSYS2 — `webview_go` wymaga CGO), opcjonalnie `rsrc` do ikony
(`go install github.com/akavel/rsrc@latest`; bez niego używany jest commitowany `rsrc.syso`).

```bat
:: exe + paczka portable w dist\ (ZIP + .sha256); dist\MapaKatastralnaCzarna_Portable nie może istnieć
scripts\build.bat
:: tylko exe
scripts\build.bat nopack
:: tryb deweloperski (okno + logi w konsoli)
scripts\run.bat
```

Ręcznie (to samo co `build.bat nopack`):

```bat
set CGO_ENABLED=1
go build -trimpath -ldflags="-s -w -H windowsgui" -o "Mapa Katastralna Czarna.exe" .
```

Paczka portable zawiera EXE i tylko dane startowe z `data\` (bez `app.log`, `window_state.json`,
`obj_thumbs`, `backups`, `json`, `point_photos`, `locations`, plików `-wal/-shm`). Paczkę release
najlepiej budować ze świeżego klona, żeby nie zabrać lokalnych zmian bazy. Ok. 97% paczki
(~1,84 GB) to skany protokołów JPG zapisane w bardzo wysokiej jakości.

## Testy

```bat
go vet ./...
go test ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
```

Testy działają na tymczasowych bazach (`t.TempDir()`) i nie dotykają `data\`. Obejmują:
bazę i migracje, stan okna, komendy RPC (właściciele, obiekty mapy, backupy działek),
round-trip eksport/import JSON i pełnego backupu ZIP, ochronę przed Zip Slip / zip bombą
(spreparowane ZIP-y) oraz zabezpieczenia `/api/rpc` (obcy Origin, zły Host, brak tokena,
„simple POST”, GET). CI: `.github/workflows/ci.yml` (windows-latest).

### Smoke test na prawdziwym oknie

Build z tagiem `smoke` wstrzykuje `scripts\smoke\smoke.js`, który przeklikuje aplikację
(strona startowa, mapa, backup ZIP, import tego ZIP-a, import złośliwego ZIP-a) i robi zrzuty
okna. Uruchamiaj go wyłącznie na **kopii** danych, np. w `.localrun\` (gitignorowane):

```bat
go build -tags smoke -o .localrun\smoke\smoke.exe .
:: skopiuj data\ do .localrun\smoke\data\
set CZARNA_SMOKE_SCRIPT=%CD%\scripts\smoke\smoke.js
set CZARNA_SMOKE_OUT=%CD%\.localrun\shots
set CZARNA_SMOKE_MALICIOUS=<ścieżka do spreparowanego ZIP-a>
cd .localrun\smoke && smoke.exe
```

Wynik: zrzuty PNG i `smoke_report.json` w katalogu `CZARNA_SMOKE_OUT`.

## Wersje

| Wersja | Data       | Zmiany                                                                     |
|--------|------------|----------------------------------------------------------------------------|
| v1.3   | w przygotowaniu | Poprawki bezpieczeństwa (Zip Slip, ochrona lokalnego API), aktualizacje zależności, testy + CI, mniejszy EXE |
| v1.2   | czerwiec 2026 | Punkty historyczne (warstwa + edytor + galeria), migracje bazy, pamięć stanu okna, cache miniatur |
| v1.1   | maj 2026   | MapLibre GL: mapa + edytor, przeciąganie punktów, wybór kategorii, poprawki cofania |
| v1.0   | marzec 2026| Pierwsze stabilne wydanie portable — Go + WebView2                          |

## Autor

**Maksymilian Augustyn** — autor i inicjator wersji portable desktop.

## Licencja

Kod źródłowy jest dostępny na licencji MIT.
