use crate::state::AppState;
use geo::Area;
use std::collections::HashMap;

/// GET /api/stats — PEŁNE dane (wszystkie pola)
#[tauri::command]
pub fn pobierz_statystyki(
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    
    let total_owners = query_one::<i64>(&db, "SELECT COUNT(*) FROM wlasciciele");
    let total_plots = query_one::<i64>(&db, "SELECT COUNT(*) FROM obiekty_geograficzne WHERE kategoria != 'obrys_miejscowosci'");
    let total_people = query_one::<i64>(&db, "SELECT COUNT(*) FROM osoby_genealogia");

    // Kategorie
    let cat_counts = category_counts(&db);
    
    // Płeć
    let (male_count, female_count) = gender_counts(&db);

    // Powierzchnia
    let (total_area_m2, min_area_m2, max_area_m2) = area_summary(&db);
    let location_area_m2 = location_area(&db).unwrap_or(total_area_m2);
    let total_area_ha = total_area_m2 / 10000.0;

    // Rankingi
    let rankings_real = rankings(&db, "real");
    let rankings_protocol = rankings(&db, "protocol");
    let parcels_ranking = parcels_by_area(&db);
    let (rivers_ranking, roads_ranking) = rivers_roads_ranking(&db);

    // Żydzi
    let jewish = jewish_stats(&db);

    // Demografia
    let demo_official = demografia_table(&db);
    let demo_metrical = dynamic_demography(&db);

    // Protokoły dzienne
    let protocols = protocols_per_day(&db);

    // Genealogia
    let genealogy = genealogy_stats(&db, total_people, male_count, female_count);

    // Rzeki/drogi stats (oblicz z rankingów)
    let rivers_len: Vec<f64> = rivers_ranking.iter().filter_map(|r| r["length_m"].as_f64()).collect();
    let roads_len: Vec<f64> = roads_ranking.iter().filter_map(|r| r["length_m"].as_f64()).collect();
    let rivers_count = rivers_len.len() as i64;
    let roads_count = roads_len.len() as i64;

    Ok(serde_json::json!({
        "general_stats": {
            "total_owners": total_owners, "total_plots": total_plots
        },
        "area_stats": {
            "total_area_ha": total_area_ha, "avg_area_ares": if total_plots>0 {total_area_ha*100.0/total_plots as f64} else {0.0},
            "min_area_m2": min_area_m2, "max_area_m2": max_area_m2
        },
        "rivers_stats": {
            "total_count": rivers_count,
            "max_length_m": rivers_len.iter().cloned().fold(0.0, f64::max),
            "avg_length_m": if rivers_count > 0 { rivers_len.iter().sum::<f64>() / rivers_count as f64 } else { 0.0 },
            "min_length_m": if rivers_count > 0 { rivers_len.iter().cloned().fold(f64::MAX, f64::min) } else { 0.0 },
        },
        "roads_stats": {
            "total_count": roads_count,
            "max_length_m": roads_len.iter().cloned().fold(0.0, f64::max),
            "avg_length_m": if roads_count > 0 { roads_len.iter().sum::<f64>() / roads_count as f64 } else { 0.0 },
            "min_length_m": if roads_count > 0 { roads_len.iter().cloned().fold(f64::MAX, f64::min) } else { 0.0 },
        },
        "drawn_percentage": { "drawn_count": total_plots, "protocol_count": total_plots, "percentage": 100.0, "missing_count": 0 },
        "location_area": { "area_hectares": location_area_m2 / 10000.0, "area_km2": location_area_m2 / 1_000_000.0 },
        "jewish_stats": jewish,
        "category_counts": cat_counts,
        "rankings_real": rankings_real,
        "rankings_protocol": rankings_protocol,
        "parcels_ranking": parcels_ranking,
        "rivers_ranking": rivers_ranking,
        "roads_ranking": roads_ranking,
        "demografia": demo_metrical,
        "demografia_official": demo_official,
        "protocols_per_day": protocols,
        "genealogy_stats": genealogy,
    }))
}

