use crate::state::AppState;
use czarna_core::models::OsobaGenealogia;
use czarna_core::services::genealogia::{self, DrzewoGenealogiczne};

#[tauri::command]
pub fn pobierz_drzewo_genealogiczne(
    state: tauri::State<AppState>,
) -> Result<DrzewoGenealogiczne, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    genealogia::pobierz_drzewo(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pobierz_osoby_wlasciciela(
    state: tauri::State<AppState>,
    wlasciciel_id: i64,
) -> Result<Vec<OsobaGenealogia>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    genealogia::pobierz_osoby_wlasciciela(&db, wlasciciel_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dodaj_osobe(
    state: tauri::State<AppState>,
    osoba: OsobaGenealogia,
) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    genealogia::dodaj_osobe(&db, &osoba).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn aktualizuj_osobe(
    state: tauri::State<AppState>,
    osoba: OsobaGenealogia,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    genealogia::aktualizuj_osobe(&db, &osoba).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn usun_osobe(
    state: tauri::State<AppState>,
    id: i64,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    genealogia::usun_osobe(&db, id).map_err(|e| e.to_string())
}
