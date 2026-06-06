package main

import (
	"bytes"
	"czarna-mapa/internal/db"
	"czarna-mapa/internal/service"
	"czarna-mapa/internal/windowstate"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/webview/webview_go"
)

//go:embed all:frontend
var frontend embed.FS

func main() {
	// Znajdź katalog z plikiem wykonywalnym (dla protokołów i bazy dev)
	exePath, _ := os.Executable()
	exeDir := filepath.Dir(exePath)

	// Baza: AppData (release) lub lokalnie obok EXE (dev)
	appDataDir := getAppDataDir()
	dbPath := filepath.Join(appDataDir, "czarna.db")
	dataDir := appDataDir // protokoły w AppData

	// W trybie dev (baza istnieje obok EXE) używaj lokalnych ścieżek
	localDB := filepath.Join(exeDir, "data", "czarna.db")
	if _, err := os.Stat(localDB); err == nil {
		dbPath = localDB
		dataDir = filepath.Join(exeDir, "data")
	}

	// Log do pliku
	logFile, _ := os.Create(filepath.Join(dataDir, "app.log"))
	if logFile != nil {
		log.SetOutput(logFile)
		defer logFile.Close()
	}
	log.Printf("Baza danych: %s", dbPath)

	// Otwórz bazę
	database, err := db.Open(dbPath)
	if err != nil {
		log.Fatalf("Nie można otworzyć bazy: %v", err)
	}
	defer database.Close()

	var count int64
	database.QueryRow("SELECT COUNT(*) FROM obiekty_geograficzne").Scan(&count)
	if count == 0 {
		log.Println("UWAGA: Baza danych jest pusta.")
	}

	// Utwórz App (handler RPC)
	app := &App{
		db:          database,
		dataDir:     dataDir,
		rootDataDir: dataDir,
		dbPath:      dbPath,
	}
	if err := app.ensureLocationsRegistry(); err != nil {
		log.Printf("Nie można zainicjalizować miejscowości: %v", err)
	}
	if err := app.ensureGenealogyProtocolLinks(); err != nil {
		log.Printf("Nie można odtworzyć powiązań genealogia-protokół: %v", err)
	}
	if repaired, err := service.RepairOwnerParcelLinksFromJSON(database, dataDir); err != nil {
		log.Printf("Nie można uzupełnić powiązań działek ułamkowych: %v", err)
	} else if repaired > 0 {
		log.Printf("Uzupełniono brakujące powiązania działka-właściciel: %d", repaired)
	}

	// Serwuj frontend z embed
	frontendFS, err := fs.Sub(frontend, "frontend")
	if err != nil {
		log.Fatalf("Blad embed: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/rpc", app.handleRPC)
	mux.HandleFunc("/api/wlasciciel/", app.handleLegacyAPI)
	mux.HandleFunc("/api/genealogia/", app.handleLegacyAPI)
	mux.HandleFunc("/api/dzialki", app.handleLegacyAPI)
	mux.HandleFunc("/api/genealogia/persons-format", app.handleLegacyAPI)
	mux.HandleFunc("/api/genealogia/pdf/", app.handleFamilyCardPDF)
	mux.HandleFunc("/protokoly/", app.handleProtokoly)
	mux.HandleFunc("/history_photos/", app.handleHistoryPhotos)
	mux.HandleFunc("/point_photos/", app.handlePointPhotos)
	mux.HandleFunc("/obj_thumb", app.handleObjThumb)
	mux.HandleFunc("/location_favicon", app.handleLocationFavicon)
	mux.HandleFunc("/location_js/location-config.js", app.handleLocationConfigJS)
	mux.HandleFunc("/mapa/mapa.jpg", app.handleMapaJPG)
	fileServer := http.FileServer(http.FS(frontendFS))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			app.handleDynamicIndex(w, r, frontendFS)
			return
		}
		fileServer.ServeHTTP(w, r)
	})

	// Użyj stałego portu, żeby localStorage przetrwał restart aplikacji.
	// Port 57200 — mało prawdopodobne, żeby był zajęty przez inny program.
	const preferredPort = 57200
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", preferredPort))
	if err != nil {
		// Fallback: jeśli port zajęty, weź losowy
		listener, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			log.Fatalf("Nie można znaleźć wolnego portu: %v", err)
		}
	}
	port := listener.Addr().(*net.TCPAddr).Port

	// Start serwera HTTP w tle
	go func() {
		log.Printf("Serwer na http://127.0.0.1:%d", port)
		if err := http.Serve(listener, mux); err != nil {
			log.Printf("Serwer zatrzymany: %v", err)
		}
	}()

	// Okno WebView
	startPath := "/"
	if reg, err := app.loadRegistry(); err == nil && !reg.AutoOpen {
		startPath = "/miejscowosci.html"
	}
	url := fmt.Sprintf("http://127.0.0.1:%d%s", port, startPath)
	log.Printf("Otwieram okno: %s", url)

	// Wczytaj zapamiętany stan okna (rozmiar, pozycja, zmaksymalizowanie).
	winState := windowstate.Load(dataDir)
	log.Printf("Stan okna: %dx%d @(%d,%d) max=%v",
		winState.Width, winState.Height, winState.X, winState.Y, winState.Maximized)

	w := webview.New(true) // true = debug (konsola devtools dostępna)
	defer w.Destroy()
	w.SetTitle("Mapa Katastralna Gminy Czarna")
	setWindowIcon(w.Window())
	w.SetSize(winState.Width, winState.Height, webview.HintNone)
	// Ustaw pozycję i stan zmaksymalizowania (Win32, tylko Windows).
	hwnd := hwndFromWebview(w)
	applyWindowState(hwnd, winState)
	w.Navigate(url)

	// Polling stanu okna w tle - zapisuje do pliku gdy user zmieni rozmiar/pozycję.
	startWindowStateWatcher(hwnd, dataDir, winState)

	w.Run()

	// Przy zamknięciu: ostatni zapis aktualnego stanu.
	if final, err := readWindowState(hwnd); err == nil {
		_ = windowstate.Save(dataDir, final)
	}
}

