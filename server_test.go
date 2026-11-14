package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testPort = 57299
const testToken = "test-token-0123456789abcdef"

type rpcReq struct {
	method      string
	host        string
	origin      string
	secFetch    string
	contentType string
	token       string
	body        string
}

func defaultRPCReq() rpcReq {
	return rpcReq{
		method:      http.MethodPost,
		host:        fmt.Sprintf("127.0.0.1:%d", testPort),
		origin:      fmt.Sprintf("http://127.0.0.1:%d", testPort),
		secFetch:    "same-origin",
		contentType: "application/json",
		token:       testToken,
		body:        `{"cmd":"pobierz_wszystkich_wlascicieli","args":{}}`,
	}
}

func doGuarded(t *testing.T, h http.Handler, path string, r rpcReq) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(r.method, path, strings.NewReader(r.body))
	req.Host = r.host
	if r.origin != "" {
		req.Header.Set("Origin", r.origin)
	}
	if r.secFetch != "" {
		req.Header.Set("Sec-Fetch-Site", r.secFetch)
	}
	if r.contentType != "" {
		req.Header.Set("Content-Type", r.contentType)
	}
	if r.token != "" {
		req.Header.Set(rpcTokenHeader, r.token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func guardedHandler(t *testing.T) (http.Handler, *App) {
	app := newTestApp(t)
	guard := newRequestGuard(testPort, testToken)
	return guard.wrap(buildMux(app, testFrontendFS(t), guard)), app
}

func TestRPCGuard(t *testing.T) {
	h, _ := guardedHandler(t)
	cases := []struct {
		name   string
		mutate func(*rpcReq)
		want   int
	}{
		{"valid", func(r *rpcReq) {}, http.StatusOK},
		{"valid-no-origin-headers", func(r *rpcReq) { r.origin = ""; r.secFetch = "" }, http.StatusOK},
		{"json-with-charset", func(r *rpcReq) { r.contentType = "application/json; charset=utf-8" }, http.StatusOK},
		{"cross-origin", func(r *rpcReq) { r.origin = "https://evil.example" }, http.StatusForbidden},
		{"other-local-port", func(r *rpcReq) { r.origin = "http://127.0.0.1:8080" }, http.StatusForbidden},
		{"localhost-origin", func(r *rpcReq) { r.origin = fmt.Sprintf("http://localhost:%d", testPort) }, http.StatusForbidden},
		{"null-origin", func(r *rpcReq) { r.origin = "null" }, http.StatusForbidden},
		{"cross-site-fetch", func(r *rpcReq) { r.origin = ""; r.secFetch = "cross-site" }, http.StatusForbidden},
		{"same-site-fetch", func(r *rpcReq) { r.origin = ""; r.secFetch = "same-site" }, http.StatusForbidden},
		{"wrong-host-rebinding", func(r *rpcReq) { r.host = fmt.Sprintf("evil.example:%d", testPort) }, http.StatusForbidden},
		{"wrong-host-localhost", func(r *rpcReq) { r.host = fmt.Sprintf("localhost:%d", testPort) }, http.StatusForbidden},
		{"wrong-host-port", func(r *rpcReq) { r.host = "127.0.0.1:1" }, http.StatusForbidden},
		{"missing-token", func(r *rpcReq) { r.token = "" }, http.StatusForbidden},
		{"wrong-token", func(r *rpcReq) { r.token = "x" + testToken[1:] }, http.StatusForbidden},
		{"text-plain-simple-post", func(r *rpcReq) { r.contentType = "text/plain" }, http.StatusUnsupportedMediaType},
		{"form-simple-post", func(r *rpcReq) { r.contentType = "application/x-www-form-urlencoded" }, http.StatusUnsupportedMediaType},
		{"get-rejected", func(r *rpcReq) { r.method = http.MethodGet; r.body = "" }, http.StatusMethodNotAllowed},
		{"put-rejected", func(r *rpcReq) { r.method = http.MethodPut }, http.StatusMethodNotAllowed},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := defaultRPCReq()
			c.mutate(&r)
			rec := doGuarded(t, h, "/api/rpc", r)
			if rec.Code != c.want {
				t.Fatalf("status %d, oczekiwano %d (%s)", rec.Code, c.want, strings.TrimSpace(rec.Body.String()))
			}
		})
	}
}