/// GET /api/graph-data
#[tauri::command]
pub fn pobierz_dane_grafu(state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    
    if let Ok(mut stmt) = db.conn.prepare("SELECT unikalny_klucz, nazwa_wlasciciela, numer_protokolu FROM wlasciciele") {
        if let Ok(rows) = stmt.query_map([], |r| {
            let k: String = r.get(0)?; let n: String = r.get(1)?; let lp: Option<i32> = r.get(2)?;
            Ok(serde_json::json!({"id":k,"label":format!("{}\n(Lp. {})",n,lp.map(|x|x.to_string()).unwrap_or("N/A".into())),"title":format!("Protokół Lp. {}",lp.map(|x|x.to_string()).unwrap_or("N/A".into()))}))
        }) { nodes = rows.filter_map(|r|r.ok()).collect(); }
    }

    let re = regex::Regex::new(r"\[\[.*?\|(.*?)\]\]").unwrap();
    if let Ok(mut stmt) = db.conn.prepare("SELECT unikalny_klucz, powiazania_i_transakcje FROM wlasciciele") {
        if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_,String>(0)?, r.get::<_,Option<String>>(1)?))) {
            let mut seen = std::collections::HashSet::new();
            for r in rows.flatten() {
                if let Some(ref t) = r.1 {
                    for cap in re.captures_iter(t) {
                        let cel = cap[1].to_string();
                        if r.0 != cel && seen.insert(format!("{}|{}",r.0,cel)) {
                            edges.push(serde_json::json!({"from":r.0,"to":cel,"arrows":"to"}));
                        }
                    }
                }
            }
        }
    }
    Ok(serde_json::json!({"nodes":nodes,"edges":edges}))
}

#[tauri::command]
pub fn pobierz_genealogie_wlasciciela(state: tauri::State<AppState>, klucz: String) -> Result<serde_json::Value, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let wid: Option<i64> = db.conn.query_row("SELECT id FROM wlasciciele WHERE unikalny_klucz=?1", rusqlite::params![klucz], |r| r.get(0)).ok();
    let osoby = match wid {
        Some(w) => osoby_by_owner(&db, w).unwrap_or_default(),
        None => vec![],
    };
    Ok(serde_json::json!({"osoby":osoby}))
}

// ==================== HELPERS ====================

fn query_one<T: rusqlite::types::FromSql + Default>(db: &czarna_core::Database, sql: &str) -> T {
    db.conn.query_row(sql, [], |r| r.get(0)).unwrap_or_default()
}

type OsobaRow = (i64, i32, String, Option<String>, Option<i32>, Option<i32>, Option<String>, Option<String>, Option<i64>, Option<i64>, Option<String>);

