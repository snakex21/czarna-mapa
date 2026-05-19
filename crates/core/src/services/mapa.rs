use crate::db::Database;
use crate::error::{Error, Result};
use crate::models::*;
use geo::{Contains, Point, Polygon, Coord};
use geojson::GeoJson;
use serde::{Deserialize, Serialize};

/// Parametry zapytania o obiekty w widocznym obszarze mapy
#[derive(Debug, Deserialize)]
pub struct MapBounds {
    pub sw_lat: f64,
    pub sw_lng: f64,
    pub ne_lat: f64,
    pub ne_lng: f64,
}

/// Odpowiedź z obiektami mapy
#[derive(Debug, Serialize)]
pub struct MapaResponse {
    pub obiekty: Vec<ObiektGeograficzny>,
    pub wlasciciele_obiekty: Vec<DzialkaWlascicielInfo>,
}

#[derive(Debug, Serialize)]
pub struct DzialkaWlascicielInfo {
    pub obiekt_id: i64,
    pub wlasciciel_id: i64,
    pub nazwa_wlasciciela: String,
    pub typ_posiadania: Option<String>,
}

/// Pobiera obiekty geograficzne w zadanym obszarze (bounding box)
pub fn pobierz_obiekty_w_obszarze(db: &Database, bounds: &MapBounds) -> Result<Vec<ObiektGeograficzny>> {
    let mut stmt = db.conn.prepare(
        "SELECT id, nazwa_lub_numer, kategoria, geometria_geojson,
                bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng
         FROM obiekty_geograficzne
         WHERE bbox_max_lat >= ?1 AND bbox_min_lat <= ?2
           AND bbox_max_lng >= ?3 AND bbox_min_lng <= ?4"
    )?;

    let obiekty = stmt.query_map(
        rusqlite::params![bounds.sw_lat, bounds.ne_lat, bounds.sw_lng, bounds.ne_lng],
        |row| {
            Ok(ObiektGeograficzny {
                id: row.get(0)?,
                nazwa_lub_numer: row.get(1)?,
                kategoria: row.get(2)?,
                geometria_geojson: row.get(3)?,
                bbox_min_lat: row.get(4)?,
                bbox_min_lng: row.get(5)?,
                bbox_max_lat: row.get(6)?,
                bbox_max_lng: row.get(7)?,
            })
        }
    )?;

    obiekty.map(|r| r.map_err(Error::from)).collect()
}

/// Pobiera wszystkich właścicieli dla danego obiektu
pub fn pobierz_wlascicieli_obiektu(db: &Database, obiekt_id: i64) -> Result<Vec<DzialkaWlascicielInfo>> {
    let mut stmt = db.conn.prepare(
        "SELECT dw.obiekt_id, dw.wlasciciel_id, w.nazwa_wlasciciela, dw.typ_posiadania
         FROM dzialki_wlasciciele dw
         JOIN wlasciciele w ON w.id = dw.wlasciciel_id
         WHERE dw.obiekt_id = ?1"
    )?;

    let result = stmt.query_map(
        rusqlite::params![obiekt_id],
        |row| {
            Ok(DzialkaWlascicielInfo {
                obiekt_id: row.get(0)?,
                wlasciciel_id: row.get(1)?,
                nazwa_wlasciciela: row.get(2)?,
                typ_posiadania: row.get(3)?,
            })
        }
    )?;

    result.map(|r| r.map_err(Error::from)).collect()
}

/// Znajduje obiekt zawierający dany punkt (geolokalizacja)
pub fn znajdz_obiekt_po_punkcie(db: &Database, lat: f64, lng: f64) -> Result<Option<ObiektGeograficzny>> {
    let point = Point::new(lng, lat);

    // Najpierw filtruj po bounding boxie
    let kandydaci = pobierz_obiekty_w_obszarze(db, &MapBounds {
        sw_lat: lat - 0.001,
        sw_lng: lng - 0.001,
        ne_lat: lat + 0.001,
        ne_lng: lng + 0.001,
    })?;

    // Potem dokładne sprawdzenie geometrii
    for obiekt in kandydaci {
        if let Some(ref geojson_str) = obiekt.geometria_geojson {
            if let Ok(geojson) = geojson_str.parse::<GeoJson>() {
                if let Ok(polygon) = geo_polygon_from_geojson(&geojson) {
                    if polygon.contains(&point) {
                        return Ok(Some(obiekt));
                    }
                }
            }
        }
    }

    Ok(None)
}

