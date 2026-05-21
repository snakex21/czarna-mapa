# PROJECT_SKILL — Mapa Katastralna Czarna (Go + Wails)

## Język
**Go 1.22+** z frameworkiem **Wails v2** (desktop app z webview).
Zero CGO — `modernc.org/sqlite` zamiast `mattn/go-sqlite3`.

## Architektura

```
czarna-mapa/
├── main.go                      # Wails entry point, konfiguracja okna
├── app.go                       # App struct + wszystkie bindowane metody (~30 endpointów)
├── wails.json                   # Konfiguracja Wails (ścieżka frontendu, okno, ikona)
├── go.mod / go.sum
├── .gitignore
│
├── internal/                    # 🔒 Private — kompilator Go blokuje import z zewnątrz
│   ├── db/
│   │   ├── sqlite.go            # Otwieranie, migracje, App.db
│   │   └── schema.go            # CREATE TABLE statements
│   ├── models/
│   │   └── models.go            # Wszystkie structy z json tagami
│   ├── service/                 # Logika biznesowa
│   │   ├── map.go               # Obiekty, GeoJSON, bounding box
│   │   ├── owner.go             # Właściciele, działki, CRUD
│   │   ├── genealogy.go         # Drzewo genealogiczne, osoby
│   │   ├── protocol.go          # Skanowane protokoły (JPG, base64)
│   │   ├── demography.go        # Demografia
│   │   └── config.go            # Konfiguracja mapy/systemu
│   └── geo/
│       └── geojson.go           # Parsowanie GeoJSON, bbox, contains, area
│
├── frontend/                    # Statyczny HTML/CSS/JS (serwowany przez Wails)
│   ├── index.html
│   ├── assets/
│   ├── mapa/
│   ├── wlasciciele/
│   ├── genealogia/
│   ├── admin/
│   ├── graf/
│   ├── strona_glowna/
│   ├── docs/
│   ├── static/
│   └── location_js/
│
├── data/                        # Wszystkie dane aplikacji razem
│   ├── czarna.db                # SQLite (kopiowana z resources)
│   └── protokoly/               # Skanowane dokumenty (JPG)
│
├── tools/                       # Skrypty Python (migracje, fixy)
└── scripts/                     # Skrypty build/run
    ├── build.bat
    └── run.bat
```

## Zasady

1. **Zero `target/`** — Go nie tworzy folderu build-artefaktów per projekt.
   Cache współdzielony globalnie w `GOPATH/pkg/mod`, liczony w MB.
   Po buildzie masz 1 plik EXE (~25 MB) + nic więcej.

2. **`internal/` jest kluczowe** — Go na poziomie kompilatora blokuje import
   z pakietów `internal/` przez kod spoza tego modułu. Twoja logika jest
   hermetyczna.

3. **Jeden `models.go`** — idiom Go: wszystkie structy w jednym pliku.
   Tagi `json:"nazwa_pola"` definiują serializację do frontendu.

4. **Wails binduje metody `app.go`** — każda publiczna metoda na `App` staje się
   automatycznie dostępna z JS jako `window.go.main.App.NazwaMetody(...)`.
   Odpowiednik `#[tauri::command]`.

5. **Zero node_modules** — frontend to czysty HTML/CSS/JS. Wails serwuje go
   bezpośrednio bez build stepu.

6. **`data/` trzyma wszystko co jest danymi** — SQLite + skany protokołów.
   Nie mieszamy danych z kodem frontendu.

## Wzorce

### Metoda bindowana (odpowiednik Tauri command)
```go
// app.go
func (a *App) PobierzObiektyWidok(swLat, swLng, neLat, neLng float64) []models.Obiekt {
    return service.PobierzObiekty(a.db, swLat, swLng, neLat, neLng)
}
```

### Frontend wywołanie
```js
// JS — Wails automatycznie generuje binding
const obiekty = await window.go.main.App.PobierzObiektyWidok(50.04, 21.22, 50.08, 21.26);
```

### Dostęp do bazy
```go
// internal/db/sqlite.go
func Open(path string) (*sql.DB, error) {
    db, err := sql.Open("sqlite", path)
    // wykonaj migracje
    return db, nil
}
```

### GeoJSON w Go
```go
// internal/geo/geojson.go — używa github.com/paulmach/orb
import "github.com/paulmach/orb/geojson"
```

## Testy
```bash
go test ./internal/...
```

## Build
```bash
wails build          # produkcyjny .exe
wails dev            # hot-reload
```
