package service

import (
	"czarna-mapa/internal/geo"
	"database/sql"
	"fmt"
	"log"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// PobierzStatystyki zwraca pełne dane statystyczne.
func PobierzStatystyki(db *sql.DB) (map[string]interface{}, error) {
	totalOwners := queryOneInt64(db, "SELECT COUNT(*) FROM wlasciciele")
	totalPlots := queryOneInt64(db, "SELECT COUNT(*) FROM obiekty_geograficzne WHERE kategoria != 'obrys_miejscowosci'")
	totalPeople := queryOneInt64(db, "SELECT COUNT(*) FROM osoby_genealogia")

	catCounts := categoryCounts(db)
	maleCount, femaleCount := genderCounts(db)
	totalArea, minArea, maxArea := areaSummary(db)
	locationArea := locationAreaM2(db)
	totalAreaHa := totalArea / 10000.0

	rankingsReal := rankings(db, "real")
	rankingsProtocol := rankings(db, "protocol")
	parcelsRanking := parcelsByArea(db)
	riversRanking, roadsRanking := riversRoadsRanking(db)
	jewish := jewishStats(db)
	demoOfficial := DemografiaTable(db)
	demoDynamic := DynamicDemography(db)
	protocols := protocolsPerDay(db)
	genealogy := genealogyStats(db, totalPeople, maleCount, femaleCount)

	// Rzeki/drogi stats
	var riversLen, roadsLen []float64
	for _, r := range riversRanking {
		if v, ok := r["length_m"].(float64); ok {
			riversLen = append(riversLen, v)
		}
	}
	for _, r := range roadsRanking {
		if v, ok := r["length_m"].(float64); ok {
			roadsLen = append(roadsLen, v)
		}
	}
	riversCount := int64(len(riversLen))
	roadsCount := int64(len(roadsLen))

	maxRivers := 0.0
	for _, v := range riversLen { if v > maxRivers { maxRivers = v } }
	sumRivers := 0.0
	for _, v := range riversLen { sumRivers += v }
	avgRivers := 0.0
	if riversCount > 0 { avgRivers = sumRivers / float64(riversCount) }
	minRivers := maxRivers
	for _, v := range riversLen { if v < minRivers { minRivers = v } }
	if riversCount == 0 { minRivers = 0 }

	maxRoads := 0.0
	for _, v := range roadsLen { if v > maxRoads { maxRoads = v } }
	sumRoads := 0.0
	for _, v := range roadsLen { sumRoads += v }
	avgRoads := 0.0
	if roadsCount > 0 { avgRoads = sumRoads / float64(roadsCount) }
	minRoads := maxRoads
	for _, v := range roadsLen { if v < minRoads { minRoads = v } }
	if roadsCount == 0 { minRoads = 0 }

	return map[string]interface{}{
		"general_stats": map[string]interface{}{
			"total_owners": totalOwners, "total_plots": totalPlots,
		},
		"area_stats": map[string]interface{}{
			"total_area_ha": totalAreaHa,
			"avg_area_ares": func() float64 { if totalPlots > 0 { return totalAreaHa * 100.0 / float64(totalPlots) }; return 0 }(),
			"min_area_m2": minArea, "max_area_m2": maxArea,
		},
		"rivers_stats": map[string]interface{}{
			"total_count": riversCount, "max_length_m": maxRivers,
			"avg_length_m": avgRivers, "min_length_m": minRivers,
		},
		"roads_stats": map[string]interface{}{
			"total_count": roadsCount, "max_length_m": maxRoads,
			"avg_length_m": avgRoads, "min_length_m": minRoads,
		},
		"drawn_percentage": map[string]interface{}{
			"drawn_count": totalPlots, "protocol_count": totalPlots,
			"percentage": 100.0, "missing_count": 0,
		},
		"location_area": map[string]interface{}{
			"area_hectares": locationArea / 10000.0,
			"area_km2":      locationArea / 1_000_000.0,
		},
		"jewish_stats":       jewish,
		"category_counts":    catCounts,
		"rankings_real":      rankingsReal,
		"rankings_protocol":  rankingsProtocol,
		"parcels_ranking":    parcelsRanking,
		"rivers_ranking":     riversRanking,
		"roads_ranking":      roadsRanking,
		"demografia":         demoDynamic,
		"demografia_official": demoOfficial,
		"protocols_per_day":  protocols,
		"genealogy_stats":    genealogy,
	}, nil
}

// PobierzDaneGraful zwraca dane dla wizualizacji grafu.
func PobierzDaneGraful(db *sql.DB) (map[string]interface{}, error) {
	var nodes []map[string]interface{}
	var edges []map[string]interface{}

	rows, err := db.Query("SELECT unikalny_klucz, nazwa_wlasciciela, numer_protokolu FROM wlasciciele")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var klucz, nazwa string
		var lp *int32
		if err := rows.Scan(&klucz, &nazwa, &lp); err != nil {
			continue
		}
		lpStr := "N/A"
		if lp != nil {
			lpStr = strings.TrimSpace(strings.Replace(
				strings.Replace(
					strings.Replace(
						fmt.Sprintf("%d", *lp), "\u00a0", "", -1),
					"\u2007", "", -1),
				" ", "", -1))
		}
		label := nazwa + "\n(Lp. " + lpStr + ")"
		nodes = append(nodes, map[string]interface{}{
			"id":    klucz,
			"label": label,
			"title": "Protokół Lp. " + lpStr,
		})
	}

	re := regexp.MustCompile(`\[\[.*?\|(.*?)\]\]`)
	rows2, err := db.Query("SELECT unikalny_klucz, powiazania_i_transakcje FROM wlasciciele")
	if err != nil {
		// Nodes alone are fine
		return map[string]interface{}{"nodes": nodes, "edges": edges}, nil
	}
	defer rows2.Close()

	seen := make(map[string]bool)
	for rows2.Next() {
		var klucz string
		var trans *string
		if err := rows2.Scan(&klucz, &trans); err != nil {
			continue
		}
		if trans == nil {
			continue
		}
		for _, match := range re.FindAllStringSubmatch(*trans, -1) {
			cel := match[1]
			pair := klucz + "|" + cel
			if klucz != cel && !seen[pair] {
				seen[pair] = true
				edges = append(edges, map[string]interface{}{
					"from": klucz, "to": cel, "arrows": "to",
				})
			}
		}
	}

	return map[string]interface{}{
		"nodes": nodes,
		"edges": edges,
	}, nil
}