fn all_osoby(db: &czarna_core::Database) -> Result<Vec<OsobaRow>, String> {
    let mut stmt = db.conn.prepare("SELECT p.id,p.json_id,p.imie_nazwisko,p.plec,p.rok_urodzenia,p.rok_smierci,p.numer_domu,p.uwagi,p.id_ojca,p.id_matki,w.unikalny_klucz FROM osoby_genealogia p LEFT JOIN wlasciciele w ON p.id_protokolu=w.id").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?,r.get(10)?))).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn all_malzenstwa(db: &czarna_core::Database) -> Result<Vec<(i64,i64,Option<i32>)>, String> {
    let mut stmt = db.conn.prepare("SELECT malzonek1_id,malzonek2_id,rok_slubu FROM malzenstwa").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn osoby_by_owner(db: &czarna_core::Database, wid: i64) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = db.conn.prepare("SELECT id,json_id,imie_nazwisko,plec,numer_domu,rok_urodzenia,rok_smierci,id_ojca,id_matki,id_protokolu,uwagi FROM osoby_genealogia WHERE id_protokolu=?1").map_err(|e| e.to_string())?;
    let rows = stmt.query_map(rusqlite::params![wid], |r| Ok(serde_json::json!({
        "id":r.get::<_,i64>(0)?,"json_id":r.get::<_,i32>(1)?,"imie_nazwisko":r.get::<_,String>(2)?,"plec":r.get::<_,Option<String>>(3)?,
        "numer_domu":r.get::<_,Option<String>>(4)?,"rok_urodzenia":r.get::<_,Option<i32>>(5)?,"rok_smierci":r.get::<_,Option<i32>>(6)?,
        "id_ojca":r.get::<_,Option<i64>>(7)?,"id_matki":r.get::<_,Option<i64>>(8)?,"id_protokolu":r.get::<_,Option<i64>>(9)?,"uwagi":r.get::<_,Option<String>>(10)?,
    }))).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn category_counts(db: &czarna_core::Database) -> HashMap<String, i64> {
    let mut map = HashMap::new();
    if let Ok(mut s) = db.conn.prepare("SELECT kategoria,COUNT(*) FROM obiekty_geograficzne WHERE kategoria IS NOT NULL AND kategoria!='obrys_miejscowosci' GROUP BY kategoria") {
        if let Ok(rows) = s.query_map([], |r| Ok((r.get::<_,String>(0)?, r.get::<_,i64>(1)?))) {
            for r in rows.flatten() { map.insert(r.0, r.1); }
        }
    }
    map
}

fn gender_counts(db: &czarna_core::Database) -> (i64, i64) {
    let mut m = 0i64; let mut f = 0i64;
    if let Ok(mut s) = db.conn.prepare("SELECT plec,COUNT(*) FROM osoby_genealogia GROUP BY plec") {
        if let Ok(rows) = s.query_map([], |r| Ok((r.get::<_,String>(0)?, r.get::<_,i64>(1)?))) {
            for r in rows.flatten() {
                match r.0.as_str() { "M" => m = r.1, "K" => f = r.1, _ => {} }
            }
        }
    }
    (m, f)
}

fn area_summary(db: &czarna_core::Database) -> (f64, f64, f64) {
    let mut total = 0.0;
    let mut min_area = f64::MAX;
    let mut max_area: f64 = 0.0;
    let mut seen = false;

    if let Ok(mut s) = db.conn.prepare(
        "SELECT geometria_geojson FROM obiekty_geograficzne \
         WHERE geometria_geojson IS NOT NULL AND kategoria!='obrys_miejscowosci'"
    ) {
        let rows: Vec<Option<String>> = s.query_map([], |r| r.get(0))
            .map(|rs| rs.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();
        for gj_str in rows {
            let area = compute_area_m2(&gj_str);
            if area > 0.0 {
                seen = true;
                total += area;
                min_area = min_area.min(area);
                max_area = max_area.max(area);
            }
        }
    }

    if seen { (total, min_area, max_area) } else { (0.0, 0.0, 0.0) }
}

fn compute_area_m2(geojson_str: &Option<String>) -> f64 {
    fn polygon_area(rings: &[Vec<Vec<f64>>]) -> f64 {
        if rings.is_empty() || rings[0].len() < 3 { return 0.0; }
        let exterior: Vec<geo::Coord> = rings[0].iter()
            .filter(|c| c.len() >= 2)
            .map(|c| geo::Coord { x: c[0], y: c[1] })
            .collect();
        if exterior.len() < 3 { return 0.0; }
        let poly = geo::Polygon::new(geo::LineString::from(exterior), vec![]);
        let area_deg2 = poly.unsigned_area();
        let lat_rad = 50.0_f64.to_radians();
        let m_lat = 111132.92 - 559.82 * (2.0 * lat_rad).cos() + 1.175 * (4.0 * lat_rad).cos();
        let m_lng = 111412.84 * lat_rad.cos() - 93.5 * (3.0 * lat_rad).cos();
        area_deg2 * m_lat * m_lng
    }

    if let Some(s) = geojson_str {
        if let Ok(gj) = s.parse::<geojson::GeoJson>() {
            if let geojson::GeoJson::Geometry(ref geom) = gj {
                return match &geom.value {
                    geojson::Value::Polygon(rings) => polygon_area(rings),
                    geojson::Value::MultiPolygon(polys) => polys.iter().map(|rings| polygon_area(rings)).sum(),
                    _ => 0.0,
                };
            }
        }
    }
    0.0
}

fn location_area(db: &czarna_core::Database) -> Option<f64> {
    if let Ok(mut s) = db.conn.prepare(
        "SELECT geometria_geojson FROM obiekty_geograficzne \
         WHERE kategoria='obrys_miejscowosci' AND geometria_geojson IS NOT NULL LIMIT 1"
    ) {
        let geom: Option<String> = s.query_row([], |r| r.get(0)).ok()?;
        let area = compute_area_m2(&geom);
        if area > 0.0 { return Some(area); }
    }
    None
}

#[derive(Default)]
struct OwnerAgg {
    name: String,
    key: String,
    protocol: Option<i32>,
    plot_count: i64,
    total_area_m2: f64,
    plot_numbers: Vec<String>,
}

type RankingRow = (i64, String, String, Option<i32>, String, Option<String>);

fn map_ranking_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<RankingRow> {
    Ok((
        r.get::<_, i64>(0)?,
        r.get::<_, String>(1)?,
        r.get::<_, String>(2)?,
        r.get::<_, Option<i32>>(3)?,
        r.get::<_, String>(4)?,
        r.get::<_, Option<String>>(5)?,
    ))
}

fn rankings(db: &czarna_core::Database, typ: &str) -> serde_json::Value {
    let mut result = serde_json::Map::new();
    let cats = ["all_plots", "rolna", "budowlana", "las", "pastwisko", "droga", "rzeka", "budynek", "kapliczka", "obiekt_specjalny"];

    for cat in &cats {
        let mut owners: HashMap<i64, OwnerAgg> = HashMap::new();
        let cat_filter = if *cat == "all_plots" { "" } else { "AND o.kategoria=?1" };
        let real_cond = "(dw.typ_posiadania='wlasnosc rzeczywista' OR dw.typ_posiadania='własność rzeczywista')";
        let proto_cond = "(dw.typ_posiadania IS NULL OR (dw.typ_posiadania!='wlasnosc rzeczywista' AND dw.typ_posiadania!='własność rzeczywista'))";
        let cond = if typ == "real" { real_cond } else { proto_cond };
        let sql = format!(
            "SELECT w.id,w.nazwa_wlasciciela,w.unikalny_klucz,w.numer_protokolu,o.nazwa_lub_numer,o.geometria_geojson \
             FROM wlasciciele w JOIN dzialki_wlasciciele dw ON w.id=dw.wlasciciel_id \
             JOIN obiekty_geograficzne o ON dw.obiekt_id=o.id \
             WHERE {} {}",
            cond, cat_filter
        );

        if let Ok(mut s) = db.conn.prepare(&sql) {
            if *cat == "all_plots" {
                if let Ok(rows) = s.query_map([], map_ranking_row) {
                    collect_ranking_rows(rows, &mut owners);
                }
            } else if let Ok(rows) = s.query_map([*cat], map_ranking_row) {
                collect_ranking_rows(rows, &mut owners);
            }
        }

        let mut items: Vec<_> = owners.into_values().map(|o| serde_json::json!({
            "nazwa_wlasciciela": o.name,
            "unikalny_klucz": o.key,
            "numer_protokolu": o.protocol,
            "plot_count": o.plot_count,
            "total_area_m2": o.total_area_m2,
            "plot_numbers": o.plot_numbers,
        })).collect();
        items.sort_by(|a,b| b["plot_count"].as_i64().cmp(&a["plot_count"].as_i64()));
        result.insert(cat.to_string(), serde_json::json!(items));
    }
    serde_json::json!(result)
}

fn collect_ranking_rows<I>(rows: I, owners: &mut HashMap<i64, OwnerAgg>)
where
    I: IntoIterator<Item = rusqlite::Result<RankingRow>>,
{
    for row in rows.into_iter().flatten() {
        let entry = owners.entry(row.0).or_insert_with(|| OwnerAgg {
            name: row.1.clone(), key: row.2.clone(), protocol: row.3, ..Default::default()
        });
        entry.plot_count += 1;
        entry.total_area_m2 += compute_area_m2(&row.5);
        entry.plot_numbers.push(row.4);
    }
}

fn parcels_by_area(db: &czarna_core::Database) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    let cats = ["all","rolna","budowlana","las","pastwisko"];
    for cat in &cats {
        let cat_filter = if *cat == "all" { "WHERE o.kategoria!='obrys_miejscowosci'" } else { &format!("WHERE o.kategoria='{}'", cat) };
        let sql = format!("SELECT o.nazwa_lub_numer,w.nazwa_wlasciciela,w.unikalny_klucz,o.geometria_geojson FROM obiekty_geograficzne o LEFT JOIN dzialki_wlasciciele dw ON o.id=dw.obiekt_id LEFT JOIN wlasciciele w ON dw.wlasciciel_id=w.id {}", cat_filter);
        let mut items = Vec::new();
        if let Ok(mut s) = db.conn.prepare(&sql) {
            if let Ok(rows) = s.query_map([], |r| Ok(serde_json::json!({
                "parcel_number": r.get::<_,String>(0)?, "nazwa_wlasciciela": r.get::<_,Option<String>>(1)?,
                "unikalny_klucz": r.get::<_,Option<String>>(2)?, "area_m2": compute_area_m2(&r.get::<_,Option<String>>(3)?),
            }))) { items = rows.filter_map(|r| r.ok()).collect(); }
        }
        items.sort_by(|a,b| b["area_m2"].as_f64().partial_cmp(&a["area_m2"].as_f64()).unwrap_or(std::cmp::Ordering::Equal));
        items.truncate(50);
        map.insert(cat.to_string(), serde_json::json!(items));
    }
    serde_json::json!(map)
}

fn rivers_roads_ranking(db: &czarna_core::Database) -> (Vec<serde_json::Value>, Vec<serde_json::Value>) {
    let mut rivers = Vec::new();
    let mut roads = Vec::new();
    if let Ok(mut s) = db.conn.prepare("SELECT nazwa_lub_numer,kategoria,geometria_geojson FROM obiekty_geograficzne WHERE kategoria IN ('rzeka','droga')") {
        if let Ok(rows) = s.query_map([], |r| Ok((r.get::<_,String>(0)?, r.get::<_,String>(1)?, r.get::<_,Option<String>>(2)?)))  {
            for r in rows.flatten() {
                let len = line_length(&r.2);
                let item = if r.1 == "rzeka" {
                    serde_json::json!({"length_m": len, "river_name": r.0})
                } else {
                    serde_json::json!({"length_m": len, "road_number": r.0})
                };
                if r.1 == "rzeka" { rivers.push(item); } else { roads.push(item); }
            }
        }
    }
    rivers.sort_by(|a,b| b["length_m"].as_f64().partial_cmp(&a["length_m"].as_f64()).unwrap_or(std::cmp::Ordering::Equal));
    roads.sort_by(|a,b| b["length_m"].as_f64().partial_cmp(&a["length_m"].as_f64()).unwrap_or(std::cmp::Ordering::Equal));
    (rivers, roads)
}

fn line_length(geojson_str: &Option<String>) -> f64 {
    if let Some(s) = geojson_str {
        if let Ok(gj) = s.parse::<geojson::GeoJson>() {
            if let geojson::GeoJson::Geometry(ref g) = gj {
                let coords = match &g.value {
                    geojson::Value::LineString(cs) => cs.clone(),
                    geojson::Value::Polygon(rings) if !rings.is_empty() => rings[0].clone(),
                    _ => return 0.0,
                };
                let mut len = 0.0;
                for i in 1..coords.len() {
                    let dx = (coords[i][0] - coords[i-1][0]) * 111320.0 * 0.6428; // cos(50°)
                    let dy = (coords[i][1] - coords[i-1][1]) * 111320.0;
                    len += (dx*dx + dy*dy).sqrt();
                }
                return len;
            }
        }
    }
    0.0
}

fn jewish_stats(db: &czarna_core::Database) -> serde_json::Value {
    let name_filter = "(w.nazwa_wlasciciela LIKE '%Grünstein%' OR w.nazwa_wlasciciela LIKE '%Wachtel%' OR w.nazwa_wlasciciela LIKE '%Fisch%' OR w.nazwa_wlasciciela LIKE '%Hudes%' OR w.nazwa_wlasciciela LIKE '%Gastwirth%' OR w.nazwa_wlasciciela LIKE '%Neubert%' OR w.nazwa_wlasciciela LIKE '%Grinstein%')";
    let sql = format!("SELECT w.id,w.nazwa_wlasciciela,w.unikalny_klucz,w.numer_protokolu,o.geometria_geojson FROM wlasciciele w LEFT JOIN dzialki_wlasciciele dw ON w.id=dw.wlasciciel_id LEFT JOIN obiekty_geograficzne o ON dw.obiekt_id=o.id WHERE {}", name_filter);
    let mut aggs: HashMap<i64, OwnerAgg> = HashMap::new();
    let mut total_parcels = 0i64;
    let mut total_area_m2 = 0.0;
    if let Ok(mut s) = db.conn.prepare(&sql) {
        if let Ok(rows) = s.query_map([], |r| Ok((r.get::<_,i64>(0)?, r.get::<_,String>(1)?, r.get::<_,String>(2)?, r.get::<_,Option<i32>>(3)?, r.get::<_,Option<String>>(4)?))) {
            for row in rows.flatten() {
                let entry = aggs.entry(row.0).or_insert_with(|| OwnerAgg { name: row.1.clone(), key: row.2.clone(), protocol: row.3, ..Default::default() });
                if row.4.is_some() {
                    let area = compute_area_m2(&row.4);
                    entry.plot_count += 1;
                    entry.total_area_m2 += area;
                    total_area_m2 += area;
                    total_parcels += 1;
                }
            }
        }
    }
    let owners: Vec<_> = aggs.into_values().map(|o| serde_json::json!({
        "nazwa_wlasciciela": o.name, "unikalny_klucz": o.key,
        "numer_protokolu": o.protocol, "parcels_count": o.plot_count,
        "total_area_m2": o.total_area_m2,
    })).collect();
    serde_json::json!({
        "owners_count": owners.len(), "parcels_count": total_parcels, "total_area_ha": total_area_m2 / 10000.0, "owners": owners,
    })
}

fn demografia_table(db: &czarna_core::Database) -> Vec<serde_json::Value> {
    let mut v = Vec::new();
    if let Ok(mut s) = db.conn.prepare("SELECT rok,populacja_ogolem,katolicy,zydzi,inni,opis FROM demografia ORDER BY rok") {
        if let Ok(rows) = s.query_map([], |r| Ok(serde_json::json!({
            "rok": r.get::<_,i32>(0)?, "populacja_ogolem": r.get::<_,Option<i32>>(1)?,
            "katolicy": r.get::<_,Option<i32>>(2)?, "zydzi": r.get::<_,Option<i32>>(3)?,
            "inni": r.get::<_,Option<i32>>(4)?, "opis": r.get::<_,Option<String>>(5)?,
        }))) { v = rows.filter_map(|r| r.ok()).collect(); }
    }
    v
}

fn dynamic_demography(db: &czarna_core::Database) -> Vec<serde_json::Value> {
    // Oblicz populację rok po roku na podstawie dat urodzeń/śmierci
    let mut v = Vec::new();
    if let Ok(mut s) = db.conn.prepare("SELECT rok_urodzenia,rok_smierci FROM osoby_genealogia") {
        let data: Vec<(Option<i32>, Option<i32>)> = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map(|rs| rs.filter_map(|r| r.ok()).collect()).unwrap_or_default();
        let births: Vec<i32> = data.iter().filter_map(|(b,_)| *b).collect();
        let deaths: Vec<i32> = data.iter().filter_map(|(_,d)| *d).collect();
        if births.is_empty() { return v; }
        let min_y = *births.iter().min().unwrap();
        let max_y = std::cmp::max(births.iter().max().copied().unwrap_or(0), deaths.iter().max().copied().unwrap_or(0));
        for year in min_y..=max_y {
            let pop: i32 = data.iter().map(|(b,d)| {
                if let Some(birth) = b {
                    if *birth <= year {
                        if let Some(death) = d {
                            if *death >= year { 1 } else { 0 }
                        } else if year - birth <= 95 { 1 } else { 0 }
                    } else { 0 }
                } else { 0 }
            }).sum();
            if pop > 0 {
                v.push(serde_json::json!({"rok":year,"populacja_ogolem":pop,"katolicy":0,"zydzi":0,"inni":0,"opis":null}));
            }
        }
    }
    v
}

fn protocols_per_day(db: &czarna_core::Database) -> Vec<serde_json::Value> {
    let mut v = Vec::new();
    if let Ok(mut s) = db.conn.prepare("SELECT data_protokolu,unikalny_klucz,nazwa_wlasciciela FROM wlasciciele WHERE data_protokolu IS NOT NULL") {
        let mut by_date: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
        if let Ok(rows) = s.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))) {
            for r in rows.flatten() {
                let iso = parse_polish_date(&r.0);
                by_date.entry(iso).or_default().push(serde_json::json!({"unikalny_klucz":r.1,"nazwa_wlasciciela":r.2}));
            }
        }
        for (date, owners) in &by_date {
            v.push(serde_json::json!({"protocol_date":date,"protocol_count":owners.len(),"owners":owners}));
        }
        v.sort_by(|a,b| a["protocol_date"].as_str().cmp(&b["protocol_date"].as_str()));
    }
    v
}

