use crate::db::Database;
use crate::error::Result;

/// Pobiera wartość konfiguracji
pub fn pobierz(db: &Database, klucz: &str) -> Result<Option<String>> {
    let mut stmt = db.conn.prepare(
        "SELECT wartosc FROM konfiguracja_systemu WHERE klucz = ?1"
    )?;

    let mut rows = stmt.query_map(rusqlite::params![klucz], |row| row.get::<_, String>(0))?;

    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// Ustawia wartość konfiguracji
pub fn ustaw(db: &Database, klucz: &str, wartosc: &str, opis: Option<&str>) -> Result<()> {
    db.conn.execute(
        "INSERT INTO konfiguracja_systemu (klucz, wartosc, opis)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(klucz) DO UPDATE SET wartosc = excluded.wartosc, opis = excluded.opis",
        rusqlite::params![klucz, wartosc, opis],
    )?;
    Ok(())
}

/// Pobiera kalibrację mapy (współrzędne SW/NE)
pub fn pobierz_kalibracje_mapy(db: &Database) -> Result<serde_json::Value> {
    let wartosc = pobierz(db, "map_calibration")?
        .unwrap_or_else(|| r#"{"sw":{"lat":50.0414,"lng":21.2261},"ne":{"lat":50.0814,"lng":21.2661}}"#.into());
    Ok(serde_json::from_str(&wartosc)?)
}