// PobierzGenealogieWlasciciela zwraca osoby dla właściciela.
func PobierzGenealogieWlasciciela(db *sql.DB, klucz string) (map[string]interface{}, error) {
	var wid int64
	err := db.QueryRow("SELECT id FROM wlasciciele WHERE unikalny_klucz = ?", klucz).Scan(&wid)
	if err != nil {
		return map[string]interface{}{"osoby": []interface{}{}}, nil
	}

	rows, err := db.Query(
		`SELECT id, json_id, imie_nazwisko, plec, numer_domu, rok_urodzenia, rok_smierci,
		        id_ojca, id_matki, id_protokolu, uwagi
		 FROM osoby_genealogia WHERE id_protokolu = ?`, wid,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var osoby []map[string]interface{}
	for rows.Next() {
		var id, jsonID int64
		var imie string
		var plec, numerDomu, uwagi *string
		var rokUr, rokSm *int32
		var idOjca, idMatki, idProt *int64
		if err := rows.Scan(&id, &jsonID, &imie, &plec, &numerDomu, &rokUr, &rokSm,
			&idOjca, &idMatki, &idProt, &uwagi); err != nil {
			continue
		}
		osoby = append(osoby, map[string]interface{}{
			"id": id, "json_id": jsonID, "imie_nazwisko": imie,
			"plec": plec, "numer_domu": numerDomu,
			"rok_urodzenia": rokUr, "rok_smierci": rokSm,
			"id_ojca": idOjca, "id_matki": idMatki,
			"id_protokolu": idProt, "uwagi": uwagi,
		})
	}
	return map[string]interface{}{"osoby": osoby}, nil
}

// ============== HELPERS ==============

func queryOneInt64(db *sql.DB, query string) int64 {
	var v int64
	db.QueryRow(query).Scan(&v)
	return v
}

func categoryCounts(db *sql.DB) map[string]int64 {
	rows, err := db.Query("SELECT kategoria, COUNT(*) FROM obiekty_geograficzne WHERE kategoria IS NOT NULL AND kategoria != 'obrys_miejscowosci' GROUP BY kategoria")
	if err != nil { return nil }
	defer rows.Close()

	m := make(map[string]int64)
	for rows.Next() {
		var kat string; var cnt int64
		if rows.Scan(&kat, &cnt) == nil { m[kat] = cnt }
	}
	return m
}

func genderCounts(db *sql.DB) (int64, int64) {
	rows, err := db.Query("SELECT plec, COUNT(*) FROM osoby_genealogia GROUP BY plec")
	if err != nil { return 0, 0 }
	defer rows.Close()

	var m, f int64
	for rows.Next() {
		var plec sql.NullString; var cnt int64
		if rows.Scan(&plec, &cnt) != nil { continue }
		p := ""
		if plec.Valid { p = plec.String }
		log.Printf("[DEBUG] plec='%s' count=%d", p, cnt)
		switch p {
		case "M", "m": m = cnt
		case "K", "k", "F", "f": f += cnt
		}
	}
	return m, f
}

func areaSummary(db *sql.DB) (total, min, max float64) {
	min = 1e18
	rows, err := db.Query("SELECT geometria_geojson FROM obiekty_geograficzne WHERE geometria_geojson IS NOT NULL AND kategoria != 'obrys_miejscowosci'")
	if err != nil { return }
	defer rows.Close()

	for rows.Next() {
		var geom *string
		if rows.Scan(&geom) != nil || geom == nil { continue }
		area := geo.AreaM2(*geom)
		if area > 0 {
			total += area
			if area < min { min = area }
			if area > max { max = area }
		}
	}
	if min == 1e18 { min = 0 }
	return
}

func locationAreaM2(db *sql.DB) float64 {
	var geom *string
	err := db.QueryRow("SELECT geometria_geojson FROM obiekty_geograficzne WHERE kategoria='obrys_miejscowosci' AND geometria_geojson IS NOT NULL LIMIT 1").Scan(&geom)
	if err != nil || geom == nil { return 0 }
	return geo.AreaM2(*geom)
}

func rankings(db *sql.DB, typ string) map[string]interface{} {
	cats := []string{"all_plots", "rolna", "budowlana", "las", "pastwisko", "droga", "rzeka", "budynek", "kapliczka", "obiekt_specjalny"}
	result := make(map[string]interface{})

	for _, cat := range cats {
		owners := make(map[int64]*ownerAgg)
		catFilter := ""
		if cat != "all_plots" { catFilter = "AND o.kategoria = '" + cat + "'" }

		realCond := "(dw.typ_posiadania = 'wlasnosc rzeczywista' OR dw.typ_posiadania = 'wlasnosc rzeczywista')"
		protoCond := "(dw.typ_posiadania IS NULL OR (dw.typ_posiadania != 'wlasnosc rzeczywista' AND dw.typ_posiadania != 'wlasnosc rzeczywista'))"
		cond := realCond
		if typ == "protocol" { cond = protoCond }

		query := strings.Join([]string{
			"SELECT w.id, w.nazwa_wlasciciela, w.unikalny_klucz, w.numer_protokolu, o.nazwa_lub_numer, o.geometria_geojson",
			"FROM wlasciciele w JOIN dzialki_wlasciciele dw ON w.id = dw.wlasciciel_id",
			"JOIN obiekty_geograficzne o ON dw.obiekt_id = o.id",
			"WHERE", cond, catFilter,
		}, " ")

		rows, err := db.Query(query)
		if err != nil { continue }
		for rows.Next() {
			var id int64; var nazwa, klucz, plotNum string
			var lp *int32; var geom *string
			if rows.Scan(&id, &nazwa, &klucz, &lp, &plotNum, &geom) != nil { continue }

			ag, ok := owners[id]
			if !ok {
				ag = &ownerAgg{name: nazwa, key: klucz, protocol: lp}
				owners[id] = ag
			}
			ag.plotCount++
			if geom != nil { ag.totalArea += geo.AreaM2(*geom) }
			ag.plotNums = append(ag.plotNums, plotNum)
		}
		rows.Close()

		items := make([]map[string]interface{}, 0, len(owners))
		for _, ag := range owners {
			items = append(items, map[string]interface{}{
				"nazwa_wlasciciela": ag.name, "unikalny_klucz": ag.key,
				"numer_protokolu": ag.protocol, "plot_count": ag.plotCount,
				"total_area_m2": ag.totalArea, "plot_numbers": ag.plotNums,
			})
		}
		sort.Slice(items, func(i, j int) bool {
			return items[i]["plot_count"].(int64) > items[j]["plot_count"].(int64)
		})
		result[cat] = items
	}
	return result
}

type ownerAgg struct {
	name      string
	key       string
	protocol  *int32
	plotCount int64
	totalArea float64
	plotNums  []string
}

func parcelsByArea(db *sql.DB) map[string]interface{} {
	cats := []string{"all", "rolna", "budowlana", "las", "pastwisko"}
	result := make(map[string]interface{})

	for _, cat := range cats {
		catFilter := "WHERE o.kategoria != 'obrys_miejscowosci'"
		if cat != "all" { catFilter = "WHERE o.kategoria = '" + cat + "'" }

		query := strings.Join([]string{
			"SELECT o.nazwa_lub_numer, w.nazwa_wlasciciela, w.unikalny_klucz, o.geometria_geojson",
			"FROM obiekty_geograficzne o",
			"LEFT JOIN dzialki_wlasciciele dw ON o.id = dw.obiekt_id",
			"LEFT JOIN wlasciciele w ON dw.wlasciciel_id = w.id",
			catFilter,
		}, " ")

		rows, err := db.Query(query)
		if err != nil { continue }

		var items []map[string]interface{}
		for rows.Next() {
			var plotNum string; var wlascNazwa, wlascKlucz *string; var geom *string
			if rows.Scan(&plotNum, &wlascNazwa, &wlascKlucz, &geom) != nil { continue }
			area := 0.0
			if geom != nil { area = geo.AreaM2(*geom) }
			items = append(items, map[string]interface{}{
				"parcel_number": plotNum, "nazwa_wlasciciela": wlascNazwa,
				"unikalny_klucz": wlascKlucz, "area_m2": area,
			})
		}
		rows.Close()

		sort.Slice(items, func(i, j int) bool {
			return items[i]["area_m2"].(float64) > items[j]["area_m2"].(float64)
		})
		if len(items) > 50 { items = items[:50] }
		result[cat] = items
	}
	return result
}

func riversRoadsRanking(db *sql.DB) ([]map[string]interface{}, []map[string]interface{}) {
	rows, err := db.Query("SELECT nazwa_lub_numer, kategoria, geometria_geojson FROM obiekty_geograficzne WHERE kategoria IN ('rzeka', 'droga')")
	if err != nil { return nil, nil }
	defer rows.Close()

	var rivers, roads []map[string]interface{}
	for rows.Next() {
		var nazwa, kat string; var geom *string
		if rows.Scan(&nazwa, &kat, &geom) != nil { continue }
		length := 0.0
		if geom != nil { length = geo.LineLengthM(*geom) }
		item := map[string]interface{}{"length_m": length}
		if kat == "rzeka" { item["river_name"] = nazwa } else { item["road_number"] = nazwa }
		if kat == "rzeka" { rivers = append(rivers, item) } else { roads = append(roads, item) }
	}
	sort.Slice(rivers, func(i, j int) bool { return rivers[i]["length_m"].(float64) > rivers[j]["length_m"].(float64) })
	sort.Slice(roads, func(i, j int) bool { return roads[i]["length_m"].(float64) > roads[j]["length_m"].(float64) })
	return rivers, roads
}

func jewishStats(db *sql.DB) map[string]interface{} {
	query := `SELECT w.id, w.nazwa_wlasciciela, w.unikalny_klucz, w.numer_protokolu, o.geometria_geojson
		FROM wlasciciele w LEFT JOIN dzialki_wlasciciele dw ON w.id = dw.wlasciciel_id
		LEFT JOIN obiekty_geograficzne o ON dw.obiekt_id = o.id
		WHERE (w.nazwa_wlasciciela LIKE '%Grunstein%' OR w.nazwa_wlasciciela LIKE '%Wachtel%'
		   OR w.nazwa_wlasciciela LIKE '%Fisch%' OR w.nazwa_wlasciciela LIKE '%Hudes%'
		   OR w.nazwa_wlasciciela LIKE '%Gastwirth%' OR w.nazwa_wlasciciela LIKE '%Neubert%'
		   OR w.nazwa_wlasciciela LIKE '%Grinstein%')`

	rows, err := db.Query(query)
	if err != nil { return map[string]interface{}{} }
	defer rows.Close()

	aggs := make(map[int64]*ownerAgg)
	var totalParcels int64
	var totalArea float64

	for rows.Next() {
		var id int64; var nazwa, klucz string; var lp *int32; var geom *string
		if rows.Scan(&id, &nazwa, &klucz, &lp, &geom) != nil { continue }

		ag, ok := aggs[id]
		if !ok {
			ag = &ownerAgg{name: nazwa, key: klucz, protocol: lp}
			aggs[id] = ag
		}
		if geom != nil {
			ag.plotCount++
			area := geo.AreaM2(*geom)
			ag.totalArea += area
			totalArea += area
			totalParcels++
		}
	}

	owners := make([]map[string]interface{}, 0, len(aggs))
	for _, ag := range aggs {
		owners = append(owners, map[string]interface{}{
			"nazwa_wlasciciela": ag.name, "unikalny_klucz": ag.key,
			"numer_protokolu": ag.protocol, "parcels_count": ag.plotCount,
			"total_area_m2": ag.totalArea,
		})
	}
	return map[string]interface{}{
		"owners_count": len(owners), "parcels_count": totalParcels,
		"total_area_ha": totalArea / 10000.0, "owners": owners,
	}
}

func protocolsPerDay(db *sql.DB) []map[string]interface{} {
	rows, err := db.Query("SELECT data_protokolu, unikalny_klucz, nazwa_wlasciciela FROM wlasciciele WHERE data_protokolu IS NOT NULL")
	if err != nil { return nil }
	defer rows.Close()

	byDate := make(map[string][]map[string]interface{})
	for rows.Next() {
		var data, klucz, nazwa string
		if rows.Scan(&data, &klucz, &nazwa) != nil { continue }
		iso := parsePolishDate(data)
		byDate[iso] = append(byDate[iso], map[string]interface{}{
			"unikalny_klucz": klucz, "nazwa_wlasciciela": nazwa,
		})
	}

	var result []map[string]interface{}
	for date, owners := range byDate {
		result = append(result, map[string]interface{}{
			"protocol_date": date, "protocol_count": len(owners), "owners": owners,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i]["protocol_date"].(string) < result[j]["protocol_date"].(string)
	})
	return result
}

func parsePolishDate(text string) string {
	months := map[string]int{
		"stycznia":1,"lutego":2,"marca":3,"kwietnia":4,"maja":5,"czerwca":6,
		"lipca":7,"sierpnia":8,"wrzesnia":9,"pazdziernika":10,"listopada":11,"grudnia":12,
		"styczeń":1,"luty":2,"marzec":3,"kwiecień":4,"maj":5,"czerwiec":6,
		"lipiec":7,"sierpień":8,"wrzesień":9,"październik":10,"listopad":11,"grudzień":12,
	}
	parts := strings.Fields(text)
	if len(parts) < 3 { return text }

	day := 1
	if d, err := strconv.Atoi(parts[0]); err == nil { day = d }

	monthKey := strings.Trim(strings.ToLower(parts[1]), ",.!-;:")
	month := 1
	for k, v := range months {
		if strings.HasPrefix(monthKey, k) || strings.HasPrefix(k, monthKey) { month = v; break }
	}

	year := 1882
	for _, p := range parts {
		p = strings.Trim(p, ",.!-;:()[]")
		if y, err := strconv.Atoi(p); err == nil && y >= 1700 && y <= 2100 { year = y; break }
	}
	return fmt.Sprintf("%04d-%02d-%02d", year, month, day)
}

func genealogyStats(db *sql.DB, total, male, female int64) map[string]interface{} {
	// Top surnames
	rows, err := db.Query("SELECT imie_nazwisko FROM osoby_genealogia")
	var surnames []map[string]interface{}
	if err == nil {
		defer rows.Close()
		counter := make(map[string]int64)
		for rows.Next() {
			var name string
			if rows.Scan(&name) != nil { continue }
			parts := strings.Fields(name)
			if len(parts) > 0 {
				last := parts[len(parts)-1]
				counter[last]++
			}
		}
		type pair struct { name string; count int64 }
		var pairs []pair
		for n, c := range counter { pairs = append(pairs, pair{n, c}) }
		sort.Slice(pairs, func(i, j int) bool { return pairs[i].count > pairs[j].count })
		for i := 0; i < 10 && i < len(pairs); i++ {
			surnames = append(surnames, map[string]interface{}{
				"name": pairs[i].name, "count": pairs[i].count,
			})
		}
	}

	birthsDec, deathsDec, marriagesDec := decadeStats(db)
	infant := infantMortality(db)
	lifespan := lifespanByGeneration(db)
	deathAge := deathAgeDistribution(db)
	family := familyStructure(db)

	return map[string]interface{}{
		"total_people": total, "male_count": male, "female_count": female,
		"top_surnames": surnames,
		"births_by_decade": birthsDec, "deaths_by_decade": deathsDec, "marriages_by_decade": marriagesDec,
		"infant_mortality": infant,
		"lifespan_by_generation": lifespan,
		"death_age_distribution": deathAge,
		"family_structure": family,
	}
}

func decadeStats(db *sql.DB) (interface{}, interface{}, interface{}) {
	build := func(counter map[int]int32) map[string]interface{} {
		if len(counter) == 0 { return map[string]interface{}{"labels": []string{}, "data": []int32{}} }
		var decades []int
		for d := range counter { decades = append(decades, d) }
		sort.Ints(decades)
		labels := make([]string, len(decades))
		data := make([]int32, len(decades))
		for i, d := range decades {
			labels[i] = fmt.Sprintf("%ds", d)
			data[i] = counter[d]
		}
		return map[string]interface{}{"labels": labels, "data": data}
	}

	births := make(map[int]int32)
	deaths := make(map[int]int32)
	marriages := make(map[int]int32)

	rows, _ := db.Query("SELECT rok_urodzenia, rok_smierci FROM osoby_genealogia")
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var birth, death *int32
			if rows.Scan(&birth, &death) == nil {
				if birth != nil { births[int(*birth/10)*10]++ }
				if death != nil { deaths[int(*death/10)*10]++ }
			}
		}
	}

	rows2, _ := db.Query("SELECT rok_slubu FROM malzenstwa WHERE rok_slubu IS NOT NULL")
	if rows2 != nil {
		defer rows2.Close()
		for rows2.Next() {
			var rok int32
			if rows2.Scan(&rok) == nil { marriages[int(rok/10)*10]++ }
		}
	}

	return build(births), build(deaths), build(marriages)
}

