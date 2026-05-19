use thiserror::Error as ThisError;

#[derive(Debug, ThisError)]
pub enum Error {
    #[error("Błąd bazy danych: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Nie znaleziono: {0}")]
    NotFound(String),

    #[error("Nieprawidłowe dane: {0}")]
    InvalidData(String),

    #[error("Błąd serializacji: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Błąd geometrii: {0}")]
    Geometry(String),

    #[error("Błąd wewnętrzny: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, Error>;
