package main

import (
	"archive/zip"
	"bytes"
	"czarna-mapa/internal/db"
	"czarna-mapa/internal/service"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func asMap(t *testing.T, v interface{}) map[string]interface{} {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]interface{}
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("nie obiekt JSON: %s", b)
	}
	return m
}

func asSlice(t *testing.T, v interface{}) []interface{} {
	t.Helper()
	b, _ := json.Marshal(fixNullSlice(v))
	var s []interface{}
	if err := json.Unmarshal(b, &s); err != nil {
		t.Fatalf("nie tablica JSON: %s", b)
	}
	return s
}

func TestDispatchUnknownCommand(t *testing.T) {
	app := newTestApp(t)
	if _, err := app.dispatch("nie_ma_takiej", nil); err == nil || !strings.Contains(err.Error(), "nieznana komenda") {
		t.Fatalf("oczekiwano błędu nieznanej komendy, jest %v", err)
	}
}

func TestDispatchOwnerCRUD(t *testing.T) {
	app := newTestApp(t)
	res := asMap(t, mustDispatch(t, app, "dodaj_wlasciciela", map[string]interface{}{
		"unikalny_klucz": "Jan_Kowalski_1", "nazwa_wlasciciela": "Jan Kowalski", "numer_domu": "12",
	}))
	id, _ := res["id"].(float64)
	if id <= 0 {
		t.Fatalf("brak id: %v", res)
	}
	found := asSlice(t, mustDispatch(t, app, "szukaj_wlascicieli", map[string]interface{}{"query": "Kowal"}))
	if len(found) != 1 {
		t.Fatalf("szukaj: %v", found)
	}
	mustDispatch(t, app, "aktualizuj_wlasciciela", map[string]interface{}{
		"id": id, "unikalny_klucz": "Jan_Kowalski_1", "nazwa_wlasciciela": "Jan Kowalski (syn)",
	})
	var name string
	if err := app.db.QueryRow("SELECT nazwa_wlasciciela FROM wlasciciele WHERE id=?", int64(id)).Scan(&name); err != nil || name != "Jan Kowalski (syn)" {
		t.Fatalf("aktualizacja: %q %v", name, err)
	}
	if _, err := app.dispatch("dodaj_wlasciciela", map[string]interface{}{"unikalny_klucz": "Jan_Kowalski_1", "nazwa_wlasciciela": "Dup"}); err == nil {
		t.Fatal("duplikat klucza przyjęty")
	}
	mustDispatch(t, app, "usun_wlasciciela", map[string]interface{}{"id": id})
	if all := asSlice(t, mustDispatch(t, app, "pobierz_wszystkich_wlascicieli", nil)); len(all) != 0 {
		t.Fatalf("po usunięciu zostało: %v", all)
	}
}

func TestDispatchMapObjects(t *testing.T) {
	app := newTestApp(t)
	args := map[string]interface{}{"nazwa": "101", "kategoria": "dzialka", "geometria": testPolygon}
	mustDispatch(t, app, "edytor_dzialek_dodaj_obiekt", args)
	if _, err := app.dispatch("edytor_dzialek_dodaj_obiekt", args); err == nil {
		t.Fatal("duplikat obiektu przyjęty")
	}
	fc := asMap(t, mustDispatch(t, app, "api_dzialki", nil))
	feats, _ := fc["features"].([]interface{})
	if fc["type"] != "FeatureCollection" || len(feats) != 1 {
		t.Fatalf("api_dzialki: %v", fc)
	}
	inView := asSlice(t, mustDispatch(t, app, "pobierz_obiekty_widok", map[string]interface{}{
		"sw_lat": 49.9, "sw_lng": 20.9, "ne_lat": 50.1, "ne_lng": 21.1,
	}))
	if len(inView) != 1 {
		t.Fatalf("pobierz_obiekty_widok: %v", inView)
	}
	outView := asSlice(t, mustDispatch(t, app, "pobierz_obiekty_widok", map[string]interface{}{
		"sw_lat": 10, "sw_lng": 10, "ne_lat": 11, "ne_lng": 11,
	}))
	if len(outView) != 0 {
		t.Fatalf("obiekt poza widokiem zwrócony: %v", outView)
	}
	mustDispatch(t, app, "edytor_dzialek_usun_wszystkie", nil)
	if fc := asMap(t, mustDispatch(t, app, "api_dzialki", nil)); len(fc["features"].([]interface{})) != 0 {
		t.Fatal("usun_wszystkie nie usunęło obiektów")
	}
}