func infantMortality(db *sql.DB) map[string]interface{} {
	rows, _ := db.Query("SELECT rok_urodzenia, rok_smierci FROM osoby_genealogia WHERE rok_urodzenia IS NOT NULL")
	if rows == nil { return map[string]interface{}{} }
	defer rows.Close()

	var infantDeaths, totalBirths int64
	byDecade := make(map[int]int64)

	for rows.Next() {
		var birth int32; var death *int32
		if rows.Scan(&birth, &death) != nil { continue }
		totalBirths++
		if death != nil && *death >= birth && *death-birth <= 1 {
			infantDeaths++
			byDecade[int(birth/10)*10]++
		}
	}

	rate := 0.0
	if totalBirths > 0 { rate = float64(infantDeaths) / float64(totalBirths) * 100.0 }

	var decades []int
	for d := range byDecade { decades = append(decades, d) }
	sort.Ints(decades)
	labels := make([]string, len(decades))
	data := make([]int64, len(decades))
	for i, d := range decades {
		labels[i] = fmt.Sprintf("%ds", d)
		data[i] = byDecade[d]
	}

	return map[string]interface{}{
		"infant_deaths": infantDeaths, "mortality_rate": mathRound(rate*100) / 100,
		"by_decade": map[string]interface{}{"labels": labels, "data": data},
	}
}