// Mutująca komenda wysłana z obcej strony nie może niczego zmienić.
func TestCrossOriginMutationHasNoEffect(t *testing.T) {
	h, app := guardedHandler(t)
	mustDispatch(t, app, "edytor_dzialek_dodaj_obiekt", map[string]interface{}{"nazwa": "1", "kategoria": "dzialka", "geometria": testPolygon})

	r := defaultRPCReq()
	r.origin = "https://evil.example"
	r.secFetch = "cross-site"
	r.token = ""
	r.contentType = "text/plain"
	r.body = `{"cmd":"edytor_dzialek_usun_wszystkie","args":{}}`
	if rec := doGuarded(t, h, "/api/rpc", r); rec.Code == http.StatusOK {
		t.Fatal("cross-origin RPC przyjęte")
	}
	var n int
	if err := app.db.QueryRow("SELECT COUNT(*) FROM obiekty_geograficzne").Scan(&n); err != nil || n != 1 {
		t.Fatalf("dane zmienione przez cross-origin RPC: n=%d err=%v", n, err)
	}
}

func TestGuardAppliesToStaticAndLegacyRoutes(t *testing.T) {
	h, _ := guardedHandler(t)
	for _, path := range []string{"/", "/api/dzialki", "/location_js/location-config.js"} {
		r := defaultRPCReq()
		r.method = http.MethodGet
		r.body = ""
		r.token = ""
		r.origin = ""
		r.secFetch = "none"
		if rec := doGuarded(t, h, path, r); rec.Code != http.StatusOK {
			t.Errorf("%s: zwykłe GET z aplikacji powinno przejść, jest %d", path, rec.Code)
		}
		r.host = "evil.example"
		if rec := doGuarded(t, h, path, r); rec.Code != http.StatusForbidden {
			t.Errorf("%s: zły Host powinien dać 403, jest %d", path, rec.Code)
		}
		r.host = fmt.Sprintf("127.0.0.1:%d", testPort)
		r.secFetch = "cross-site" // np. <script src> z obcej strony
		if rec := doGuarded(t, h, path, r); rec.Code != http.StatusForbidden {
			t.Errorf("%s: cross-site powinno dać 403, jest %d", path, rec.Code)
		}
	}
}

func TestRPCBodyLimit(t *testing.T) {
	h, _ := guardedHandler(t)
	old := maxRPCBodyBytes
	maxRPCBodyBytes = 1024
	defer func() { maxRPCBodyBytes = old }()
	r := defaultRPCReq()
	r.body = `{"cmd":"miejscowosci_import_backup","args":{"data_b64":"` + strings.Repeat("A", 4096) + `"}}`
	if rec := doGuarded(t, h, "/api/rpc", r); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status %d, oczekiwano 413", rec.Code)
	}
}

func TestInitScriptScopesTokenToOrigin(t *testing.T) {
	g := newRequestGuard(testPort, testToken)
	s := g.initScript()
	if !strings.Contains(s, `window.location.origin==="http://127.0.0.1:57299"`) || !strings.Contains(s, testToken) {
		t.Fatalf("nieoczekiwany skrypt: %s", s)
	}
}

func TestNewSessionTokenIsRandom(t *testing.T) {
	a, err := newSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	b, _ := newSessionToken()
	if len(a) != 64 || a == b {
		t.Fatalf("token nie jest losowy: %q %q", a, b)
	}
}

// Test end-to-end na prawdziwym gnieździe 127.0.0.1.
func TestGuardedServerOverLoopback(t *testing.T) {
	app := newTestApp(t)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	guard := newRequestGuard(port, testToken)
	srv := newHTTPServer(guard.wrap(buildMux(app, testFrontendFS(t), guard)))
	go srv.Serve(ln)
	defer srv.Close()
	base := fmt.Sprintf("http://127.0.0.1:%d", port)

	call := func(token, origin string) (int, string) {
		req, _ := http.NewRequest(http.MethodPost, base+"/api/rpc", strings.NewReader(`{"cmd":"miejscowosci_lista","args":{}}`))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set(rpcTokenHeader, token)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	if code, body := call(testToken, base); code != http.StatusOK {
		t.Fatalf("poprawne RPC: %d %s", code, body)
	} else {
		var v map[string]interface{}
		if err := json.Unmarshal([]byte(body), &v); err != nil || v["locations"] == nil {
			t.Fatalf("zła odpowiedź: %s", body)
		}
	}
	if code, _ := call("", base); code != http.StatusForbidden {
		t.Errorf("brak tokena: %d", code)
	}
	if code, _ := call(testToken, "https://evil.example"); code != http.StatusForbidden {
		t.Errorf("obcy Origin: %d", code)
	}
}
