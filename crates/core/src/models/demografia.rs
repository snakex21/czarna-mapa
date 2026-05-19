use serde::{Deserialize, Serialize};

/// Dane demograficzne dla danego roku
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Demografia {
    pub id: Option<i64>,
    pub rok: i32,
    pub populacja_ogolem: Option<i32>,
    pub katolicy: Option<i32>,
    pub zydzi: Option<i32>,
    pub inni: Option<i32>,
    pub opis: Option<String>,
}
