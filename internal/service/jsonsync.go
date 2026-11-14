package service

import (
	"czarna-mapa/internal/geo"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type LocationJSONMeta struct {
	ID                  string `json:"id"`
	Name                string `json:"name"`
	FullName            string `json:"full_name"`
	Powiat              string `json:"powiat"`
	Region              string `json:"region"`
	Year                string `json:"year"`
	Century             string `json:"century"`
	GminaKatastralna    string `json:"gmina_katastralna"`
	MiejscowoscProtokol string `json:"miejscowosc_protokolu"`
	HomepageDescription string `json:"homepage_description,omitempty"`
	HistorySubtitle     string `json:"history_subtitle,omitempty"`
	HistoryParagraph1   string `json:"history_paragraph1,omitempty"`
	HistoryParagraph2   string `json:"history_paragraph2,omitempty"`
	HistoryParagraph3   string `json:"history_paragraph3,omitempty"`
}

type JSONSyncResult struct {
	Dir          string   `json:"dir,omitempty"`
	Files        []string `json:"files,omitempty"`
	Owners       int      `json:"owners,omitempty"`
	Parcels      int      `json:"parcels,omitempty"`
	People       int      `json:"people,omitempty"`
	Demography   int      `json:"demography,omitempty"`
	ImportedKeys []string `json:"imported_keys,omitempty"`
}

type oldOwnerRecord map[string]interface{}
type oldOwners map[string]oldOwnerRecord

type oldParcelRecord struct {
	Kategoria string      `json:"kategoria"`
	Geometria [][]float64 `json:"geometria"`
	Extra     interface{} `json:"-"`
}

// ExportCompatibleJSON eksportuje aktywną bazę SQLite do JSON zgodnego ze starym launcherem.
func ExportCompatibleJSON(db *sql.DB, dataDir string, meta LocationJSONMeta) (*JSONSyncResult, error) {
	outDir := filepath.Join(dataDir, "json")
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return nil, err
	}
	res := &JSONSyncResult{Dir: outDir}

	if n, err := exportOwnersJSON(db, filepath.Join(outDir, "owner_data_to_import.json")); err != nil {
		return nil, err
	} else {
		res.Owners = n
		res.Files = append(res.Files, "owner_data_to_import.json")
	}
	if n, err := exportParcelsJSON(db, filepath.Join(outDir, "parcels_data.json")); err != nil {
		return nil, err
	} else {
		res.Parcels = n
		res.Files = append(res.Files, "parcels_data.json")
	}
	if n, err := exportGenealogyJSON(db, filepath.Join(outDir, "genealogia.json")); err != nil {
		return nil, err
	} else {
		res.People = n
		res.Files = append(res.Files, "genealogia.json")
	}
	if n, err := exportDemographyJSON(db, filepath.Join(outDir, "demografia.json")); err != nil {
		return nil, err
	} else {
		res.Demography = n
		res.Files = append(res.Files, "demografia.json")
	}
	if err := exportMapConfigJSON(db, filepath.Join(outDir, "map_config.json")); err != nil {
		return nil, err
	} else {
		res.Files = append(res.Files, "map_config.json")
	}
	if err := writeJSON(filepath.Join(outDir, "location.json"), meta); err != nil {
		return nil, err
	} else {
		res.Files = append(res.Files, "location.json")
	}
	sort.Strings(res.Files)
	return res, nil
}

