package service

import (
	"czarna-mapa/internal/models"
	"database/sql"
)

// PobierzWszystkich wlascicieli
func PobierzWszystkich(db *sql.DB) ([]models.Wlasciciel, error) {
	rows, err := db.Query(
		`SELECT id, unikalny_klucz, nazwa_wlasciciela, numer_protokolu, numer_domu,
		        data_protokolu, miejsce_protokolu, genealogia, historia_wlasnosci,
		        uwagi, wspolwlasnosc, powiazania_i_transakcje, interpretacja_i_wnioski
		 FROM wlasciciele ORDER BY nazwa_wlasciciela`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.Wlasciciel
	for rows.Next() {
		var w models.Wlasciciel
		if err := rows.Scan(&w.ID, &w.UnikalnyKlucz, &w.NazwaWlasciciela, &w.NumerProtokolu,
			&w.NumerDomu, &w.DataProtokolu, &w.MiejsceProtokolu, &w.Genealogia,
			&w.HistoriaWlasnosci, &w.Uwagi, &w.Wspolwlasnosc,
			&w.PowiazaniaITransakcje, &w.InterpretacjaIWnioski); err != nil {
			return nil, err
		}
		result = append(result, w)
	}
	return result, rows.Err()
}

// PobierzPoID zwraca właściciela po ID.
func PobierzPoID(db *sql.DB, id int64) (*models.Wlasciciel, error) {
	var w models.Wlasciciel
	err := db.QueryRow(
		`SELECT id, unikalny_klucz, nazwa_wlasciciela, numer_protokolu, numer_domu,
		        data_protokolu, miejsce_protokolu, genealogia, historia_wlasnosci,
		        uwagi, wspolwlasnosc, powiazania_i_transakcje, interpretacja_i_wnioski
		 FROM wlasciciele WHERE id = ?`, id,
	).Scan(&w.ID, &w.UnikalnyKlucz, &w.NazwaWlasciciela, &w.NumerProtokolu,
		&w.NumerDomu, &w.DataProtokolu, &w.MiejsceProtokolu, &w.Genealogia,
		&w.HistoriaWlasnosci, &w.Uwagi, &w.Wspolwlasnosc,
		&w.PowiazaniaITransakcje, &w.InterpretacjaIWnioski)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &w, nil
}

// SzukajPoNazwie szuka właścicieli po fragmencie nazwy.
func SzukajPoNazwie(db *sql.DB, query string) ([]models.Wlasciciel, error) {
	rows, err := db.Query(
		`SELECT id, unikalny_klucz, nazwa_wlasciciela, numer_protokolu, numer_domu,
		        data_protokolu, miejsce_protokolu, genealogia, historia_wlasnosci,
		        uwagi, wspolwlasnosc, powiazania_i_transakcje, interpretacja_i_wnioski
		 FROM wlasciciele WHERE nazwa_wlasciciela LIKE ? LIMIT 50`,
		"%"+query+"%",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.Wlasciciel
	for rows.Next() {
		var w models.Wlasciciel
		if err := rows.Scan(&w.ID, &w.UnikalnyKlucz, &w.NazwaWlasciciela, &w.NumerProtokolu,
			&w.NumerDomu, &w.DataProtokolu, &w.MiejsceProtokolu, &w.Genealogia,
			&w.HistoriaWlasnosci, &w.Uwagi, &w.Wspolwlasnosc,
			&w.PowiazaniaITransakcje, &w.InterpretacjaIWnioski); err != nil {
			return nil, err
		}
		result = append(result, w)
	}
	return result, rows.Err()
}

// Dodaj właściciela — zwraca ID.
func DodajWlasciciela(db *sql.DB, w *models.Wlasciciel) (int64, error) {
	res, err := db.Exec(
		`INSERT INTO wlasciciele (unikalny_klucz, nazwa_wlasciciela, numer_protokolu, numer_domu,
		                          genealogia, historia_wlasnosci, uwagi, wspolwlasnosc,
		                          powiazania_i_transakcje, interpretacja_i_wnioski,
		                          data_protokolu, miejsce_protokolu)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		w.UnikalnyKlucz, w.NazwaWlasciciela, w.NumerProtokolu, w.NumerDomu,
		w.Genealogia, w.HistoriaWlasnosci, w.Uwagi, w.Wspolwlasnosc,
		w.PowiazaniaITransakcje, w.InterpretacjaIWnioski,
		w.DataProtokolu, w.MiejsceProtokolu,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// Aktualizuj właściciela.
func AktualizujWlasciciela(db *sql.DB, w *models.Wlasciciel) error {
	_, err := db.Exec(
		`UPDATE wlasciciele SET unikalny_klucz = ?, nazwa_wlasciciela = ?, numer_protokolu = ?,
		                        numer_domu = ?, genealogia = ?, historia_wlasnosci = ?,
		                        uwagi = ?, wspolwlasnosc = ?, powiazania_i_transakcje = ?,
		                        interpretacja_i_wnioski = ?, data_protokolu = ?, miejsce_protokolu = ?
		 WHERE id = ?`,
		w.UnikalnyKlucz, w.NazwaWlasciciela, w.NumerProtokolu, w.NumerDomu,
		w.Genealogia, w.HistoriaWlasnosci, w.Uwagi, w.Wspolwlasnosc,
		w.PowiazaniaITransakcje, w.InterpretacjaIWnioski,
		w.DataProtokolu, w.MiejsceProtokolu, w.ID,
	)
	return err
}

// Usun właściciela.
func UsunWlasciciela(db *sql.DB, id int64) error {
	_, err := db.Exec("DELETE FROM wlasciciele WHERE id = ?", id)
	return err
}

// PobierzWszystkieObiektyAdmin zwraca listę obiektów dla admina.
func PobierzWszystkieObiektyAdmin(db *sql.DB) ([]map[string]interface{}, error) {
	rows, err := db.Query(
		"SELECT id, nazwa_lub_numer, kategoria FROM obiekty_geograficzne ORDER BY nazwa_lub_numer, id",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var id int64
		var nazwa, kategoria string
		if err := rows.Scan(&id, &nazwa, &kategoria); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"id":              id,
			"nazwa_lub_numer": nazwa,
			"kategoria":       kategoria,
		})
	}
	return result, nil
}
