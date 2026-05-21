# Mapa Katastralna Czarna — wersja portable desktop

> Aplikacja desktopowa do przeglądania historycznej mapy katastralnej gminy Czarna z 1882 roku.
> Działa jako samodzielny program Windows — bez instalacji, bez serwera, zero konfiguracji.

## Dlaczego powstała?

Pierwszą wersją projektu była aplikacja serwerowa / webowa:
[Projekt-Czarna (Flask + Python)](https://github.com/snakex21/Projekt-Czarna) — backend Python, frontend HTML/CSS/JS, baza PostgreSQL + PostGIS.

Ta aplikacja desktopowa powstała z mojej własnej inicjatywy jako niezależna,
lokalna wersja portable. Jej celem jest umożliwienie wygodnego korzystania
z mapy katastralnej i danych historycznych bez uruchamiania całego środowiska
serwerowego.

Nie jest to główna wersja projektu dyplomowego, lecz osobne praktyczne
rozwinięcie — przygotowane po to, aby aplikację można było łatwo przekazać,
uruchomić lokalnie, zarchiwizować i przenieść np. na pendrive.

Ta wersja **desktopowa** zastępuje cały stos serwerowy jednym plikiem EXE (~80 MB). Dzięki temu:
- nie potrzebujesz Pythona, PostgreSQL ani serwera,
- uruchamiasz aplikację jak każdy inny program Windows,
- dane są w jednym folderze — łatwe do kopiowania i backupowania,
- możesz przenosić całą aplikację na pendrive.

## Relacja do projektu webowego

Wersja portable korzysta z tej samej idei i tego samego zakresu danych co
projekt webowy, ale została przebudowana pod tryb lokalny. Zamiast serwera,
bazy PostgreSQL i konfiguracji środowiska użytkownik otrzymuje gotową aplikację
Windows z lokalną bazą SQLite oraz folderem danych.

Dzięki temu projekt może działać offline i być używany jako samodzielne
narzędzie do przeglądania mapy, protokołów, genealogii oraz danych historycznych.

## Co potrafi aplikacja?

- Interaktywna mapa katastralna — przeglądanie działek, właścicieli, obrysów.
- Edytor właścicieli — dodawanie i edycja protokołów katastralnych ze skanami JPG.
- Edytor działek — rysowanie i modyfikacja obiektów na mapie.
- Genealogia — drzewo genealogiczne mieszkańców, relacje rodzinne, małżeństwa.
- Demografia — dane ludnościowe (katolicy, żydzi, pozostali).
- Statystyki i porównywarka protokołów.
- Miejscowości — zarządzanie wieloma lokalizacjami, każda z własną bazą.
- Backup i przywracanie — pełny backup ZIP (JSON, SQLite, protokoły, zdjęcia).

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

| Warstwa          | Technologia               |
|------------------|---------------------------|
| Backend / logika | Go 1.22                   |
| Baza danych      | SQLite (`modernc.org/sqlite`) |
| Frontend         | HTML + CSS + JS (Leaflet) |
| Okno aplikacji   | WebView2 (Edge)           |
| GeoJSON          | `github.com/paulmach/orb` |

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

## Autor

**Maksymilian Augustyn** — autor i inicjator wersji portable desktop.

## Licencja

Kod źródłowy jest dostępny na licencji MIT.