func TestEditorBackupPathRejectsTraversal(t *testing.T) {
	app := newTestApp(t)
	for _, name := range []string{"../../etc/passwd", "..\\..\\x_backup.json", "notabackup.json", "x_backup.txt", ""} {
		p, err := app.safeEditorBackupPath(name)
		if err == nil && filepath.Dir(p) != filepath.Join(app.dataDir, "backups") {
			t.Errorf("%q -> %q wychodzi poza katalog backupów", name, p)
		}
	}
	// Kopia działek: utwórz, wypisz, przywróć, usuń.
	mustDispatch(t, app, "edytor_dzialek_dodaj_obiekt", map[string]interface{}{"nazwa": "7", "kategoria": "dzialka", "geometria": testPolygon})
	created := asMap(t, mustDispatch(t, app, "edytor_dzialek_utworz_backup", nil))
	fn, _ := created["filename"].(string)
	list := asMap(t, mustDispatch(t, app, "edytor_dzialek_backupy", nil))
	if files, _ := list["files"].([]interface{}); len(files) != 1 {
		t.Fatalf("lista backupów: %v", list)
	}
	mustDispatch(t, app, "edytor_dzialek_usun_wszystkie", nil)
	restored := asMap(t, mustDispatch(t, app, "edytor_dzialek_przywroc_backup", map[string]interface{}{"filename": fn}))
	if restored["parcels"].(float64) != 1 {
		t.Fatalf("przywrócenie: %v", restored)
	}
	mustDispatch(t, app, "edytor_dzialek_usun_backup", map[string]interface{}{"filename": fn})
}

func TestLegacyGETEndpoints(t *testing.T) {
	h, app := guardedHandler(t)
	mustDispatch(t, app, "edytor_dzialek_dodaj_obiekt", map[string]interface{}{"nazwa": "5", "kategoria": "dzialka", "geometria": testPolygon})
	r := defaultRPCReq()
	r.method = http.MethodGet
	r.body = ""
	rec := doGuarded(t, h, "/api/dzialki", r)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "FeatureCollection") {
		t.Fatalf("/api/dzialki: %d %s", rec.Code, rec.Body.String())
	}
	r.method = http.MethodPost
	if rec := doGuarded(t, h, "/api/dzialki", r); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST na legacy GET: %d", rec.Code)
	}
}

// seedSampleData wypełnia bazę małym, syntetycznym zestawem danych.
func seedSampleData(t *testing.T, app *App) {
	t.Helper()
	mustDispatch(t, app, "edytor_dzialek_dodaj_obiekt", map[string]interface{}{"nazwa": "12", "kategoria": "dzialka", "geometria": testPolygon})
	mustDispatch(t, app, "edytor_dzialek_dodaj_obiekt", map[string]interface{}{"nazwa": "13/1", "kategoria": "budynek", "geometria": testPolygon})
	mustDispatch(t, app, "dodaj_wlasciciela", map[string]interface{}{"unikalny_klucz": "Anna_Nowak_3", "nazwa_wlasciciela": "Anna Nowak", "numer_domu": "3"})
	mustDispatch(t, app, "dodaj_wlasciciela", map[string]interface{}{"unikalny_klucz": "Piotr_Zajac_4", "nazwa_wlasciciela": "Piotr Zając", "numer_domu": "4"})
}

