use serde::{Deserialize, Serialize};

/// Obiekt geograficzny: działka, droga, budynek itp.
/// Geometria przechowywana jako GeoJSON
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObiektGeograficzny {
    pub id: Option<i64>,
    pub nazwa_lub_numer: String,
    pub kategoria: String,
    pub geometria_geojson: Option<String>,
    pub bbox_min_lat: Option<f64>,
    pub bbox_min_lng: Option<f64>,
    pub bbox_max_lat: Option<f64>,
    pub bbox_max_lng: Option<f64>,
}
