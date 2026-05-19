use serde::{Deserialize, Serialize};

/// Osoba w drzewie genealogicznym
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsobaGenealogia {
    pub id: Option<i64>,
    pub json_id: i32,
    pub imie_nazwisko: String,
    pub plec: Option<String>,
    pub numer_domu: Option<String>,
    pub rok_urodzenia: Option<i32>,
    pub rok_smierci: Option<i32>,
    pub id_ojca: Option<i64>,
    pub id_matki: Option<i64>,
    pub id_protokolu: Option<i64>,
    pub uwagi: Option<String>,
}
