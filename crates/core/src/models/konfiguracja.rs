use serde::{Deserialize, Serialize};

/// Konfiguracja systemu (klucz-wartość)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Konfiguracja {
    pub klucz: String,
    pub wartosc: String,  // JSON
    pub opis: Option<String>,
}
