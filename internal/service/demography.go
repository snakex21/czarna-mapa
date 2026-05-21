package service

import (
	"czarna-mapa/internal/models"
	"database/sql"
)

// PobierzWszystkieDemografie zwraca wszystkie rekordy demografii.
func PobierzWszystkieDemografie(db *sql.DB) ([]models.Demografia, error) {
	rows, err := db.Query(
		"SELECT id, rok, populacja_ogolem, katolicy, zydzi, inni, opis FROM demografia ORDER BY rok",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.Demografia
	for rows.Next() {
		var d models.Demografia
		if err := rows.Scan(&d.ID, &d.Rok, &d.PopulacjaOgolem, &d.Katolicy, &d.Zydzi, &d.Inni, &d.Opis); err != nil {
			return nil, err
		}
		result = append(result, d)
	}
	return result, rows.Err()
}

// ZastapWszystkieDemografie zapisuje całą tabelę demografii naraz (jak stary edytor JSON).
func ZastapWszystkieDemografie(db *sql.DB, rows []models.Demografia) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM demografia"); err != nil {
		return err
	}

	stmt, err := tx.Prepare(`INSERT INTO demografia (rok,populacja_ogolem,katolicy,zydzi,inni,opis) VALUES (?,?,?,?,?,?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, r := range rows {
		if r.Rok == 0 {
			continue
		}
		if _, err := stmt.Exec(r.Rok, r.PopulacjaOgolem, r.Katolicy, r.Zydzi, r.Inni, r.Opis); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// DemografiaTable zwraca demografię jako []map[string]interface{} (dla stats).
func DemografiaTable(db *sql.DB) []map[string]interface{} {
	rows, err := db.Query(
		"SELECT rok, populacja_ogolem, katolicy, zydzi, inni, opis FROM demografia ORDER BY rok",
	)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var rok int32
		var pop, kat, zyd, inni *int32
		var opis *string
		if err := rows.Scan(&rok, &pop, &kat, &zyd, &inni, &opis); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"rok":              rok,
			"populacja_ogolem": pop,
			"katolicy":         kat,
			"zydzi":            zyd,
			"inni":             inni,
			"opis":             opis,
		})
	}
	return result
}

// DynamicDemography oblicza populację rok po roku na podstawie dat urodzeń/śmierci.
func DynamicDemography(db *sql.DB) []map[string]interface{} {
	rows, err := db.Query("SELECT rok_urodzenia, rok_smierci FROM osoby_genealogia")
	if err != nil {
		return nil
	}
	defer rows.Close()

	type record struct{ birth, death *int32 }
	var data []record
	for rows.Next() {
		var r record
		rows.Scan(&r.birth, &r.death)
		data = append(data, r)
	}

	if len(data) == 0 {
		return nil
	}

	minY := int32(9999)
	maxY := int32(0)
	for _, r := range data {
		if r.birth != nil && *r.birth < minY {
			minY = *r.birth
		}
		if r.birth != nil && *r.birth > maxY {
			maxY = *r.birth
		}
		if r.death != nil && *r.death > maxY {
			maxY = *r.death
		}
	}

	var result []map[string]interface{}
	for year := minY; year <= maxY; year++ {
		pop := int32(0)
		for _, r := range data {
			if r.birth != nil && *r.birth <= year {
				if r.death != nil && *r.death >= year {
					pop++
				} else if r.death == nil && year-*r.birth <= 95 {
					pop++
				}
			}
		}
		if pop > 0 {
			result = append(result, map[string]interface{}{
				"rok": year, "populacja_ogolem": pop,
				"katolicy": 0, "zydzi": 0, "inni": 0, "opis": nil,
			})
		}
	}
	return result
}
