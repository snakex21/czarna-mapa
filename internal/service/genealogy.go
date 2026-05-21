package service

import (
	"czarna-mapa/internal/models"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
)

// PobierzDrzewo zwraca pełne drzewo genealogiczne (osoby + małżeństwa).
func PobierzDrzewo(db *sql.DB) (*models.DrzewoGenealogiczne, error) {
	// Osoby
	osoby, err := pobierzWszystkieOsoby(db)
	if err != nil {
		return nil, err
	}

	// Małżeństwa
	malzenstwa, err := pobierzWszystkieMalzenstwa(db)
	if err != nil {
		return nil, err
	}

	return &models.DrzewoGenealogiczne{
		Osoby:      osoby,
		Malzenstwa: malzenstwa,
	}, nil
}

func pobierzWszystkieOsoby(db *sql.DB) ([]models.OsobaGenealogia, error) {
	rows, err := db.Query(
		`SELECT id, json_id, imie_nazwisko, plec, numer_domu, rok_urodzenia, rok_smierci,
		        id_ojca, id_matki, id_protokolu, uwagi
		 FROM osoby_genealogia ORDER BY imie_nazwisko`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.OsobaGenealogia
	for rows.Next() {
		var o models.OsobaGenealogia
		if err := rows.Scan(&o.ID, &o.JsonID, &o.ImieNazwisko, &o.Plec, &o.NumerDomu,
			&o.RokUrodzenia, &o.RokSmierci, &o.IdOjca, &o.IdMatki, &o.IdProtokolu, &o.Uwagi); err != nil {
			return nil, err
		}
		result = append(result, o)
	}
	return result, rows.Err()
}

func pobierzWszystkieMalzenstwa(db *sql.DB) ([]models.Malzenstwo, error) {
	rows, err := db.Query(
		"SELECT malzonek1_id, malzonek2_id, rok_slubu, miesiac_slubu, dzien_slubu, data_slubu FROM malzenstwa",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.Malzenstwo
	for rows.Next() {
		var m models.Malzenstwo
		if err := rows.Scan(&m.Malzonek1ID, &m.Malzonek2ID, &m.RokSlubu, &m.MiesiacSlubu, &m.DzienSlubu, &m.DataSlubu); err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, rows.Err()
}

// PobierzOsobyWlasciciela zwraca osoby dla danego właściciela.
func PobierzOsobyWlasciciela(db *sql.DB, wlascicielID int64) ([]models.OsobaGenealogia, error) {
	rows, err := db.Query(
		`SELECT id, json_id, imie_nazwisko, plec, numer_domu, rok_urodzenia, rok_smierci,
		        id_ojca, id_matki, id_protokolu, uwagi
		 FROM osoby_genealogia WHERE id_protokolu = ? ORDER BY imie_nazwisko`, wlascicielID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.OsobaGenealogia
	for rows.Next() {
		var o models.OsobaGenealogia
		if err := rows.Scan(&o.ID, &o.JsonID, &o.ImieNazwisko, &o.Plec, &o.NumerDomu,
			&o.RokUrodzenia, &o.RokSmierci, &o.IdOjca, &o.IdMatki, &o.IdProtokolu, &o.Uwagi); err != nil {
			return nil, err
		}
		result = append(result, o)
	}
	return result, rows.Err()
}

// DodajOsobe dodaje osobę — zwraca ID.
func DodajOsobe(db *sql.DB, o *models.OsobaGenealogia) (int64, error) {
	res, err := db.Exec(
		`INSERT INTO osoby_genealogia (json_id, imie_nazwisko, plec, numer_domu, rok_urodzenia,
		                               rok_smierci, id_ojca, id_matki, id_protokolu, uwagi)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		o.JsonID, o.ImieNazwisko, o.Plec, o.NumerDomu, o.RokUrodzenia,
		o.RokSmierci, o.IdOjca, o.IdMatki, o.IdProtokolu, o.Uwagi,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// AktualizujOsobe aktualizuje osobę.
func AktualizujOsobe(db *sql.DB, o *models.OsobaGenealogia) error {
	_, err := db.Exec(
		`UPDATE osoby_genealogia SET json_id = ?, imie_nazwisko = ?, plec = ?, numer_domu = ?,
		                             rok_urodzenia = ?, rok_smierci = ?, id_ojca = ?, id_matki = ?,
		                             id_protokolu = ?, uwagi = ?
		 WHERE id = ?`,
		o.JsonID, o.ImieNazwisko, o.Plec, o.NumerDomu,
		o.RokUrodzenia, o.RokSmierci, o.IdOjca, o.IdMatki,
		o.IdProtokolu, o.Uwagi, o.ID,
	)
	return err
}

// UsunOsobe usuwa osobę.
func UsunOsobe(db *sql.DB, id int64) error {
	_, err := db.Exec("DELETE FROM osoby_genealogia WHERE id = ?", id)
	return err
}

// PobierzGenealogieEditor zwraca dane w płaskim formacie starego edytora genealogii.
func PobierzGenealogieEditor(db *sql.DB) ([]models.GenealogiaEditorPerson, error) {
	rows, err := db.Query(`SELECT p.id,p.json_id,p.imie_nazwisko,p.plec,p.numer_domu,p.rok_urodzenia,p.rok_smierci,
		p.id_ojca,p.id_matki,w.unikalny_klucz,p.uwagi
		FROM osoby_genealogia p LEFT JOIN wlasciciele w ON p.id_protokolu=w.id ORDER BY p.imie_nazwisko`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type rawPerson struct {
		p          models.GenealogiaEditorPerson
		dbID       int64
		fatherDBID *int64
		motherDBID *int64
	}
	var raws []rawPerson
	dbToJSON := map[int64]int64{}
	for rows.Next() {
		var r rawPerson
		var fullName string
		var plec, numerDomu, proto, uwagi *string
		if err := rows.Scan(&r.dbID, &r.p.IDOsoby, &fullName, &plec, &numerDomu, &r.p.RokUrodzenia, &r.p.RokSmierci, &r.fatherDBID, &r.motherDBID, &proto, &uwagi); err != nil {
			return nil, err
		}
		r.p.DBID = r.dbID
		parts := strings.SplitN(fullName, " ", 2)
		r.p.Imie = parts[0]
		if len(parts) > 1 {
			r.p.Nazwisko = parts[1]
		}
		if plec != nil {
			r.p.Plec = *plec
		} else {
			r.p.Plec = "M"
		}
		if numerDomu != nil {
			r.p.NumerDomu = *numerDomu
		}
		if proto != nil {
			r.p.ProtokolKlucz = *proto
		}
		if uwagi != nil {
			r.p.Uwagi = *uwagi
		}
		dbToJSON[r.dbID] = r.p.IDOsoby
		raws = append(raws, r)
	}

	spouseMap := map[int64][]map[string]interface{}{}
	mRows, _ := db.Query("SELECT malzonek1_id, malzonek2_id, rok_slubu FROM malzenstwa")
	if mRows != nil {
		defer mRows.Close()
		for mRows.Next() {
			var a, b int64
			var rok *int32
			if mRows.Scan(&a, &b, &rok) == nil {
				ja, oka := dbToJSON[a]
				jb, okb := dbToJSON[b]
				if oka && okb {
					spouseMap[a] = append(spouseMap[a], map[string]interface{}{"spouseId": jb, "spouse_json_id": jb, "year": rok})
					spouseMap[b] = append(spouseMap[b], map[string]interface{}{"spouseId": ja, "spouse_json_id": ja, "year": rok})
				}
			}
		}
	}

	out := make([]models.GenealogiaEditorPerson, 0, len(raws))
	for _, r := range raws {
		p := r.p
		if r.fatherDBID != nil {
			if v, ok := dbToJSON[*r.fatherDBID]; ok {
				p.IDOjca = &v
			}
		}
		if r.motherDBID != nil {
			if v, ok := dbToJSON[*r.motherDBID]; ok {
				p.IDMatki = &v
			}
		}
		p.Marriages = spouseMap[r.dbID]
		if len(p.Marriages) > 0 {
			if v, ok := anyToInt64(p.Marriages[0]["spouseId"]); ok {
				p.IDMalzonka = &v
			}
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ZastapGenealogieEditor zapisuje całość genealogii z edytora 1:1.
func ZastapGenealogieEditor(db *sql.DB, people []models.GenealogiaEditorPerson) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM malzenstwa"); err != nil {
		return err
	}
	if _, err := tx.Exec("UPDATE osoby_genealogia SET id_ojca=NULL,id_matki=NULL"); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM osoby_genealogia"); err != nil {
		return err
	}

	ownerByKey := map[string]int64{}
	owRows, err := tx.Query("SELECT id, unikalny_klucz FROM wlasciciele")
	if err != nil {
		return err
	}
	for owRows.Next() {
		var id int64
		var key string
		if owRows.Scan(&id, &key) == nil {
			ownerByKey[key] = id
		}
	}
	owRows.Close()

	jsonToDB := map[int64]int64{}
	insert, err := tx.Prepare(`INSERT INTO osoby_genealogia (json_id,imie_nazwisko,plec,numer_domu,rok_urodzenia,rok_smierci,id_protokolu,uwagi) VALUES (?,?,?,?,?,?,?,?)`)
	if err != nil {
		return err
	}
	defer insert.Close()
	for _, p := range people {
		if p.IDOsoby == 0 {
			return fmt.Errorf("brak ID osoby dla %s %s", p.Imie, p.Nazwisko)
		}
		fullName := strings.TrimSpace(strings.TrimSpace(p.Imie) + " " + strings.TrimSpace(p.Nazwisko))
		if fullName == "" {
			continue
		}
		var protoID *int64
		if p.ProtokolKlucz != "" {
			if id, ok := ownerByKey[p.ProtokolKlucz]; ok {
				protoID = &id
			}
		}
		plec := p.Plec
		if plec == "" {
			plec = "M"
		}
		res, err := insert.Exec(p.IDOsoby, fullName, strOrNil(plec), strOrNil(p.NumerDomu), p.RokUrodzenia, p.RokSmierci, protoID, strOrNil(p.Uwagi))
		if err != nil {
			return err
		}
		dbID, _ := res.LastInsertId()
		jsonToDB[p.IDOsoby] = dbID
	}

	for _, p := range people {
		dbID, ok := jsonToDB[p.IDOsoby]
		if !ok {
			continue
		}
		var fatherDB, motherDB *int64
		if p.IDOjca != nil {
			if id, ok := jsonToDB[*p.IDOjca]; ok {
				fatherDB = &id
			}
		}
		if p.IDMatki != nil {
			if id, ok := jsonToDB[*p.IDMatki]; ok {
				motherDB = &id
			}
		}
		if _, err := tx.Exec("UPDATE osoby_genealogia SET id_ojca=?, id_matki=? WHERE id=?", fatherDB, motherDB, dbID); err != nil {
			return err
		}
	}

	seen := map[string]bool{}
	for _, p := range people {
		a, ok := jsonToDB[p.IDOsoby]
		if !ok {
			continue
		}
		for _, m := range p.Marriages {
			spouseJSON, ok := anyToInt64(m["spouse_json_id"])
			if !ok {
				spouseJSON, ok = anyToInt64(m["spouseId"])
			}
			if !ok || spouseJSON == p.IDOsoby {
				continue
			}
			b, ok := jsonToDB[spouseJSON]
			if !ok {
				continue
			}
			x, y := a, b
			if x > y {
				x, y = y, x
			}
			key := fmt.Sprintf("%d:%d", x, y)
			if seen[key] {
				continue
			}
			seen[key] = true
			if _, err := tx.Exec("INSERT INTO malzenstwa (malzonek1_id,malzonek2_id) VALUES (?,?)", x, y); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func strOrNil(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}

func anyToInt64(v interface{}) (int64, bool) {
	switch x := v.(type) {
	case int64:
		return x, true
	case int:
		return int64(x), true
	case int32:
		return int64(x), true
	case float64:
		return int64(x), true
	case string:
		i, err := strconv.ParseInt(x, 10, 64)
		return i, err == nil
	default:
		return 0, false
	}
}
