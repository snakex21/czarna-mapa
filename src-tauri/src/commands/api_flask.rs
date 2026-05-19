use std::collections::HashMap;
use regex::Regex;
use geo::Area;

use crate::state::AppState;
use rusqlite::params;

/// GET /api/dzialki — FeatureCollection GeoJSON (identycznie jak Flask)
#[tauri::command]
pub fn api_dzialki(
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = db.conn.prepare(
        "SELECT id, nazwa_lub_numer, kategoria, geometria_geojson
         FROM obiekty_geograficzne WHERE geometria_geojson IS NOT NULL"
    ).map_err(|e| e.to_string())?;

    let rows: Vec<(i64, String, String, String)> = stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
    }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

    let mut features = Vec::new();

    for (id, nazwa, kategoria, geojson_str) in &rows {
        let geometry: serde_json::Value = serde_json::from_str(geojson_str).unwrap_or(serde_json::Value::Null);

        let mut w_stmt = db.conn.prepare(
            "SELECT w.id, w.unikalny_klucz, w.nazwa_wlasciciela, dw.typ_posiadania
             FROM wlasciciele w JOIN dzialki_wlasciciele dw ON w.id = dw.wlasciciel_id
             WHERE dw.obiekt_id = ?1"
        ).map_err(|e| e.to_string())?;

        let wlasciciele: Vec<serde_json::Value> = w_stmt.query_map(params![id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "unikalny_klucz": row.get::<_, String>(1)?,
                "nazwa": row.get::<_, String>(2)?,
                "typ_posiadania": row.get::<_, Option<String>>(3)?,
            }))
        }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

        features.push(serde_json::json!({
            "type": "Feature", "id": id, "geometry": geometry,
            "properties": { "numer_obiektu": nazwa, "kategoria": kategoria, "wlasciciele": wlasciciele }
        }));
    }

    Ok(serde_json::json!({"type": "FeatureCollection", "features": features}))
}

/// GET /api/wlasciciele (identycznie jak Flask)
#[tauri::command]
pub fn api_wlasciciele(
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.conn.prepare(
        "SELECT id, unikalny_klucz, nazwa_wlasciciela, numer_protokolu FROM wlasciciele ORDER BY numer_protokolu"
    ).map_err(|e| e.to_string())?;

    let owners: Vec<serde_json::Value> = stmt.query_map([], |row| {
        let id: i64 = row.get(0)?;
        Ok((id, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, Option<i32>>(3)?))
    }).map_err(|e| e.to_string())?.filter_map(|r| r.ok())
      .map(|(id, klucz, nazwa, numer)| {
          let dz = get_owner_parcels(&db, id);
          serde_json::json!({"id":id,"unikalny_klucz":klucz,"nazwa_wlasciciela":nazwa,"numer_protokolu":numer,"dzialki_rzeczywiste":dz,"dzialki_protokol":dz})
      }).collect();

    let total = owners.len() as i64;
    let min_lp = owners.iter().filter_map(|o| o["numer_protokolu"].as_i64()).min().unwrap_or(1);
    let max_lp = owners.iter().filter_map(|o| o["numer_protokolu"].as_i64()).max().unwrap_or(1);

    Ok(serde_json::json!({"owners":owners,"metadata":{"total_count":total,"zakres_lp":{"min":min_lp,"max":max_lp}}}))
}

