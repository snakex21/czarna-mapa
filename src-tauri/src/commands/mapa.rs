use crate::state::AppState;
use czarna_core::services::mapa::{self, MapBounds};

#[tauri::command]
pub fn pobierz_obiekty_widok(
    state: tauri::State<AppState>,
    sw_lat: f64,
    sw_lng: f64,
    ne_lat: f64,
    ne_lng: f64,
) -> Result<Vec<czarna_core::models::ObiektGeograficzny>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let bounds = MapBounds { sw_lat, sw_lng, ne_lat, ne_lng };
    mapa::pobierz_obiekty_w_obszarze(&db, &bounds).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pobierz_obiekt_po_punkcie(
    state: tauri::State<AppState>,
    lat: f64,
    lng: f64,
) -> Result<Option<czarna_core::models::ObiektGeograficzny>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    mapa::znajdz_obiekt_po_punkcie(&db, lat, lng).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pobierz_wlascicieli_obiektu(
    state: tauri::State<AppState>,
    obiekt_id: i64,
) -> Result<Vec<czarna_core::services::mapa::DzialkaWlascicielInfo>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    mapa::pobierz_wlascicieli_obiektu(&db, obiekt_id).map_err(|e| e.to_string())
}
