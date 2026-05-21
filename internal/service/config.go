package service

import (
	"database/sql"
)

// PobierzKalibracjeMapy zwraca JSON z kalibracją mapy.
func PobierzKalibracjeMapy(db *sql.DB) (string, error) {
	var wartosc string
	err := db.QueryRow(
		"SELECT wartosc FROM konfiguracja_systemu WHERE klucz = 'map_calibration'",
	).Scan(&wartosc)
	if err != nil {
		if err == sql.ErrNoRows {
			return `{"sw":{"lat":50.0414,"lng":21.2261},"ne":{"lat":50.0814,"lng":21.2661}}`, nil
		}
		return "", err
	}
	return wartosc, nil
}

// PobierzKonfiguracjeMapy zwraca pełną konfigurację mapy.
func PobierzKonfiguracjeMapy(db *sql.DB) (map[string]interface{}, error) {
	calibrationStr, err := PobierzKalibracjeMapy(db)
	if err != nil {
		return nil, err
	}

	defaultsStr := Pobierz(db, "map_defaults")
	if defaultsStr == "" {
		defaultsStr = `{"center":{"lat":50.0614,"lng":21.2461},"zoom":14}`
	}

	return map[string]interface{}{
		"calibration": calibrationStr,
		"defaults":    defaultsStr,
	}, nil
}

// Pobierz zwraca wartość konfiguracji dla danego klucza.
func Pobierz(db *sql.DB, klucz string) string {
	var wartosc string
	err := db.QueryRow(
		"SELECT wartosc FROM konfiguracja_systemu WHERE klucz = ?", klucz,
	).Scan(&wartosc)
	if err != nil {
		return ""
	}
	return wartosc
}

// Ustaw zapisuje wartość konfiguracji.
func Ustaw(db *sql.DB, klucz, wartosc string, opis *string) error {
	_, err := db.Exec(
		`INSERT INTO konfiguracja_systemu (klucz, wartosc, opis) VALUES (?, ?, ?)
		 ON CONFLICT(klucz) DO UPDATE SET wartosc = excluded.wartosc, opis = excluded.opis`,
		klucz, wartosc, opis,
	)
	return err
}