fn parse_polish_date(text: &str) -> String {
    // "10 lutego 1882 rok" -> "1882-02-10"
    let months: HashMap<&str, u32> = [
        ("stycznia",1),("lutego",2),("marca",3),("kwietnia",4),("maja",5),("czerwca",6),
        ("lipca",7),("sierpnia",8),("wrzesnia",9),("pazdziernika",10),("listopada",11),("grudnia",12),
        ("styczen",1),("styczeń",1),("luty",2),("marzec",3),("kwiecien",4),("kwiecień",4),("maj",5),("czerwiec",6),
        ("lipiec",7),("sierpien",8),("sierpień",8),("wrzesień",9),("październik",10),("pazdziernik",10),("listopad",11),("grudzien",12),("grudzień",12),
    ].into_iter().collect();
    let parts: Vec<&str> = text.split_whitespace().collect();
    if parts.len() >= 3 {
        let day: u32 = parts[0].parse().unwrap_or(1);
        let month_key = parts[1].trim_matches(|c: char| !c.is_alphabetic()).to_lowercase();
        let month = months.get(month_key.as_str()).copied().unwrap_or(1);
        let year: i32 = parts.iter()
            .filter_map(|p| p.trim_matches(|c: char| !c.is_ascii_digit()).parse::<i32>().ok())
            .find(|y| *y >= 1700 && *y <= 2100)
            .unwrap_or(1882);
        return format!("{:04}-{:02}-{:02}", year, month, day);
    }
    text.to_string()
}

