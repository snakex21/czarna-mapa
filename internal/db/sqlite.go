package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// Open otwiera (lub tworzy) bazę SQLite i wykonuje migracje schematu.
func Open(path string) (*sql.DB, error) {
	// Upewnij się że katalog istnieje
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("nie można utworzyć katalogu bazy: %w", err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("nie można otworzyć bazy: %w", err)
	}

	// Konfiguracja SQLite
	pragmas := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA foreign_keys=ON",
		"PRAGMA busy_timeout=5000",
		"PRAGMA synchronous=NORMAL",
	}
	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			db.Close()
			return nil, fmt.Errorf("PRAGMA %s: %w", p, err)
		}
	}

	// Wykonaj migracje
	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migracja schematu: %w", err)
	}

	return db, nil
}

// migrate wykonuje schemat SQL.
func migrate(db *sql.DB) error {
	_, err := db.Exec(FullSchema)
	if err != nil {
		return fmt.Errorf("błąd wykonania schematu: %w", err)
	}
	// Migracje dodatkowe (ALTER TABLE) wykonywane po pełnym schemacie.
	if err := migrateExtra(db); err != nil {
		return fmt.Errorf("migracje dodatkowe: %w", err)
	}
	return nil
}
