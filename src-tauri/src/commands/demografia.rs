use crate::state::AppState;
use czarna_core::models::Demografia;
use czarna_core::services::demografia;

#[tauri::command]
pub fn pobierz_demografie(
    state: tauri::State<AppState>,
) -> Result<Vec<Demografia>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    demografia::pobierz_wszystkie(&db).map_err(|e| e.to_string())
}