fn genealogy_stats(db: &czarna_core::Database, total: i64, male: i64, female: i64) -> serde_json::Value {
    // Top surnames
    let mut surnames = Vec::new();
    if let Ok(mut s) = db.conn.prepare("SELECT imie_nazwisko FROM osoby_genealogia") {
        if let Ok(rows) = s.query_map([], |r| r.get::<_,String>(0)) {
            let mut counter: HashMap<String, i64> = HashMap::new();
            for name in rows.flatten() {
                if let Some(last) = name.split_whitespace().last() {
                    *counter.entry(last.to_string()).or_default() += 1;
                }
            }
            let mut sorted: Vec<_> = counter.into_iter().collect();
            sorted.sort_by(|a,b| b.1.cmp(&a.1));
            surnames = sorted.into_iter().take(10).map(|(n,c)| serde_json::json!({"name":n,"count":c})).collect();
        }
    }

    // Births/deaths/marriages by decade
    let (births_dec, deaths_dec, marriages_dec) = decade_stats(db);

    // Infant mortality
    let infant = infant_mortality(db);

    let lifespan = lifespan_by_generation(db);
    let death_age = death_age_distribution(db);
    let family = family_structure(db);

    serde_json::json!({
        "total_people": total, "male_count": male, "female_count": female,
        "top_surnames": surnames,
        "births_by_decade": births_dec, "deaths_by_decade": deaths_dec, "marriages_by_decade": marriages_dec,
        "infant_mortality": infant,
        "lifespan_by_generation": lifespan,
        "death_age_distribution": death_age,
        "family_structure": family,
    })
}

