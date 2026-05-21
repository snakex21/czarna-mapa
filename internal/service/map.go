package service

import (
	"czarna-mapa/internal/geo"
	"czarna-mapa/internal/models"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

// PobierzObiektyWObszarze zwraca obiekty w zadanym bounding boxie.
func PobierzObiektyWObszarze(db *sql.DB, bounds models.MapBounds) ([]models.ObiektGeograficzny, error) {
	rows, err := db.Query(
		`SELECT id, nazwa_lub_numer, kategoria, geometria_geojson,
		        bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng
		 FROM obiekty_geograficzne
		 WHERE bbox_max_lat >= ? AND bbox_min_lat <= ?
		   AND bbox_max_lng >= ? AND bbox_min_lng <= ?`,
		bounds.SwLat, bounds.NeLat, bounds.SwLng, bounds.NeLng,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.ObiektGeograficzny
	for rows.Next() {
		var o models.ObiektGeograficzny
		var geomStr sql.NullString
		if err := rows.Scan(&o.ID, &o.NazwaLubNumer, &o.Kategoria, &geomStr,
			&o.BBoxMinLat, &o.BBoxMinLng, &o.BBoxMaxLat, &o.BBoxMaxLng); err != nil {
			return nil, err
		}
		if geomStr.Valid && geomStr.String != "" {
			o.GeometriaGeoJSON = json.RawMessage(geomStr.String)
		}
		result = append(result, o)
	}
	return result, rows.Err()
}

// ZapiszObiektMapy dodaje lub aktualizuje obiekt geograficzny edytora działek.
func ZapiszObiektMapy(db *sql.DB, nazwa, kategoria string, geometria interface{}) (int64, error) {
	geomBytes, err := json.Marshal(geometria)
	if err != nil {
		return 0, err
	}
	geomStr := string(geomBytes)
	bbox := geo.CalculateBBox(geomStr)
	var minLat, minLng, maxLat, maxLng interface{}
	if bbox != nil {
		minLng, minLat, maxLng, maxLat = (*bbox)[0], (*bbox)[1], (*bbox)[2], (*bbox)[3]
	}

	res, err := db.Exec(`INSERT INTO obiekty_geograficzne
		(nazwa_lub_numer,kategoria,geometria_geojson,bbox_min_lat,bbox_min_lng,bbox_max_lat,bbox_max_lng)
		VALUES (?,?,?,?,?,?,?)`, nazwa, kategoria, geomStr, minLat, minLng, maxLat, maxLng)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func AktualizujGeometrieObiektu(db *sql.DB, id int64, geometria interface{}) error {
	geomBytes, err := json.Marshal(geometria)
	if err != nil {
		return err
	}
	geomStr := string(geomBytes)
	bbox := geo.CalculateBBox(geomStr)
	var minLat, minLng, maxLat, maxLng interface{}
	if bbox != nil {
		minLng, minLat, maxLng, maxLat = (*bbox)[0], (*bbox)[1], (*bbox)[2], (*bbox)[3]
	}
	_, err = db.Exec(`UPDATE obiekty_geograficzne SET geometria_geojson=?, bbox_min_lat=?, bbox_min_lng=?, bbox_max_lat=?, bbox_max_lng=? WHERE id=?`, geomStr, minLat, minLng, maxLat, maxLng, id)
	return err
}

func ZmienNazweObiektu(db *sql.DB, id int64, nazwa string) error {
	_, err := db.Exec("UPDATE obiekty_geograficzne SET nazwa_lub_numer=? WHERE id=?", nazwa, id)
	return err
}

func ZmienKategorieObiektu(db *sql.DB, id int64, kategoria string) error {
	_, err := db.Exec("UPDATE obiekty_geograficzne SET kategoria=? WHERE id=?", kategoria, id)
	return err
}

func UsunObiektMapy(db *sql.DB, id int64) error {
	_, err := db.Exec("DELETE FROM obiekty_geograficzne WHERE id=?", id)
	return err
}

func UsunWszystkieObiektyMapy(db *sql.DB) error {
	_, err := db.Exec("DELETE FROM obiekty_geograficzne")
	return err
}

func SprawdzDuplikatObiektu(db *sql.DB, nazwa, kategoria string) (bool, error) {
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM obiekty_geograficzne WHERE nazwa_lub_numer=? AND kategoria=?", nazwa, kategoria).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func WymagajBrakuDuplikatu(db *sql.DB, nazwa, kategoria string) error {
	exists, err := SprawdzDuplikatObiektu(db, nazwa, kategoria)
	if err != nil {
		return err
	}
	if exists {
		return fmt.Errorf("obiekt %s typu %s już istnieje", nazwa, kategoria)
	}
	return nil
}

// ZnajdzObiektPoPunkcie znajduje obiekt zawierający dany punkt.
func ZnajdzObiektPoPunkcie(db *sql.DB, lat, lng float64) (*models.ObiektGeograficzny, error) {
	// Najpierw po bounding boxie
	kandydaci, err := PobierzObiektyWObszarze(db, models.MapBounds{
		SwLat: lat - 0.001, SwLng: lng - 0.001,
		NeLat: lat + 0.001, NeLng: lng + 0.001,
	})
	if err != nil {
		return nil, err
	}

	pt := geo.Point{Lng: lng, Lat: lat}

	for i := range kandydaci {
		o := &kandydaci[i]
		// Obrys miejscowości jest dużym poligonem tła. Nie może przechwytywać
		// kliknięć wewnątrz mapy, bo wtedy zamiast działki zwracał się
		// "obrys_miejscowosci".
		if o.Kategoria == "obrys_miejscowosci" {
			continue
		}
		if len(o.GeometriaGeoJSON) == 0 {
			continue
		}
		poly, err := geo.ParsePolygonFromGeoJSON(string(o.GeometriaGeoJSON))
		if err != nil || poly == nil {
			continue
		}
		if poly.Contains(pt) {
			return o, nil
		}
	}

	return nil, nil
}

// PobierzWlascicieliObiektu zwraca właścicieli dla danego obiektu.
func PobierzWlascicieliObiektu(db *sql.DB, obiektID int64) ([]models.DzialkaWlascicielInfo, error) {
	rows, err := db.Query(
		`SELECT DISTINCT dw.obiekt_id, dw.wlasciciel_id, w.nazwa_wlasciciela, dw.typ_posiadania
		 FROM dzialki_wlasciciele dw
		 JOIN wlasciciele w ON w.id = dw.wlasciciel_id
		 WHERE dw.obiekt_id = ?`, obiektID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.DzialkaWlascicielInfo
	for rows.Next() {
		var d models.DzialkaWlascicielInfo
		if err := rows.Scan(&d.ObiektID, &d.WlascicielID, &d.NazwaWlasciciela, &d.TypPosiadania); err != nil {
			return nil, err
		}
		result = append(result, d)
	}
	return result, rows.Err()
}

// API_Dzialki zwraca FeatureCollection GeoJSON (identycznie jak Flask).
func API_Dzialki(db *sql.DB) (map[string]interface{}, error) {
	rows, err := db.Query(
		"SELECT id, nazwa_lub_numer, kategoria, geometria_geojson FROM obiekty_geograficzne WHERE geometria_geojson IS NOT NULL",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type row struct {
		id        int64
		nazwa     string
		kategoria string
		geomStr   string
	}

	var obiekty []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.nazwa, &r.kategoria, &r.geomStr); err != nil {
			continue
		}
		obiekty = append(obiekty, r)
	}

	features := make([]map[string]interface{}, 0, len(obiekty))
	for _, o := range obiekty {
		wlasciciele, _ := getOwnersForParcel(db, o.id)
		var geomJSON interface{}
		if o.geomStr != "" {
			json.Unmarshal([]byte(o.geomStr), &geomJSON)
		}
		features = append(features, map[string]interface{}{
			"type":     "Feature",
			"id":       o.id,
			"geometry": geomJSON,
			"properties": map[string]interface{}{
				"numer_obiektu": o.nazwa,
				"kategoria":     o.kategoria,
				"wlasciciele":   wlasciciele,
			},
		})
	}

	return map[string]interface{}{
		"type":     "FeatureCollection",
		"features": features,
	}, nil
}

// GetOwnerParcels zwraca działki właściciela jako JSON (helper).
func GetOwnerParcels(db *sql.DB, ownerID int64) ([]map[string]interface{}, error) {
	rows, err := db.Query(
		`SELECT o.id, o.nazwa_lub_numer
		 FROM dzialki_wlasciciele dw
		 JOIN obiekty_geograficzne o ON o.id = dw.obiekt_id
		 WHERE dw.wlasciciel_id = ?`, ownerID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var id int64
		var nazwa string
		if err := rows.Scan(&id, &nazwa); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"id":              id,
			"nazwa_lub_numer": nazwa,
		})
	}
	return result, nil
}

// getOwnersForParcel zwraca właścicieli dla danej działki (do API_Dzialki).
func getOwnersForParcel(db *sql.DB, obiektID int64) ([]map[string]interface{}, error) {
	rows, err := db.Query(
		`SELECT DISTINCT w.id, w.unikalny_klucz, w.nazwa_wlasciciela, dw.typ_posiadania
		 FROM wlasciciele w JOIN dzialki_wlasciciele dw ON w.id = dw.wlasciciel_id
		 WHERE dw.obiekt_id = ?`, obiektID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var id int64
		var klucz, nazwa string
		var typ *string
		if err := rows.Scan(&id, &klucz, &nazwa, &typ); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"id":             id,
			"unikalny_klucz": klucz,
			"nazwa":          nazwa,
			"typ_posiadania": typ,
		})
	}
	return result, nil
}

