use serde::{Deserialize, Serialize};

/// Relacja małżeńska między dwiema osobami
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Malzenstwo {
    pub malzonek1_id: i64,
    pub malzonek2_id: i64,
    pub rok_slubu: Option<i32>,
    pub miesiac_slubu: Option<i32>,
    pub dzien_slubu: Option<i32>,
    pub data_slubu: Option<String>,
}