fn decade_stats(db: &czarna_core::Database) -> (serde_json::Value, serde_json::Value, serde_json::Value) {
    fn build(counter: &HashMap<i32,i32>) -> serde_json::Value {
        if counter.is_empty() { return serde_json::json!({"labels":[],"data":[]}); }
        let mut decades: Vec<i32> = counter.keys().copied().collect();
        decades.sort();
        let labels: Vec<String> = decades.iter().map(|d| format!("{}s", d)).collect();
        let data: Vec<i32> = decades.iter().map(|d| counter.get(d).copied().unwrap_or(0)).collect();
        serde_json::json!({"labels":labels,"data":data})
    }
    let mut births = HashMap::new();
    let mut deaths = HashMap::new();
    let mut marriages = HashMap::new();
    if let Ok(mut s) = db.conn.prepare("SELECT rok_urodzenia,rok_smierci FROM osoby_genealogia") {
        if let Ok(rows) = s.query_map([], |r| Ok((r.get::<_,Option<i32>>(0)?, r.get::<_,Option<i32>>(1)?))) {
            for r in rows.flatten() {
                if let Some(y) = r.0 { *births.entry((y/10)*10).or_default() += 1; }
                if let Some(y) = r.1 { *deaths.entry((y/10)*10).or_default() += 1; }
            }
        }
    }
    if let Ok(mut s) = db.conn.prepare("SELECT rok_slubu FROM malzenstwa WHERE rok_slubu IS NOT NULL") {
        if let Ok(rows) = s.query_map([], |r| r.get::<_,i32>(0)) {
            for r in rows.flatten() { *marriages.entry((r/10)*10).or_default() += 1; }
        }
    }
    (build(&births), build(&deaths), build(&marriages))
}