func lifespanByGeneration(db *sql.DB) map[string]interface{} {
	rows, _ := db.Query("SELECT rok_urodzenia, rok_smierci FROM osoby_genealogia WHERE rok_urodzenia IS NOT NULL AND rok_smierci IS NOT NULL")
	if rows == nil { return map[string]interface{}{} }
	defer rows.Close()

	byDecade := make(map[int][]int32)
	var allAges []int32
	for rows.Next() {
		var birth, death int32
		if rows.Scan(&birth, &death) != nil || death <= birth { continue }
		age := death - birth
		byDecade[int(birth/10)*10] = append(byDecade[int(birth/10)*10], age)
		allAges = append(allAges, age)
	}

	if len(byDecade) == 0 { return map[string]interface{}{"labels": []string{}, "data": []float64{}, "avg_lifespan": 0, "total_records": 0} }

	var decades []int
	for d := range byDecade { decades = append(decades, d) }
	sort.Ints(decades)

	data := make([]float64, len(decades))
	for i, d := range decades {
		ages := byDecade[d]
		if len(ages) == 0 { continue }
		sum := int32(0)
		for _, a := range ages { sum += a }
		data[i] = mathRound(float64(sum)/float64(len(ages))*10) / 10
	}

	avg := 0.0
	if len(allAges) > 0 {
		sum := int32(0)
		for _, a := range allAges { sum += a }
		avg = mathRound(float64(sum)/float64(len(allAges))*10) / 10
	}

	labels := make([]string, len(decades))
	for i, d := range decades { labels[i] = fmt.Sprintf("%ds", d) }

	return map[string]interface{}{
		"labels": labels, "data": data,
		"avg_lifespan": avg, "total_records": len(allAges),
	}
}