func exportOwnersJSON(db *sql.DB, path string) (int, error) {
	rows, err := db.Query(`SELECT id,unikalny_klucz,nazwa_wlasciciela,numer_protokolu,numer_domu,data_protokolu,miejsce_protokolu,genealogia,historia_wlasnosci,uwagi,wspolwlasnosc,powiazania_i_transakcje,interpretacja_i_wnioski FROM wlasciciele ORDER BY COALESCE(numer_protokolu,999999), nazwa_wlasciciela`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	out := oldOwners{}
	ownerIDs := map[int64]string{}
	for rows.Next() {
		var id int64
		var key, name string
		var order *int32
		var house, date, place, gen, hist, uw, wsp, pow, interp *string
		if err := rows.Scan(&id, &key, &name, &order, &house, &date, &place, &gen, &hist, &uw, &wsp, &pow, &interp); err != nil {
			return 0, err
		}
		rec := oldOwnerRecord{"ownerName": name}
		if order != nil {
			rec["orderNumber"] = fmt.Sprint(*order)
		}
		if date != nil {
			rec["protocolDate"] = *date
		}
		if house != nil {
			rec["houseNumber"] = *house
		}
		if place != nil {
			rec["protocolLocation"] = *place
		}
		if gen != nil {
			rec["genealogy"] = *gen
		}
		if hist != nil {
			rec["ownershipHistory"] = *hist
		}
		if uw != nil {
			rec["remarks"] = *uw
		}
		if wsp != nil {
			rec["wspolwlasnosc"] = *wsp
		}
		if pow != nil {
			rec["powiazania_i_transakcje"] = *pow
		}
		if interp != nil {
			rec["interpretacja_i_wnioski"] = *interp
		}
		rec["buildingPlots"] = []string{}
		rec["agriculturalPlots"] = []string{}
		rec["realbuildingPlots"] = []string{}
		rec["realagriculturalPlots"] = []string{}
		rec["plotLinks"] = []map[string]interface{}{}
		out[key] = rec
		ownerIDs[id] = key
	}
	// Powiązania działka-właściciel. Pola legacy (buildingPlots itd.) zostają
	// dla zgodności ze starszymi wersjami, a pełna informacja (kategoria
	// obiektu, typ_posiadania, opis_udzialu) trafia do "plotLinks".
	linkRows, err := db.Query(`SELECT dw.wlasciciel_id,o.nazwa_lub_numer,o.kategoria,dw.typ_posiadania,dw.opis_udzialu FROM dzialki_wlasciciele dw JOIN obiekty_geograficzne o ON o.id=dw.obiekt_id ORDER BY o.nazwa_lub_numer,o.kategoria,COALESCE(dw.typ_posiadania,''),dw.id`)
	if err != nil {
		return 0, err
	}
	defer linkRows.Close()
	for linkRows.Next() {
		var oid int64
		var num, cat string
		var typ, opis sql.NullString
		if err := linkRows.Scan(&oid, &num, &cat, &typ, &opis); err != nil {
			return 0, err
		}
		key := ownerIDs[oid]
		if key == "" {
			continue
		}
		field := "agriculturalPlots"
		if cat == "budowlana" {
			field = "buildingPlots"
		}
		if strings.Contains(strings.ToLower(typ.String), "rzeczywista") {
			field = "real" + field
		}
		arr, _ := out[key][field].([]string)
		out[key][field] = append(arr, num)
		link := map[string]interface{}{"plot": num, "kategoria": cat, "typ_posiadania": nullStr(typ), "opis_udzialu": nullStr(opis)}
		links, _ := out[key]["plotLinks"].([]map[string]interface{})
		out[key]["plotLinks"] = append(links, link)
	}
	if err := linkRows.Err(); err != nil {
		return 0, err
	}
	relRows, err := db.Query(`SELECT wlasciciel_id_1,wlasciciel_id_2,typ_relacji,opis_relacji FROM powiazania_protokolow ORDER BY id`)
	if err != nil {
		return 0, err
	}
	defer relRows.Close()
	for relRows.Next() {
		var a, b int64
		var typ, opis sql.NullString
		if err := relRows.Scan(&a, &b, &typ, &opis); err != nil {
			return 0, err
		}
		ka, kb := ownerIDs[a], ownerIDs[b]
		if ka == "" || kb == "" {
			continue
		}
		rels, _ := out[ka]["protocolRelations"].([]map[string]interface{})
		out[ka]["protocolRelations"] = append(rels, map[string]interface{}{"ownerKey": kb, "typ_relacji": nullStr(typ), "opis_relacji": nullStr(opis)})
	}
	if err := relRows.Err(); err != nil {
		return 0, err
	}
	return len(out), writeJSON(path, out)
}

func exportParcelsJSON(db *sql.DB, path string) (int, error) {
	rows, err := db.Query(`SELECT nazwa_lub_numer,kategoria,geometria_geojson FROM obiekty_geograficzne ORDER BY nazwa_lub_numer,kategoria`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	out := map[string]map[string]interface{}{}
	for rows.Next() {
		var num, cat string
		var geom sql.NullString
		if err := rows.Scan(&num, &cat, &geom); err != nil {
			return 0, err
		}
		rec := map[string]interface{}{"kategoria": cat}
		if geom.Valid && strings.TrimSpace(geom.String) != "" {
			// "geometria" to stary format (pierścień [lat,lng]); "geojson"
			// zachowuje dokładną geometrię (Point, LineString, wiele pierścieni).
			rec["geometria"] = geoJSONToOldLatLng(geom.String)
			if json.Valid([]byte(geom.String)) {
				rec["geojson"] = json.RawMessage(geom.String)
			}
		}
		out[num+"_"+cat] = rec
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	return len(out), writeJSON(path, out)
}

func exportDemographyJSON(db *sql.DB, path string) (int, error) {
	rows, err := db.Query(`SELECT rok,populacja_ogolem,katolicy,zydzi,inni,opis FROM demografia ORDER BY rok`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var out []map[string]interface{}
	for rows.Next() {
		var rok int32
		var pop, kat, zydzi, inni *int32
		var opis *string
		if err := rows.Scan(&rok, &pop, &kat, &zydzi, &inni, &opis); err != nil {
			return 0, err
		}
		out = append(out, map[string]interface{}{"rok": rok, "populacja_ogolem": pop, "katolicy": kat, "zydzi": zydzi, "inni": inni, "opis": opis})
	}
	return len(out), writeJSON(path, out)
}

func exportMapConfigJSON(db *sql.DB, path string) error {
	cal, err := PobierzKalibracjeMapy(db)
	if err != nil {
		return err
	}
	defs := Pobierz(db, "map_defaults")
	if defs == "" {
		defs = `{"center":{"lat":50.0605803891,"lng":21.2395193597},"zoom":14}`
	}
	var c, d interface{}
	_ = json.Unmarshal([]byte(cal), &c)
	_ = json.Unmarshal([]byte(defs), &d)
	return writeJSON(path, map[string]interface{}{"calibration": c, "defaults": d})
}

func exportGenealogyJSON(db *sql.DB, path string) (int, error) {
	rows, err := db.Query(`SELECT p.id,p.json_id,p.imie_nazwisko,p.plec,p.numer_domu,p.rok_urodzenia,p.rok_smierci,p.id_ojca,p.id_matki,w.unikalny_klucz,p.uwagi FROM osoby_genealogia p LEFT JOIN wlasciciele w ON p.id_protokolu=w.id ORDER BY p.json_id`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	type raw struct {
		dbid, jsonid   int64
		rec            map[string]interface{}
		father, mother *int64
	}
	var raws []raw
	dbToJSON := map[int64]int64{}
	for rows.Next() {
		var r raw
		var name string
		var gender, house, proto, notes *string
		var birth, death *int32
		if err := rows.Scan(&r.dbid, &r.jsonid, &name, &gender, &house, &birth, &death, &r.father, &r.mother, &proto, &notes); err != nil {
			return 0, err
		}
		r.rec = map[string]interface{}{"id": r.jsonid, "name": name, "gender": strVal(gender), "houseNumber": house, "birthDate": yearObj(birth), "deathDate": yearObj(death), "protokolKey": proto, "fatherId": nil, "motherId": nil, "spouseIds": []int64{}, "notes": strVal(notes)}
		dbToJSON[r.dbid] = r.jsonid
		raws = append(raws, r)
	}
	spouses := map[int64][]int64{}
	marriages := map[int64][]map[string]interface{}{}
	mr, err := db.Query(`SELECT malzonek1_id,malzonek2_id,rok_slubu,miesiac_slubu,dzien_slubu,data_slubu FROM malzenstwa ORDER BY malzonek1_id,malzonek2_id`)
	if err != nil {
		return 0, err
	}
	defer mr.Close()
	for mr.Next() {
		var a, b int64
		var y, m, d *int32
		var text sql.NullString
		if err := mr.Scan(&a, &b, &y, &m, &d, &text); err != nil {
			return 0, err
		}
		ja, oka := dbToJSON[a]
		jb, okb := dbToJSON[b]
		if !oka || !okb {
			continue
		}
		date := marriageDateObj(y, m, d)
		spouses[a] = append(spouses[a], jb)
		spouses[b] = append(spouses[b], ja)
		ma := map[string]interface{}{"spouseId": jb, "date": date}
		mb := map[string]interface{}{"spouseId": ja, "date": date}
		if text.Valid && text.String != "" {
			ma["dateText"] = text.String
			mb["dateText"] = text.String
		}
		marriages[a] = append(marriages[a], ma)
		marriages[b] = append(marriages[b], mb)
	}
	if err := mr.Err(); err != nil {
		return 0, err
	}
	persons := []map[string]interface{}{}
	for _, r := range raws {
		if r.father != nil {
			r.rec["fatherId"] = dbToJSON[*r.father]
		}
		if r.mother != nil {
			r.rec["motherId"] = dbToJSON[*r.mother]
		}
		if s := spouses[r.dbid]; s != nil {
			r.rec["spouseIds"] = s
		}
		if m := marriages[r.dbid]; m != nil {
			r.rec["marriages"] = m
		}
		persons = append(persons, r.rec)
	}
	return len(persons), writeJSON(path, map[string]interface{}{"persons": persons})
}

// ImportCompatibleJSON importuje wybrane stare JSON-y do aktualnej bazy SQLite.
func ImportCompatibleJSON(db *sql.DB, files map[string]json.RawMessage) (*JSONSyncResult, error) {
	res := &JSONSyncResult{}
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if raw := firstFile(files, "parcels_data.json"); raw != nil {
		n, err := importParcelsJSON(tx, raw)
		if err != nil {
			return nil, err
		}
		res.Parcels = n
		res.ImportedKeys = append(res.ImportedKeys, "parcels_data.json")
	}
	if raw := firstFile(files, "owner_data_to_import.json", "wlasciciele.json"); raw != nil {
		n, err := importOwnersJSON(tx, raw)
		if err != nil {
			return nil, err
		}
		res.Owners = n
		res.ImportedKeys = append(res.ImportedKeys, "owner_data_to_import.json")
	}
	if raw := firstFile(files, "demografia.json"); raw != nil {
		n, err := importDemographyJSON(tx, raw)
		if err != nil {
			return nil, err
		}
		res.Demography = n
		res.ImportedKeys = append(res.ImportedKeys, "demografia.json")
	}
	if raw := firstFile(files, "genealogia.json"); raw != nil {
		n, err := importGenealogyJSON(tx, raw)
		if err != nil {
			return nil, err
		}
		res.People = n
		res.ImportedKeys = append(res.ImportedKeys, "genealogia.json")
	}
	if raw := firstFile(files, "map_config.json"); raw != nil {
		if err := importMapConfigJSON(tx, raw); err != nil {
			return nil, err
		}
		res.ImportedKeys = append(res.ImportedKeys, "map_config.json")
	}
	return res, tx.Commit()
}

func importParcelsJSON(tx *sql.Tx, raw []byte) (int, error) {
	var data map[string]map[string]interface{}
	if err := json.Unmarshal(raw, &data); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`DELETE FROM dzialki_wlasciciele`); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`DELETE FROM obiekty_geograficzne`); err != nil {
		return 0, err
	}
	for key, rec := range data {
		cat, _ := rec["kategoria"].(string)
		if cat == "" {
			cat = "rolna"
		}
		num := parcelNumberFromKey(key, cat)
		var geomStr string
		if g, ok := rec["geojson"]; ok && g != nil {
			b, err := json.Marshal(g)
			if err != nil {
				return 0, err
			}
			geomStr = string(b)
		} else {
			geomStr = oldGeomToGeoJSON(rec["geometria"])
		}
		var geomVal, minLat, minLng, maxLat, maxLng interface{}
		if geomStr != "" {
			geomVal = geomStr
			if bbox := geo.CalculateBBox(geomStr); bbox != nil {
				minLng, minLat, maxLng, maxLat = (*bbox)[0], (*bbox)[1], (*bbox)[2], (*bbox)[3]
			}
		}
		if _, err := tx.Exec(`INSERT INTO obiekty_geograficzne (nazwa_lub_numer,kategoria,geometria_geojson,bbox_min_lat,bbox_min_lng,bbox_max_lat,bbox_max_lng) VALUES (?,?,?,?,?,?,?)`, num, cat, geomVal, minLat, minLng, maxLat, maxLng); err != nil {
			return 0, err
		}
	}
	return len(data), nil
}

func importOwnersJSON(tx *sql.Tx, raw []byte) (int, error) {
	var data oldOwners
	if err := json.Unmarshal(raw, &data); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`DELETE FROM dzialki_wlasciciele`); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`DELETE FROM powiazania_protokolow`); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`DELETE FROM wlasciciele`); err != nil {
		return 0, err
	}
	ownerIDs := map[string]int64{}
	keys := make([]string, 0, len(data))
	for k := range data {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, key := range keys {
		v := data[key]
		order := intOrNil(v["orderNumber"])
		res, err := tx.Exec(`INSERT INTO wlasciciele (unikalny_klucz,nazwa_wlasciciela,numer_protokolu,numer_domu,data_protokolu,miejsce_protokolu,genealogia,historia_wlasnosci,uwagi,wspolwlasnosc,powiazania_i_transakcje,interpretacja_i_wnioski) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, key, strAny(v["ownerName"]), order, nilStrAny(v["houseNumber"]), nilStrAny(v["protocolDate"]), nilStrAny(v["protocolLocation"]), nilStrAny(v["genealogy"]), nilStrAny(v["ownershipHistory"]), nilStrAny(v["remarks"]), nilStrAny(v["wspolwlasnosc"]), nilStrAny(v["powiazania_i_transakcje"]), nilStrAny(v["interpretacja_i_wnioski"]))
		if err != nil {
			return 0, err
		}
		id, _ := res.LastInsertId()
		ownerIDs[key] = id
	}
	for _, key := range keys {
		oid := ownerIDs[key]
		v := data[key]
		if links, ok := v["plotLinks"].([]interface{}); ok {
			// Pełny format (v1.3+): dokładna kategoria, typ i opis udziału.
			for _, l := range links {
				m, ok := l.(map[string]interface{})
				if !ok {
					continue
				}
				num := strings.TrimSpace(strAny(m["plot"]))
				if num == "" {
					continue
				}
				objID, err := ensureObjectCatTx(tx, num, strAny(m["kategoria"]))
				if err != nil {
					return 0, err
				}
				if _, err := tx.Exec(`INSERT OR IGNORE INTO dzialki_wlasciciele (wlasciciel_id,obiekt_id,typ_posiadania,opis_udzialu) VALUES (?,?,?,?)`, oid, objID, m["typ_posiadania"], m["opis_udzialu"]); err != nil {
					return 0, err
				}
			}
			continue
		}
		for _, field := range []string{"realbuildingPlots", "realagriculturalPlots", "buildingPlots", "agriculturalPlots"} {
			arr := toStringArray(v[field])
			real := strings.HasPrefix(field, "real")
			building := strings.Contains(strings.ToLower(field), "building")
			typ := "wlasnosc z protokolu"
			if real {
				typ = "wlasnosc rzeczywista"
			}
			for _, num := range arr {
				objID, err := ensureObjectTx(tx, num, building)
				if err != nil {
					return 0, err
				}
				_, _ = tx.Exec(`INSERT INTO dzialki_wlasciciele (wlasciciel_id,obiekt_id,typ_posiadania,opis_udzialu) VALUES (?,?,?,?)`, oid, objID, typ, "")
			}
		}
	}
	for _, key := range keys {
		rels, _ := data[key]["protocolRelations"].([]interface{})
		for _, r := range rels {
			m, ok := r.(map[string]interface{})
			if !ok {
				continue
			}
			other, ok := ownerIDs[strAny(m["ownerKey"])]
			if !ok {
				continue
			}
			if _, err := tx.Exec(`INSERT INTO powiazania_protokolow (wlasciciel_id_1,wlasciciel_id_2,typ_relacji,opis_relacji) VALUES (?,?,?,?)`, ownerIDs[key], other, m["typ_relacji"], m["opis_relacji"]); err != nil {
				return 0, err
			}
		}
	}
	return len(data), nil
}

// RepairOwnerParcelLinksFromJSON uzupełnia brakujące relacje działka-właściciel
// z pliku owner_data_to_import.json. Starsze bazy potrafią mieć poprawne
// powiązania dla działek całkowitych, ale brak powiązań dla numerów ułamkowych
// typu "800/1". Funkcja niczego nie usuwa — tylko dopisuje brakujące relacje.
func RepairOwnerParcelLinksFromJSON(db *sql.DB, dataDir string) (int, error) {
	path := filepath.Join(dataDir, "owner_data_to_import.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}

	var data oldOwners
	if err := json.Unmarshal(raw, &data); err != nil {
		return 0, err
	}

	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	inserted := 0
	for ownerKey, record := range data {
		var ownerID int64
		if err := tx.QueryRow(`SELECT id FROM wlasciciele WHERE unikalny_klucz=?`, ownerKey).Scan(&ownerID); err != nil {
			continue
		}

		for _, field := range []string{"realbuildingPlots", "realagriculturalPlots", "buildingPlots", "agriculturalPlots"} {
			real := strings.HasPrefix(field, "real")
			building := strings.Contains(strings.ToLower(field), "building")
			typ := "wlasnosc z protokolu"
			if real {
				typ = "wlasnosc rzeczywista"
			}

			for _, num := range toStringArray(record[field]) {
				if strings.TrimSpace(num) == "" {
					continue
				}
				objectID, err := ensureObjectTx(tx, num, building)
				if err != nil {
					return 0, err
				}
				res, err := tx.Exec(
					`INSERT OR IGNORE INTO dzialki_wlasciciele (wlasciciel_id,obiekt_id,typ_posiadania,opis_udzialu) VALUES (?,?,?,?)`,
					ownerID, objectID, typ, "",
				)
				if err != nil {
					return 0, err
				}
				if n, _ := res.RowsAffected(); n > 0 {
					inserted++
				}
			}
		}
	}

	return inserted, tx.Commit()
}

func importDemographyJSON(tx *sql.Tx, raw []byte) (int, error) {
	var rows []map[string]interface{}
	if err := json.Unmarshal(raw, &rows); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`DELETE FROM demografia`); err != nil {
		return 0, err
	}
	for _, r := range rows {
		_, err := tx.Exec(`INSERT INTO demografia (rok,populacja_ogolem,katolicy,zydzi,inni,opis) VALUES (?,?,?,?,?,?)`, intOrNil(r["rok"]), intOrNil(r["populacja_ogolem"]), intOrNil(r["katolicy"]), intOrNil(r["zydzi"]), intOrNil(r["inni"]), nilStrAny(r["opis"]))
		if err != nil {
			return 0, err
		}
	}
	return len(rows), nil
}

func importMapConfigJSON(tx *sql.Tx, raw []byte) error {
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		return err
	}
	if c, ok := m["calibration"]; ok {
		b, _ := json.Marshal(c)
		_, err := tx.Exec(`INSERT INTO konfiguracja_systemu (klucz,wartosc,opis) VALUES ('map_calibration',?,'Współrzędne kalibracji mapy historycznej') ON CONFLICT(klucz) DO UPDATE SET wartosc=excluded.wartosc`, string(b))
		if err != nil {
			return err
		}
	}
	if d, ok := m["defaults"]; ok {
		b, _ := json.Marshal(d)
		_, err := tx.Exec(`INSERT INTO konfiguracja_systemu (klucz,wartosc,opis) VALUES ('map_defaults',?,'Domyślny widok mapy') ON CONFLICT(klucz) DO UPDATE SET wartosc=excluded.wartosc`, string(b))
		if err != nil {
			return err
		}
	}
	return nil
}

func importGenealogyJSON(tx *sql.Tx, raw []byte) (int, error) {
	var wrapper struct {
		Persons []map[string]interface{} `json:"persons"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return 0, err
	}
	_, _ = tx.Exec(`DELETE FROM malzenstwa`)
	_, _ = tx.Exec(`UPDATE osoby_genealogia SET id_ojca=NULL,id_matki=NULL`)
	if _, err := tx.Exec(`DELETE FROM osoby_genealogia`); err != nil {
		return 0, err
	}
	ownerByKey := map[string]int64{}
	rows, _ := tx.Query(`SELECT id,unikalny_klucz FROM wlasciciele`)
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var id int64
			var key string
			if rows.Scan(&id, &key) == nil {
				ownerByKey[key] = id
			}
		}
	}
	jsonToDB := map[int64]int64{}
	for _, p := range wrapper.Persons {
		jid := int64Val(p["id"])
		name := strAny(p["name"])
		proto := strAny(p["protokolKey"])
		var protoID interface{}
		if id, ok := ownerByKey[proto]; ok {
			protoID = id
		}
		res, err := tx.Exec(`INSERT INTO osoby_genealogia (json_id,imie_nazwisko,plec,numer_domu,rok_urodzenia,rok_smierci,id_protokolu,uwagi) VALUES (?,?,?,?,?,?,?,?)`, jid, name, nilStrAny(p["gender"]), nilStrAny(p["houseNumber"]), yearFromObj(p["birthDate"]), yearFromObj(p["deathDate"]), protoID, nilStrAny(p["notes"]))
		if err != nil {
			return 0, err
		}
		dbid, _ := res.LastInsertId()
		jsonToDB[jid] = dbid
	}
	for _, p := range wrapper.Persons {
		dbid := jsonToDB[int64Val(p["id"])]
		var father, mother interface{}
		if id := int64Val(p["fatherId"]); id != 0 {
			father = jsonToDB[id]
		}
		if id := int64Val(p["motherId"]); id != 0 {
			mother = jsonToDB[id]
		}
		_, err := tx.Exec(`UPDATE osoby_genealogia SET id_ojca=?,id_matki=? WHERE id=?`, father, mother, dbid)
		if err != nil {
			return 0, err
		}
	}
	seen := map[string]bool{}
	addMarriage := func(a, b int64, date map[string]interface{}, text interface{}) error {
		if a == 0 || b == 0 || a == b {
			return nil
		}
		x, y := a, b
		if x > y {
			x, y = y, x
		}
		k := fmt.Sprintf("%d:%d", x, y)
		if seen[k] {
			return nil
		}
		seen[k] = true
		var yr, mo, dy interface{}
		if date != nil {
			yr, mo, dy = intOrNil(date["year"]), intOrNil(date["month"]), intOrNil(date["day"])
		}
		_, err := tx.Exec(`INSERT INTO malzenstwa (malzonek1_id,malzonek2_id,rok_slubu,miesiac_slubu,dzien_slubu,data_slubu) VALUES (?,?,?,?,?,?)`, x, y, yr, mo, dy, text)
		return err
	}
	// Najpierw "marriages" (z datą ślubu), potem "spouseIds" bez daty.
	for _, p := range wrapper.Persons {
		a := jsonToDB[int64Val(p["id"])]
		ms, _ := p["marriages"].([]interface{})
		for _, mm := range ms {
			m, ok := mm.(map[string]interface{})
			if !ok {
				continue
			}
			date, _ := m["date"].(map[string]interface{})
			if err := addMarriage(a, jsonToDB[int64Val(m["spouseId"])], date, nilStrAny(m["dateText"])); err != nil {
				return 0, err
			}
		}
	}
	for _, p := range wrapper.Persons {
		a := jsonToDB[int64Val(p["id"])]
		for _, sid := range toInt64Array(p["spouseIds"]) {
			if err := addMarriage(a, jsonToDB[sid], nil, nil); err != nil {
				return 0, err
			}
		}
	}
	return len(wrapper.Persons), nil
}