/// GET /api/wlasciciel/{klucz} — DOKŁADNIE jak Flask
#[tauri::command]
pub fn api_wlasciciel(
    state: tauri::State<AppState>,
    klucz: String,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = db.conn.prepare(
        "SELECT id, unikalny_klucz, nazwa_wlasciciela, numer_protokolu, numer_domu,
                genealogia, historia_wlasnosci, uwagi, wspolwlasnosc,
                powiazania_i_transakcje, interpretacja_i_wnioski,
                data_protokolu, miejsce_protokolu
         FROM wlasciciele WHERE unikalny_klucz = ?1"
    ).map_err(|e| e.to_string())?;

    let row = stmt.query_row(params![klucz], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
            row.get::<_, Option<i32>>(3)?, row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?, row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?, row.get::<_, Option<String>>(8)?,
            row.get::<_, Option<String>>(9)?, row.get::<_, Option<String>>(10)?,
            row.get::<_, Option<String>>(11)?, row.get::<_, Option<String>>(12)?))
    }).map_err(|_| "Nie znaleziono wlasciciela".to_string())?;

    let (id, _uk, nazwa, num_prot, num_domu, genealogia_raw, historia_raw, uwagi_raw,
         wspol_raw, powiazania_raw, interp_raw, data_prot, miejsce_prot) = row;

    let nl2br = |s: &Option<String>| -> String {
        s.as_deref().unwrap_or("").replace("\\n", "<br>").replace('\n', "<br>")
    };
    let process_links = |text: &str| -> String {
        let re = Regex::new(r"\[\[([^|\]]+)\|([^\]]+)\]\]").unwrap();
        re.replace_all(text, r#"<a href="protokol.html?ownerId=$2">$1</a>"#).to_string()
    };

    let genealogia = nl2br(&genealogia_raw);
    let historia = nl2br(&historia_raw);
    let uwagi = nl2br(&uwagi_raw);
    let wspolwlasnosc = nl2br(&wspol_raw);
    let interpretacja = nl2br(&interp_raw);
    let powiazania_html = process_links(&nl2br(&powiazania_raw));

    let pelna_historia = if !uwagi.is_empty() {
        format!("{}<hr><b>Ciag dalszy / Uwagi:</b><br>{}", historia, uwagi)
    } else { historia };

    let ma_drzewo: bool = db.conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM osoby_genealogia WHERE id_protokolu = ?1)", params![id], |r| r.get(0)
    ).unwrap_or(false);

    let (dzialki_protokol, dzialki_rzeczywiste, dom_obiekt_id) = get_parcels_with_area(&db, id, &num_domu);

    Ok(serde_json::json!({
        "id": id, "unikalny_klucz": _uk, "nazwa_wlasciciela": nazwa,
        "numer_protokolu": num_prot, "numer_domu": num_domu,
        "genealogia": genealogia, "historia_wlasnosci": historia_raw,
        "uwagi": uwagi_raw, "wspolwlasnosc": wspolwlasnosc,
        "powiazania_i_transakcje": powiazania_raw, "powiazania_i_transakcje_html": powiazania_html,
        "interpretacja_i_wnioski": interpretacja,
        "data_protokolu": data_prot, "miejsce_protokolu": miejsce_prot,
        "gmina_katastralna": "Czarna", "ma_drzewo_genealogiczne": ma_drzewo,
        "pelna_historia": pelna_historia,
        "dzialki_protokol": dzialki_protokol, "dzialki_rzeczywiste": dzialki_rzeczywiste,
        "dom_obiekt_id": dom_obiekt_id, "dom_numer": num_domu,
    }))
}

/// GET /api/genealogia/persons-format
#[tauri::command]
pub fn api_genealogia_persons(
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.conn.prepare(
        "SELECT p.id, p.json_id, p.imie_nazwisko, p.plec, p.rok_urodzenia, p.rok_smierci,
                p.numer_domu, p.uwagi, p.id_ojca, p.id_matki, w.unikalny_klucz
         FROM osoby_genealogia p LEFT JOIN wlasciciele w ON p.id_protokolu = w.id"
    ).map_err(|e| e.to_string())?;

    let osoby: Vec<(i64, i32, String, Option<String>, Option<i32>, Option<i32>, Option<String>, Option<String>, Option<i64>, Option<i64>, Option<String>)> =
        stmt.query_map([], |row| Ok((
            row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?,
            row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?, row.get(10)?,
        ))).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

    let mut db_to_json: HashMap<i64, i32> = HashMap::new();
    for o in &osoby { db_to_json.insert(o.0, o.1); }

    let mut malz_stmt = db.conn.prepare(
        "SELECT malzonek1_id, malzonek2_id, rok_slubu FROM malzenstwa"
    ).map_err(|e| e.to_string())?;
    let malzenstwa: Vec<(i64, i64, Option<i32>)> = malz_stmt.query_map([], |row| Ok((
        row.get(0)?, row.get(1)?, row.get(2)?
    ))).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

    let mut spouse_map: HashMap<i64, Vec<i32>> = HashMap::new();
    let mut marriages_map: HashMap<i64, Vec<serde_json::Value>> = HashMap::new();
    for (m1, m2, rok) in &malzenstwa {
        if let (Some(&j1), Some(&j2)) = (db_to_json.get(m1), db_to_json.get(m2)) {
            spouse_map.entry(*m1).or_default().push(j2);
            spouse_map.entry(*m2).or_default().push(j1);
            let md = serde_json::json!({"spouseId": j2, "year": rok});
            marriages_map.entry(*m1).or_default().push(md.clone());
            marriages_map.entry(*m2).or_default().push(serde_json::json!({"spouseId": j1, "year": rok}));
        }
    }

    let persons: Vec<_> = osoby.iter().map(|(db_id, json_id, name, gender, birth, death, house, notes, father, mother, proto_key)| {
        let father_json = father.and_then(|f| db_to_json.get(&f)).copied();
        let mother_json = mother.and_then(|m| db_to_json.get(&m)).copied();
        serde_json::json!({
            "id": json_id, "name": name, "gender": gender, "houseNumber": house,
            "birthDate": birth.map(|y| serde_json::json!({"year": y})),
            "deathDate": death.map(|y| serde_json::json!({"year": y})),
            "fatherId": father_json, "motherId": mother_json,
            "spouseIds": spouse_map.get(db_id).cloned().unwrap_or_default(),
            "notes": notes, "marriages": marriages_map.get(db_id).cloned().unwrap_or_default(),
            "protokolKey": proto_key,
        })
    }).collect();
    Ok(serde_json::json!({"persons": persons}))
}