func deathAgeDistribution(db *sql.DB) map[string]interface{} {
	labels := []string{"0-1", "1-5", "5-10", "10-20", "20-30", "30-40", "40-50", "50-60", "60-70", "70-80", "80+"}
	counts := make([]int64, len(labels))
	var total int64

	rows, _ := db.Query("SELECT rok_urodzenia, rok_smierci FROM osoby_genealogia WHERE rok_urodzenia IS NOT NULL AND rok_smierci IS NOT NULL")
	if rows == nil { return map[string]interface{}{"labels": labels, "data": counts, "total_deaths": total} }
	defer rows.Close()

	for rows.Next() {
		var birth, death int32
		if rows.Scan(&birth, &death) != nil || death < birth { continue }
		age := death - birth
		idx := 10
		switch {
		case age <= 1: idx = 0
		case age <= 5: idx = 1
		case age <= 10: idx = 2
		case age <= 20: idx = 3
		case age <= 30: idx = 4
		case age <= 40: idx = 5
		case age <= 50: idx = 6
		case age <= 60: idx = 7
		case age <= 70: idx = 8
		case age <= 80: idx = 9
		}
		counts[idx]++
		total++
	}
	return map[string]interface{}{"labels": labels, "data": counts, "total_deaths": total}
}

func familyStructure(db *sql.DB) map[string]interface{} {
	rows, _ := db.Query("SELECT id_ojca, id_matki FROM osoby_genealogia WHERE id_ojca IS NOT NULL OR id_matki IS NOT NULL")
	if rows == nil { return map[string]interface{}{} }
	defer rows.Close()

	childrenByParent := make(map[int64]int64)
	for rows.Next() {
		var father, mother *int64
		if rows.Scan(&father, &mother) != nil { continue }
		if father != nil { childrenByParent[*father]++ }
		if mother != nil { childrenByParent[*mother]++ }
	}

	var counts []int64
	for _, c := range childrenByParent { counts = append(counts, c) }

	dist := make([]int64, 5)
	for _, c := range counts {
		switch {
		case c == 1: dist[0]++
		case c == 2: dist[1]++
		case c <= 5: dist[2]++
		case c <= 10: dist[3]++
		default: dist[4]++
		}
	}

	avgChildren := 0.0
	if len(counts) > 0 {
		sum := int64(0)
		for _, c := range counts { sum += c }
		avgChildren = mathRound(float64(sum)/float64(len(counts))*100) / 100
	}

	// Household sizes
	rows2, _ := db.Query("SELECT COUNT(*) FROM osoby_genealogia WHERE numer_domu IS NOT NULL AND numer_domu != '' GROUP BY numer_domu")
	var householdSizes []int64
	if rows2 != nil {
		defer rows2.Close()
		for rows2.Next() {
			var cnt int64
			if rows2.Scan(&cnt) == nil { householdSizes = append(householdSizes, cnt) }
		}
	}

	avgHousehold := 0.0
	if len(householdSizes) > 0 {
		sum := int64(0)
		for _, s := range householdSizes { sum += s }
		avgHousehold = mathRound(float64(sum)/float64(len(householdSizes))*10) / 10
	}

	return map[string]interface{}{
		"avg_children_per_parent": avgChildren,
		"family_size_distribution": map[string]interface{}{
			"labels": []string{"1 dziecko", "2 dzieci", "3-5 dzieci", "6-10 dzieci", ">10 dzieci"},
			"data": dist,
		},
		"total_families":    len(counts),
		"avg_household_size": avgHousehold,
		"total_households":  len(householdSizes),
	}
}

// ============== MATH HELPERS ==============

func mathRound(v float64) float64 {
	return math.Round(v)
}