fn infant_mortality(db: &czarna_core::Database) -> serde_json::Value {
    let mut infant_deaths = 0i64;
    let mut total_births = 0i64;
    let mut by_decade = HashMap::new();
    if let Ok(mut s) = db.conn.prepare("SELECT rok_urodzenia,rok_smierci FROM osoby_genealogia WHERE rok_urodzenia IS NOT NULL") {
        if let Ok(rows) = s.query_map([], |r| Ok((r.get::<_,i32>(0)?, r.get::<_,Option<i32>>(1)?))) {
            for r in rows.flatten() {
                total_births += 1;
                if let Some(death) = r.1 {
                if death >= r.0 && death - r.0 <= 1 {
                    infant_deaths += 1;
                    *by_decade.entry((r.0/10)*10).or_default() += 1;
                }
                }
            }
        }
    }
    let rate = if total_births > 0 { infant_deaths as f64 / total_births as f64 * 100.0 } else { 0.0 };
    let mut decades: Vec<i32> = by_decade.keys().copied().collect(); decades.sort();
    serde_json::json!({
        "infant_deaths": infant_deaths, "mortality_rate": (rate * 100.0).round() / 100.0,
        "by_decade": {
            "labels": decades.iter().map(|d| format!("{}s", d)).collect::<Vec<_>>(),
            "data": decades.iter().map(|d| by_decade.get(d).copied().unwrap_or(0)).collect::<Vec<_>>(),
        }
    })
}