// hwndFromWebview konwertuje unsafe.Pointer z webview_go na uintptr (HWND).
// Wrapper dodany dla bezpieczeństwa typów.
func hwndFromWebview(w webview.WebView) uintptr {
	return uintptr(w.Window())
}

// startWindowStateWatcher uruchamia goroutine, która co 2s sprawdza
// aktualny rozmiar/pozycję/zmaksymalizowanie okna i zapisuje do pliku
// gdy cokolwiek się zmieni. Pamięta ostatni "normalny" rect, żeby po
// odmaksymalizowaniu przywrócić właściwy rozmiar.
func startWindowStateWatcher(hwnd uintptr, dataDir string, initial windowstate.State) {
	if dataDir == "" {
		return
	}
	var (
		mu        sync.Mutex
		lastSaved windowstate.State = initial
		// lastNormal: ostatni rect odczytany GDY okno NIE było zmaksymalizowane.
		// To jest rozmiar do przywrócenia po WM_SYSCOMMAND/SC_RESTORE.
		lastNormal Rect
	)
	if !initial.Maximized && initial.Width > 0 && initial.Height > 0 {
		lastNormal = Rect{
			Left:   int32(initial.X),
			Top:    int32(initial.Y),
			Right:  int32(initial.X + initial.Width),
			Bottom: int32(initial.Y + initial.Height),
		}
	}

	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			cur, err := readWindowState(hwnd)
			if err != nil {
				continue
			}
			mu.Lock()
			if !cur.Maximized {
				lastNormal = Rect{
					Left:   int32(cur.X),
					Top:    int32(cur.Y),
					Right:  int32(cur.X + cur.Width),
					Bottom: int32(cur.Y + cur.Height),
				}
			} else if lastNormal.Width() > 0 && lastNormal.Height() > 0 {
				// Przy zapisie zmaksymalizowanego okna zachowaj ostatni normalny rect.
				cur.X = lastNormal.X()
				cur.Y = lastNormal.Y()
				cur.Width = lastNormal.Width()
				cur.Height = lastNormal.Height()
			}
			changed := cur != lastSaved
			if changed {
				_ = windowstate.Save(dataDir, cur)
				lastSaved = cur
			}
			mu.Unlock()
		}
	}()
}

// readWindowState odczytuje aktualny rect i stan zmaksymalizowania z Win32.
func readWindowState(hwnd uintptr) (windowstate.State, error) {
	r, err := GetWindowRect(hwnd)
	if err != nil {
		return windowstate.State{}, err
	}
	return windowstate.State{
		X:         r.X(),
		Y:         r.Y(),
		Width:     r.Width(),
		Height:    r.Height(),
		Maximized: IsZoomed(hwnd),
	}, nil
}

// applyWindowState ustawia pozycję/rozmiar/zmaksymalizowanie okna.
// Placeholder na platformy inne niż Windows (pusty w *_other.go).
func applyWindowState(hwnd uintptr, s windowstate.State) {
	applyWindowStateOS(hwnd, s)
}

func (a *App) handleDynamicIndex(w http.ResponseWriter, r *http.Request, frontendFS fs.FS) {
	template := "praca_inzynierska"
	if loc, err := a.activeLocation(); err == nil && loc != nil && loc.HomepageTemplate != "" {
		template = loc.HomepageTemplate
	}

	file := "index.html"
	if template == "standardowy" {
		file = "strona_glowna/szablony/standardowy/index.html"
	}

	b, err := fs.ReadFile(frontendFS, file)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	http.ServeContent(w, r, "index.html", time.Now(), bytes.NewReader(b))
}

func getAppDataDir() string {
	appData, err := os.UserConfigDir()
	if err != nil {
		return "."
	}
	dir := filepath.Join(appData, "czarna-mapa")
	os.MkdirAll(dir, 0755)
	return dir
}