/// Próbuje konwertować GeoJSON na geo::Polygon
fn geo_polygon_from_geojson(geojson: &GeoJson) -> std::result::Result<Polygon<f64>, String> {
    use geojson::Value;
    use geo::LineString;

    match geojson {
        GeoJson::Feature(feature) => {
            if let Some(geometry) = &feature.geometry {
                geo_polygon_from_geojson(&GeoJson::Geometry(geometry.clone()))
            } else {
                Err("Feature bez geometrii".into())
            }
        }
        GeoJson::Geometry(geometry) => {
            match &geometry.value {
                Value::Polygon(coords) => {
                    if coords.is_empty() {
                        return Err("Pusty polygon".into());
                    }
                    let exterior: Vec<Coord<f64>> = coords[0].iter()
                        .map(|c| Coord { x: c[0], y: c[1] })
                        .collect();
                    let exterior = LineString::from(exterior);

                    let interiors: Vec<LineString<f64>> = coords[1..].iter()
                        .map(|ring| {
                            let coords: Vec<Coord<f64>> = ring.iter()
                                .map(|c| Coord { x: c[0], y: c[1] })
                                .collect();
                            LineString::from(coords)
                        })
                        .collect();

                    Ok(Polygon::new(exterior, interiors))
                }
                _ => Err("Nieobsługiwany typ geometrii".into()),
            }
        }
        _ => Err("Oczekiwano Feature lub Geometry".into()),
    }
}

/// Oblicza bounding box z GeoJSON geometrii
pub fn oblicz_bbox_z_geojson(geojson_str: &str) -> Option<(f64, f64, f64, f64)> {
    let geojson: GeoJson = geojson_str.parse().ok()?;

    let mut min_lat = f64::MAX;
    let mut min_lng = f64::MAX;
    let mut max_lat = f64::MIN;
    let mut max_lng = f64::MIN;

    fn extract_coords(geojson: &GeoJson, min_lat: &mut f64, min_lng: &mut f64, max_lat: &mut f64, max_lng: &mut f64) {
        match geojson {
            GeoJson::Feature(f) => {
                if let Some(ref g) = f.geometry {
                    extract_coords(&GeoJson::Geometry(g.clone()), min_lat, min_lng, max_lat, max_lng);
                }
            }
            GeoJson::Geometry(g) => {
                extract_from_value(&g.value, min_lat, min_lng, max_lat, max_lng);
            }
            _ => {}
        }
    }

    fn extract_from_value(value: &geojson::Value, min_lat: &mut f64, min_lng: &mut f64, max_lat: &mut f64, max_lng: &mut f64) {
        match value {
            geojson::Value::Point(c) => update_bbox(c[1], c[0], min_lat, min_lng, max_lat, max_lng),
            geojson::Value::MultiPoint(points) => {
                for c in points { update_bbox(c[1], c[0], min_lat, min_lng, max_lat, max_lng); }
            }
            geojson::Value::LineString(coords) => {
                for c in coords { update_bbox(c[1], c[0], min_lat, min_lng, max_lat, max_lng); }
            }
            geojson::Value::MultiLineString(lines) => {
                for line in lines {
                    for c in line { update_bbox(c[1], c[0], min_lat, min_lng, max_lat, max_lng); }
                }
            }
            geojson::Value::Polygon(rings) => {
                for ring in rings {
                    for c in ring { update_bbox(c[1], c[0], min_lat, min_lng, max_lat, max_lng); }
                }
            }
            geojson::Value::MultiPolygon(polygons) => {
                for poly in polygons {
                    for ring in poly {
                        for c in ring { update_bbox(c[1], c[0], min_lat, min_lng, max_lat, max_lng); }
                    }
                }
            }
            geojson::Value::GeometryCollection(geoms) => {
                for g in geoms {
                    extract_from_value(&g.value, min_lat, min_lng, max_lat, max_lng);
                }
            }
        }
    }

    fn update_bbox(lat: f64, lng: f64, min_lat: &mut f64, min_lng: &mut f64, max_lat: &mut f64, max_lng: &mut f64) {
        if lat < *min_lat { *min_lat = lat; }
        if lat > *max_lat { *max_lat = lat; }
        if lng < *min_lng { *min_lng = lng; }
        if lng > *max_lng { *max_lng = lng; }
    }

    extract_coords(&geojson, &mut min_lat, &mut min_lng, &mut max_lat, &mut max_lng);

    if min_lat == f64::MAX {
        None
    } else {
        Some((min_lat, min_lng, max_lat, max_lng))
    }
}
