package main

// Lokalny serwer HTTP dla okna WebView i jego zabezpieczenia.
//
// Serwer słucha wyłącznie na 127.0.0.1, ale to nie wystarcza: każda strona
// otwarta w zwykłej przeglądarce może wysłać żądanie do 127.0.0.1:<port>
// (CSRF), a atak DNS rebinding pozwala nawet czytać odpowiedzi. Dlatego:
//
//   - Host musi być dokładnie "127.0.0.1:<port>" (blokuje DNS rebinding),
//   - nagłówek Origin, jeśli jest, musi być dokładnie "http://127.0.0.1:<port>",
//   - Sec-Fetch-Site, jeśli jest, musi być "same-origin" albo "none",
//   - /api/rpc wymaga POST, Content-Type: application/json oraz losowego
//     tokena sesji w nagłówku X-Czarna-Token. Token jest generowany przy
//     każdym starcie i wstrzykiwany do strony przez webview.Init(), więc nie
//     da się go odczytać z zewnątrz (nie ma go w żadnym zasobie HTTP).

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"time"
)

const rpcTokenHeader = "X-Czarna-Token"

// maxRPCBodyBytes ogranicza body /api/rpc (upload base64 zdjęć, map
// i backupów ZIP). Base64 to +33%, więc ZIP do ~575 MB. Zmienna (nie stała)
// tylko po to, żeby testy mogły ją obniżyć.
var maxRPCBodyBytes int64 = 768 << 20

// newSessionToken generuje losowy token sesji (256 bitów).
func newSessionToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// requestGuard egzekwuje Host/Origin/Sec-Fetch-Site dla wszystkich żądań
// oraz token sesji dla /api/rpc.
type requestGuard struct {
	host   string // np. "127.0.0.1:57200"
	origin string // np. "http://127.0.0.1:57200"
	token  string
}

func newRequestGuard(port int, token string) *requestGuard {
	host := fmt.Sprintf("127.0.0.1:%d", port)
	return &requestGuard{host: host, origin: "http://" + host, token: token}
}

// initScript zwraca JS wstrzykiwany do każdej strony w WebView. Token jest
// udostępniany tylko, gdy dokument pochodzi z naszego originu.
func (g *requestGuard) initScript() string {
	origin, _ := json.Marshal(g.origin)
	token, _ := json.Marshal(g.token)
	return fmt.Sprintf(`(function(){try{if(window.location.origin===%s){Object.defineProperty(window,"__CZARNA_RPC_TOKEN",{value:%s,writable:false,configurable:false,enumerable:false});}}catch(e){}})();`, origin, token)
}

func forbidden(w http.ResponseWriter, reason string, r *http.Request) {
	log.Printf("[SECURITY] odrzucono %s %s: %s (Host=%q Origin=%q)", r.Method, r.URL.Path, reason, r.Host, r.Header.Get("Origin"))
	http.Error(w, "Forbidden: "+reason, http.StatusForbidden)
}

// wrap zabezpiecza cały mux.
func (g *requestGuard) wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != g.host {
			forbidden(w, "nieprawidłowy Host", r)
			return
		}
		if o := r.Header.Get("Origin"); o != "" && o != g.origin {
			forbidden(w, "obcy Origin", r)
			return
		}
		if s := r.Header.Get("Sec-Fetch-Site"); s != "" && s != "same-origin" && s != "none" {
			forbidden(w, "żądanie cross-site", r)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Referrer-Policy", "same-origin")
		next.ServeHTTP(w, r)
	})
}

// requireRPC chroni endpoint RPC: tylko POST z JSON-em i poprawnym tokenem.
// Wszystkie komendy RPC (także odczytowe) idą przez POST; GET jest odrzucany.
func (g *requestGuard) requireRPC(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "Tylko POST", http.StatusMethodNotAllowed)
			return
		}
		mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mt != "application/json" {
			http.Error(w, "Wymagany Content-Type: application/json", http.StatusUnsupportedMediaType)
			return
		}
		got := r.Header.Get(rpcTokenHeader)
		if got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(g.token)) != 1 {
			forbidden(w, "brak lub zły token sesji", r)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxRPCBodyBytes)
		next(w, r)
	}
}

// buildMux rejestruje wszystkie trasy aplikacji. RPC jest owinięte w guard.requireRPC.
func buildMux(app *App, frontendFS fs.FS, guard *requestGuard) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/rpc", guard.requireRPC(app.handleRPC))
	// Endpointy legacy (GET) mapują się wyłącznie na komendy odczytowe.
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
	return mux
}

// newHTTPServer tworzy serwer z timeoutami (bez limitu ReadTimeout, bo upload
// dużego backupu może trwać; limit rozmiaru daje MaxBytesReader).
func newHTTPServer(h http.Handler) *http.Server {
	return &http.Server{
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    64 << 10,
	}
}