// --- Helpers ---

fn get_owner_parcels(db: &czarna_core::Database, owner_id: i64) -> Vec<serde_json::Value> {
    if let Ok(mut stmt) = db.conn.prepare(
        "SELECT o.id, o.nazwa_lub_numer FROM dzialki_wlasciciele dw
         JOIN obiekty_geograficzne o ON o.id = dw.obiekt_id WHERE dw.wlasciciel_id = ?1"
    ) {
        return stmt.query_map(params![owner_id], |row| Ok(serde_json::json!({
            "id": row.get::<_, i64>(0)?, "nazwa_lub_numer": row.get::<_, String>(1)?,
        }))).map_err(|_| ()).unwrap().filter_map(|r| r.ok()).collect();
    }
    vec![]
}

fn get_parcels_with_area(
    db: &czarna_core::Database, owner_id: i64, house_num: &Option<String>,
) -> (Vec<serde_json::Value>, Vec<serde_json::Value>, Option<i64>) {
    let mut protokol = Vec::new();
    let mut rzeczywiste = Vec::new();
    let mut dom_id = None;

    if let Ok(mut stmt) = db.conn.prepare(
        "SELECT o.id, o.nazwa_lub_numer, o.kategoria, o.geometria_geojson, dw.typ_posiadania
         FROM dzialki_wlasciciele dw JOIN obiekty_geograficzne o ON o.id = dw.obiekt_id
         WHERE dw.wlasciciel_id = ?1"
    ) {
        if let Ok(rows) = stmt.query_map(params![owner_id], |row| Ok((
            row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?, row.get::<_, Option<String>>(4)?,
        ))) {
            for r in rows.flatten() {
                let (oid, nazwa, kat, geojson_str, typ) = r;
                let area = compute_area_m2(&geojson_str);
                if let Some(ref hn) = house_num {
                    if (kat == "dom" || kat == "budynek" || kat == "budowlana") && &nazwa == hn {
                        dom_id = Some(oid);
                    }
                }
                let p = serde_json::json!({"id":oid,"nazwa_lub_numer":nazwa,"kategoria":kat,"powierzchnia_m2":area});
                if typ.as_deref() == Some("wlasnosc rzeczywista") { rzeczywiste.push(p.clone()); }
                protokol.push(p);
            }
        }
    }
    (protokol, rzeczywiste, dom_id)
}

fn compute_area_m2(geojson_str: &Option<String>) -> f64 {
    if let Some(s) = geojson_str {
        if let Ok(gj) = s.parse::<geojson::GeoJson>() {
            if let geojson::GeoJson::Geometry(ref geom) = gj {
                if let geojson::Value::Polygon(rings) = &geom.value {
                    if rings.is_empty() { return 0.0; }
                    let exterior: Vec<geo::Coord> = rings[0].iter()
                        .map(|c| geo::Coord { x: c[0], y: c[1] }).collect();
                    if exterior.len() >= 3 {
                        let poly = geo::Polygon::new(geo::LineString::from(exterior), vec![]);
                        let area_deg2 = poly.unsigned_area();
                        let lat_rad = 50.0_f64.to_radians();
                        let m_lat = 111132.92 - 559.82 * (2.0 * lat_rad).cos() + 1.175 * (4.0 * lat_rad).cos();
                        let m_lng = 111412.84 * lat_rad.cos() - 93.5 * (3.0 * lat_rad).cos();
                        return area_deg2 * m_lat * m_lng;
                    }
                }
            }
        }
    }
    0.0
}
