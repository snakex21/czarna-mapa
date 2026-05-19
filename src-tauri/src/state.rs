use czarna_core::Database;
use std::path::PathBuf;
use std::sync::Mutex;

/// Stan aplikacji — dostępny we wszystkich komendach Tauri
pub struct AppState {
    pub db: Mutex<Database>,
    pub data_dir: Mutex<PathBuf>,
}
