package db

import (
	"database/sql"
	"fmt"
	"log"
)

// Migracje dodatkowe wykonywane po FullSchema. Są idempotentne — sprawdzają
// czy tabela/kolumna istnieje zanim ją dodadzą. To pozwala rozszerzać
// istniejące bazy (stary schemat) bez ich ręcznej przebudowy.
//
// v1 (2026-06): punktów historycznych — dwie nowe tabele obok obiekty_geograficzne:
//   - historical_points_metadata: metadane (display_name, description, source_note)
//                                  powiązane z obiektem specjalnym po object_name.
//   - point_photos: galeria zdjęć (filename, caption, position) dla obiektu.
//                  Zdjęcia fizycznie w data/point_photos/<plik>.
//                Wzorzec z "Projekt Mapa Czarna" — osobna warstwa na mapie
//                z popupem display_name + description + galeria + source_note.
func migrateExtra(db *sql.DB) error {
	if err := ensureTable(db, `historical_points_metadata`, `(
			object_name  TEXT PRIMARY KEY,
			display_name TEXT,
			description  TEXT,
			source_note  TEXT
		)`); err != nil {
		return fmt.Errorf("migracja historical_points_metadata: %w", err)
	}
	if err := ensureTable(db, `point_photos`, `(
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			object_name TEXT NOT NULL,
			filename    TEXT NOT NULL,
			caption     TEXT,
			position    INTEGER NOT NULL DEFAULT 0,
			created_at  TEXT NOT NULL DEFAULT (datetime('now'))
		)`); err != nil {
		return fmt.Errorf("migracja point_photos: %w", err)
	}
	// Indeks na object_name przyspiesza JOIN-y i kasowanie kaskadowe.
	if err := ensureIndex(db, `idx_point_photos_object_name`, `point_photos`, `object_name`); err != nil {
		return fmt.Errorf("migracja idx_point_photos_object_name: %w", err)
	}
	return nil
}

// ensureTable tworzy tabelę jeśli jeszcze nie istnieje. W SQLite CREATE TABLE
// IF NOT EXISTS jest wspierane — używamy go zamiast wzorca z PRAGMA table_info.
func ensureTable(db *sql.DB, name, ddl string) error {
	stmt := fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s %s`, name, ddl)
	if _, err := db.Exec(stmt); err != nil {
		return err
	}
	log.Printf("[DB] Migracja: zapewniono tabelę %s", name)
	return nil
}

// ensureIndex tworzy indeks jeśli jeszcze nie istnieje.
func ensureIndex(db *sql.DB, idxName, table, columns string) error {
	stmt := fmt.Sprintf(`CREATE INDEX IF NOT EXISTS %s ON %s(%s)`, idxName, table, columns)
	if _, err := db.Exec(stmt); err != nil {
		return err
	}
	return nil
}

// ensureColumn dodaje kolumnę do tabeli jeśli jeszcze nie istnieje.
// Używa PRAGMA table_info żeby sprawdzić, a nie kruczków z IF NOT EXISTS
// (którego SQLite historycznie nie wspiera w ALTER TABLE ADD COLUMN).
func ensureColumn(db *sql.DB, table, column, colDef string) error {
	rows, err := db.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, table))
	if err != nil {
		return fmt.Errorf("table_info %s: %w", table, err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		if name == column {
			return nil // już jest
		}
	}
	stmt := fmt.Sprintf(`ALTER TABLE %s ADD COLUMN %s %s`, table, column, colDef)
	if _, err := db.Exec(stmt); err != nil {
		return fmt.Errorf("ADD COLUMN %s.%s: %w", table, column, err)
	}
	log.Printf("[DB] Migracja: dodano %s.%s", table, column)
	return nil
}
