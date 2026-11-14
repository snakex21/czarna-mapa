package db

import (
	"path/filepath"
	"testing"
)

func TestOpenCreatesSchemaAndIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "test.db")
	for i := 0; i < 2; i++ { // drugie otwarcie = migracje na istniejącej bazie
		d, err := Open(path)
		if err != nil {
			t.Fatalf("Open #%d: %v", i, err)
		}
		for _, table := range []string{
			"konfiguracja_systemu", "obiekty_geograficzne", "wlasciciele", "osoby_genealogia",
			"malzenstwa", "dzialki_wlasciciele", "demografia", "powiazania_protokolow",
			"historical_points_metadata", "point_photos",
		} {
			var name string
			if err := d.QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&name); err != nil {
				t.Errorf("brak tabeli %s: %v", table, err)
			}
		}
		var mode string
		if err := d.QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil || mode != "wal" {
			t.Errorf("journal_mode=%q err=%v, oczekiwano wal", mode, err)
		}
		var fk int
		if err := d.QueryRow("PRAGMA foreign_keys").Scan(&fk); err != nil || fk != 1 {
			t.Errorf("foreign_keys=%d err=%v", fk, err)
		}
		_ = d.Close()
	}
}

func TestOwnerUniqueKeyConstraint(t *testing.T) {
	d, err := Open(filepath.Join(t.TempDir(), "u.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if _, err := d.Exec(`INSERT INTO wlasciciele (unikalny_klucz, nazwa_wlasciciela) VALUES ('k1','Jan')`); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`INSERT INTO wlasciciele (unikalny_klucz, nazwa_wlasciciela) VALUES ('k1','Inny')`); err == nil {
		t.Fatal("duplikat unikalny_klucz został przyjęty")
	}
}