// GetParcelsWithArea zwraca działki właściciela z powierzchnią.
func GetParcelsWithArea(db *sql.DB, ownerID int64, houseNum *string) (
	protokol, rzeczywiste []map[string]interface{}, domID *int64,
) {
	rows, err := db.Query(
		`SELECT o.id, o.nazwa_lub_numer, o.kategoria, o.geometria_geojson, dw.typ_posiadania
		 FROM dzialki_wlasciciele dw
		 JOIN obiekty_geograficzne o ON o.id = dw.obiekt_id
		 WHERE dw.wlasciciel_id = ?`, ownerID,
	)
	if err != nil {
		return
	}
	defer rows.Close()

	seenProtokol := map[int64]bool{}
	seenRzeczywiste := map[int64]bool{}
	var firstBuildingOID int64
	hasBuilding := false
	for rows.Next() {
		var oid int64
		var nazwa, kat string
		var geomStr, typ *string
		if err := rows.Scan(&oid, &nazwa, &kat, &geomStr, &typ); err != nil {
			continue
		}
		area := 0.0
		if geomStr != nil {
			area = geo.AreaM2(*geomStr)
		}
		if houseNum != nil && (kat == "dom" || kat == "budynek" || kat == "budowlana") {
			if nazwa == *houseNum {
				domID = &oid
			}
			if !hasBuilding {
				firstBuildingOID = oid
				hasBuilding = true
			}
		}
		p := map[string]interface{}{
			"id":              oid,
			"nazwa_lub_numer": nazwa,
			"kategoria":       kat,
			"powierzchnia_m2": area,
		}
		typNorm := ""
		if typ != nil {
			typNorm = strings.ToLower(strings.TrimSpace(*typ))
		}
		// Dokładnie odwzorowujemy logikę oryginalnego Pythona:
		//   protokół = wszystko co NIE jest „własność rzeczywista” (lub NULL)
		//   rzeczywiste = tylko te oznaczone „własność rzeczywista”
		isReal := strings.Contains(typNorm, "rzeczywist")
		isProtocol := !isReal

		if isReal && !seenRzeczywiste[oid] {
			rzeczywiste = append(rzeczywiste, p)
			seenRzeczywiste[oid] = true
		}
		if isProtocol && !seenProtokol[oid] {
			protokol = append(protokol, p)
			seenProtokol[oid] = true
		}
	}
	if domID == nil && hasBuilding {
		domID = &firstBuildingOID
	}
	sortParcels(protokol)
	sortParcels(rzeczywiste)
	return
}

func sortParcels(items []map[string]interface{}) {
	sort.SliceStable(items, func(i, j int) bool {
		ai, af := parcelSortKey(fmt.Sprint(items[i]["nazwa_lub_numer"]))
		bi, bf := parcelSortKey(fmt.Sprint(items[j]["nazwa_lub_numer"]))
		if ai != bi {
			return ai < bi
		}
		if af != bf {
			return af < bf
		}
		return fmt.Sprint(items[i]["nazwa_lub_numer"]) < fmt.Sprint(items[j]["nazwa_lub_numer"])
	})
}

func parcelSortKey(s string) (int, int) {
	parts := []string{""}
	for _, r := range s {
		if unicode.IsDigit(r) {
			parts[len(parts)-1] += string(r)
		} else if parts[len(parts)-1] != "" {
			parts = append(parts, "")
		}
	}
	a, _ := strconv.Atoi(parts[0])
	b := 0
	if len(parts) > 1 {
		b, _ = strconv.Atoi(parts[1])
	}
	return a, b
}
