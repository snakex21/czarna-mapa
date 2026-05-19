use crate::state::AppState;
use czarna_core::models::Wlasciciel;
use czarna_core::services::wlasciciele;

#[tauri::command]
pub fn pobierz_wszystkich_wlascicieli(
    state: tauri::State<AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let wlasciciele = wlasciciele::pobierz_wszystkich(&db).map_err(|e| e.to_string())?;
    
    // Wzbogać o informacje o działkach
    let result: Vec<serde_json::Value> = wlasciciele.into_iter().map(|w| {
        let dzialki = pobierz_dzialki_wlasciciela_internal(&db, w.id);
        serde_json::json!({
            "id": w.id,
            "unikalny_klucz": w.unikalny_klucz,
            "nazwa_wlasciciela": w.nazwa_wlasciciela,
            "numer_protokolu": w.numer_protokolu,
            "numer_domu": w.numer_domu,
            "data_protokolu": w.data_protokolu,
            "miejsce_protokolu": w.miejsce_protokolu,
            "genealogia": w.genealogia,
            "historia_wlasnosci": w.historia_wlasnosci,
            "uwagi": w.uwagi,
            "wspolwlasnosc": w.wspolwlasnosc,
            "powiazania_i_transakcje": w.powiazania_i_transakcje,
            "interpretacja_i_wnioski": w.interpretacja_i_wnioski,
            "dzialki_rzeczywiste": dzialki,
            "dzialki_protokol": dzialki,
        })
    }).collect();
    
    Ok(result)
}

/// Wewnętrzna funkcja pomocnicza do pobierania działek właściciela
fn pobierz_dzialki_wlasciciela_internal(db: &czarna_core::Database, wlasciciel_id: Option<i64>) -> Vec<serde_json::Value> {
    if let Some(wid) = wlasciciel_id {
        if let Ok(mut stmt) = db.conn.prepare(
            "SELECT o.id, o.nazwa_lub_numer, o.kategoria
             FROM dzialki_wlasciciele dw
             JOIN obiekty_geograficzne o ON o.id = dw.obiekt_id
             WHERE dw.wlasciciel_id = ?1"
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![wid], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "numer": row.get::<_, String>(1)?,
                    "kategoria": row.get::<_, String>(2)?,
                }))
            }) {
                return rows.filter_map(|r| r.ok()).collect();
            }
        }
    }
    vec![]
}

#[tauri::command]
pub fn pobierz_wlasciciela(
    state: tauri::State<AppState>,
    id: Option<i64>,
    klucz: Option<String>,
) -> Result<Option<serde_json::Value>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    
    let w = if let Some(k) = klucz {
        // Szukaj po unikalny_klucz
        let mut stmt = db.conn.prepare(
            "SELECT id FROM wlasciciele WHERE unikalny_klucz = ?1"
        ).map_err(|e| e.to_string())?;
        let found_id: Option<i64> = stmt.query_row(rusqlite::params![k], |row| row.get(0)).ok();
        match found_id {
            Some(fid) => wlasciciele::pobierz_po_id(&db, fid).map_err(|e| e.to_string())?,
            None => None,
        }
    } else if let Some(i) = id {
        wlasciciele::pobierz_po_id(&db, i).map_err(|e| e.to_string())?
    } else {
        return Ok(None);
    };

    match w {
        Some(w) => {
            let dzialki = pobierz_dzialki_wlasciciela_internal(&db, w.id);
            Ok(Some(serde_json::json!({
                "id": w.id,
                "unikalny_klucz": w.unikalny_klucz,
                "nazwa_wlasciciela": w.nazwa_wlasciciela,
                "numer_protokolu": w.numer_protokolu,
                "numer_domu": w.numer_domu,
                "data_protokolu": w.data_protokolu,
                "miejsce_protokolu": w.miejsce_protokolu,
                "genealogia": w.genealogia,
                "historia_wlasnosci": w.historia_wlasnosci,
                "uwagi": w.uwagi,
                "wspolwlasnosc": w.wspolwlasnosc,
                "powiazania_i_transakcje": w.powiazania_i_transakcje,
                "interpretacja_i_wnioski": w.interpretacja_i_wnioski,
                "dzialki_rzeczywiste": dzialki,
                "dzialki_protokol": dzialki,
            })))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn szukaj_wlascicieli(
    state: tauri::State<AppState>,
    query: String,
) -> Result<Vec<Wlasciciel>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    wlasciciele::szukaj_po_nazwie(&db, &query).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dodaj_wlasciciela(
    state: tauri::State<AppState>,
    wlasciciel: Wlasciciel,
) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    wlasciciele::dodaj(&db, &wlasciciel).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn aktualizuj_wlasciciela(
    state: tauri::State<AppState>,
    wlasciciel: Wlasciciel,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    wlasciciele::aktualizuj(&db, &wlasciciel).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn usun_wlasciciela(
    state: tauri::State<AppState>,
    id: i64,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    wlasciciele::usun(&db, id).map_err(|e| e.to_string())
}
