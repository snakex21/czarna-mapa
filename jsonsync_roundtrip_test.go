package main

import (
	"czarna-mapa/internal/db"
	"czarna-mapa/internal/service"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

// canonicalDump zwraca zawartość tabel danych w postaci niezależnej od
// wewnętrznych ID (relacje opisane kluczami naturalnymi), posortowaną.
func canonicalDump(t *testing.T, d *sql.DB) map[string][]string {
	t.Helper()
	out := map[string][]string{}
	add := func(table, query string, normGeom bool) {
		rows, err := d.Query(query)
		if err != nil {
			t.Fatalf("%s: %v", table, err)
		}
		defer rows.Close()
		cols, _ := rows.Columns()
		for rows.Next() {
			vals := make([]sql.NullString, len(cols))
			ptrs := make([]interface{}, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				t.Fatal(err)
			}
			line := ""
			for i, v := range vals {
				s := v.String
				if normGeom && cols[i] == "geometria_geojson" && s != "" {
					var g interface{}
					if json.Unmarshal([]byte(s), &g) == nil {
						b, _ := json.Marshal(g)
						s = string(b)
					}
				}
				line += fmt.Sprintf("%s=%q;", cols[i], s)
			}
			out[table] = append(out[table], line)
		}
		sort.Strings(out[table])
	}
	add("obiekty", `SELECT nazwa_lub_numer,kategoria,geometria_geojson FROM obiekty_geograficzne`, true)
	add("wlasciciele", `SELECT unikalny_klucz,nazwa_wlasciciela,numer_protokolu,numer_domu,data_protokolu,miejsce_protokolu,genealogia,historia_wlasnosci,uwagi,wspolwlasnosc,powiazania_i_transakcje,interpretacja_i_wnioski FROM wlasciciele`, false)
	add("dzialki_wlasciciele", `SELECT w.unikalny_klucz,o.nazwa_lub_numer,o.kategoria,dw.typ_posiadania,dw.opis_udzialu FROM dzialki_wlasciciele dw JOIN wlasciciele w ON w.id=dw.wlasciciel_id JOIN obiekty_geograficzne o ON o.id=dw.obiekt_id`, false)
	add("powiazania_protokolow", `SELECT a.unikalny_klucz,b.unikalny_klucz,p.typ_relacji,p.opis_relacji FROM powiazania_protokolow p JOIN wlasciciele a ON a.id=p.wlasciciel_id_1 JOIN wlasciciele b ON b.id=p.wlasciciel_id_2`, false)
	add("osoby", `SELECT p.json_id,p.imie_nazwisko,p.plec,p.numer_domu,p.rok_urodzenia,p.rok_smierci,f.json_id,m.json_id,w.unikalny_klucz,p.uwagi FROM osoby_genealogia p LEFT JOIN osoby_genealogia f ON f.id=p.id_ojca LEFT JOIN osoby_genealogia m ON m.id=p.id_matki LEFT JOIN wlasciciele w ON w.id=p.id_protokolu`, false)
	add("malzenstwa", `SELECT MIN(a.json_id,b.json_id),MAX(a.json_id,b.json_id),z.rok_slubu,z.miesiac_slubu,z.dzien_slubu,z.data_slubu FROM malzenstwa z JOIN osoby_genealogia a ON a.id=z.malzonek1_id JOIN osoby_genealogia b ON b.id=z.malzonek2_id`, false)
	add("demografia", `SELECT rok,populacja_ogolem,katolicy,zydzi,inni,opis FROM demografia`, false)
	return out
}

// jsonRoundTrip eksportuje bazę do JSON i importuje pliki do świeżej bazy.
func jsonRoundTrip(t *testing.T, src *sql.DB) *App {
	t.Helper()
	outDir := t.TempDir()
	if _, err := service.ExportCompatibleJSON(src, outDir, service.LocationJSONMeta{ID: "czarna", Name: "Czarna"}); err != nil {
		t.Fatal(err)
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
	return dst
}

func compareDumps(t *testing.T, want, got map[string][]string) {
	t.Helper()
	for table := range want {
		if !reflect.DeepEqual(want[table], got[table]) {
			t.Errorf("%s: %d wierszy przed, %d po round-tripie", table, len(want[table]), len(got[table]))
			wm := map[string]bool{}
			for _, l := range want[table] {
				wm[l] = true
			}
			shown := 0
			for _, l := range got[table] {
				if !wm[l] && shown < 3 {
					t.Logf("  nowy/zmieniony wiersz: %s", l)
					shown++
				}
			}
		}
	}
}

// Eksport JSON-only musi przenosić typ_posiadania, opis_udzialu, wszystkie
// relacje (działki, powiązania protokołów, rodzice, małżeństwa z datą,
// protokół osoby) oraz geometrie inne niż wielokąt.
func TestJSONRoundTripPreservesRelations(t *testing.T) {
	src := newTestApp(t)
	exec := func(q string, args ...interface{}) int64 {
		t.Helper()
		res, err := src.db.Exec(q, args...)
		if err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		id, _ := res.LastInsertId()
		return id
	}
	obj := `INSERT INTO obiekty_geograficzne (nazwa_lub_numer,kategoria,geometria_geojson) VALUES (?,?,?)`
	pPoly := exec(obj, "12", "rolna", `{"type":"Polygon","coordinates":[[[21,50],[21.001,50],[21.001,50.001],[21,50]],[[21.0002,50.0002],[21.0004,50.0002],[21.0004,50.0004],[21.0002,50.0002]]]}`)
	pDup := exec(obj, "12", "budowlana", `{"type":"Polygon","coordinates":[[[21,50],[21.002,50],[21.002,50.002],[21,50]]]}`)
	exec(obj, "dworzec kolejowy", "obiekt_specjalny", `{"type":"Point","coordinates":[21.2,50.06]}`)
	exec(obj, "1163", "droga", `{"type":"LineString","coordinates":[[21,50],[21.01,50.01]]}`)
	pNoGeom := exec(obj, "800/1", "rolna", nil)

	own := `INSERT INTO wlasciciele (unikalny_klucz,nazwa_wlasciciela,numer_protokolu,numer_domu,data_protokolu,miejsce_protokolu,uwagi) VALUES (?,?,?,?,?,?,?)`
	o1 := exec(own, "A_1", "Osoba A", 1, "1", "1882-03-01", "Czarna", "uwagi")
	o2 := exec(own, "B_2", "Osoba B", 2, "2", nil, nil, nil)
	link := `INSERT INTO dzialki_wlasciciele (wlasciciel_id,obiekt_id,typ_posiadania,opis_udzialu) VALUES (?,?,?,?)`
	exec(link, o1, pPoly, "wlasnosc z protokolu", "1/2")
	exec(link, o1, pPoly, "wlasnosc rzeczywista", "")
	exec(link, o2, pPoly, "dzierzawa", "połowa zachodnia")
	exec(link, o2, pDup, nil, nil)
	exec(link, o2, pNoGeom, "wlasnosc z protokolu", "")
	exec(`INSERT INTO powiazania_protokolow (wlasciciel_id_1,wlasciciel_id_2,typ_relacji,opis_relacji) VALUES (?,?,?,?)`, o1, o2, "sprzedaz", "sprzedaż części działki 12")

	per := `INSERT INTO osoby_genealogia (json_id,imie_nazwisko,plec,numer_domu,rok_urodzenia,rok_smierci,id_ojca,id_matki,id_protokolu,uwagi) VALUES (?,?,?,?,?,?,?,?,?,?)`
	f := exec(per, 10, "Ojciec", "M", "1", 1820, 1870, nil, nil, o1, nil)
	m := exec(per, 11, "Matka", "K", "1", 1825, nil, nil, nil, nil, "notatka")
	exec(per, 12, "Dziecko", "K", "1", 1850, nil, f, m, nil, nil)
	exec(`INSERT INTO malzenstwa (malzonek1_id,malzonek2_id,rok_slubu,miesiac_slubu,dzien_slubu,data_slubu) VALUES (?,?,?,?,?,?)`, f, m, 1848, 5, 7, "7 V 1848")
	exec(`INSERT INTO demografia (rok,populacja_ogolem,katolicy,zydzi,inni,opis) VALUES (1882,500,450,40,10,'spis')`)

	want := canonicalDump(t, src.db)
	dst := jsonRoundTrip(t, src.db)
	got := canonicalDump(t, dst.db)
	compareDumps(t, want, got)
	if len(got["dzialki_wlasciciele"]) != 5 || len(got["powiazania_protokolow"]) != 1 || len(got["malzenstwa"]) != 1 {
		t.Fatalf("brak relacji po imporcie: %v", got)
	}
}

// Ten sam round-trip na kopii bazy z repozytorium (dane historyczne).
func TestJSONRoundTripRepoDatabase(t *testing.T) {
	srcPath := filepath.Join("data", "czarna.db")
	// Można wskazać inną bazę (np. kopię bazy użytkownika); test i tak
	// pracuje na kopii w katalogu tymczasowym.
	if p := os.Getenv("CZARNA_ROUNDTRIP_DB"); p != "" {
		srcPath = p
	}
	in, err := os.Open(srcPath)
	if err != nil {
		t.Skipf("brak %s: %v", srcPath, err)
	}
	defer in.Close()
	tmp := filepath.Join(t.TempDir(), "czarna.db")
	outF, err := os.Create(tmp)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(outF, in); err != nil {
		t.Fatal(err)
	}
	outF.Close()
	src, err := db.Open(tmp)
	if err != nil {
		t.Fatal(err)
	}
	defer src.Close()
	want := canonicalDump(t, src)
	dst := jsonRoundTrip(t, src)
	compareDumps(t, want, canonicalDump(t, dst.db))
}
