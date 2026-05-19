use crate::state::AppState;
use czarna_core::services::konfiguracja;
use serde_json::json;

#[tauri::command]
pub fn pobierz_kalibracje_mapy(
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    konfiguracja::pobierz_kalibracje_mapy(&db).map_err(|e| e.to_string())
}

/// Zwraca pełną konfigurację mapy w formacie zgodnym z oryginalnym frontendem
#[tauri::command]
pub fn pobierz_konfiguracje_mapy(
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let calibration = konfiguracja::pobierz_kalibracje_mapy(&db).map_err(|e| e.to_string())?;
    let defaults_str = konfiguracja::pobierz(&db, "map_defaults")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| r#"{"center":{"lat":50.0614,"lng":21.2461},"zoom":14}"#.into());
    let defaults: serde_json::Value = serde_json::from_str(&defaults_str)
        .unwrap_or(json!({"center":{"lat":50.0614,"lng":21.2461},"zoom":14}));

    Ok(json!({
        "calibration": calibration,
        "defaults": defaults
    }))
}

#[tauri::command]
pub fn pobierz_konfiguracje(
    state: tauri::State<AppState>,
    klucz: String,
) -> Result<Option<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    konfiguracja::pobierz(&db, &klucz).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ustaw_konfiguracje(
    state: tauri::State<AppState>,
    klucz: String,
    wartosc: String,
    opis: Option<String>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    konfiguracja::ustaw(&db, &klucz, &wartosc, opis.as_deref()).map_err(|e| e.to_string())
}
