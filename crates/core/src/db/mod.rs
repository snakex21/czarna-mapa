pub mod schema;

use rusqlite::Connection;
use std::path::Path;
use crate::error::Result;

/// Główny dostęp do bazy danych aplikacji
pub struct Database {
    pub conn: Connection,
}

impl Database {
    /// Otwiera (lub tworzy) bazę danych SQLite
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;

        // Włącz WAL mode dla lepszej wydajności
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    /// Otwiera bazę w pamięci (do testów)
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;

        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    /// Inicjalizuje schemat bazy danych (tworzy tabele jeśli nie istnieją)
    fn init_schema(&self) -> Result<()> {
        self.conn.execute_batch(schema::FULL_SCHEMA)?;
        Ok(())
    }
}
