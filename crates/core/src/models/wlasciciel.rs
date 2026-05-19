use serde::{Deserialize, Serialize};

/// Właściciel z protokołu katastralnego
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wlasciciel {
    pub id: Option<i64>,
    pub unikalny_klucz: String,
    pub nazwa_wlasciciela: String,
    pub numer_protokolu: Option<i32>,
    pub numer_domu: Option<String>,
    pub data_protokolu: Option<String>,
    pub miejsce_protokolu: Option<String>,
    pub genealogia: Option<String>,
    pub historia_wlasnosci: Option<String>,
    pub uwagi: Option<String>,
    pub wspolwlasnosc: Option<String>,
    pub powiazania_i_transakcje: Option<String>,
    pub interpretacja_i_wnioski: Option<String>,
}
