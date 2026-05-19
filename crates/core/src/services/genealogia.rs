use crate::db::Database;
use crate::error::Result;
use crate::models::{OsobaGenealogia, Malzenstwo};
use serde::Serialize;

/// Pełne drzewo genealogiczne (osoby + małżeństwa)
#[derive(Debug, Serialize)]
pub struct DrzewoGenealogiczne {
    pub osoby: Vec<OsobaGenealogia>,
    pub malzenstwa: Vec<Malzenstwo>,
}

/// Pobiera pełne drzewo genealogiczne
pub fn pobierz_drzewo(db: &Database) -> Result<DrzewoGenealogiczne> {
    let osoby = pobierz_wszystkie_osoby(db)?;
    let malzenstwa = pobierz_wszystkie_malzenstwa(db)?;

    Ok(DrzewoGenealogiczne { osoby, malzenstwa })
}

/// Pobiera wszystkie osoby
pub fn pobierz_wszystkie_osoby(db: &Database) -> Result<Vec<OsobaGenealogia>> {
    let mut stmt = db.conn.prepare(
        "SELECT id, json_id, imie_nazwisko, plec, numer_domu,
                rok_urodzenia, rok_smierci, id_ojca, id_matki, id_protokolu, uwagi
         FROM osoby_genealogia ORDER BY imie_nazwisko"
    )?;

    let result = stmt.query_map([], map_osoba)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(result)
}

/// Pobiera osobę po ID
pub fn pobierz_osobe_po_id(db: &Database, id: i64) -> Result<Option<OsobaGenealogia>> {
    let mut stmt = db.conn.prepare(
        "SELECT id, json_id, imie_nazwisko, plec, numer_domu,
                rok_urodzenia, rok_smierci, id_ojca, id_matki, id_protokolu, uwagi
         FROM osoby_genealogia WHERE id = ?1"
    )?;

    let mut rows = stmt.query_map(rusqlite::params![id], map_osoba)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// Pobiera wszystkie małżeństwa
pub fn pobierz_wszystkie_malzenstwa(db: &Database) -> Result<Vec<Malzenstwo>> {
    let mut stmt = db.conn.prepare(
        "SELECT malzonek1_id, malzonek2_id, rok_slubu, miesiac_slubu, dzien_slubu, data_slubu
         FROM malzenstwa"
    )?;

    let result = stmt.query_map([], |row| {
        Ok(Malzenstwo {
            malzonek1_id: row.get(0)?,
            malzonek2_id: row.get(1)?,
            rok_slubu: row.get(2)?,
            miesiac_slubu: row.get(3)?,
            dzien_slubu: row.get(4)?,
            data_slubu: row.get(5)?,
        })
    })?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(result)
}

/// Pobiera osoby powiązane z danym właścicielem
pub fn pobierz_osoby_wlasciciela(db: &Database, wlasciciel_id: i64) -> Result<Vec<OsobaGenealogia>> {
    let mut stmt = db.conn.prepare(
        "SELECT id, json_id, imie_nazwisko, plec, numer_domu,
                rok_urodzenia, rok_smierci, id_ojca, id_matki, id_protokolu, uwagi
         FROM osoby_genealogia WHERE id_protokolu = ?1 ORDER BY imie_nazwisko"
    )?;

    let result = stmt.query_map(rusqlite::params![wlasciciel_id], map_osoba)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(result)
}

/// Dodaje osobę
pub fn dodaj_osobe(db: &Database, o: &OsobaGenealogia) -> Result<i64> {
    db.conn.execute(
        "INSERT INTO osoby_genealogia (json_id, imie_nazwisko, plec, numer_domu,
                 rok_urodzenia, rok_smierci, id_ojca, id_matki, id_protokolu, uwagi)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            o.json_id, o.imie_nazwisko, o.plec, o.numer_domu,
            o.rok_urodzenia, o.rok_smierci, o.id_ojca, o.id_matki, o.id_protokolu, o.uwagi
        ],
    )?;
    Ok(db.conn.last_insert_rowid())
}

/// Aktualizuje osobę
pub fn aktualizuj_osobe(db: &Database, o: &OsobaGenealogia) -> Result<()> {
    let id = o.id.ok_or_else(|| crate::error::Error::InvalidData("Brak ID".into()))?;
    db.conn.execute(
        "UPDATE osoby_genealogia SET
            json_id = ?1, imie_nazwisko = ?2, plec = ?3, numer_domu = ?4,
            rok_urodzenia = ?5, rok_smierci = ?6, id_ojca = ?7, id_matki = ?8,
            id_protokolu = ?9, uwagi = ?10
         WHERE id = ?11",
        rusqlite::params![
            o.json_id, o.imie_nazwisko, o.plec, o.numer_domu,
            o.rok_urodzenia, o.rok_smierci, o.id_ojca, o.id_matki,
            o.id_protokolu, o.uwagi, id
        ],
    )?;
    Ok(())
}

/// Usuwa osobę
pub fn usun_osobe(db: &Database, id: i64) -> Result<()> {
    db.conn.execute("DELETE FROM osoby_genealogia WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

/// Dodaje małżeństwo
pub fn dodaj_malzenstwo(db: &Database, m: &Malzenstwo) -> Result<()> {
    db.conn.execute(
        "INSERT INTO malzenstwa (malzonek1_id, malzonek2_id, rok_slubu, miesiac_slubu, dzien_slubu, data_slubu)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            m.malzonek1_id, m.malzonek2_id, m.rok_slubu, m.miesiac_slubu, m.dzien_slubu, m.data_slubu
        ],
    )?;
    Ok(())
}

/// Usuwa małżeństwo
pub fn usun_malzenstwo(db: &Database, m1_id: i64, m2_id: i64) -> Result<()> {
    db.conn.execute(
        "DELETE FROM malzenstwa WHERE malzonek1_id = ?1 AND malzonek2_id = ?2",
        rusqlite::params![m1_id, m2_id],
    )?;
    Ok(())
}

fn map_osoba(row: &rusqlite::Row) -> std::result::Result<OsobaGenealogia, rusqlite::Error> {
    Ok(OsobaGenealogia {
        id: row.get(0)?,
        json_id: row.get(1)?,
        imie_nazwisko: row.get(2)?,
        plec: row.get(3)?,
        numer_domu: row.get(4)?,
        rok_urodzenia: row.get(5)?,
        rok_smierci: row.get(6)?,
        id_ojca: row.get(7)?,
        id_matki: row.get(8)?,
        id_protokolu: row.get(9)?,
        uwagi: row.get(10)?,
    })
}
