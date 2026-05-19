mod commands;
mod state;

use state::AppState;
use std::sync::Mutex;
use tauri::Manager;

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Określ ścieżkę do bazy danych
            let app_dir = app.handle().path().app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));

            // W trybie dev szukaj bazy lokalnie, w release w app_data_dir
            let db_path = if cfg!(debug_assertions) {
                let dev_db = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .unwrap()
                    .join("data")
                    .join("czarna.db");
                if dev_db.exists() {
                    dev_db
                } else {
                    app_dir.join("czarna.db")
                }
            } else {
                std::fs::create_dir_all(&app_dir).ok();
                let release_db = app_dir.join("czarna.db");
                // Skopiuj bazę z resources jeśli nie istnieje
                if !release_db.exists() {
                    // W release mode baza jest bundlowana jako resource
                    // Tauri rozpakowuje resources do app_dir/resources/
                    let resource_db = app_dir.join("resources").join("data").join("czarna.db");
                    if resource_db.exists() {
                        std::fs::copy(&resource_db, &release_db).ok();
                    }
                }
                release_db
            };
            log::info!("Baza danych: {:?}", db_path);

            // Otwórz bazę
            let db = czarna_core::Database::open(&db_path)
                .expect("Nie można otworzyć bazy danych");

            // Sprawdź czy baza jest pusta
            let count: i64 = db.conn
                .query_row("SELECT COUNT(*) FROM obiekty_geograficzne", [], |row| row.get(0))
                .unwrap_or(0);

            if count == 0 {
                log::info!("Baza danych jest pusta — zaimportuj dane przed uruchomieniem.");
            }

            app.manage(AppState {
                db: Mutex::new(db),
                data_dir: Mutex::new(app_dir),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::mapa::pobierz_obiekty_widok,
            commands::mapa::pobierz_obiekt_po_punkcie,
            commands::mapa::pobierz_wlascicieli_obiektu,
            commands::wlasciciele::pobierz_wszystkich_wlascicieli,
            commands::wlasciciele::pobierz_wlasciciela,
            commands::wlasciciele::szukaj_wlascicieli,
            commands::wlasciciele::dodaj_wlasciciela,
            commands::wlasciciele::aktualizuj_wlasciciela,
            commands::wlasciciele::usun_wlasciciela,
            commands::genealogia::pobierz_drzewo_genealogiczne,
            commands::genealogia::pobierz_osoby_wlasciciela,
            commands::genealogia::dodaj_osobe,
            commands::genealogia::aktualizuj_osobe,
            commands::genealogia::usun_osobe,
            commands::demografia::pobierz_demografie,
            commands::konfiguracja::pobierz_kalibracje_mapy,
            commands::konfiguracja::pobierz_konfiguracje_mapy,
            commands::konfiguracja::pobierz_konfiguracje,
            commands::konfiguracja::ustaw_konfiguracje,
            commands::protokoly::lista_protokolow,
            commands::protokoly::laduj_zdjecia_protokolu,
            commands::stats::pobierz_genealogie_wlasciciela,
            commands::stats::pobierz_dane_grafu,
            commands::stats::pobierz_statystyki,
            commands::api_flask::api_dzialki,
            commands::api_flask::api_wlasciciele,
            commands::api_flask::api_wlasciciel,
            commands::api_flask::api_genealogia_persons,
        ])
        .run(tauri::generate_context!())
        .expect("Błąd podczas uruchamiania aplikacji");
}
