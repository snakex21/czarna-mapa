# PROJECT_SKILL — Mapa Katastralna Czarna (Go + WebView2)

## Technologia
- **Go 1.26** (`go.mod`), okno: `github.com/webview/webview_go` (WebView2 na Windows).
  To **nie jest Wails** — aplikacja ma własny lokalny serwer HTTP i ręczny JSON-RPC.
- `webview_go` wymaga **CGO** (gcc / MinGW-w64). Baza: `modernc.org/sqlite` (czyste Go).
- Miniatury JPG/PNG/WebP: `github.com/disintegration/imaging` + `golang.org/x/image`.
- Frontend: statyczny HTML/CSS/JS osadzony w EXE (`//go:embed all:frontend`), bez build stepu.
  MapLibre GL i mapbox-gl-draw są w `frontend/assets/vendor/` (działa offline).

## Architektura

```
czarna-mapa/
├── main.go            # start: katalog danych, baza, serwer HTTP, okno WebView
├── server.go          # requestGuard: Host/Origin/Content-Type + token X-Czarna-Token
├── rpc.go             # App.dispatch — wszystkie komendy RPC, backup/import miejscowości
├── zipsafe.go         # bezpieczne rozpakowywanie ZIP (os.Root, limity, Zip Slip)
├── devtools.go        # DevTools tylko z --debug / CZARNA_DEBUG=1
├── window_*.go        # stan i pozycja okna (Win32)
├── smoke_windows.go   # harness smoke testu (tylko -tags smoke)
├── internal/
│   ├── db/            # Open, schemat, migracje (ensureTable/ensureColumn)
│   ├── models/        # structy z tagami json
│   ├── service/       # logika: mapa, właściciele, genealogia, protokoły,
│   │                  # statystyki, punkty historyczne, miniatury, jsonsync (eksport/import JSON)
│   ├── geo/           # GeoJSON, bbox
│   └── windowstate/   # data/window_state.json
├── frontend/          # HTML/CSS/JS (assets/js/api.js = klient RPC)
├── data/              # dane startowe: czarna.db, protokoly/, mapa.jpg, JSON-y
├── resources/         # app.ico (rsrc.syso jest wygenerowany z niego i trzymany w repo)
└── scripts/           # build.bat, run.bat, smoke/smoke.js
```

## Zasady

1. **Nowa komenda = nowy `case` w `App.dispatch` (rpc.go)**, logika w `internal/service`.
2. **Lokalny serwer jest chroniony** (`server.go`): każde `/api/rpc` musi mieć poprawny
   `Host`, `Origin`, `Content-Type: application/json` i token sesji, który WebView
   wstrzykuje do strony (`window.__CZARNA_RPC_TOKEN`). Nie omijać tego w nowych endpointach.
3. **ZIP-y rozpakowujemy wyłącznie przez `zipsafe.go`.**
4. **Ścieżki tylko względem katalogu danych aplikacji** (`dataDir` / `rootDataDir`),
   nigdy ścieżki z komputera dewelopera (Pulpit itp.).
5. **Eksport JSON musi być bezstratny** — `jsonsync.go` zapisuje pola zgodne ze starym
   formatem oraz pełne (`plotLinks`, `protocolRelations`, `geojson`, daty ślubów).
   Każda nowa kolumna/relacja wymaga rozszerzenia testu `jsonsync_roundtrip_test.go`.
6. **Dane runtime nie trafiają do repo ani paczki** (`app.log`, `window_state.json`,
   `obj_thumbs/`, `backups/`, `json/`, `point_photos/`) — patrz `.gitignore` i `build.bat`.

## Wzorce

### Komenda RPC (Go)
```go
// rpc.go
func (a *App) dispatch(cmd string, args map[string]interface{}) (interface{}, error) {
    switch cmd {
    case "pobierz_obiekty_widok":
        // ...
    }
}
```

### Wywołanie z frontendu
```js
// assets/js/api.js dodaje nagłówek X-Czarna-Token
const obiekty = await API._invoke('pobierz_obiekty_widok', {sw_lat: 50.04, sw_lng: 21.22, ne_lat: 50.08, ne_lng: 21.26});
```

### Miniatura z cache
```js
const thumb = `/obj_thumb?path=${encodeURIComponent(srcRelPath)}&w=240`;
// srcRelPath: protokoly/<Klucz>/<plik>.jpg | history_photos/<plik> | point_photos/<plik>
```

## Testy
```bash
go vet ./... && go vet -tags smoke ./...
go test -count=1 ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
gofmt -l .        # musi być puste
```

## Build
```bat
scripts\build.bat          :: exe + paczka portable w dist\ (+ .sha256)
scripts\build.bat nopack   :: tylko exe
```
Wersja deweloperska z DevTools: uruchom z `--debug` albo `set CZARNA_DEBUG=1`.
