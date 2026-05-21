package main

import (
	"bytes"
	"czarna-mapa/internal/db"
	"czarna-mapa/internal/service"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
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

	w := webview.New(true) // true = debug (konsola devtools dostępna)
	defer w.Destroy()
	w.SetTitle("Mapa Katastralna Gminy Czarna")
	setWindowIcon(w.Window())
	w.SetSize(1400, 900, webview.HintNone)
	w.Navigate(url)
	w.Run()
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
