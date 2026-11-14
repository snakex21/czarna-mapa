package main

import (
	"czarna-mapa/internal/db"
	"io/fs"
	"path/filepath"
	"testing"
)

// newTestApp tworzy aplikację na pustej bazie w katalogu tymczasowym.
// Nie dotyka danych użytkownika.
func newTestApp(t *testing.T) *App {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "czarna.db")
	database, err := db.Open(dbPath)
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	app := &App{db: database, dataDir: dir, rootDataDir: dir, dbPath: dbPath}
	if err := app.ensureLocationsRegistry(); err != nil {
		t.Fatalf("ensureLocationsRegistry: %v", err)
	}
	return app
}

func testFrontendFS(t *testing.T) fs.FS {
	t.Helper()
	sub, err := fs.Sub(frontend, "frontend")
	if err != nil {
		t.Fatal(err)
	}
	return sub
}

func mustDispatch(t *testing.T, app *App, cmd string, args map[string]interface{}) interface{} {
	t.Helper()
	res, err := app.dispatch(cmd, args)
	if err != nil {
		t.Fatalf("dispatch(%s): %v", cmd, err)
	}
	return res
}

var testPolygon = map[string]interface{}{
	"type": "Polygon",
	"coordinates": []interface{}{[]interface{}{
		[]interface{}{21.0, 50.0}, []interface{}{21.001, 50.0},
		[]interface{}{21.001, 50.001}, []interface{}{21.0, 50.0},
	}},
}
