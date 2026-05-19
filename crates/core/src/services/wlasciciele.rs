use crate::db::Database;
use crate::error::Result;
use crate::models::Wlasciciel;

/// Pobiera wszystkich właścicieli
pub fn pobierz_wszystkich(db: &Database) -> Result<Vec<Wlasciciel>> {
    let mut stmt = db.conn.prepare(
        "SELECT id, unikalny_klucz, nazwa_wlasciciela, numer_protokolu, numer_domu,
                data_protokolu, miejsce_protokolu, genealogia, historia_wlasnosci,
                uwagi, wspolwlasnosc, powiazania_i_transakcje, interpretacja_i_wnioski
         FROM wlasciciele ORDER BY nazwa_wlasciciela"
    )?;

    let result = stmt.query_map([], map_wlasciciel)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(result)
}

/// Pobiera właściciela po ID
pub fn pobierz_po_id(db: &Database, id: i64) -> Result<Option<Wlasciciel>> {
    let mut stmt = db.conn.prepare(
        "SELECT id, unikalny_klucz, nazwa_wlasciciela, numer_protokolu, numer_domu,
                data_protokolu, miejsce_protokolu, genealogia, historia_wlasnosci,
                uwagi, wspolwlasnosc, powiazania_i_transakcje, interpretacja_i_wnioski
         FROM wlasciciele WHERE id = ?1"
    )?;

    let mut rows = stmt.query_map(rusqlite::params![id], map_wlasciciel)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// Szuka właścicieli po nazwie
pub fn szukaj_po_nazwie(db: &Database, query: &str) -> Result<Vec<Wlasciciel>> {
    let pattern = format!("%{}%", query);
    let mut stmt = db.conn.prepare(
        "SELECT id, unikalny_klucz, nazwa_wlasciciela, numer_protokolu, numer_domu,
                data_protokolu, miejsce_protokolu, genealogia, historia_wlasnosci,
                uwagi, wspolwlasnosc, powiazania_i_transakcje, interpretacja_i_wnioski
         FROM wlasciciele
         WHERE nazwa_wlasciciela LIKE ?1 OR uwagi LIKE ?1
         ORDER BY nazwa_wlasciciela"
    )?;

    let result = stmt.query_map(rusqlite::params![pattern], map_wlasciciel)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(result)
}

/// Dodaje nowego właściciela
pub fn dodaj(db: &Database, w: &Wlasciciel) -> Result<i64> {
    db.conn.execute(
        "INSERT INTO wlasciciele (unikalny_klucz, nazwa_wlasciciela, numer_protokolu, numer_domu,
                 data_protokolu, miejsce_protokolu, genealogia, historia_wlasnosci,
                 uwagi, wspolwlasnosc, powiazania_i_transakcje, interpretacja_i_wnioski)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![
            w.unikalny_klucz, w.nazwa_wlasciciela, w.numer_protokolu, w.numer_domu,
            w.data_protokolu, w.miejsce_protokolu, w.genealogia, w.historia_wlasnosci,
            w.uwagi, w.wspolwlasnosc, w.powiazania_i_transakcje, w.interpretacja_i_wnioski
        ],
    )?;
    Ok(db.conn.last_insert_rowid())
}

/// Aktualizuje właściciela
pub fn aktualizuj(db: &Database, w: &Wlasciciel) -> Result<()> {
    let id = w.id.ok_or_else(|| crate::error::Error::InvalidData("Brak ID".into()))?;
    db.conn.execute(
        "UPDATE wlasciciele SET
            unikalny_klucz = ?1, nazwa_wlasciciela = ?2, numer_protokolu = ?3, numer_domu = ?4,
            data_protokolu = ?5, miejsce_protokolu = ?6, genealogia = ?7, historia_wlasnosci = ?8,
            uwagi = ?9, wspolwlasnosc = ?10, powiazania_i_transakcje = ?11, interpretacja_i_wnioski = ?12
         WHERE id = ?13",
        rusqlite::params![
            w.unikalny_klucz, w.nazwa_wlasciciela, w.numer_protokolu, w.numer_domu,
            w.data_protokolu, w.miejsce_protokolu, w.genealogia, w.historia_wlasnosci,
            w.uwagi, w.wspolwlasnosc, w.powiazania_i_transakcje, w.interpretacja_i_wnioski,
            id
        ],
    )?;
    Ok(())
}

/// Usuwa właściciela
pub fn usun(db: &Database, id: i64) -> Result<()> {
    db.conn.execute("DELETE FROM wlasciciele WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

fn map_wlasciciel(row: &rusqlite::Row) -> std::result::Result<Wlasciciel, rusqlite::Error> {
    Ok(Wlasciciel {
        id: row.get(0)?,
        unikalny_klucz: row.get(1)?,
        nazwa_wlasciciela: row.get(2)?,
        numer_protokolu: row.get(3)?,
        numer_domu: row.get(4)?,
        data_protokolu: row.get(5)?,
        miejsce_protokolu: row.get(6)?,
        genealogia: row.get(7)?,
        historia_wlasnosci: row.get(8)?,
        uwagi: row.get(9)?,
        wspolwlasnosc: row.get(10)?,
        powiazania_i_transakcje: row.get(11)?,
        interpretacja_i_wnioski: row.get(12)?,
    })
}
