use crate::state::AppState;
use std::path::PathBuf;

/// Zwraca listę właścicieli z protokołami (bez zdjęć — tylko info)
#[tauri::command]
pub fn lista_protokolow(
    state: tauri::State<AppState>,
) -> Result<Vec<ProtokolInfo>, String> {
    use czarna_core::services::wlasciciele;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let wlasciciele = wlasciciele::pobierz_wszystkich(&db).map_err(|e| e.to_string())?;

    let protokoly_dir = get_protokoly_dir(&state)?;

    let mut result = Vec::new();

    for w in wlasciciele {
        if w.nazwa_wlasciciela.is_empty() { continue; }
        if w.numer_protokolu.is_none() { continue; }

        let folder_name = w.nazwa_wlasciciela.replace(' ', "_");
        let proto_dir = protokoly_dir.join(&folder_name);

        let zdjecia_count = if proto_dir.exists() {
            std::fs::read_dir(&proto_dir)
                .map(|entries| {
                    entries.filter_map(|e| e.ok())
                        .filter(|e| {
                            e.path().extension()
                                .map(|ext| {
                                    let e = ext.to_str().unwrap_or("").to_lowercase();
                                    e == "jpg" || e == "jpeg" || e == "png"
                                })
                                .unwrap_or(false)
                        })
                        .count()
                })
                .unwrap_or(0)
        } else {
            0
        };

        result.push(ProtokolInfo {
            nazwa: w.nazwa_wlasciciela,
            numer_protokolu: w.numer_protokolu,
            numer_domu: w.numer_domu.clone(),
            data_protokolu: w.data_protokolu.clone(),
            miejsce_protokolu: w.miejsce_protokolu.clone(),
            zdjecia_count: zdjecia_count as i32,
        });
    }

    Ok(result)
}

/// Ładuje zdjęcia dla konkretnego właściciela (base64)
#[tauri::command]
pub fn laduj_zdjecia_protokolu(
    state: tauri::State<AppState>,
    nazwa_wlasciciela: String,
) -> Result<Vec<String>, String> {
    let protokoly_dir = get_protokoly_dir(&state)?;
    let folder_name = nazwa_wlasciciela.replace(' ', "_");
    let proto_dir = protokoly_dir.join(&folder_name);

    let mut zdjecia = Vec::new();

    if proto_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&proto_dir) {
            let mut files: Vec<_> = entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.path().extension()
                        .map(|ext| {
                            let e = ext.to_str().unwrap_or("").to_lowercase();
                            e == "jpg" || e == "jpeg" || e == "png"
                        })
                        .unwrap_or(false)
                })
                .collect();

            files.sort_by_key(|f| f.file_name());

            for file in files {
                if let Ok(data) = std::fs::read(file.path()) {
                    let ext = file.path().extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("jpg")
                        .to_string();
                    let b64 = base64_encode(&data);
                    zdjecia.push(format!("data:image/{};base64,{}", ext, b64));
                }
            }
        }
    }

    Ok(zdjecia)
}

fn get_protokoly_dir(state: &tauri::State<AppState>) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent().unwrap()
            .join("data").join("protokoly"))
    } else {
        let dir = state.data_dir.lock().map_err(|e| e.to_string())?;
        Ok(dir.join("resources").join("data").join("protokoly"))
    }
}

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

#[derive(serde::Serialize, Clone)]
pub struct ProtokolInfo {
    pub nazwa: String,
    pub numer_protokolu: Option<i32>,
    pub numer_domu: Option<String>,
    pub data_protokolu: Option<String>,
    pub miejsce_protokolu: Option<String>,
    pub zdjecia_count: i32,
}
