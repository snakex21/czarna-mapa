use crate::db::Database;
use crate::error::Result;
use crate::models::Demografia;

/// Pobiera wszystkie dane demograficzne
pub fn pobierz_wszystkie(db: &Database) -> Result<Vec<Demografia>> {
    let mut stmt = db.conn.prepare(
        "SELECT id, rok, populacja_ogolem, katolicy, zydzi, inni, opis
         FROM demografia ORDER BY rok"
    )?;

    let result = stmt.query_map([], |row| {
        Ok(Demografia {
            id: row.get(0)?,
            rok: row.get(1)?,
            populacja_ogolem: row.get(2)?,
            katolicy: row.get(3)?,
            zydzi: row.get(4)?,
            inni: row.get(5)?,
            opis: row.get(6)?,
        })
    })?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(result)
}
