/// Pełny schemat bazy danych SQLite
/// Odpowiednik PostgreSQL + PostGIS → SQLite (geometria jako GeoJSON TEXT)
pub const FULL_SCHEMA: &str = r#"
-- =============================================================================
-- KONFIGURACJA SYSTEMU
-- =============================================================================
CREATE TABLE IF NOT EXISTS konfiguracja_systemu (
    klucz       TEXT PRIMARY KEY,
    wartosc     TEXT NOT NULL,       -- JSONB → TEXT (JSON)
    opis        TEXT
);

-- =============================================================================
-- OBIEKTY GEOGRAFICZNE (działki, drogi, budynki)
-- Geometria przechowywana jako GeoJSON TEXT
-- Bounding box: min_lat, min_lng, max_lat, max_lng dla szybkich zapytań
-- =============================================================================
CREATE TABLE IF NOT EXISTS obiekty_geograficzne (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    nazwa_lub_numer     TEXT NOT NULL,
    kategoria           TEXT NOT NULL,
    geometria_geojson   TEXT,              -- GeoJSON geometrii
    bbox_min_lat        REAL,
    bbox_min_lng        REAL,
    bbox_max_lat        REAL,
    bbox_max_lng        REAL,
    UNIQUE (nazwa_lub_numer, kategoria)
);

CREATE INDEX IF NOT EXISTS idx_obiekty_bbox
    ON obiekty_geograficzne(bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng);

CREATE INDEX IF NOT EXISTS idx_obiekty_kategoria
    ON obiekty_geograficzne(kategoria);

-- =============================================================================
-- WŁAŚCICIELE (protokoły katastralne)
-- =============================================================================
CREATE TABLE IF NOT EXISTS wlasciciele (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    unikalny_klucz          TEXT NOT NULL UNIQUE,
    nazwa_wlasciciela       TEXT NOT NULL,
    numer_protokolu         INTEGER,
    numer_domu              TEXT,
    data_protokolu          TEXT,              -- DATE → TEXT
    miejsce_protokolu       TEXT,
    genealogia              TEXT,
    historia_wlasnosci      TEXT,
    uwagi                   TEXT,
    wspolwlasnosc           TEXT,
    powiazania_i_transakcje TEXT,
    interpretacja_i_wnioski TEXT
);

CREATE INDEX IF NOT EXISTS idx_wlasciciele_nazwa ON wlasciciele(nazwa_wlasciciela);

-- =============================================================================
-- OSOBY GENEALOGIA
-- =============================================================================
CREATE TABLE IF NOT EXISTS osoby_genealogia (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    json_id         INTEGER UNIQUE NOT NULL,
    imie_nazwisko   TEXT NOT NULL,
    plec            TEXT,                      -- VARCHAR(1) → TEXT
    numer_domu      TEXT,
    rok_urodzenia   INTEGER,
    rok_smierci     INTEGER,
    id_ojca         INTEGER REFERENCES osoby_genealogia(id) ON DELETE SET NULL,
    id_matki        INTEGER REFERENCES osoby_genealogia(id) ON DELETE SET NULL,
    id_protokolu    INTEGER REFERENCES wlasciciele(id) ON DELETE SET NULL,
    uwagi           TEXT
);

CREATE INDEX IF NOT EXISTS idx_osoby_protokol ON osoby_genealogia(id_protokolu);
CREATE INDEX IF NOT EXISTS idx_osoby_ojciec ON osoby_genealogia(id_ojca);
CREATE INDEX IF NOT EXISTS idx_osoby_matka ON osoby_genealogia(id_matki);

-- =============================================================================
-- MAŁŻEŃSTWA
-- =============================================================================
CREATE TABLE IF NOT EXISTS malzenstwa (
    malzonek1_id    INTEGER NOT NULL REFERENCES osoby_genealogia(id) ON DELETE CASCADE,
    malzonek2_id    INTEGER NOT NULL REFERENCES osoby_genealogia(id) ON DELETE CASCADE,
    rok_slubu       INTEGER,
    miesiac_slubu   INTEGER,
    dzien_slubu     INTEGER,
    data_slubu      TEXT,
    PRIMARY KEY (malzonek1_id, malzonek2_id),
    CHECK (malzonek1_id <> malzonek2_id)
);

-- =============================================================================
-- DZIAŁKI ↔ WŁAŚCICIELE (relacja N:M)
-- =============================================================================
CREATE TABLE IF NOT EXISTS dzialki_wlasciciele (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    wlasciciel_id   INTEGER NOT NULL REFERENCES wlasciciele(id) ON DELETE CASCADE,
    obiekt_id       INTEGER NOT NULL REFERENCES obiekty_geograficzne(id) ON DELETE CASCADE,
    typ_posiadania  TEXT,
    opis_udzialu    TEXT,
    UNIQUE (wlasciciel_id, obiekt_id, typ_posiadania)
);

CREATE INDEX IF NOT EXISTS idx_dzialki_wlasciciel ON dzialki_wlasciciele(wlasciciel_id);
CREATE INDEX IF NOT EXISTS idx_dzialki_obiekt ON dzialki_wlasciciele(obiekt_id);

-- =============================================================================
-- DEMOGRAFIA
-- =============================================================================
CREATE TABLE IF NOT EXISTS demografia (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    rok             INTEGER NOT NULL UNIQUE,
    populacja_ogolem INTEGER,
    katolicy        INTEGER,
    zydzi           INTEGER,
    inni            INTEGER,
    opis            TEXT
);

-- =============================================================================
-- POWIĄZANIA MIĘDZY PROTOKOŁAMI
-- =============================================================================
CREATE TABLE IF NOT EXISTS powiazania_protokolow (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    wlasciciel_id_1 INTEGER NOT NULL REFERENCES wlasciciele(id) ON DELETE CASCADE,
    wlasciciel_id_2 INTEGER NOT NULL REFERENCES wlasciciele(id) ON DELETE CASCADE,
    typ_relacji     TEXT,
    opis_relacji    TEXT
);

-- =============================================================================
-- DOMYŚLNA KONFIGURACJA MAPY (INSERT IF NOT EXISTS)
-- =============================================================================
INSERT OR IGNORE INTO konfiguracja_systemu (klucz, wartosc, opis) VALUES
('map_calibration', '{"sw":{"lat":50.0414,"lng":21.2261},"ne":{"lat":50.0814,"lng":21.2661}}',
 'Współrzędne kalibracji mapy historycznej'),
('map_defaults', '{"center":{"lat":50.0614,"lng":21.2461},"zoom":14}',
 'Domyślny widok startowy mapy');
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_schema_is_valid_sql() {
        // Ensure the schema can be executed without syntax errors
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(FULL_SCHEMA).expect("Schema should execute successfully");
    }
}