func countRows(t *testing.T, app *App, table string) int {
	t.Helper()
	var n int
	if err := app.db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// Eksport JSON -> import do pustej bazy -> ponowny eksport daje to samo.
func TestJSONExportImportRoundTrip(t *testing.T) {
	src := newTestApp(t)
	seedSampleData(t, src)
	outDir := t.TempDir()
	res, err := service.ExportCompatibleJSON(src.db, outDir, service.LocationJSONMeta{ID: "czarna", Name: "Czarna"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Parcels != 2 || res.Owners != 2 {
		t.Fatalf("eksport: %+v", res)
	}
	files := map[string]json.RawMessage{}
	for _, f := range []string{"parcels_data.json", "owner_data_to_import.json", "genealogia.json", "demografia.json", "map_config.json"} {
		b, err := os.ReadFile(filepath.Join(outDir, "json", f))
		if err != nil {
			t.Fatal(err)
		}
		files[f] = b
	}
	dst := newTestApp(t)
	if _, err := dst.dispatch("miejscowosci_import_json", map[string]interface{}{"files": files}); err != nil {
		t.Fatal(err)
	}
	if countRows(t, dst, "obiekty_geograficzne") != 2 || countRows(t, dst, "wlasciciele") != 2 {
		t.Fatalf("po imporcie: obiekty=%d wlasciciele=%d", countRows(t, dst, "obiekty_geograficzne"), countRows(t, dst, "wlasciciele"))
	}
	out2 := t.TempDir()
	if _, err := service.ExportCompatibleJSON(dst.db, out2, service.LocationJSONMeta{ID: "czarna", Name: "Czarna"}); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"parcels_data.json", "owner_data_to_import.json"} {
		a, _ := os.ReadFile(filepath.Join(outDir, "json", f))
		b, _ := os.ReadFile(filepath.Join(out2, "json", f))
		if !bytes.Equal(a, b) {
			t.Errorf("%s różni się po round-tripie", f)
		}
	}
}

// Pełny backup ZIP -> import w czystej instalacji odtwarza miejscowość.
func TestFullBackupImportRoundTrip(t *testing.T) {
	src := newTestApp(t)
	seedSampleData(t, src)
	// Zdjęcie historii i skan protokołu, żeby sprawdzić katalogi.
	if err := os.MkdirAll(filepath.Join(src.dataDir, "protokoly", "Anna_Nowak_3"), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(src.dataDir, "protokoly", "Anna_Nowak_3", "1.jpg"), []byte("jpg-1"), 0o644)
	_ = os.MkdirAll(filepath.Join(src.dataDir, "history_photos"), 0o755)
	_ = os.WriteFile(filepath.Join(src.dataDir, "history_photos", "dworzec.png"), []byte("png"), 0o644)
	// Checkpoint WAL, żeby plik .db zawierał dane (tak jak przy zamykaniu aplikacji).
	if _, err := src.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		t.Fatal(err)
	}

	created := asMap(t, mustDispatch(t, src, "miejscowosci_pelny_backup", map[string]interface{}{}))
	zipPath, _ := created["path"].(string)
	zipData, err := os.ReadFile(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		t.Fatal(err)
	}
	// Nasz własny backup musi przechodzić walidację.
	if err := validateZipArchive(zr, defaultZipLimits); err != nil {
		t.Fatalf("własny backup nie przechodzi walidacji: %v", err)
	}

	dst := newTestApp(t)
	res := asMap(t, mustImport(t, dst, zipData))
	results, _ := res["results"].([]interface{})
	if len(results) != 1 {
		t.Fatalf("import: %v", res)
	}
	r0 := results[0].(map[string]interface{})
	if r0["status"] != "updated" || r0["error"] != nil || r0["json_import_warning"] != nil {
		t.Fatalf("wynik importu: %v", r0)
	}
	locDir := filepath.Join(dst.rootDataDir, "locations", "czarna")
	for _, rel := range []string{"czarna.db", "mapa.jpg", filepath.Join("protokoly", "Anna_Nowak_3", "1.jpg"), filepath.Join("history_photos", "dworzec.png")} {
		if _, err := os.Stat(filepath.Join(locDir, rel)); err != nil {
			t.Errorf("brak odtworzonego pliku %s: %v", rel, err)
		}
	}
	restored, err := db.Open(filepath.Join(locDir, "czarna.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	var owners, objs int
	_ = restored.QueryRow("SELECT COUNT(*) FROM wlasciciele").Scan(&owners)
	_ = restored.QueryRow("SELECT COUNT(*) FROM obiekty_geograficzne").Scan(&objs)
	if owners != 2 || objs != 2 {
		t.Fatalf("odtworzona baza: wlasciciele=%d obiekty=%d", owners, objs)
	}
	reg, err := dst.loadRegistry()
	if err != nil {
		t.Fatal(err)
	}
	if len(reg.Locations) != 1 || reg.Locations[0].DBPath != filepath.Join(locDir, "czarna.db") {
		t.Fatalf("rejestr: %+v", reg.Locations)
	}
}

func mustImport(t *testing.T, app *App, zipData []byte) interface{} {
	t.Helper()
	res, err := app.importFullBackupZip(zipData, defaultZipLimits)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	return res
}

// Rejestr z absolutnymi ścieżkami z innego komputera (jak data/locations.json
// w wersji v1.2) musi zostać przepięty na lokalny katalog danych, a zapis
// rejestru ma używać ścieżek względnych.
func TestRegistryStaleAbsolutePathsAreRebased(t *testing.T) {
	app := newTestApp(t)
	stale := filepath.Join(t.TempDir(), "nie", "istnieje")
	reg := locationsRegistry{ActiveID: "czarna", AutoOpen: true, Locations: []LocationInfo{{
		ID: "czarna", Name: "Czarna", DBPath: filepath.Join(stale, "czarna.db"), DataDir: stale,
	}}}
	b, _ := json.Marshal(reg)
	if err := os.WriteFile(app.registryPath(), b, 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := app.loadRegistry()
	if err != nil {
		t.Fatal(err)
	}
	if got.Locations[0].DBPath != app.dbPath || got.Locations[0].DataDir != app.dataDir {
		t.Fatalf("ścieżki nie przepięte: %+v", got.Locations[0])
	}
	if err := app.saveRegistry(got); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(app.registryPath())
	var saved locationsRegistry
	_ = json.Unmarshal(raw, &saved)
	if saved.Locations[0].DBPath != "czarna.db" || saved.Locations[0].DataDir != "." {
		t.Fatalf("zapisane ścieżki nie są względne: %+v", saved.Locations[0])
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatal("aplikacja utworzyła katalog pod nieistniejącą ścieżką")
	}
	// Ścieżki poza katalogiem danych zostają absolutne.
	if r := relativeToRoot(app.dataDir, stale); r != stale {
		t.Fatalf("ścieżka spoza root zrelatywizowana: %q", r)
	}
}

// Gdy backup zawiera bazę, import nie może nakładać na nią JSON-a
// (JSON nie przenosi wszystkich relacji działka-właściciel).
func TestFullBackupWithDBKeepsDBAuthoritative(t *testing.T) {
	src := newTestApp(t)
	seedSampleData(t, src)
	// Relacja, której nie ma w eksporcie JSON (nietypowy typ posiadania).
	if _, err := src.db.Exec(`INSERT INTO dzialki_wlasciciele (wlasciciel_id, obiekt_id, typ_posiadania, opis_udzialu)
		SELECT w.id, o.id, 'dzierzawa', '1/2' FROM wlasciciele w, obiekty_geograficzne o WHERE w.unikalny_klucz='Anna_Nowak_3' AND o.nazwa_lub_numer='12'`); err != nil {
		t.Fatal(err)
	}
	if _, err := src.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		t.Fatal(err)
	}
	want := countRows(t, src, "dzialki_wlasciciele")
	created := asMap(t, mustDispatch(t, src, "miejscowosci_pelny_backup", map[string]interface{}{"include_json": true, "include_db": true}))
	zipData, err := os.ReadFile(created["path"].(string))
	if err != nil {
		t.Fatal(err)
	}
	dst := newTestApp(t)
	res := asMap(t, mustImport(t, dst, zipData))
	r0 := res["results"].([]interface{})[0].(map[string]interface{})
	if r0["json_import"] == nil {
		t.Fatalf("JSON nałożony na odtworzoną bazę: %v", r0)
	}
	restored, err := db.Open(filepath.Join(dst.rootDataDir, "locations", "czarna", "czarna.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	var got, share int
	_ = restored.QueryRow("SELECT COUNT(*) FROM dzialki_wlasciciele").Scan(&got)
	_ = restored.QueryRow("SELECT COUNT(*) FROM dzialki_wlasciciele WHERE typ_posiadania='dzierzawa' AND opis_udzialu='1/2'").Scan(&share)
	if got != want || share != 1 {
		t.Fatalf("relacje działka-właściciel: %d (oczekiwano %d), z udziałem 1/2: %d", got, want, share)
	}
}
