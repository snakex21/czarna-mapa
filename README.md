# Mapa Katastralna Czarna — wersja portable desktop v1.2

> Aplikacja desktopowa do przeglądania historycznej mapy katastralnej gminy Czarna z 1882 roku.
> Działa jako samodzielny program Windows — bez instalacji, bez serwera, zero konfiguracji.

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
[Projekt-Czarna (Flask + Python)](https://github.com/snakex21/Projekt-Czarna) — backend Python, frontend HTML/CSS/JS z Leaflet, baza PostgreSQL + PostGIS.

Ta aplikacja desktopowa powstała jako niezależna, lokalna wersja portable. Jej celem jest
umożliwienie wygodnego korzystania z mapy katastralnej i danych historycznych bez całego
środowiska serwerowego.

Nie jest to główna wersja projektu dyplomowego, lecz osobne praktyczne
rozwinięcie — przygotowane po to, aby aplikację można było łatwo przekazać,
uruchomić lokalnie, zarchiwizować i przenieść np. na pendrive.

Ta wersja **desktopowa** zastępuje cały stos serwerowy jednym plikiem EXE (~80 MB). Dzięki temu:
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

## Wymiana danych z wersją serwerową

Obie wersje (desktopowa i serwerowa) używają tego samego formatu JSON. Dzięki temu możesz:

- wyeksportować dane z jednej aplikacji do folderu `json/`,
- zaimportować je do drugiej przez panel `JSON / Backup`,
- przenosić dane między wersjami bez utraty informacji.

## Technologie

| Warstwa             | Technologia                         |
|---------------------|-------------------------------------|
| Backend / logika    | Go 1.22                             |
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

```bash
# Wymagania: Go 1.22+, rsrc (do ikony Windows)
go install github.com/akavel/rsrc@latest

# Generowanie zasobu ikony
rsrc -arch amd64 -ico resources/app.ico -o rsrc.syso

# Budowa
go build -ldflags="-H windowsgui" -o "Mapa Katastralna Czarna.exe" .

# Testy
go test ./internal/...
```

## Wersje

| Wersja | Data       | Zmiany                                                                     |
|--------|------------|----------------------------------------------------------------------------|
| v1.2   | czerwiec 2026 | Punkty historyczne (warstwa + edytor + galeria), migracje bazy, pamięć stanu okna, cache miniatur |
| v1.1   | maj 2026   | MapLibre GL: mapa + edytor, przeciąganie punktów, wybór kategorii, poprawki cofania |
| v1.0   | marzec 2026| Pierwsze stabilne wydanie portable — Go + WebView2                          |

## Autor

**Maksymilian Augustyn** — autor i inicjator wersji portable desktop.

## Licencja

Kod źródłowy jest dostępny na licencji MIT.