fn lifespan_by_generation(db: &czarna_core::Database) -> serde_json::Value {
    let mut by_decade: HashMap<i32, Vec<i32>> = HashMap::new();
    let mut all_ages = Vec::new();
    if let Ok(mut s) = db.conn.prepare("SELECT rok_urodzenia,rok_smierci FROM osoby_genealogia WHERE rok_urodzenia IS NOT NULL AND rok_smierci IS NOT NULL") {
        if let Ok(rows) = s.query_map([], |r| Ok((r.get::<_,i32>(0)?, r.get::<_,i32>(1)?))) {
            for (birth, death) in rows.flatten() {
                if death > birth {
                    let age = death - birth;
                    by_decade.entry((birth / 10) * 10).or_default().push(age);
                    all_ages.push(age);
                }
            }
        }
    }
    if by_decade.is_empty() {
        return serde_json::json!({"labels":[],"data":[],"avg_lifespan":0,"total_records":0});
    }
    let mut decades: Vec<i32> = by_decade.keys().copied().collect();
    decades.sort();
    let first = *decades.first().unwrap();
    let last = *decades.last().unwrap();
    let range: Vec<i32> = (first..=last).step_by(10).collect();
    let data: Vec<f64> = range.iter().map(|d| {
        let ages = by_decade.get(d).cloned().unwrap_or_default();
        if ages.is_empty() { 0.0 } else { ((ages.iter().sum::<i32>() as f64 / ages.len() as f64) * 10.0).round() / 10.0 }
    }).collect();
    let avg = if all_ages.is_empty() { 0.0 } else { ((all_ages.iter().sum::<i32>() as f64 / all_ages.len() as f64) * 10.0).round() / 10.0 };
    serde_json::json!({
        "labels": range.iter().map(|d| format!("{}s", d)).collect::<Vec<_>>(),
        "data": data,
        "avg_lifespan": avg,
        "total_records": all_ages.len(),
    })
}

fn death_age_distribution(db: &czarna_core::Database) -> serde_json::Value {
    let labels = vec!["0-1", "1-5", "5-10", "10-20", "20-30", "30-40", "40-50", "50-60", "60-70", "70-80", "80+"];
    let mut counts = vec![0i64; labels.len()];
    let mut total = 0i64;
    if let Ok(mut s) = db.conn.prepare("SELECT rok_urodzenia,rok_smierci FROM osoby_genealogia WHERE rok_urodzenia IS NOT NULL AND rok_smierci IS NOT NULL") {
        if let Ok(rows) = s.query_map([], |r| Ok((r.get::<_,i32>(0)?, r.get::<_,i32>(1)?))) {
            for (birth, death) in rows.flatten() {
                if death >= birth {
                    let age = death - birth;
                    let idx = if age <= 1 { 0 } else if age <= 5 { 1 } else if age <= 10 { 2 } else if age <= 20 { 3 }
                        else if age <= 30 { 4 } else if age <= 40 { 5 } else if age <= 50 { 6 } else if age <= 60 { 7 }
                        else if age <= 70 { 8 } else if age <= 80 { 9 } else { 10 };
                    counts[idx] += 1;
                    total += 1;
                }
            }
        }
    }
    serde_json::json!({"labels": labels, "data": counts, "total_deaths": total})
}

fn family_structure(db: &czarna_core::Database) -> serde_json::Value {
    let mut children_by_parent: HashMap<i64, i64> = HashMap::new();
    if let Ok(mut s) = db.conn.prepare("SELECT id_ojca,id_matki FROM osoby_genealogia WHERE id_ojca IS NOT NULL OR id_matki IS NOT NULL") {
        if let Ok(rows) = s.query_map([], |r| Ok((r.get::<_,Option<i64>>(0)?, r.get::<_,Option<i64>>(1)?))) {
            for (father, mother) in rows.flatten() {
                if let Some(id) = father { *children_by_parent.entry(id).or_default() += 1; }
                if let Some(id) = mother { *children_by_parent.entry(id).or_default() += 1; }
            }
        }
    }
    let counts: Vec<i64> = children_by_parent.values().copied().collect();
    let mut dist = vec![0i64; 5];
    for c in &counts {
        let idx = if *c == 1 { 0 } else if *c == 2 { 1 } else if *c <= 5 { 2 } else if *c <= 10 { 3 } else { 4 };
        dist[idx] += 1;
    }
    let avg_children = if counts.is_empty() { 0.0 } else { ((counts.iter().sum::<i64>() as f64 / counts.len() as f64) * 100.0).round() / 100.0 };

    let mut household_sizes = Vec::new();
    if let Ok(mut s) = db.conn.prepare("SELECT COUNT(*) FROM osoby_genealogia WHERE numer_domu IS NOT NULL AND numer_domu!='' GROUP BY numer_domu") {
        if let Ok(rows) = s.query_map([], |r| r.get::<_,i64>(0)) {
            household_sizes = rows.filter_map(|r| r.ok()).collect();
        }
    }
    let avg_household = if household_sizes.is_empty() { 0.0 } else { ((household_sizes.iter().sum::<i64>() as f64 / household_sizes.len() as f64) * 10.0).round() / 10.0 };
    serde_json::json!({
        "avg_children_per_parent": avg_children,
        "family_size_distribution": {"labels": ["1 dziecko", "2 dzieci", "3-5 dzieci", "6-10 dzieci", ">10 dzieci"], "data": dist},
        "total_families": counts.len(),
        "avg_household_size": avg_household,
        "total_households": household_sizes.len(),
    })
}