func writeJSON(path string, v interface{}) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0644)
}
func firstFile(files map[string]json.RawMessage, names ...string) json.RawMessage {
	for _, n := range names {
		if v := files[n]; v != nil {
			return v
		}
	}
	return nil
}
func strVal(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
func yearObj(p *int32) interface{} {
	if p == nil {
		return nil
	}
	return map[string]int32{"year": *p}
}
func nilStrAny(v interface{}) interface{} {
	s := strAny(v)
	if s == "" {
		return nil
	}
	return s
}
func strAny(v interface{}) string {
	if v == nil {
		return ""
	}
	switch x := v.(type) {
	case string:
		return x
	case fmt.Stringer:
		return x.String()
	default:
		return fmt.Sprint(x)
	}
}
func intOrNil(v interface{}) interface{} {
	if v == nil {
		return nil
	}
	i := int64Val(v)
	if i == 0 && strings.TrimSpace(strAny(v)) == "" {
		return nil
	}
	return i
}
func int64Val(v interface{}) int64 {
	switch x := v.(type) {
	case float64:
		return int64(x)
	case int64:
		return x
	case int:
		return int64(x)
	case json.Number:
		i, _ := x.Int64()
		return i
	case string:
		var i int64
		fmt.Sscan(x, &i)
		return i
	default:
		return 0
	}
}
func toStringArray(v interface{}) []string {
	var out []string
	if a, ok := v.([]interface{}); ok {
		for _, x := range a {
			if m, ok := x.(map[string]interface{}); ok {
				n := strAny(m["numerator"])
				d := strAny(m["denominator"])
				if n != "" && d != "" {
					out = append(out, n+"/"+d)
				} else if n != "" {
					out = append(out, n)
				}
			} else if s := strings.TrimSpace(strAny(x)); s != "" {
				out = append(out, s)
			}
		}
	}
	return out
}
func toInt64Array(v interface{}) []int64 {
	var out []int64
	if a, ok := v.([]interface{}); ok {
		for _, x := range a {
			if i := int64Val(x); i != 0 {
				out = append(out, i)
			}
		}
	}
	return out
}
func yearFromObj(v interface{}) interface{} {
	if m, ok := v.(map[string]interface{}); ok {
		return intOrNil(m["year"])
	}
	return nil
}

// parcelNumberFromKey odcina z klucza "<numer>_<kategoria>" sufiks kategorii.
// Kategorie mogą zawierać "_" (np. "obiekt_specjalny"), więc nie wystarczy
// ostatni znak "_".
func parcelNumberFromKey(key, cat string) string {
	if cat != "" && strings.HasSuffix(key, "_"+cat) && len(key) > len(cat)+1 {
		return key[:len(key)-len(cat)-1]
	}
	if i := strings.LastIndex(key, "_"); i > 0 {
		return key[:i]
	}
	return key
}

// ensureObjectCatTx zwraca obiekt o dokładnie tym numerze i kategorii
// (tworzy go, jeśli nie istnieje). Bez kategorii działa jak ensureObjectTx.
func ensureObjectCatTx(tx *sql.Tx, num, cat string) (int64, error) {
	if cat == "" {
		return ensureObjectTx(tx, num, false)
	}
	var id int64
	err := tx.QueryRow(`SELECT id FROM obiekty_geograficzne WHERE nazwa_lub_numer=? AND kategoria=?`, num, cat).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != sql.ErrNoRows {
		return 0, err
	}
	res, err := tx.Exec(`INSERT INTO obiekty_geograficzne (nazwa_lub_numer,kategoria) VALUES (?,?)`, num, cat)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func nullStr(v sql.NullString) interface{} {
	if !v.Valid {
		return nil
	}
	return v.String
}

func marriageDateObj(y, m, d *int32) interface{} {
	if y == nil && m == nil && d == nil {
		return nil
	}
	out := map[string]int32{}
	if y != nil {
		out["year"] = *y
	}
	if m != nil {
		out["month"] = *m
	}
	if d != nil {
		out["day"] = *d
	}
	return out
}

func ensureObjectTx(tx *sql.Tx, num string, building bool) (int64, error) {
	cat := "rolna"
	if building {
		cat = "budowlana"
	}
	// Najpierw szukamy obiektu po samej nazwie – jeśli już istnieje
	// (np. zaimportowany z GeoJSON z właściwą kategorią pastwisko/las),
	// używamy go zamiast tworzyć duplikat z domyślną „rolna”.
	var id int64
	err := tx.QueryRow(`SELECT id FROM obiekty_geograficzne WHERE nazwa_lub_numer=? LIMIT 1`, num).Scan(&id)
	if err == nil {
		return id, nil
	}
	res, err := tx.Exec(`INSERT INTO obiekty_geograficzne (nazwa_lub_numer,kategoria) VALUES (?,?)`, num, cat)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}
func oldGeomToGeoJSON(v interface{}) string {
	arr, ok := v.([]interface{})
	if !ok || len(arr) == 0 {
		return ""
	}
	coords := []interface{}{}
	for _, p := range arr {
		if pt, ok := p.([]interface{}); ok && len(pt) >= 2 {
			coords = append(coords, []interface{}{pt[1], pt[0]})
		}
	}
	if len(coords) > 0 {
		coords = append(coords, coords[0])
	}
	b, _ := json.Marshal(map[string]interface{}{"type": "Polygon", "coordinates": []interface{}{coords}})
	return string(b)
}
func geoJSONToOldLatLng(s string) [][]float64 {
	var raw map[string]interface{}
	if json.Unmarshal([]byte(s), &raw) != nil {
		return nil
	}
	coords := extractFirstRing(raw)
	out := [][]float64{}
	for i, pt := range coords {
		if len(pt) >= 2 {
			if i == len(coords)-1 && len(coords) > 1 && pt[0] == coords[0][0] && pt[1] == coords[0][1] {
				break
			}
			out = append(out, []float64{pt[1], pt[0]})
		}
	}
	return out
}
func extractFirstRing(v interface{}) [][]float64 {
	switch x := v.(type) {
	case map[string]interface{}:
		if g := x["geometry"]; g != nil {
			return extractFirstRing(g)
		}
		if x["type"] == "Polygon" {
			if rings, ok := x["coordinates"].([]interface{}); ok && len(rings) > 0 {
				return ringToFloats(rings[0])
			}
		}
	case []interface{}:
		return ringToFloats(x)
	}
	return nil
}
func ringToFloats(v interface{}) [][]float64 {
	a, ok := v.([]interface{})
	if !ok {
		return nil
	}
	out := [][]float64{}
	for _, p := range a {
		if pt, ok := p.([]interface{}); ok && len(pt) >= 2 {
			out = append(out, []float64{toFloatAny(pt[0]), toFloatAny(pt[1])})
		}
	}
	return out
}
func toFloatAny(v interface{}) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case json.Number:
		f, _ := x.Float64()
		return f
	default:
		var f float64
		fmt.Sscan(fmt.Sprint(x), &f)
		return f
	}
}
