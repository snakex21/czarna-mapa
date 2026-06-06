package main

import (
	"archive/zip"
	"bytes"
	"czarna-mapa/internal/db"
	"czarna-mapa/internal/models"
	"czarna-mapa/internal/service"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// App trzyma stan (baza + dataDir).
type App struct {
	db          *sql.DB
	dataDir     string
	rootDataDir string
	dbPath      string
}

type HistoryPhotoInfo struct {
	Filename string `json:"filename"`
	Caption  string `json:"caption"`
}

type LocationInfo struct {
	ID                  string             `json:"id"`
	Name                string             `json:"name"`
	FullName            string             `json:"full_name"`
	Powiat              string             `json:"powiat"`
	Region              string             `json:"region"`
	Year                string             `json:"year"`
	Century             string             `json:"century"`
	GminaKatastralna    string             `json:"gmina_katastralna"`
	MiejscowoscProtokol string             `json:"miejscowosc_protokolu"`
	HomepageTemplate    string             `json:"homepage_template"`
	HomepageDescription string             `json:"homepage_description"`
	HistorySubtitle     string             `json:"history_subtitle"`
	HistoryParagraph1   string             `json:"history_paragraph1"`
	HistoryParagraph2   string             `json:"history_paragraph2"`
	HistoryParagraph3   string             `json:"history_paragraph3"`
	HistoryPhotos       []HistoryPhotoInfo `json:"history_photos"`
	DBPath              string             `json:"db_path"`
	DataDir             string             `json:"data_dir"`
	Active              bool               `json:"active"`
	AutoOpen            bool               `json:"auto_open"`
	CreatedAt           string             `json:"created_at,omitempty"`
}

type locationsRegistry struct {
	ActiveID  string         `json:"active_id"`
	AutoOpen  bool           `json:"auto_open"`
	Locations []LocationInfo `json:"locations"`
}

// handleProtokoly serwuje skany tak jak stary Flaskowy endpoint /protokoly/...
// Stare widoki wyszukują obrazy przez <img src="/protokoly/Klucz/1.jpg">,
// dlatego poza RPC udostępniamy bezpieczny statyczny handler do katalogu skanów.
func (a *App) handleProtokoly(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Tylko GET", http.StatusMethodNotAllowed)
		return
	}

	rel := strings.TrimPrefix(r.URL.Path, "/protokoly/")
	rel = filepath.Clean(filepath.FromSlash(rel))
	if rel == "." || filepath.IsAbs(rel) || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || rel == ".." {
		http.Error(w, "Nieprawidlowa sciezka", http.StatusBadRequest)
		return
	}

	base := service.ProtoBaseDir(a.db, a.dataDir)
	filePath := filepath.Join(base, rel)
	absBase, _ := filepath.Abs(base)
	absFile, _ := filepath.Abs(filePath)
	if absFile != absBase && !strings.HasPrefix(absFile, absBase+string(os.PathSeparator)) {
		http.Error(w, "Nieprawidlowa sciezka", http.StatusBadRequest)
		return
	}

	ext := strings.ToLower(filepath.Ext(filePath))
	if ext != ".jpg" && ext != ".jpeg" && ext != ".png" {
		http.NotFound(w, r)
		return
	}
	if _, err := os.Stat(filePath); err != nil {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, filePath)
}

// handleMapaJPG serwuje mapę aktywnej miejscowości. Jeśli nie ma pliku w danych,
// używa wbudowanej obecnej mapy Czarnej jako fallbacku.
func (a *App) handleMapaJPG(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Tylko GET", http.StatusMethodNotAllowed)
		return
	}
	mapPath := filepath.Join(a.dataDir, "mapa.jpg")
	if f, err := os.Open(mapPath); err == nil {
		defer f.Close()
		w.Header().Set("Content-Type", "image/jpeg")
		http.ServeContent(w, r, "mapa.jpg", time.Now(), f)
		return
	}
	b, err := frontend.ReadFile("frontend/mapa/mapa.jpg")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	http.ServeContent(w, r, "mapa.jpg", time.Now(), bytes.NewReader(b))
}

func (a *App) handleLocationFavicon(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Tylko GET", http.StatusMethodNotAllowed)
		return
	}
	for _, p := range []string{
		filepath.Join(a.dataDir, "favicon.jpeg"),
		filepath.Join(a.dataDir, "custom_icon.ico"),
		filepath.Join("resources", "app.ico"),
	} {
		if f, err := os.Open(p); err == nil {
			defer f.Close()
			ext := strings.ToLower(filepath.Ext(p))
			if ext == ".ico" {
				w.Header().Set("Content-Type", "image/x-icon")
			} else {
				w.Header().Set("Content-Type", "image/jpeg")
			}
			http.ServeContent(w, r, filepath.Base(p), time.Now(), f)
			return
		}
	}
	b, err := frontend.ReadFile("frontend/favicon.jpeg")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	http.ServeContent(w, r, "favicon.jpeg", time.Now(), bytes.NewReader(b))
}

func (a *App) handleHistoryPhotos(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Tylko GET", http.StatusMethodNotAllowed)
		return
	}
	rel := strings.TrimPrefix(r.URL.Path, "/history_photos/")
	rel = filepath.Clean(filepath.FromSlash(rel))
	if rel == "." || filepath.IsAbs(rel) || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || rel == ".." {
		http.Error(w, "Nieprawidlowa sciezka", http.StatusBadRequest)
		return
	}
	base := filepath.Join(a.dataDir, "history_photos")
	filePath := filepath.Join(base, rel)
	absBase, _ := filepath.Abs(base)
	absFile, _ := filepath.Abs(filePath)
	if absFile != absBase && !strings.HasPrefix(absFile, absBase+string(os.PathSeparator)) {
		http.Error(w, "Nieprawidlowa sciezka", http.StatusBadRequest)
		return
	}
	ext := strings.ToLower(filepath.Ext(filePath))
	if ext != ".jpg" && ext != ".jpeg" && ext != ".png" && ext != ".webp" {
		http.NotFound(w, r)
		return
	}
	if _, err := os.Stat(filePath); err != nil {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, filePath)
}

// handlePointPhotos serwuje oryginalne zdjęcia z galerii punktów historycznych
// (data/point_photos/). Miniatury idą przez /obj_thumb?path=point_photos/<plik>&w=...
// Cache nagłówki: 1 dzień (pliki są niezmienne po uploadzie - unikalna nazwa).
func (a *App) handlePointPhotos(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Tylko GET", http.StatusMethodNotAllowed)
		return
	}
	rel := strings.TrimPrefix(r.URL.Path, "/point_photos/")
	rel = filepath.Clean(filepath.FromSlash(rel))
	if rel == "." || filepath.IsAbs(rel) || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || rel == ".." {
		http.Error(w, "Nieprawidlowa sciezka", http.StatusBadRequest)
		return
	}
	base := filepath.Join(a.dataDir, "point_photos")
	filePath := filepath.Join(base, rel)
	absBase, _ := filepath.Abs(base)
	absFile, _ := filepath.Abs(filePath)
	if absFile != absBase && !strings.HasPrefix(absFile, absBase+string(os.PathSeparator)) {
		http.Error(w, "Nieprawidlowa sciezka", http.StatusBadRequest)
		return
	}
	ext := strings.ToLower(filepath.Ext(filePath))
	if ext != ".jpg" && ext != ".jpeg" && ext != ".png" && ext != ".webp" && ext != ".gif" {
		http.NotFound(w, r)
		return
	}
	if _, err := os.Stat(filePath); err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("Content-Type", service.MimeForExt(ext))
	http.ServeFile(w, r, filePath)
}

// handleObjThumb generuje (lub serwuje z cache) miniaturkę dowolnego obrazu
// w dataDir. Parametry query:
//   - path — ścieżka względna do dataDir (np. "protokoly/Adam/1.jpg",
//            "history_photos/dworzec.png", "point_photos/123_abc.jpg")
//   - w    — żądana szerokość w px (domyślnie 240, max 800)
func (a *App) handleObjThumb(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Tylko GET", http.StatusMethodNotAllowed)
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "Brak parametru path", http.StatusBadRequest)
		return
	}
	wStr := r.URL.Query().Get("w")
	width := 240
	if wStr != "" {
		if v, err := strconv.Atoi(wStr); err == nil && v > 0 {
			width = v
		}
	}
	cachePath, err := service.GenerujThumbnail(a.dataDir, path, width)
	if err != nil {
		// Brak pliku źródłowego = cichy 404 (żeby pętle <img> nie zaśmiecały konsoli)
		if os.IsNotExist(err) {
			http.NotFound(w, r)
			return
		}
		log.Printf("[THUMB] błąd %s: %v", path, err)
		http.Error(w, "Błąd generowania miniatury", http.StatusInternalServerError)
		return
	}
	// Cache HTTP — 30 dni, plik jest opisany SHA-1, więc niezmienny
	w.Header().Set("Cache-Control", "public, max-age=2592000, immutable")
	w.Header().Set("Content-Type", "image/jpeg")
	http.ServeFile(w, r, cachePath)
}

func (a *App) handleLocationConfigJS(w http.ResponseWriter, r *http.Request) {
	loc, _ := a.activeLocation()
	if loc == nil {
		loc = &LocationInfo{Name: "Czarna", FullName: "Czarna", Powiat: "Dębicki", Region: "Podkarpackie", Year: "1882", Century: "XIX w."}
	}
	config := map[string]interface{}{
		"name":                loc.Name,
		"fullName":            loc.FullName,
		"powiat":              loc.Powiat,
		"region":              loc.Region,
		"year":                loc.Year,
		"century":             loc.Century,
		"homepageDescription": loc.HomepageDescription,
		"historySubtitle":     loc.HistorySubtitle,
		"historyParagraph1":   loc.HistoryParagraph1,
		"historyParagraph2":   loc.HistoryParagraph2,
		"historyParagraph3":   loc.HistoryParagraph3,
		"historyPhotos":       loc.HistoryPhotos,
	}
	b, _ := json.MarshalIndent(config, "", "  ")
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte("// Konfiguracja aktualnej miejscowości\nwindow.LOCATION_CONFIG = "))
	_, _ = w.Write(b)
	_, _ = w.Write([]byte(";\n"))
}

// handleRPC obsługuje POST /api/rpc z ciałem: {"cmd":"...","args":{...}}
func (a *App) handleRPC(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Tylko POST", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Cmd  string                 `json:"cmd"`
		Args map[string]interface{} `json:"args"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	result, err := a.dispatch(req.Cmd, req.Args)
	if err != nil {
		log.Printf("[RPC] %s → ERROR: %v", req.Cmd, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Konwertuj nil slice na pusty array (JS nie lubi null zamiast [])
	result = fixNullSlice(result)

	log.Printf("[RPC] %s → OK", req.Cmd)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (a *App) handleLegacyAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Tylko GET", http.StatusMethodNotAllowed)
		return
	}
	cmd := ""
	args := map[string]interface{}{}
	switch r.URL.Path {
	case "/api/dzialki":
		cmd = "api_dzialki"
	case "/api/genealogia/persons-format":
		cmd = "api_genealogia_persons"
	default:
		if strings.HasPrefix(r.URL.Path, "/api/wlasciciel/") {
			cmd = "api_wlasciciel"
			args["klucz"] = strings.TrimPrefix(r.URL.Path, "/api/wlasciciel/")
		} else if strings.HasPrefix(r.URL.Path, "/api/genealogia/") {
			cmd = "api_genealogia_tree"
			args["klucz"] = strings.TrimPrefix(r.URL.Path, "/api/genealogia/")
		} else {
			http.NotFound(w, r)
			return
		}
	}
	result, err := a.dispatch(cmd, args)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	result = fixNullSlice(result)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(result)
}

func (a *App) handleFamilyCardPDF(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Tylko GET", http.StatusMethodNotAllowed)
		return
	}
	idStr := strings.TrimPrefix(r.URL.Path, "/api/genealogia/pdf/")
	idStr = strings.Trim(idStr, "/")
	if idStr == "" {
		http.Error(w, "Brak ID osoby", http.StatusBadRequest)
		return
	}
	var dbID, jsonID int64
	var name string
	var gender, house, notes, proto *string
	var birth, death *int32
	var fatherID, motherID *int64
	err := a.db.QueryRow(`SELECT p.id,p.json_id,p.imie_nazwisko,p.plec,p.numer_domu,p.rok_urodzenia,p.rok_smierci,p.id_ojca,p.id_matki,p.uwagi,w.unikalny_klucz
		FROM osoby_genealogia p LEFT JOIN wlasciciele w ON p.id_protokolu=w.id WHERE p.json_id=?`, idStr).
		Scan(&dbID, &jsonID, &name, &gender, &house, &birth, &death, &fatherID, &motherID, &notes, &proto)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	type personLite struct {
		DBID, JSONID    int64
		Name            string
		Father, Mother  *int64
		House, Gender   *string
		Birth, Death    *int32
		Notes, ProtoKey *string
	}
	allRows, _ := a.db.Query(`SELECT p.id,p.json_id,p.imie_nazwisko,p.plec,p.numer_domu,p.rok_urodzenia,p.rok_smierci,p.id_ojca,p.id_matki,p.uwagi,w.unikalny_klucz FROM osoby_genealogia p LEFT JOIN wlasciciele w ON p.id_protokolu=w.id`)
	people := map[int64]personLite{}
	if allRows != nil {
		defer allRows.Close()
		for allRows.Next() {
			var p personLite
			_ = allRows.Scan(&p.DBID, &p.JSONID, &p.Name, &p.Gender, &p.House, &p.Birth, &p.Death, &p.Father, &p.Mother, &p.Notes, &p.ProtoKey)
			people[p.DBID] = p
		}
	}
	personName := func(id *int64) string {
		if id == nil {
			return ""
		}
		if p, ok := people[*id]; ok {
			return p.Name
		}
		return fmt.Sprintf("ID %d", *id)
	}
	collectNames := func(ids []int64, limit int) []string {
		out := []string{}
		for _, id := range ids {
			if p, ok := people[id]; ok {
				out = append(out, p.Name)
			}
			if limit > 0 && len(out) >= limit {
				break
			}
		}
		return out
	}
	spouseRows, _ := a.db.Query(`SELECT CASE WHEN malzonek1_id=? THEN malzonek2_id ELSE malzonek1_id END FROM malzenstwa WHERE malzonek1_id=? OR malzonek2_id=?`, dbID, dbID, dbID)
	spouseIDs := []int64{}
	if spouseRows != nil {
		defer spouseRows.Close()
		for spouseRows.Next() {
			var id int64
			if spouseRows.Scan(&id) == nil {
				spouseIDs = append(spouseIDs, id)
			}
		}
	}
	childIDs := []int64{}
	for id, p := range people {
		if (p.Father != nil && *p.Father == dbID) || (p.Mother != nil && *p.Mother == dbID) {
			childIDs = append(childIDs, id)
		}
	}
	sort.Slice(childIDs, func(i, j int) bool { return people[childIDs[i]].Name < people[childIDs[j]].Name })
	siblingIDs := []int64{}
	for id, p := range people {
		if id == dbID {
			continue
		}
		if (fatherID != nil && p.Father != nil && *p.Father == *fatherID) || (motherID != nil && p.Mother != nil && *p.Mother == *motherID) {
			siblingIDs = append(siblingIDs, id)
		}
	}
	grandparents := []string{}
	if fatherID != nil {
		if fp, ok := people[*fatherID]; ok {
			if fp.Father != nil {
				grandparents = append(grandparents, personName(fp.Father)+" (Ojciec Ojca)")
			}
			if fp.Mother != nil {
				grandparents = append(grandparents, personName(fp.Mother)+" (Matka Ojca)")
			}
		}
	}
	if motherID != nil {
		if mp, ok := people[*motherID]; ok {
			if mp.Father != nil {
				grandparents = append(grandparents, personName(mp.Father)+" (Ojciec Matki)")
			}
			if mp.Mother != nil {
				grandparents = append(grandparents, personName(mp.Mother)+" (Matka Matki)")
			}
		}
	}
	relLines := []string{}
	if len(grandparents) > 0 {
		relLines = append(relLines, "• Dziadkowie: "+strings.Join(grandparents, ", "))
	} else {
		relLines = append(relLines, "• Dziadkowie: Brak danych")
	}
	parents := []string{}
	if fatherID != nil {
		parents = append(parents, personName(fatherID))
	}
	if motherID != nil {
		parents = append(parents, personName(motherID))
	}
	if len(parents) > 0 {
		relLines = append(relLines, "• Rodzice: "+strings.Join(parents, ", "))
	} else {
		relLines = append(relLines, "• Rodzice: Brak danych")
	}
	if spouses := collectNames(spouseIDs, 0); len(spouses) > 0 {
		relLines = append(relLines, "• Małżeństwa: "+strings.Join(spouses, ", "))
	}
	if siblings := collectNames(siblingIDs, 6); len(siblings) > 0 {
		suffix := ""
		if len(siblingIDs) > 6 {
			suffix = "..."
		}
		relLines = append(relLines, fmt.Sprintf("• Rodzeństwo (%d): %s%s", len(siblingIDs), strings.Join(siblings, ", "), suffix))
	} else {
		relLines = append(relLines, "• Rodzeństwo: Brak danych")
	}
	if children := collectNames(childIDs, 6); len(children) > 0 {
		suffix := ""
		if len(childIDs) > 6 {
			suffix = fmt.Sprintf(", ... (+%d)", len(childIDs)-6)
		}
		relLines = append(relLines, fmt.Sprintf("• Dzieci (%d): %s%s", len(childIDs), strings.Join(children, ", "), suffix))
	} else {
		relLines = append(relLines, "• Dzieci: Brak wpisów")
	}
	relationsHTML := ""
	for _, line := range relLines {
		relationsHTML += `<div class="rel-line">` + html.EscapeString(line) + `</div>`
	}

	// Dane właściciela/działek jak w oryginalnej karcie.
	var ownerID int64
	var ownerName string
	if house != nil && strings.TrimSpace(*house) != "" {
		_ = a.db.QueryRow(`SELECT id,nazwa_wlasciciela FROM wlasciciele WHERE LOWER(TRIM(COALESCE(numer_domu,'')))=LOWER(TRIM(?)) ORDER BY COALESCE(numer_protokolu,999999), id LIMIT 1`, *house).Scan(&ownerID, &ownerName)
	}
	type parcel struct{ Num, Cat, Geom, Typ string }
	parcels := []parcel{}
	if ownerID != 0 {
		rows, _ := a.db.Query(`SELECT o.nazwa_lub_numer,o.kategoria,COALESCE(o.geometria_geojson,''),COALESCE(dw.typ_posiadania,'') FROM dzialki_wlasciciele dw JOIN obiekty_geograficzne o ON o.id=dw.obiekt_id WHERE dw.wlasciciel_id=?`, ownerID)
		if rows != nil {
			defer rows.Close()
			for rows.Next() {
				var p parcel
				if rows.Scan(&p.Num, &p.Cat, &p.Geom, &p.Typ) == nil && strings.Contains(strings.ToLower(p.Typ), "rzeczywista") {
					parcels = append(parcels, p)
				}
			}
		}
	}
	parsePoly := func(geom string) [][2]float64 {
		var g struct {
			Type        string          `json:"type"`
			Coordinates json.RawMessage `json:"coordinates"`
		}
		if json.Unmarshal([]byte(geom), &g) != nil || len(g.Coordinates) == 0 {
			return nil
		}
		var poly [][][]float64
		if strings.EqualFold(g.Type, "Polygon") && json.Unmarshal(g.Coordinates, &poly) == nil && len(poly) > 0 {
			pts := make([][2]float64, 0, len(poly[0]))
			for _, c := range poly[0] {
				if len(c) >= 2 {
					pts = append(pts, [2]float64{c[0], c[1]})
				}
			}
			return pts
		}
		return nil
	}
	minX, minY, maxX, maxY := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	polys := map[int][][2]float64{}
	for i, p := range parcels {
		pts := parsePoly(p.Geom)
		if len(pts) > 0 {
			polys[i] = pts
			for _, pt := range pts {
				if pt[0] < minX {
					minX = pt[0]
				}
				if pt[0] > maxX {
					maxX = pt[0]
				}
				if pt[1] < minY {
					minY = pt[1]
				}
				if pt[1] > maxY {
					maxY = pt[1]
				}
			}
		}
	}
	mapHTML := `<div class="map-empty">Brak danych przestrzennych (geometrii)</div>`
	if len(polys) > 0 {
		dx := maxX - minX
		dy := maxY - minY
		if dx == 0 {
			dx = 0.002
		}
		if dy == 0 {
			dy = 0.002
		}
		mapHTML = `<svg viewBox="0 0 800 350" class="map-svg">`
		for i, pts := range polys {
			points := []string{}
			for _, pt := range pts {
				x := 60 + (pt[0]-minX)/dx*680
				y := 320 - (pt[1]-minY)/dy*290
				points = append(points, fmt.Sprintf("%.1f,%.1f", x, y))
			}
			color := "#f1c40f"
			if parcels[i].Cat == "budynek" || parcels[i].Cat == "dom" || parcels[i].Cat == "budowlana" {
				color = "#e74c3c"
			}
			mapHTML += fmt.Sprintf(`<polygon points="%s" fill="%s" stroke="#111" stroke-width="1.2" opacity="0.9"/>`, strings.Join(points, " "), color)
		}
		mapHTML += `<g class="legend"><rect x="565" y="18" width="210" height="66" fill="white" opacity=".92" stroke="#ccc"/><rect x="582" y="34" width="13" height="13" fill="#e74c3c" stroke="#111"/><text x="603" y="45">Działki Budowlane</text><rect x="582" y="58" width="13" height="13" fill="#f1c40f" stroke="#111"/><text x="603" y="69">Działki Rolne/Inne</text></g></svg>`
	}
	buildNums, agriNums := []string{}, []string{}
	for _, p := range parcels {
		if p.Cat == "budynek" || p.Cat == "dom" || p.Cat == "budowlana" {
			buildNums = append(buildNums, p.Num)
		} else {
			agriNums = append(agriNums, p.Num)
		}
	}
	sort.Strings(buildNums)
	sort.Strings(agriNums)
	inv := []string{}
	if len(buildNums) > 0 {
		inv = append(inv, "Budowlane: "+strings.Join(buildNums, ", "))
	}
	if len(agriNums) > 0 {
		inv = append(inv, "Rolne: "+strings.Join(agriNums, ", "))
	}
	if len(inv) == 0 {
		inv = []string{"Brak przypisanych działek rzeczywistych"}
	}
	year := func(p *int32) string {
		if p == nil {
			return ""
		}
		return fmt.Sprint(*p)
	}
	str := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	datesStr := fmt.Sprintf("Ur. %s - Zm. %s", valueOr(year(birth), "?"), valueOr(year(death), "?"))
	notesHTML := ""
	if strings.TrimSpace(str(notes)) != "" {
		notesHTML = `<div class="notes">Notatki: ` + html.EscapeString(strings.ReplaceAll(str(notes), "\n", " ")) + `</div>`
	}
	ownerLine := ""
	if ownerName != "" {
		ownerLine = `Wł. w 1882: ` + html.EscapeString(ownerName)
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Disposition", `inline; filename="karta_rodziny.html"`)
	_, _ = fmt.Fprintf(w, `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Karta rodziny - %s</title><style>@page{size:A4;margin:12mm}body{font-family:Arial,sans-serif;color:#111;background:#eee;margin:0}.page{width:794px;min-height:1122px;margin:0 auto;background:white;padding:48px 64px;box-sizing:border-box;position:relative}.print{position:fixed;right:18px;top:18px;z-index:5;padding:8px 12px}.title{text-align:center;font-size:24px;font-weight:800;margin-top:0}.subtitle{text-align:center;font-size:10px;color:gray}.line{border-top:1px solid #111;margin:12px 0 36px}.top{display:flex;justify-content:space-between;gap:20px}.name{font-size:18px;font-weight:800;color:#2c3e50}.dates{font-size:14px;color:#7f8c8d;margin-top:8px}.house{text-align:right;font-size:16px;font-weight:800;color:#e67e22}.owner{text-align:right;font-size:10px;color:#7f8c8d;margin-top:8px}.section{font-size:14px;font-weight:800;margin-top:34px;margin-bottom:14px}.rel-line{font-size:10px;margin:5px 0}.notes{font-size:9px;color:gray;font-style:italic;margin-top:10px}.map-title{text-align:center;font-size:12px;margin:24px 0 8px}.map-box{height:350px}.map-svg{width:100%%;height:350px}.map-empty{text-align:center;color:red;padding:150px 0}.legend text{font-size:12px}.inventory{font-size:10px;color:#34495e;font-style:italic;line-height:1.5}.footer{position:absolute;bottom:22px;left:0;right:0;text-align:center;font-size:8px;color:#bdc3c7}@media print{body{background:white}.page{margin:0;padding:0;width:auto;min-height:auto}.print{display:none}}</style></head><body><button class="print" onclick="window.print()">Drukuj / zapisz PDF</button><main class="page"><div class="title">KARTA RODZINY I MAJĄTKU</div><div class="subtitle">GENEALOGIA CYFROWA 'CZARNA'</div><div class="line"></div><div class="top"><div><div class="name">%s</div><div class="dates">%s</div></div><div><div class="house">%s</div><div class="owner">%s</div></div></div><div class="section">Drzewo Genealogiczne (Najbliżsi):</div>%s%s<div class="map-title">Mapa Posiadłości: Dom nr %s</div><div class="map-box">%s</div><div class="section">Inwentarz Gruntów (%d poz.):</div><div class="inventory">%s</div><div class="footer">Raport wygenerowany automatycznie: %s | System 'Czarna'</div></main><script>setTimeout(()=>window.print(),300)</script></body></html>`, html.EscapeString(name), html.EscapeString(name), html.EscapeString(datesStr), html.EscapeString(valueOr(prefixHouse(str(house)), "Brak danych o domu")), ownerLine, relationsHTML, notesHTML, html.EscapeString(str(house)), mapHTML, len(parcels), html.EscapeString(strings.Join(inv, " | ")), time.Now().Format("2006-01-02 15:04"))
}

func (a *App) dispatch(cmd string, args map[string]interface{}) (interface{}, error) {
	if args == nil {
		args = map[string]interface{}{}
	}

	switch cmd {
	// ============ MAPA ============
	case "pobierz_obiekty_widok":
		swLat, _ := args["sw_lat"].(float64)
		swLng, _ := args["sw_lng"].(float64)
		neLat, _ := args["ne_lat"].(float64)
		neLng, _ := args["ne_lng"].(float64)
		objs, err := service.PobierzObiektyWObszarze(a.db, models.MapBounds{
			SwLat: swLat, SwLng: swLng, NeLat: neLat, NeLng: neLng,
		})
		if err == nil && len(objs) > 0 {
			data, _ := json.Marshal(objs[0])
			s := string(data)
			if len(s) > 500 {
				s = s[:500]
			}
			log.Printf("[DEBUG] obiekt[0] JSON: %s", s)
		}
		return objs, err

	case "pobierz_obiekt_po_punkcie":
		lat, _ := args["lat"].(float64)
		lng, _ := args["lng"].(float64)
		return service.ZnajdzObiektPoPunkcie(a.db, lat, lng)

	case "pobierz_wlascicieli_obiektu":
		id, _ := args["obiekt_id"].(float64)
		return service.PobierzWlascicieliObiektu(a.db, int64(id))

	// --- Punkty historyczne (obiekty specjalne z metadanymi + galerią) ---
	case "pobierz_punkty_historyczne":
		return service.PobierzPunktyHistoryczne(a.db)

	case "pobierz_liste_obiektow_specjalnych":
		return service.ListaObiektowSpecjalnych(a.db)

	case "pobierz_punkt_historyczny":
		name, _ := args["object_name"].(string)
		return service.PobierzPunktHistoryczny(a.db, name)

	case "zapisz_punkt_historyczny":
		strIfc := func(v interface{}) string { s, _ := v.(string); return s }
		meta := models.HistoricalPointMetadata{
			ObjectName:  strIfc(args["object_name"]),
			DisplayName: strIfc(args["display_name"]),
			Description: strIfc(args["description"]),
			SourceNote:  strIfc(args["source_note"]),
		}
		return map[string]interface{}{"ok": true}, service.ZapiszPunktHistoryczny(a.db, meta)

	case "dodaj_zdjecie_punktu_historycznego":
		name, _ := args["object_name"].(string)
		dataURL, _ := args["data_url"].(string)
		filename, _ := args["filename"].(string)
		photo, err := service.DodajZdjeciePunktu(a.db, a.dataDir, name, dataURL, filename)
		if err != nil {
			return nil, err
		}
		return photo, nil

	case "usun_zdjecie_punktu_historycznego":
		id, _ := args["id"].(float64)
		return map[string]interface{}{"ok": true}, service.UsunZdjeciePunktu(a.db, a.dataDir, int64(id))

	case "aktualizuj_caption_zdjecia_punktu":
		id, _ := args["id"].(float64)
		caption, _ := args["caption"].(string)
		return map[string]interface{}{"ok": true}, service.AktualizujCaption(a.db, int64(id), caption)

	case "aktualizuj_kolejnosc_zdjec_punktu":
		name, _ := args["object_name"].(string)
		rawIDs, _ := args["ids_in_order"].([]interface{})
		ids := make([]int64, 0, len(rawIDs))
		for _, v := range rawIDs {
			if f, ok := v.(float64); ok {
				ids = append(ids, int64(f))
			}
		}
		return map[string]interface{}{"ok": true}, service.AktualizujKolejnoscZdjec(a.db, name, ids)

	case "edytor_dzialek_dodaj_obiekt":
		nazwa, _ := args["nazwa"].(string)
		kategoria, _ := args["kategoria"].(string)
		geom := args["geometria"]
		if err := service.WymagajBrakuDuplikatu(a.db, nazwa, kategoria); err != nil {
			return nil, err
		}
		id, err := service.ZapiszObiektMapy(a.db, nazwa, kategoria, geom)
		return map[string]interface{}{"id": id}, err

	case "edytor_dzialek_aktualizuj_geometrie":
		id, _ := args["id"].(float64)
		return nil, service.AktualizujGeometrieObiektu(a.db, int64(id), args["geometria"])

	case "edytor_dzialek_zmien_nazwe":
		id, _ := args["id"].(float64)
		nazwa, _ := args["nazwa"].(string)
		return nil, service.ZmienNazweObiektu(a.db, int64(id), nazwa)

	case "edytor_dzialek_zmien_kategorie":
		id, _ := args["id"].(float64)
		kategoria, _ := args["kategoria"].(string)
		return nil, service.ZmienKategorieObiektu(a.db, int64(id), kategoria)

	case "edytor_dzialek_usun_obiekt":
		id, _ := args["id"].(float64)
		return nil, service.UsunObiektMapy(a.db, int64(id))

	case "edytor_dzialek_usun_wszystkie":
		return nil, service.UsunWszystkieObiektyMapy(a.db)

	case "edytor_dzialek_backupy":
		return a.editorParcelBackups()

	case "edytor_dzialek_utworz_backup":
		return a.editorCreateParcelBackup()

	case "edytor_dzialek_przywroc_backup":
		filename, _ := args["filename"].(string)
		return a.editorRestoreParcelBackup(filename)

	case "edytor_dzialek_usun_backup":
		filename, _ := args["filename"].(string)
		return a.editorDeleteParcelBackup(filename)

	// ============ WŁAŚCICIELE ============
	case "pobierz_wszystkich_wlascicieli":
		return a.v1PobierzWszystkichWlascicieli()

	case "pobierz_wlasciciela":
		return a.v1PobierzWlasciciela(args)

	case "szukaj_wlascicieli":
		q, _ := args["query"].(string)
		wl, err := service.SzukajPoNazwie(a.db, q)
		if err != nil {
			return nil, err
		}
		return wl, nil

	case "dodaj_wlasciciela":
		var w models.Wlasciciel
		if err := mapToStruct(args, &w); err != nil {
			return nil, err
		}
		id, err := service.DodajWlasciciela(a.db, &w)
		return map[string]interface{}{"id": id}, err

	case "aktualizuj_wlasciciela":
		var w models.Wlasciciel
		if err := mapToStruct(args, &w); err != nil {
			return nil, err
		}
		return nil, service.AktualizujWlasciciela(a.db, &w)

	case "usun_wlasciciela":
		id, _ := args["id"].(float64)
		return nil, service.UsunWlasciciela(a.db, int64(id))

	case "pobierz_wszystkie_obiekty_admin":
		return service.PobierzWszystkieObiektyAdmin(a.db)

	case "zapisz_wlasciciela_admin":
		return a.v1ZapiszWlascicielaAdmin(args)

	// ============ GENEALOGIA ============
	case "pobierz_drzewo_genealogiczne":
		return service.PobierzDrzewo(a.db)

	case "pobierz_osoby_wlasciciela":
		id, _ := args["wlasciciel_id"].(float64)
		return service.PobierzOsobyWlasciciela(a.db, int64(id))

	case "dodaj_osobe":
		var o models.OsobaGenealogia
		if err := mapToStruct(args, &o); err != nil {
			return nil, err
		}
		id, err := service.DodajOsobe(a.db, &o)
		return map[string]interface{}{"id": id}, err

	case "aktualizuj_osobe":
		var o models.OsobaGenealogia
		if err := mapToStruct(args, &o); err != nil {
			return nil, err
		}
		return nil, service.AktualizujOsobe(a.db, &o)

	case "usun_osobe":
		id, _ := args["id"].(float64)
		return nil, service.UsunOsobe(a.db, int64(id))

	case "pobierz_genealogie_editor":
		return service.PobierzGenealogieEditor(a.db)

	case "zapisz_genealogie_editor":
		var people []models.GenealogiaEditorPerson
		if raw, ok := args["people"]; ok {
			b, _ := json.Marshal(raw)
			if err := json.Unmarshal(b, &people); err != nil {
				return nil, err
			}
		}
		return nil, service.ZastapGenealogieEditor(a.db, people)

	// ============ DEMOGRAFIA ============
	case "pobierz_demografie":
		return service.PobierzWszystkieDemografie(a.db)

	case "zapisz_demografie":
		var rows []models.Demografia
		if raw, ok := args["rows"]; ok {
			b, _ := json.Marshal(raw)
			if err := json.Unmarshal(b, &rows); err != nil {
				return nil, err
			}
		}
		return nil, service.ZastapWszystkieDemografie(a.db, rows)

	// ============ KONFIGURACJA ============
	case "pobierz_kalibracje_mapy":
		return service.PobierzKalibracjeMapy(a.db)

	case "pobierz_konfiguracje_mapy":
		return service.PobierzKonfiguracjeMapy(a.db)

	case "pobierz_konfiguracje":
		klucz, _ := args["klucz"].(string)
		val := service.Pobierz(a.db, klucz)
		return val, nil

	case "ustaw_konfiguracje":
		klucz, _ := args["klucz"].(string)
		wartosc, _ := args["wartosc"].(string)
		var opis *string
		if o, ok := args["opis"].(string); ok && o != "" {
			opis = &o
		}
		return nil, service.Ustaw(a.db, klucz, wartosc, opis)

	// ============ PROTOKOŁY ============
	case "lista_protokolow":
		return service.ListaProtokolow(a.db, a.dataDir)

	case "laduj_zdjecia_protokolu":
		nazwa, _ := args["nazwa_wlasciciela"].(string)
		return service.LadujZdjeciaProtokolu(a.db, a.dataDir, nazwa)

	case "lista_zdjec_protokolu":
		nazwa, _ := args["nazwa_wlasciciela"].(string)
		return service.ListaZdjecProtokolu(a.db, a.dataDir, nazwa)

	case "usun_zdjecie_protokolu":
		nazwa, _ := args["nazwa_wlasciciela"].(string)
		plik, _ := args["nazwa_pliku"].(string)
		return nil, service.UsunZdjecieProtokolu(a.db, a.dataDir, nazwa, plik)

	case "pobierz_zdjecie_protokolu":
		nazwa, _ := args["nazwa_wlasciciela"].(string)
		plik, _ := args["nazwa_pliku"].(string)
		return service.PobierzZdjecieProtokolu(a.db, a.dataDir, nazwa, plik)

	case "ustaw_numer_zdjecia_protokolu":
		nazwa, _ := args["nazwa_wlasciciela"].(string)
		plik, _ := args["nazwa_pliku"].(string)
		num, _ := args["nowy_numer"].(float64)
		return service.UstawNumerZdjecia(a.db, a.dataDir, nazwa, plik, int64(num))

	case "przesun_zdjecie_protokolu":
		nazwa, _ := args["nazwa_wlasciciela"].(string)
		plik, _ := args["nazwa_pliku"].(string)
		kierunek, _ := args["kierunek"].(string)
		return nil, service.PrzesunZdjecie(a.db, a.dataDir, nazwa, plik, kierunek)

	// ============ STATYSTYKI ============
	case "pobierz_statystyki":
		return service.PobierzStatystyki(a.db)

	case "pobierz_dane_graful":
		return service.PobierzDaneGraful(a.db)

	case "pobierz_genealogie_wlasciciela":
		klucz, _ := args["klucz"].(string)
		return service.PobierzGenealogieWlasciciela(a.db, klucz)

	// ============ API FLASK ============
	case "api_dzialki":
		return service.API_Dzialki(a.db)

	case "api_wlasciciele":
		return a.v1APIWlasciciele()

	case "api_wlasciciel":
		klucz, _ := args["klucz"].(string)
		return a.v1APIWlasciciel(klucz)

	case "api_genealogia_persons":
		return a.v1APIGenealogiaPersons()

	case "api_genealogia_tree":
		klucz, _ := args["klucz"].(string)
		return a.v1APIGenealogiaTree(klucz)

	// ============ MIEJSCOWOŚCI ==========
	case "miejscowosci_lista":
		return a.listLocations()

	case "miejscowosci_aktywna":
		return a.activeLocation()

	case "miejscowosci_ustaw_aktywna":
		id, _ := args["id"].(string)
		return a.setActiveLocation(id)

	case "miejscowosci_ustaw_autostart":
		autoOpen, _ := args["auto_open"].(bool)
		return nil, a.setLocationsAutoOpen(autoOpen)

	case "miejscowosci_dodaj":
		var loc LocationInfo
		if err := mapToStruct(args, &loc); err != nil {
			return nil, err
		}
		return a.addLocation(loc)

	case "miejscowosci_aktualizuj":
		var loc LocationInfo
		if err := mapToStruct(args, &loc); err != nil {
			return nil, err
		}
		return a.updateLocation(loc)

	case "miejscowosci_usun":
		id, _ := args["id"].(string)
		return a.deleteLocation(id)

	case "miejscowosci_info_mapy":
		return a.activeLocationMapInfo()

	case "miejscowosci_zapisz_kalibracje":
		calibration, _ := args["calibration"].(string)
		defaults, _ := args["defaults"].(string)
		return nil, a.saveMapCalibration(calibration, defaults)

	case "miejscowosci_zapisz_mape":
		dataURL, _ := args["data_url"].(string)
		return nil, a.saveActiveMapImage(dataURL)

	case "miejscowosci_dodaj_zdjecie_historii":
		dataURL, _ := args["data_url"].(string)
		filename, _ := args["filename"].(string)
		caption, _ := args["caption"].(string)
		return a.addActiveHistoryPhoto(dataURL, filename, caption)

	case "miejscowosci_dodaj_zdjecia_historii":
		var photos []struct {
			DataURL  string `json:"data_url"`
			Filename string `json:"filename"`
			Caption  string `json:"caption"`
		}
		b, _ := json.Marshal(args["photos"])
		if err := json.Unmarshal(b, &photos); err != nil {
			return nil, err
		}
		for _, p := range photos {
			if _, err := a.addActiveHistoryPhoto(p.DataURL, p.Filename, p.Caption); err != nil {
				return nil, err
			}
		}
		loc, _ := a.activeLocation()
		return map[string]interface{}{"ok": true, "count": len(photos), "photos": loc.HistoryPhotos}, nil

	case "miejscowosci_usun_zdjecie_historii":
		filename, _ := args["filename"].(string)
		return nil, a.deleteActiveHistoryPhoto(filename)

	case "miejscowosci_zmien_podpis_zdjecia_historii":
		filename, _ := args["filename"].(string)
		caption, _ := args["caption"].(string)
		return nil, a.updateActiveHistoryPhotoCaption(filename, caption)

	case "miejscowosci_przesun_zdjecie_historii":
		filename, _ := args["filename"].(string)
		direction, _ := args["direction"].(string)
		return nil, a.moveActiveHistoryPhoto(filename, direction)

	case "miejscowosci_ustaw_kolejnosc_zdjec_historii":
		var filenames []string
		b, _ := json.Marshal(args["filenames"])
		if err := json.Unmarshal(b, &filenames); err != nil {
			return nil, err
		}
		return nil, a.setActiveHistoryPhotoOrder(filenames)

	case "miejscowosci_eksport_json":
		return a.exportActiveLocationJSON()

	case "miejscowosci_pelny_backup":
		return a.createFullBackup(args)

	case "miejscowosci_import_json":
		var files map[string]json.RawMessage
		if raw, ok := args["files"]; ok {
			b, _ := json.Marshal(raw)
			if err := json.Unmarshal(b, &files); err != nil {
				return nil, err
			}
		}
		return service.ImportCompatibleJSON(a.db, files)

	case "miejscowosci_przeladuj_json":
		return a.reloadJSONFromDisk()

	case "miejscowosci_import_backup":
		dataB64, _ := args["data_b64"].(string)
		return a.importFullBackup(dataB64)

	default:
		return nil, fmt.Errorf("nieznana komenda: %s", cmd)
	}
}

func (a *App) registryPath() string {
	root := a.rootDataDir
	if root == "" {
		root = a.dataDir
	}
	return filepath.Join(root, "locations.json")
}

func locationID(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = strings.ReplaceAll(s, "ł", "l")
	s = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(s, "_")
	s = strings.Trim(s, "_")
	if s == "" {
		s = "miejscowosc"
	}
	return s
}

func (a *App) ensureLocationsRegistry() error {
	path := a.registryPath()
	if _, err := os.Stat(path); err == nil {
		reg, err := a.loadRegistry()
		if err != nil {
			return err
		}
		if reg.ActiveID != "" {
			for _, loc := range reg.Locations {
				if loc.ID == reg.ActiveID {
					return a.ensureDefaultMapFile(loc.DataDir)
				}
			}
			return nil
		}
	}
	loc := LocationInfo{
		ID: locationID("Czarna"), Name: "Czarna", FullName: "Czarna", Powiat: "Dębicki", Region: "Podkarpackie",
		Year: "1882", Century: "XIX w.", GminaKatastralna: "Czarna", MiejscowoscProtokol: "Czarna",
		HomepageTemplate:    "praca_inzynierska",
		HomepageDescription: "Odkryj historię zapisaną w ziemi. Przeglądaj historyczne działki katastralne, poznaj dawnych właścicieli i zgłębiaj genealogiczne powiązania mieszkańców z 1882 roku.",
		HistoryPhotos:       []HistoryPhotoInfo{},
		DBPath:              a.dbPath, DataDir: a.dataDir, Active: true, AutoOpen: true,
		CreatedAt: time.Now().Format(time.RFC3339),
	}
	reg := locationsRegistry{ActiveID: loc.ID, AutoOpen: true, Locations: []LocationInfo{loc}}
	if err := a.saveRegistry(&reg); err != nil {
		return err
	}
	return a.ensureDefaultMapFile(loc.DataDir)
}

func (a *App) ensureDefaultMapFile(dataDir string) error {
	if dataDir == "" {
		return nil
	}
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return err
	}
	mapPath := filepath.Join(dataDir, "mapa.jpg")
	if _, err := os.Stat(mapPath); err == nil {
		return nil
	}
	b, err := frontend.ReadFile("frontend/mapa/mapa.jpg")
	if err != nil {
		return nil
	}
	return os.WriteFile(mapPath, b, 0644)
}

func (a *App) loadRegistry() (*locationsRegistry, error) {
	if err := os.MkdirAll(filepath.Dir(a.registryPath()), 0755); err != nil {
		return nil, err
	}
	if _, err := os.Stat(a.registryPath()); os.IsNotExist(err) {
		if err := a.ensureLocationsRegistry(); err != nil {
			return nil, err
		}
	}
	b, err := os.ReadFile(a.registryPath())
	if err != nil {
		return nil, err
	}
	var reg locationsRegistry
	if err := json.Unmarshal(b, &reg); err != nil {
		return nil, err
	}
	for i := range reg.Locations {
		reg.Locations[i].Active = reg.Locations[i].ID == reg.ActiveID
		reg.Locations[i].AutoOpen = reg.AutoOpen && reg.Locations[i].Active
	}
	return &reg, nil
}

func (a *App) saveRegistry(reg *locationsRegistry) error {
	if err := os.MkdirAll(filepath.Dir(a.registryPath()), 0755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(reg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(a.registryPath(), b, 0644)
}

func (a *App) ensureGenealogyProtocolLinks() error {
	var linked int64
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM osoby_genealogia WHERE id_protokolu IS NOT NULL`).Scan(&linked)
	if linked > 0 {
		return nil
	}
	paths := []string{
		filepath.Join(a.dataDir, "json", "genealogia.json"),
		filepath.Join(a.rootDataDir, "json", "genealogia.json"),
	}
	if home, err := os.UserHomeDir(); err == nil {
		paths = append(paths, filepath.Join(home, "Desktop", "Projekt Mapa Czarna", "backup", "Czarna", "genealogia.json"))
	}
	var raw []byte
	for _, p := range paths {
		if b, err := os.ReadFile(p); err == nil {
			raw = b
			break
		}
	}
	if len(raw) == 0 {
		return nil
	}
	var wrapper struct {
		Persons []struct {
			ID          int64  `json:"id"`
			ProtokolKey string `json:"protokolKey"`
		} `json:"persons"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return err
	}
	ownerByKey := map[string]int64{}
	rows, err := a.db.Query(`SELECT id,unikalny_klucz FROM wlasciciele`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var key string
		if rows.Scan(&id, &key) == nil {
			ownerByKey[key] = id
		}
	}
	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	updated := 0
	for _, p := range wrapper.Persons {
		if p.ProtokolKey == "" {
			continue
		}
		if oid, ok := ownerByKey[p.ProtokolKey]; ok {
			if res, err := tx.Exec(`UPDATE osoby_genealogia SET id_protokolu=? WHERE json_id=? AND id_protokolu IS NULL`, oid, p.ID); err == nil {
				n, _ := res.RowsAffected()
				updated += int(n)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	if updated > 0 {
		log.Printf("[GENEALOGIA] Odtworzono powiązania protokołów dla %d osób", updated)
	}
	return nil
}

func (a *App) listLocations() (map[string]interface{}, error) {
	reg, err := a.loadRegistry()
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"locations": reg.Locations, "active_id": reg.ActiveID, "auto_open": reg.AutoOpen}, nil
}

func (a *App) activeLocation() (*LocationInfo, error) {
	reg, err := a.loadRegistry()
	if err != nil {
		return nil, err
	}
	for _, loc := range reg.Locations {
		if loc.ID == reg.ActiveID {
			loc.Active = true
			loc.AutoOpen = reg.AutoOpen
			return &loc, nil
		}
	}
	if len(reg.Locations) == 0 {
		return nil, nil
	}
	reg.ActiveID = reg.Locations[0].ID
	_ = a.saveRegistry(reg)
	reg.Locations[0].Active = true
	return &reg.Locations[0], nil
}

func (a *App) setActiveLocation(id string) (map[string]interface{}, error) {
	reg, err := a.loadRegistry()
	if err != nil {
		return nil, err
	}
	var selected *LocationInfo
	for i := range reg.Locations {
		if reg.Locations[i].ID == id {
			selected = &reg.Locations[i]
			break
		}
	}
	if selected == nil {
		return nil, fmt.Errorf("nie znaleziono miejscowości: %s", id)
	}
	newDB, err := db.Open(selected.DBPath)
	if err != nil {
		return nil, err
	}
	oldDB := a.db
	a.db = newDB
	a.dbPath = selected.DBPath
	a.dataDir = selected.DataDir
	reg.ActiveID = selected.ID
	if err := a.saveRegistry(reg); err != nil {
		return nil, err
	}
	if oldDB != nil {
		_ = oldDB.Close()
	}
	_ = a.ensureGenealogyProtocolLinks()
	return map[string]interface{}{"ok": true, "active": selected}, nil
}

func (a *App) setLocationsAutoOpen(autoOpen bool) error {
	reg, err := a.loadRegistry()
	if err != nil {
		return err
	}
	reg.AutoOpen = autoOpen
	return a.saveRegistry(reg)
}

func (a *App) addLocation(loc LocationInfo) (map[string]interface{}, error) {
	reg, err := a.loadRegistry()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(loc.Name) == "" {
		return nil, fmt.Errorf("podaj nazwę miejscowości")
	}
	loc.ID = locationID(loc.Name)
	for _, existing := range reg.Locations {
		if existing.ID == loc.ID {
			return nil, fmt.Errorf("miejscowość już istnieje: %s", loc.Name)
		}
	}
	if loc.FullName == "" {
		loc.FullName = loc.Name
	}
	if loc.Year == "" {
		loc.Year = "1882"
	}
	if loc.Century == "" {
		loc.Century = "XIX w."
	}
	if loc.GminaKatastralna == "" {
		loc.GminaKatastralna = loc.Name
	}
	if loc.MiejscowoscProtokol == "" {
		loc.MiejscowoscProtokol = loc.Name
	}
	if loc.HomepageTemplate == "" {
		loc.HomepageTemplate = "praca_inzynierska"
	}
	locDir := filepath.Join(a.rootDataDir, "locations", loc.ID)
	if err := os.MkdirAll(filepath.Join(locDir, "protokoly"), 0755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(locDir, "history_photos"), 0755); err != nil {
		return nil, err
	}
	loc.DataDir = locDir
	loc.DBPath = filepath.Join(locDir, loc.ID+".db")
	loc.CreatedAt = time.Now().Format(time.RFC3339)
	newDB, err := db.Open(loc.DBPath)
	if err != nil {
		return nil, err
	}
	_ = newDB.Close()
	if err := a.ensureDefaultMapFile(loc.DataDir); err != nil {
		return nil, err
	}
	reg.Locations = append(reg.Locations, loc)
	if err := a.saveRegistry(reg); err != nil {
		return nil, err
	}
	return map[string]interface{}{"ok": true, "location": loc}, nil
}

func (a *App) updateLocation(loc LocationInfo) (map[string]interface{}, error) {
	reg, err := a.loadRegistry()
	if err != nil {
		return nil, err
	}
	if loc.ID == "" {
		return nil, fmt.Errorf("brak ID miejscowości")
	}
	for i := range reg.Locations {
		if reg.Locations[i].ID != loc.ID {
			continue
		}
		current := reg.Locations[i]
		if strings.TrimSpace(loc.Name) == "" {
			return nil, fmt.Errorf("podaj nazwę miejscowości")
		}
		current.Name = strings.TrimSpace(loc.Name)
		current.FullName = strings.TrimSpace(loc.FullName)
		if current.FullName == "" {
			current.FullName = current.Name
		}
		current.Powiat = strings.TrimSpace(loc.Powiat)
		current.Region = strings.TrimSpace(loc.Region)
		current.Year = strings.TrimSpace(loc.Year)
		if current.Year == "" {
			current.Year = "1882"
		}
		current.Century = strings.TrimSpace(loc.Century)
		if current.Century == "" {
			current.Century = "XIX w."
		}
		current.GminaKatastralna = strings.TrimSpace(loc.GminaKatastralna)
		if current.GminaKatastralna == "" {
			current.GminaKatastralna = current.Name
		}
		current.MiejscowoscProtokol = strings.TrimSpace(loc.MiejscowoscProtokol)
		if current.MiejscowoscProtokol == "" {
			current.MiejscowoscProtokol = current.Name
		}
		if loc.HomepageTemplate != "" {
			current.HomepageTemplate = loc.HomepageTemplate
		}
		current.HomepageDescription = strings.TrimSpace(loc.HomepageDescription)
		current.HistorySubtitle = strings.TrimSpace(loc.HistorySubtitle)
		current.HistoryParagraph1 = strings.TrimSpace(loc.HistoryParagraph1)
		current.HistoryParagraph2 = strings.TrimSpace(loc.HistoryParagraph2)
		current.HistoryParagraph3 = strings.TrimSpace(loc.HistoryParagraph3)
		if loc.HistoryPhotos != nil {
			current.HistoryPhotos = loc.HistoryPhotos
		}
		reg.Locations[i] = current
		if err := a.saveRegistry(reg); err != nil {
			return nil, err
		}
		return map[string]interface{}{"ok": true, "location": current}, nil
	}
	return nil, fmt.Errorf("nie znaleziono miejscowości: %s", loc.ID)
}

func (a *App) deleteLocation(id string) (map[string]interface{}, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("brak ID miejscowości")
	}
	reg, err := a.loadRegistry()
	if err != nil {
		return nil, err
	}
	if len(reg.Locations) <= 1 {
		return nil, fmt.Errorf("nie można usunąć ostatniej miejscowości")
	}
	idx := -1
	var removed LocationInfo
	for i, loc := range reg.Locations {
		if loc.ID == id {
			idx = i
			removed = loc
			break
		}
	}
	if idx < 0 {
		return nil, fmt.Errorf("nie znaleziono miejscowości: %s", id)
	}

	wasActive := reg.ActiveID == id
	var nextActive *LocationInfo
	if wasActive {
		for i := range reg.Locations {
			if i != idx {
				nextActive = &reg.Locations[i]
				break
			}
		}
		if nextActive == nil {
			return nil, fmt.Errorf("brak miejscowości do aktywowania po usunięciu")
		}
	}

	reg.Locations = append(reg.Locations[:idx], reg.Locations[idx+1:]...)
	if wasActive {
		reg.ActiveID = nextActive.ID
	}
	if err := a.saveRegistry(reg); err != nil {
		return nil, err
	}
	if wasActive {
		newDB, err := db.Open(nextActive.DBPath)
		if err != nil {
			return nil, err
		}
		oldDB := a.db
		a.db = newDB
		a.dbPath = nextActive.DBPath
		a.dataDir = nextActive.DataDir
		if oldDB != nil {
			_ = oldDB.Close()
		}
	}

	removedDir := strings.TrimSpace(removed.DataDir)
	root := strings.TrimSpace(a.rootDataDir)
	if root != "" && removedDir != "" {
		absRoot, _ := filepath.Abs(root)
		absDir, _ := filepath.Abs(removedDir)
		locationsRoot := filepath.Join(absRoot, "locations")
		// Nigdy nie usuwamy głównego katalogu data/ Czarnej; tylko katalogi data/locations/<id>.
		if strings.HasPrefix(absDir, locationsRoot+string(os.PathSeparator)) || absDir == filepath.Join(locationsRoot, id) {
			_ = os.RemoveAll(absDir)
		}
	}
	return map[string]interface{}{"ok": true, "deleted_id": id, "active_id": reg.ActiveID}, nil
}

func (a *App) activeLocationMapInfo() (map[string]interface{}, error) {
	loc, err := a.activeLocation()
	if err != nil {
		return nil, err
	}
	cal, err := service.PobierzKalibracjeMapy(a.db)
	if err != nil {
		return nil, err
	}
	defaults := service.Pobierz(a.db, "map_defaults")
	if defaults == "" {
		defaults = `{"center":{"lat":50.0605803891,"lng":21.2395193597},"zoom":14}`
	}
	mapPath := filepath.Join(a.dataDir, "mapa.jpg")
	var size int64
	mapExists := false
	if st, err := os.Stat(mapPath); err == nil {
		mapExists = true
		size = st.Size()
	}
	return map[string]interface{}{
		"location": loc, "map_exists": mapExists, "map_path": mapPath, "map_size": size,
		"map_url":     "/mapa/mapa.jpg?t=" + fmt.Sprint(time.Now().Unix()),
		"calibration": cal, "defaults": defaults,
	}, nil
}

func (a *App) saveMapCalibration(calibration, defaults string) error {
	if !json.Valid([]byte(calibration)) {
		return fmt.Errorf("kalibracja nie jest poprawnym JSON")
	}
	if !json.Valid([]byte(defaults)) {
		return fmt.Errorf("ustawienia mapy nie są poprawnym JSON")
	}
	if err := service.Ustaw(a.db, "map_calibration", calibration, strPtr("Współrzędne kalibracji mapy historycznej")); err != nil {
		return err
	}
	return service.Ustaw(a.db, "map_defaults", defaults, strPtr("Domyślny środek i zoom mapy"))
}

func (a *App) saveActiveMapImage(dataURL string) error {
	if dataURL == "" {
		return fmt.Errorf("brak danych mapy")
	}
	idx := strings.Index(dataURL, ",")
	if idx >= 0 {
		dataURL = dataURL[idx+1:]
	}
	r := base64.NewDecoder(base64.StdEncoding, strings.NewReader(dataURL))
	if err := os.MkdirAll(a.dataDir, 0755); err != nil {
		return err
	}
	tmp := filepath.Join(a.dataDir, "mapa.jpg.tmp")
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, r); err != nil {
		out.Close()
		_ = os.Remove(tmp)
		return err
	}
	out.Close()
	return os.Rename(tmp, filepath.Join(a.dataDir, "mapa.jpg"))
}

func (a *App) editorBackupDir() (string, error) {
	if strings.TrimSpace(a.dataDir) == "" {
		return "", fmt.Errorf("brak katalogu danych aktywnej miejscowości")
	}
	dir := filepath.Join(a.dataDir, "backups")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

func (a *App) editorParcelBackups() (map[string]interface{}, error) {
	dir, err := a.editorBackupDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	files := []map[string]interface{}{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".json") || !strings.Contains(name, "backup") {
			continue
		}
		info, _ := e.Info()
		item := map[string]interface{}{"filename": name}
		if info != nil {
			item["size"] = info.Size()
			item["modified"] = info.ModTime().Format("2006-01-02 15:04:05")
		}
		files = append(files, item)
	}
	sort.Slice(files, func(i, j int) bool { return fmt.Sprint(files[i]["filename"]) > fmt.Sprint(files[j]["filename"]) })
	return map[string]interface{}{"files": files}, nil
}

func (a *App) editorLocationMeta() service.LocationJSONMeta {
	loc, _ := a.activeLocation()
	if loc == nil {
		return service.LocationJSONMeta{}
	}
	return service.LocationJSONMeta{ID: loc.ID, Name: loc.Name, FullName: loc.FullName, Powiat: loc.Powiat, Region: loc.Region, Year: loc.Year, Century: loc.Century, GminaKatastralna: loc.GminaKatastralna, MiejscowoscProtokol: loc.MiejscowoscProtokol, HomepageDescription: loc.HomepageDescription, HistorySubtitle: loc.HistorySubtitle, HistoryParagraph1: loc.HistoryParagraph1, HistoryParagraph2: loc.HistoryParagraph2, HistoryParagraph3: loc.HistoryParagraph3}
}

func (a *App) editorCreateParcelBackup() (map[string]interface{}, error) {
	dir, err := a.editorBackupDir()
	if err != nil {
		return nil, err
	}
	res, err := service.ExportCompatibleJSON(a.db, a.dataDir, a.editorLocationMeta())
	if err != nil {
		return nil, err
	}
	src := filepath.Join(res.Dir, "parcels_data.json")
	stamp := time.Now().Format("20060102_150405")
	dstName := fmt.Sprintf("parcels_data_backup_%s.json", stamp)
	dst := filepath.Join(dir, dstName)
	in, err := os.Open(src)
	if err != nil {
		return nil, err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return nil, err
	}
	if err := out.Close(); err != nil {
		return nil, err
	}
	return map[string]interface{}{"status": "success", "filename": dstName, "message": "Utworzono kopię zapasową działek"}, nil
}

func (a *App) safeEditorBackupPath(filename string) (string, error) {
	dir, err := a.editorBackupDir()
	if err != nil {
		return "", err
	}
	name := filepath.Base(strings.TrimSpace(filename))
	if name == "." || name == "" || !strings.HasSuffix(strings.ToLower(name), ".json") || !strings.Contains(name, "backup") {
		return "", fmt.Errorf("nieprawidłowa nazwa backupu")
	}
	p := filepath.Join(dir, name)
	absDir, _ := filepath.Abs(dir)
	absPath, _ := filepath.Abs(p)
	if !strings.HasPrefix(absPath, absDir+string(os.PathSeparator)) && absPath != filepath.Join(absDir, name) {
		return "", fmt.Errorf("nieprawidłowa ścieżka backupu")
	}
	return p, nil
}

func (a *App) editorRestoreParcelBackup(filename string) (map[string]interface{}, error) {
	p, err := a.safeEditorBackupPath(filename)
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	res, err := service.ImportCompatibleJSON(a.db, map[string]json.RawMessage{"parcels_data.json": json.RawMessage(raw)})
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"status": "success", "message": fmt.Sprintf("Przywrócono backup (%d obiektów)", res.Parcels), "parcels": res.Parcels}, nil
}

func (a *App) editorDeleteParcelBackup(filename string) (map[string]interface{}, error) {
	p, err := a.safeEditorBackupPath(filename)
	if err != nil {
		return nil, err
	}
	if err := os.Remove(p); err != nil {
		return nil, err
	}
	return map[string]interface{}{"status": "success", "message": "Usunięto kopię zapasową"}, nil
}

func (a *App) addActiveHistoryPhoto(dataURL, filename, caption string) (map[string]interface{}, error) {
	if dataURL == "" {
		return nil, fmt.Errorf("brak danych zdjęcia")
	}
	loc, err := a.activeLocation()
	if err != nil {
		return nil, err
	}
	if loc == nil {
		return nil, fmt.Errorf("brak aktywnej miejscowości")
	}
	clean := filepath.Base(strings.TrimSpace(filename))
	if clean == "." || clean == "" {
		clean = fmt.Sprintf("historia_%d.jpg", time.Now().Unix())
	}
	ext := strings.ToLower(filepath.Ext(clean))
	if ext != ".jpg" && ext != ".jpeg" && ext != ".png" && ext != ".webp" {
		return nil, fmt.Errorf("dozwolone formaty: JPG, PNG, WEBP")
	}
	dir := filepath.Join(a.dataDir, "history_photos")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}
	base := strings.TrimSuffix(clean, ext)
	final := clean
	for i := 1; ; i++ {
		if _, err := os.Stat(filepath.Join(dir, final)); os.IsNotExist(err) {
			break
		}
		final = fmt.Sprintf("%s_%d%s", base, i, ext)
	}
	idx := strings.Index(dataURL, ",")
	if idx >= 0 {
		dataURL = dataURL[idx+1:]
	}
	r := base64.NewDecoder(base64.StdEncoding, strings.NewReader(dataURL))
	out, err := os.Create(filepath.Join(dir, final))
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(out, r); err != nil {
		out.Close()
		return nil, err
	}
	if err := out.Close(); err != nil {
		return nil, err
	}
	reg, err := a.loadRegistry()
	if err != nil {
		return nil, err
	}
	for i := range reg.Locations {
		if reg.Locations[i].ID == loc.ID {
			reg.Locations[i].HistoryPhotos = append(reg.Locations[i].HistoryPhotos, HistoryPhotoInfo{Filename: final, Caption: strings.TrimSpace(caption)})
			if err := a.saveRegistry(reg); err != nil {
				return nil, err
			}
			return map[string]interface{}{"ok": true, "filename": final, "photos": reg.Locations[i].HistoryPhotos}, nil
		}
	}
	return nil, fmt.Errorf("nie znaleziono aktywnej miejscowości")
}

func (a *App) deleteActiveHistoryPhoto(filename string) error {
	loc, err := a.activeLocation()
	if err != nil {
		return err
	}
	if loc == nil {
		return fmt.Errorf("brak aktywnej miejscowości")
	}
	filename = filepath.Base(strings.TrimSpace(filename))
	reg, err := a.loadRegistry()
	if err != nil {
		return err
	}
	for i := range reg.Locations {
		if reg.Locations[i].ID != loc.ID {
			continue
		}
		photos := reg.Locations[i].HistoryPhotos[:0]
		for _, p := range reg.Locations[i].HistoryPhotos {
			if p.Filename != filename {
				photos = append(photos, p)
			}
		}
		reg.Locations[i].HistoryPhotos = photos
		_ = os.Remove(filepath.Join(a.dataDir, "history_photos", filename))
		return a.saveRegistry(reg)
	}
	return nil
}

func (a *App) updateActiveHistoryPhotoCaption(filename, caption string) error {
	loc, err := a.activeLocation()
	if err != nil {
		return err
	}
	if loc == nil {
		return fmt.Errorf("brak aktywnej miejscowości")
	}
	filename = filepath.Base(strings.TrimSpace(filename))
	reg, err := a.loadRegistry()
	if err != nil {
		return err
	}
	for i := range reg.Locations {
		if reg.Locations[i].ID != loc.ID {
			continue
		}
		for j := range reg.Locations[i].HistoryPhotos {
			if reg.Locations[i].HistoryPhotos[j].Filename == filename {
				reg.Locations[i].HistoryPhotos[j].Caption = strings.TrimSpace(caption)
				return a.saveRegistry(reg)
			}
		}
		return fmt.Errorf("nie znaleziono zdjęcia: %s", filename)
	}
	return fmt.Errorf("nie znaleziono aktywnej miejscowości")
}

func (a *App) moveActiveHistoryPhoto(filename, direction string) error {
	loc, err := a.activeLocation()
	if err != nil {
		return err
	}
	if loc == nil {
		return fmt.Errorf("brak aktywnej miejscowości")
	}
	filename = filepath.Base(strings.TrimSpace(filename))
	reg, err := a.loadRegistry()
	if err != nil {
		return err
	}
	for i := range reg.Locations {
		if reg.Locations[i].ID != loc.ID {
			continue
		}
		photos := reg.Locations[i].HistoryPhotos
		idx := -1
		for j := range photos {
			if photos[j].Filename == filename {
				idx = j
				break
			}
		}
		if idx < 0 {
			return fmt.Errorf("nie znaleziono zdjęcia: %s", filename)
		}
		target := idx
		switch direction {
		case "up":
			target = idx - 1
		case "down":
			target = idx + 1
		default:
			return fmt.Errorf("nieznany kierunek: %s", direction)
		}
		if target < 0 || target >= len(photos) {
			return nil
		}
		photos[idx], photos[target] = photos[target], photos[idx]
		reg.Locations[i].HistoryPhotos = photos
		return a.saveRegistry(reg)
	}
	return fmt.Errorf("nie znaleziono aktywnej miejscowości")
}

func (a *App) setActiveHistoryPhotoOrder(filenames []string) error {
	loc, err := a.activeLocation()
	if err != nil {
		return err
	}
	if loc == nil {
		return fmt.Errorf("brak aktywnej miejscowości")
	}
	reg, err := a.loadRegistry()
	if err != nil {
		return err
	}
	order := map[string]int{}
	for i, f := range filenames {
		order[filepath.Base(strings.TrimSpace(f))] = i
	}
	for i := range reg.Locations {
		if reg.Locations[i].ID != loc.ID {
			continue
		}
		old := reg.Locations[i].HistoryPhotos
		newPhotos := make([]HistoryPhotoInfo, 0, len(old))
		used := map[string]bool{}
		for _, filename := range filenames {
			clean := filepath.Base(strings.TrimSpace(filename))
			for _, p := range old {
				if p.Filename == clean && !used[p.Filename] {
					newPhotos = append(newPhotos, p)
					used[p.Filename] = true
					break
				}
			}
		}
		for _, p := range old {
			if !used[p.Filename] {
				newPhotos = append(newPhotos, p)
			}
		}
		_ = order // keep explicit ordering map for validation/debug if extended later
		reg.Locations[i].HistoryPhotos = newPhotos
		return a.saveRegistry(reg)
	}
	return fmt.Errorf("nie znaleziono aktywnej miejscowości")
}

func (a *App) exportActiveLocationJSON() (*service.JSONSyncResult, error) {
	loc, err := a.activeLocation()
	if err != nil {
		return nil, err
	}
	meta := service.LocationJSONMeta{}
	if loc != nil {
		meta = service.LocationJSONMeta{
			ID: loc.ID, Name: loc.Name, FullName: loc.FullName, Powiat: loc.Powiat, Region: loc.Region,
			Year: loc.Year, Century: loc.Century, GminaKatastralna: loc.GminaKatastralna,
			MiejscowoscProtokol: loc.MiejscowoscProtokol, HomepageDescription: loc.HomepageDescription,
			HistorySubtitle:   loc.HistorySubtitle,
			HistoryParagraph1: loc.HistoryParagraph1, HistoryParagraph2: loc.HistoryParagraph2, HistoryParagraph3: loc.HistoryParagraph3,
		}
	}
	return service.ExportCompatibleJSON(a.db, a.dataDir, meta)
}

type fullBackupOptions struct {
	LocationIDs   []string `json:"location_ids"`
	AllLocations  bool     `json:"all_locations"`
	IncludeJSON   bool     `json:"include_json"`
	IncludeDB     bool     `json:"include_db"`
	IncludeMap    bool     `json:"include_map"`
	IncludeIcons  bool     `json:"include_icons"`
	IncludePhotos bool     `json:"include_history_photos"`
	IncludeScans  bool     `json:"include_protocol_scans"`
}

func (a *App) createFullBackup(args map[string]interface{}) (map[string]interface{}, error) {
	var opts fullBackupOptions
	if args != nil {
		b, _ := json.Marshal(args)
		_ = json.Unmarshal(b, &opts)
	}
	if !opts.IncludeJSON && !opts.IncludeDB && !opts.IncludeMap && !opts.IncludeIcons && !opts.IncludePhotos && !opts.IncludeScans {
		opts.IncludeJSON = true
		opts.IncludeDB = true
		opts.IncludeMap = true
		opts.IncludeIcons = true
		opts.IncludePhotos = true
		opts.IncludeScans = true
	}

	reg, err := a.loadRegistry()
	if err != nil {
		return nil, err
	}
	selected := selectBackupLocations(reg, opts)
	if len(selected) == 0 {
		return nil, fmt.Errorf("nie wybrano miejscowości do backupu")
	}

	backupRoot := filepath.Join(a.rootDataDir, "backups")
	if err := os.MkdirAll(backupRoot, 0755); err != nil {
		return nil, err
	}
	stamp := time.Now().Format("2006-01-02_15-04-05")
	namePart := selected[0].ID
	if len(selected) > 1 {
		namePart = fmt.Sprintf("%d_miejscowosci", len(selected))
	}
	zipPath := filepath.Join(backupRoot, fmt.Sprintf("backup_%s_%s.zip", namePart, stamp))

	f, err := os.Create(zipPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	defer zw.Close()

	manifest := map[string]interface{}{
		"created_at": time.Now().Format(time.RFC3339),
		"options":    opts,
		"locations":  selected,
	}
	if err := zipJSON(zw, "manifest.json", manifest); err != nil {
		return nil, err
	}
	if err := zipFileIfExists(zw, a.registryPath(), "locations.json"); err != nil {
		return nil, err
	}

	filesAdded := 2
	for _, loc := range selected {
		baseInZip := filepath.ToSlash(filepath.Join("miejscowosci", loc.ID))
		if err := zipJSON(zw, filepath.ToSlash(filepath.Join(baseInZip, "location.json")), loc); err != nil {
			return nil, err
		}
		filesAdded++

		if opts.IncludeJSON {
			dbForExport, err := db.Open(loc.DBPath)
			if err != nil {
				return nil, fmt.Errorf("%s: nie można otworzyć bazy do eksportu JSON: %w", loc.Name, err)
			}
			tmpDir, err := os.MkdirTemp("", "czarna-json-export-*")
			if err != nil {
				_ = dbForExport.Close()
				return nil, err
			}
			meta := locationMeta(loc)
			_, err = service.ExportCompatibleJSON(dbForExport, tmpDir, meta)
			_ = dbForExport.Close()
			if err != nil {
				_ = os.RemoveAll(tmpDir)
				return nil, err
			}
			n, err := zipDir(zw, filepath.Join(tmpDir, "json"), filepath.ToSlash(filepath.Join(baseInZip, "json")))
			_ = os.RemoveAll(tmpDir)
			if err != nil {
				return nil, err
			}
			filesAdded += n
		}
		if opts.IncludeDB {
			for _, p := range []string{loc.DBPath, loc.DBPath + "-wal", loc.DBPath + "-shm"} {
				if added, err := zipFileIfExistsCount(zw, p, filepath.ToSlash(filepath.Join(baseInZip, filepath.Base(p)))); err != nil {
					return nil, err
				} else if added {
					filesAdded++
				}
			}
		}
		if opts.IncludeMap {
			for _, p := range []string{"mapa.jpg", "map_config.json"} {
				if added, err := zipFileIfExistsCount(zw, filepath.Join(loc.DataDir, p), filepath.ToSlash(filepath.Join(baseInZip, p))); err != nil {
					return nil, err
				} else if added {
					filesAdded++
				}
			}
		}
		if opts.IncludeIcons {
			for _, p := range []string{"favicon.jpeg", "custom_icon.png", "custom_icon.ico"} {
				if added, err := zipFileIfExistsCount(zw, filepath.Join(loc.DataDir, p), filepath.ToSlash(filepath.Join(baseInZip, p))); err != nil {
					return nil, err
				} else if added {
					filesAdded++
				}
			}
		}
		if opts.IncludePhotos {
			n, err := zipDir(zw, filepath.Join(loc.DataDir, "history_photos"), filepath.ToSlash(filepath.Join(baseInZip, "history_photos")))
			if err != nil {
				return nil, err
			}
			filesAdded += n
		}
		if opts.IncludeScans {
			n, err := zipDir(zw, filepath.Join(loc.DataDir, "protokoly"), filepath.ToSlash(filepath.Join(baseInZip, "protokoly")))
			if err != nil {
				return nil, err
			}
			filesAdded += n
		}
	}

	return map[string]interface{}{"ok": true, "path": zipPath, "locations": len(selected), "files": filesAdded}, nil
}

func selectBackupLocations(reg *locationsRegistry, opts fullBackupOptions) []LocationInfo {
	if opts.AllLocations {
		return reg.Locations
	}
	wanted := map[string]bool{}
	for _, id := range opts.LocationIDs {
		wanted[id] = true
	}
	if len(wanted) == 0 && reg.ActiveID != "" {
		wanted[reg.ActiveID] = true
	}
	out := []LocationInfo{}
	for _, loc := range reg.Locations {
		if wanted[loc.ID] {
			out = append(out, loc)
		}
	}
	return out
}

func locationMeta(loc LocationInfo) service.LocationJSONMeta {
	return service.LocationJSONMeta{ID: loc.ID, Name: loc.Name, FullName: loc.FullName, Powiat: loc.Powiat, Region: loc.Region, Year: loc.Year, Century: loc.Century, GminaKatastralna: loc.GminaKatastralna, MiejscowoscProtokol: loc.MiejscowoscProtokol, HomepageDescription: loc.HomepageDescription, HistorySubtitle: loc.HistorySubtitle, HistoryParagraph1: loc.HistoryParagraph1, HistoryParagraph2: loc.HistoryParagraph2, HistoryParagraph3: loc.HistoryParagraph3}
}

func zipJSON(zw *zip.Writer, name string, v interface{}) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	w, err := zw.Create(filepath.ToSlash(name))
	if err != nil {
		return err
	}
	_, err = w.Write(b)
	return err
}

func zipFileIfExists(zw *zip.Writer, src, name string) error {
	_, err := zipFileIfExistsCount(zw, src, name)
	return err
}

func zipFileIfExistsCount(zw *zip.Writer, src, name string) (bool, error) {
	info, err := os.Stat(src)
	if os.IsNotExist(err) || (err == nil && info.IsDir()) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	in, err := os.Open(src)
	if err != nil {
		return false, err
	}
	defer in.Close()
	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return false, err
	}
	header.Name = filepath.ToSlash(name)
	header.Method = zip.Deflate
	out, err := zw.CreateHeader(header)
	if err != nil {
		return false, err
	}
	_, err = io.Copy(out, in)
	return true, err
}

func zipDir(zw *zip.Writer, srcDir, zipBase string) (int, error) {
	if st, err := os.Stat(srcDir); os.IsNotExist(err) || (err == nil && !st.IsDir()) {
		return 0, nil
	} else if err != nil {
		return 0, err
	}
	count := 0
	err := filepath.WalkDir(srcDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		added, err := zipFileIfExistsCount(zw, path, filepath.ToSlash(filepath.Join(zipBase, rel)))
		if added {
			count++
		}
		return err
	})
	return count, err
}

// ============ RELOAD JSON FROM DISK ============

// reloadJSONFromDisk czyta JSON-y z katalogu danych aktywnej miejscowości i importuje je do bazy.
func (a *App) reloadJSONFromDisk() (interface{}, error) {
	loc, err := a.activeLocation()
	if err != nil {
		return nil, err
	}
	jsonDir := filepath.Join(loc.DataDir, "json")
	jsonFiles := []string{
		"owner_data_to_import.json",
		"parcels_data.json",
		"genealogia.json",
		"demografia.json",
		"map_config.json",
	}
	files := map[string]json.RawMessage{}
	for _, name := range jsonFiles {
		p := filepath.Join(jsonDir, name)
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		files[name] = data
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("brak plików JSON w %s — najpierw wykonaj eksport", jsonDir)
	}
	res, err := service.ImportCompatibleJSON(a.db, files)
	if err != nil {
		return nil, err
	}
	res.Dir = jsonDir
	return res, nil
}

// ============ IMPORT FULL BACKUP ============

func (a *App) importFullBackup(dataB64 string) (map[string]interface{}, error) {
	if strings.TrimSpace(dataB64) == "" {
		return nil, fmt.Errorf("brak danych ZIP (data_b64)")
	}

	// Remove optional data:... prefix
	b64 := dataB64
	if idx := strings.Index(b64, ","); idx >= 0 {
		b64 = b64[idx+1:]
	}
	zipData, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("nieprawidłowe dane base64: %w", err)
	}

	zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return nil, fmt.Errorf("nieprawidłowy ZIP: %w", err)
	}

	// Read manifest
	var manifest struct {
		CreatedAt string               `json:"created_at"`
		Locations []LocationInfo       `json:"locations"`
		Options   fullBackupOptions    `json:"options"`
	}
	if err := readZipJSON(zr, "manifest.json", &manifest); err != nil {
		return nil, fmt.Errorf("brak manifest.json: %w", err)
	}
	if len(manifest.Locations) == 0 {
		return nil, fmt.Errorf("ZIP nie zawiera miejscowości")
	}

	// Read locations.json from ZIP to get the registry for import
	var importedRegistry locationsRegistry
	_ = readZipJSON(zr, "locations.json", &importedRegistry)

	// Load current registry
	reg, err := a.loadRegistry()
	if err != nil {
		return nil, err
	}

	results := []map[string]interface{}{}

	for _, loc := range manifest.Locations {
		baseInZip := filepath.ToSlash(filepath.Join("miejscowosci", loc.ID))
		locRes := map[string]interface{}{"id": loc.ID, "name": loc.Name}

		// Check if location already exists
		existingIdx := -1
		for i, existing := range reg.Locations {
			if existing.ID == loc.ID {
				existingIdx = i
				break
			}
		}

		// Prepare location directory
		locDir := filepath.Join(a.rootDataDir, "locations", loc.ID)
		if err := os.MkdirAll(filepath.Join(locDir, "protokoly"), 0755); err != nil {
			locRes["error"] = err.Error()
			results = append(results, locRes)
			continue
		}
		if err := os.MkdirAll(filepath.Join(locDir, "history_photos"), 0755); err != nil {
			locRes["error"] = err.Error()
			results = append(results, locRes)
			continue
		}

		// Update location info
		loc.DataDir = locDir
		loc.DBPath = filepath.Join(locDir, loc.ID+".db")

		if existingIdx >= 0 {
			loc.CreatedAt = reg.Locations[existingIdx].CreatedAt
			loc.Active = reg.Locations[existingIdx].Active
			loc.AutoOpen = reg.Locations[existingIdx].AutoOpen
			reg.Locations[existingIdx] = loc
		} else {
			if loc.Year == "" {
				loc.Year = "1882"
			}
			if loc.Century == "" {
				loc.Century = "XIX w."
			}
			if loc.GminaKatastralna == "" {
				loc.GminaKatastralna = loc.Name
			}
			if loc.MiejscowoscProtokol == "" {
				loc.MiejscowoscProtokol = loc.Name
			}
			if loc.HomepageTemplate == "" {
				loc.HomepageTemplate = "praca_inzynierska"
			}
			loc.CreatedAt = time.Now().Format(time.RFC3339)
			reg.Locations = append(reg.Locations, loc)
		}

		count := 0

		// Restore DB files
		for _, dbFile := range []string{loc.ID + ".db", loc.ID + ".db-wal", loc.ID + ".db-shm"} {
			zipPath := filepath.ToSlash(filepath.Join(baseInZip, dbFile))
			destPath := filepath.Join(locDir, dbFile)
			if err := extractZipFile(zr, zipPath, destPath); err == nil {
				count++
			}
		}

		// Import JSON data from ZIP
		jsonFiles := []struct{ zipName, contentKey string }{
			{"owner_data_to_import.json", "owner_data_to_import.json"},
			{"parcels_data.json", "parcels_data.json"},
			{"genealogia.json", "genealogia.json"},
			{"demografia.json", "demografia.json"},
			{"map_config.json", "map_config.json"},
		}
		jsonData := map[string]json.RawMessage{}
		for _, jf := range jsonFiles {
			zipPath := filepath.ToSlash(filepath.Join(baseInZip, "json", jf.zipName))
			var raw json.RawMessage
			if err := readZipJSONRaw(zr, zipPath, &raw); err == nil {
				jsonData[jf.contentKey] = raw
			}
		}

		if len(jsonData) > 0 {
			// Open location DB for import
			locDB, err := db.Open(loc.DBPath)
			if err == nil {
				_, err = service.ImportCompatibleJSON(locDB, jsonData)
				_ = locDB.Close()
				if err != nil {
					locRes["json_import_warning"] = err.Error()
				}
			}
		}

		// Restore map file
		if err := extractZipFile(zr, filepath.ToSlash(filepath.Join(baseInZip, "mapa.jpg")), filepath.Join(locDir, "mapa.jpg")); err == nil {
			count++
		}

		// Restore map_config.json (skip if already imported via JSON)
		if len(jsonData) == 0 {
			extractZipFile(zr, filepath.ToSlash(filepath.Join(baseInZip, "map_config.json")), filepath.Join(locDir, "map_config.json"))
		}

		// Restore icons
		for _, icon := range []string{"favicon.jpeg", "custom_icon.png", "custom_icon.ico"} {
			if err := extractZipFile(zr, filepath.ToSlash(filepath.Join(baseInZip, icon)), filepath.Join(locDir, icon)); err == nil {
				count++
			}
		}

		// Restore history photos
		photosDir := filepath.Join(locDir, "history_photos")
		count += extractZipDir(zr, filepath.ToSlash(filepath.Join(baseInZip, "history_photos")), photosDir)

		// Restore protocol scans
		protokolyDir := filepath.Join(locDir, "protokoly")
		count += extractZipDir(zr, filepath.ToSlash(filepath.Join(baseInZip, "protokoly")), protokolyDir)

		locRes["files_restored"] = count
		if existingIdx >= 0 {
			locRes["status"] = "updated"
		} else {
			locRes["status"] = "created"
		}
		results = append(results, locRes)
	}

	// Save updated registry
	if err := a.saveRegistry(reg); err != nil {
		return map[string]interface{}{"ok": true, "results": results, "registry_error": err.Error()}, nil
	}

	return map[string]interface{}{"ok": true, "results": results, "total": len(results)}, nil
}

// readZipJSON finds and unmarshals a JSON file from a zip.Reader.
func readZipJSON(zr *zip.Reader, name string, target interface{}) error {
	f, err := openZipFile(zr, name)
	if err != nil {
		return err
	}
	defer f.Close()
	return json.NewDecoder(f).Decode(target)
}

// readZipJSONRaw reads raw JSON from a zip entry.
func readZipJSONRaw(zr *zip.Reader, name string, target *json.RawMessage) error {
	f, err := openZipFile(zr, name)
	if err != nil {
		return err
	}
	defer f.Close()
	return json.NewDecoder(f).Decode(target)
}

// openZipFile finds a file by name in the ZIP and returns a ReadCloser.
func openZipFile(zr *zip.Reader, name string) (io.ReadCloser, error) {
	for _, f := range zr.File {
		if filepath.ToSlash(f.Name) == name {
			return f.Open()
		}
	}
	return nil, fmt.Errorf("not found in ZIP: %s", name)
}

// extractZipFile extracts a single file from ZIP to a destination path.
func extractZipFile(zr *zip.Reader, zipName, destPath string) error {
	f, err := openZipFile(zr, zipName)
	if err != nil {
		return err
	}
	defer f.Close()

	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		return err
	}
	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, f)
	return err
}

// extractZipDir extracts all files under a ZIP directory prefix to a local directory.
func extractZipDir(zr *zip.Reader, zipPrefix, destDir string) int {
	prefix := zipPrefix
	if !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	count := 0
	for _, f := range zr.File {
		name := filepath.ToSlash(f.Name)
		if !strings.HasPrefix(name, prefix) || name == prefix {
			continue
		}
		rel := strings.TrimPrefix(name, prefix)
		if rel == "" {
			continue
		}
		dest := filepath.Join(destDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		out, err := os.Create(dest)
		if err != nil {
			rc.Close()
			continue
		}
		_, err = io.Copy(out, rc)
		rc.Close()
		out.Close()
		if err == nil {
			count++
		}
	}
	return count
}

// ============ v1 helpers (skopiowane z byłego app.go) ============

func (a *App) v1PobierzWszystkichWlascicieli() ([]map[string]interface{}, error) {
	wlasciciele, err := service.PobierzWszystkich(a.db)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]interface{}, 0, len(wlasciciele))
	for _, w := range wlasciciele {
		dzialki, _ := service.GetOwnerParcels(a.db, w.ID)
		result = append(result, map[string]interface{}{
			"id": w.ID, "unikalny_klucz": w.UnikalnyKlucz,
			"nazwa_wlasciciela": w.NazwaWlasciciela, "numer_protokolu": w.NumerProtokolu,
			"numer_domu": w.NumerDomu, "data_protokolu": w.DataProtokolu,
			"miejsce_protokolu": w.MiejsceProtokolu, "genealogia": w.Genealogia,
			"historia_wlasnosci": w.HistoriaWlasnosci, "uwagi": w.Uwagi,
			"wspolwlasnosc": w.Wspolwlasnosc, "powiazania_i_transakcje": w.PowiazaniaITransakcje,
			"interpretacja_i_wnioski": w.InterpretacjaIWnioski,
			"dzialki_rzeczywiste":     dzialki, "dzialki_protokol": dzialki,
		})
	}
	return result, nil
}

func (a *App) v1PobierzWlasciciela(args map[string]interface{}) (interface{}, error) {
	var w *models.Wlasciciel
	var err error

	klucz, _ := args["klucz"].(string)
	idf, hasID := args["id"].(float64)

	if klucz != "" {
		var foundID int64
		err = a.db.QueryRow("SELECT id FROM wlasciciele WHERE unikalny_klucz = ?", klucz).Scan(&foundID)
		if err != nil {
			return nil, nil
		}
		w, err = service.PobierzPoID(a.db, foundID)
	} else if hasID {
		w, err = service.PobierzPoID(a.db, int64(idf))
	} else {
		return nil, nil
	}

	if err != nil || w == nil {
		return nil, nil
	}

	protokol, rzeczywiste, _ := service.GetParcelsWithArea(a.db, w.ID, w.NumerDomu)
	wszystkie, _ := service.GetOwnerParcels(a.db, w.ID)

	return map[string]interface{}{
		"id": w.ID, "unikalny_klucz": w.UnikalnyKlucz, "nazwa_wlasciciela": w.NazwaWlasciciela,
		"numer_protokolu": w.NumerProtokolu, "numer_domu": w.NumerDomu,
		"data_protokolu": w.DataProtokolu, "miejsce_protokolu": w.MiejsceProtokolu,
		"genealogia": w.Genealogia, "historia_wlasnosci": w.HistoriaWlasnosci,
		"uwagi": w.Uwagi, "wspolwlasnosc": w.Wspolwlasnosc,
		"powiazania_i_transakcje": w.PowiazaniaITransakcje,
		"interpretacja_i_wnioski": w.InterpretacjaIWnioski,
		"dzialki_wszystkie":       wszystkie, "dzialki_rzeczywiste": rzeczywiste,
		"dzialki_protokol": protokol,
	}, nil
}

func (a *App) v1ZapiszWlascicielaAdmin(args map[string]interface{}) (map[string]interface{}, error) {
	db := a.db
	idf, _ := args["id"].(float64)
	id := int64(idf)

	getStr := func(key string) string {
		if v, ok := args[key].(string); ok {
			return v
		}
		return ""
	}
	oldUnikalnyKlucz := ""
	if id > 0 {
		_ = db.QueryRow("SELECT unikalny_klucz FROM wlasciciele WHERE id = ?", id).Scan(&oldUnikalnyKlucz)
	}
	unikalnyKlucz := getStr("unikalny_klucz")
	nazwaWlasciciela := getStr("nazwa_wlasciciela")

	var numerProt *int32
	if v, ok := args["numer_protokolu"].(float64); ok {
		n := int32(v)
		numerProt = &n
	}

	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var savedID int64
	if id > 0 {
		savedID = id
		_, err = tx.Exec(
			`UPDATE wlasciciele SET unikalny_klucz=?,nazwa_wlasciciela=?,numer_protokolu=?,
			 numer_domu=?,genealogia=?,historia_wlasnosci=?,uwagi=?,wspolwlasnosc=?,
			 powiazania_i_transakcje=?,interpretacja_i_wnioski=?,data_protokolu=?,miejsce_protokolu=?
			 WHERE id=?`,
			unikalnyKlucz, nazwaWlasciciela, numerProt,
			strPtr(getStr("numer_domu")), strPtr(getStr("genealogia")),
			strPtr(getStr("historia_wlasnosci")), strPtr(getStr("uwagi")),
			strPtr(getStr("wspolwlasnosc")), strPtr(getStr("powiazania_i_transakcje")),
			strPtr(getStr("interpretacja_i_wnioski")), strPtr(getStr("data_protokolu")),
			strPtr(getStr("miejsce_protokolu")), savedID,
		)
	} else {
		res, err2 := tx.Exec(
			`INSERT INTO wlasciciele (unikalny_klucz,nazwa_wlasciciela,numer_protokolu,numer_domu,
			 genealogia,historia_wlasnosci,uwagi,wspolwlasnosc,powiazania_i_transakcje,
			 interpretacja_i_wnioski,data_protokolu,miejsce_protokolu)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
			unikalnyKlucz, nazwaWlasciciela, numerProt,
			strPtr(getStr("numer_domu")), strPtr(getStr("genealogia")),
			strPtr(getStr("historia_wlasnosci")), strPtr(getStr("uwagi")),
			strPtr(getStr("wspolwlasnosc")), strPtr(getStr("powiazania_i_transakcje")),
			strPtr(getStr("interpretacja_i_wnioski")), strPtr(getStr("data_protokolu")),
			strPtr(getStr("miejsce_protokolu")),
		)
		if err2 != nil {
			return nil, err2
		}
		savedID, err = res.LastInsertId()
	}
	if err != nil {
		return nil, err
	}

	tx.Exec("DELETE FROM dzialki_wlasciciele WHERE wlasciciel_id = ?", savedID)

	parseIDs := func(key string) []int64 {
		if arr, ok := args[key].([]interface{}); ok {
			ids := make([]int64, 0, len(arr))
			for _, v := range arr {
				switch n := v.(type) {
				case float64:
					ids = append(ids, int64(n))
				case string:
					var parsed int64
					fmt.Sscanf(n, "%d", &parsed)
					ids = append(ids, parsed)
				}
			}
			return ids
		}
		return nil
	}
	realIDs := parseIDs("dzialki_rzeczywiste_ids")
	protIDs := parseIDs("dzialki_protokol_ids")

	for _, oid := range realIDs {
		tx.Exec("INSERT OR IGNORE INTO dzialki_wlasciciele (wlasciciel_id,obiekt_id,typ_posiadania) VALUES (?,?,'wlasnosc rzeczywista')", savedID, oid)
	}
	for _, oid := range protIDs {
		inReal := false
		for _, rid := range realIDs {
			if rid == oid {
				inReal = true
				break
			}
		}
		if !inReal {
			tx.Exec("INSERT OR IGNORE INTO dzialki_wlasciciele (wlasciciel_id,obiekt_id,typ_posiadania) VALUES (?,?,'wlasnosc z protokolu')", savedID, oid)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	if err := service.RenameOwnerProtocolFolder(a.db, a.dataDir, oldUnikalnyKlucz, unikalnyKlucz); err != nil {
		log.Printf("[PROTOKOLY] Nie można zmienić nazwy folderu skanów %q -> %q: %v", oldUnikalnyKlucz, unikalnyKlucz, err)
	}
	return map[string]interface{}{"id": savedID}, nil
}

func (a *App) v1APIWlasciciele() (map[string]interface{}, error) {
	rows, err := a.db.Query("SELECT id,unikalny_klucz,nazwa_wlasciciela,numer_protokolu FROM wlasciciele ORDER BY numer_protokolu")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var owners []map[string]interface{}
	for rows.Next() {
		var id int64
		var klucz, nazwa string
		var num *int32
		if err := rows.Scan(&id, &klucz, &nazwa, &num); err != nil {
			continue
		}
		dz, _ := service.GetOwnerParcels(a.db, id)
		owners = append(owners, map[string]interface{}{
			"id": id, "unikalny_klucz": klucz, "nazwa_wlasciciela": nazwa,
			"numer_protokolu": num, "dzialki_rzeczywiste": dz, "dzialki_protokol": dz,
		})
	}
	total := int64(len(owners))
	return map[string]interface{}{
		"owners": owners, "metadata": map[string]interface{}{
			"total_count": total, "zakres_lp": map[string]int64{"min": 1, "max": total},
		},
	}, nil
}

func (a *App) v1APIWlasciciel(klucz string) (map[string]interface{}, error) {
	var w models.Wlasciciel
	err := a.db.QueryRow(
		`SELECT id,unikalny_klucz,nazwa_wlasciciela,numer_protokolu,numer_domu,
		 genealogia,historia_wlasnosci,uwagi,wspolwlasnosc,
		 powiazania_i_transakcje,interpretacja_i_wnioski,
		 data_protokolu,miejsce_protokolu
		 FROM wlasciciele WHERE unikalny_klucz=?`, klucz,
	).Scan(&w.ID, &w.UnikalnyKlucz, &w.NazwaWlasciciela, &w.NumerProtokolu, &w.NumerDomu,
		&w.Genealogia, &w.HistoriaWlasnosci, &w.Uwagi, &w.Wspolwlasnosc,
		&w.PowiazaniaITransakcje, &w.InterpretacjaIWnioski, &w.DataProtokolu, &w.MiejsceProtokolu)
	if err != nil {
		return nil, nil
	}

	nl2br := func(s *string) string {
		if s == nil {
			return ""
		}
		text := *s
		// Dane importowane ze starego projektu czasem zawierają zapisane dosłownie
		// sekwencje `\n` zamiast prawdziwych znaków nowej linii. Normalizujemy oba
		// warianty, żeby sekcje protokołu nie pokazywały użytkownikowi tekstu "\n".
		text = strings.ReplaceAll(text, "\r\n", "\n")
		text = strings.ReplaceAll(text, "\\r\\n", "\n")
		text = strings.ReplaceAll(text, "\\n", "\n")
		text = strings.ReplaceAll(text, "\\r", "\n")
		return strings.ReplaceAll(text, "\n", "<br>")
	}
	linkProtocolNames := func(text string) string {
		if strings.TrimSpace(text) == "" {
			return text
		}
		currentKey := w.UnikalnyKlucz
		rows, err := a.db.Query(`SELECT p.imie_nazwisko,w.unikalny_klucz FROM osoby_genealogia p JOIN wlasciciele w ON w.id=p.id_protokolu ORDER BY LENGTH(p.imie_nazwisko) DESC`)
		if err != nil {
			return text
		}
		defer rows.Close()
		seen := map[string]bool{}
		for rows.Next() {
			var name, key string
			if rows.Scan(&name, &key) != nil || strings.TrimSpace(name) == "" || strings.TrimSpace(key) == "" || seen[name] {
				continue
			}
			// Nie linkuj imion, które prowadzą do tego samego protokołu (samolink).
			if key == currentKey {
				continue
			}
			seen[name] = true
			pattern := regexp.MustCompile(`(^|[^\pL\pN])(` + regexp.QuoteMeta(name) + `)([^\pL\pN]|$)`)
			text = pattern.ReplaceAllString(text, `${1}<a href="protokol.html?ownerId=`+key+`">${2}</a>${3}`)
		}
		return text
	}
	genealogiaHTML := linkProtocolNames(nl2br(w.Genealogia))
	historiaHTML := nl2br(w.HistoriaWlasnosci)
	uwagiHTML := nl2br(w.Uwagi)
	pelnaHistoria := historiaHTML
	if uwagiHTML != "" {
		pelnaHistoria += "<hr><b>Ciag dalszy / Uwagi:</b><br>" + uwagiHTML
	}

	re := regexp.MustCompile(`\[\[([^|\]]+)\|([^\]]+)\]\]`)
	powiazaniaRaw := nl2br(w.PowiazaniaITransakcje)
	powiazaniaHTML := re.ReplaceAllString(powiazaniaRaw, `<a href="protokol.html?ownerId=$2">$1</a>`)

	var maDrzewo bool
	a.db.QueryRow("SELECT EXISTS(SELECT 1 FROM osoby_genealogia WHERE id_protokolu=?)", w.ID).Scan(&maDrzewo)
	protokol, rzeczywiste, domID := service.GetParcelsWithArea(a.db, w.ID, w.NumerDomu)

	return map[string]interface{}{
		"id": w.ID, "unikalny_klucz": w.UnikalnyKlucz, "nazwa_wlasciciela": w.NazwaWlasciciela,
		"numer_protokolu": w.NumerProtokolu, "numer_domu": w.NumerDomu,
		"genealogia": genealogiaHTML, "historia_wlasnosci": w.HistoriaWlasnosci,
		"uwagi": w.Uwagi, "wspolwlasnosc": nl2br(w.Wspolwlasnosc),
		"powiazania_i_transakcje":      w.PowiazaniaITransakcje,
		"powiazania_i_transakcje_html": powiazaniaHTML,
		"interpretacja_i_wnioski":      nl2br(w.InterpretacjaIWnioski),
		"data_protokolu":               w.DataProtokolu, "miejsce_protokolu": w.MiejsceProtokolu,
		"gmina_katastralna": "Czarna", "ma_drzewo_genealogiczne": maDrzewo,
		"pelna_historia":   pelnaHistoria,
		"dzialki_protokol": protokol, "dzialki_rzeczywiste": rzeczywiste,
		"dom_obiekt_id": domID, "dom_numer": w.NumerDomu,
	}, nil
}

func (a *App) v1APIGenealogiaPersons() (map[string]interface{}, error) {
	rows, err := a.db.Query(
		`SELECT p.id,p.json_id,p.imie_nazwisko,p.plec,p.rok_urodzenia,p.rok_smierci,
		 p.numer_domu,p.uwagi,p.id_ojca,p.id_matki,w.unikalny_klucz
		 FROM osoby_genealogia p LEFT JOIN wlasciciele w ON p.id_protokolu=w.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type oRow struct {
		dbID, jsonID           int64
		name, gender           string
		house, notes, protoKey *string
		birth, death           *int32
		father, mother         *int64
	}
	var osobyRows []oRow
	for rows.Next() {
		var o oRow
		if rows.Scan(&o.dbID, &o.jsonID, &o.name, &o.gender, &o.birth, &o.death,
			&o.house, &o.notes, &o.father, &o.mother, &o.protoKey) != nil {
			continue
		}
		osobyRows = append(osobyRows, o)
	}

	dbToJSON := make(map[int64]int64)
	for _, o := range osobyRows {
		dbToJSON[o.dbID] = o.jsonID
	}

	malzRows, _ := a.db.Query("SELECT malzonek1_id,malzonek2_id,rok_slubu FROM malzenstwa")
	spouseMap := make(map[int64][]int64)
	marriageMap := make(map[int64][]map[string]interface{})
	if malzRows != nil {
		defer malzRows.Close()
		for malzRows.Next() {
			var m1, m2 int64
			var rok *int32
			if malzRows.Scan(&m1, &m2, &rok) != nil {
				continue
			}
			if j1, ok1 := dbToJSON[m1]; ok1 {
				if j2, ok2 := dbToJSON[m2]; ok2 {
					spouseMap[m1] = append(spouseMap[m1], j2)
					spouseMap[m2] = append(spouseMap[m2], j1)
					marriageMap[m1] = append(marriageMap[m1], map[string]interface{}{"spouseId": j2, "year": rok})
					marriageMap[m2] = append(marriageMap[m2], map[string]interface{}{"spouseId": j1, "year": rok})
				}
			}
		}
	}

	persons := make([]map[string]interface{}, 0, len(osobyRows))
	for _, o := range osobyRows {
		p := map[string]interface{}{
			"id": o.jsonID, "name": o.name, "gender": o.gender,
			"houseNumber": o.house, "notes": o.notes, "protokolKey": o.protoKey, "protocolKey": o.protoKey,
		}
		if o.birth != nil {
			p["birthDate"] = map[string]interface{}{"year": *o.birth}
		}
		if o.death != nil {
			p["deathDate"] = map[string]interface{}{"year": *o.death}
		}
		if o.father != nil {
			if fj, ok := dbToJSON[*o.father]; ok {
				p["fatherId"] = fj
			}
		}
		if o.mother != nil {
			if mj, ok := dbToJSON[*o.mother]; ok {
				p["motherId"] = mj
			}
		}
		if sp, ok := spouseMap[o.dbID]; ok {
			p["spouseIds"] = sp
		}
		if mar, ok := marriageMap[o.dbID]; ok {
			p["marriages"] = mar
		}
		persons = append(persons, p)
	}
	return map[string]interface{}{"persons": persons}, nil
}

func (a *App) v1APIGenealogiaTree(klucz string) (map[string]interface{}, error) {
	var ownerID int64
	if err := a.db.QueryRow("SELECT id FROM wlasciciele WHERE unikalny_klucz=?", klucz).Scan(&ownerID); err != nil {
		return map[string]interface{}{"error": "Właściciel nie znaleziony"}, nil
	}
	var rootDBID, rootJSONID int64
	if err := a.db.QueryRow("SELECT id,json_id FROM osoby_genealogia WHERE id_protokolu=? LIMIT 1", ownerID).Scan(&rootDBID, &rootJSONID); err != nil {
		return map[string]interface{}{"rootId": nil, "persons": []interface{}{}}, nil
	}

	const maxDepth = 2
	type qitem struct{ id, depth int64 }
	visited := map[int64]int64{rootDBID: 0}
	queue := []qitem{{rootDBID, 0}}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		add := func(id int64, depth int64) {
			if id == 0 {
				return
			}
			if _, ok := visited[id]; !ok {
				visited[id] = depth
				queue = append(queue, qitem{id, depth})
			}
		}
		if cur.depth > -maxDepth {
			var father, mother *int64
			_ = a.db.QueryRow("SELECT id_ojca,id_matki FROM osoby_genealogia WHERE id=?", cur.id).Scan(&father, &mother)
			if father != nil {
				add(*father, cur.depth-1)
			}
			if mother != nil {
				add(*mother, cur.depth-1)
			}
		}
		spRows, _ := a.db.Query("SELECT CASE WHEN malzonek1_id=? THEN malzonek2_id ELSE malzonek1_id END FROM malzenstwa WHERE malzonek1_id=? OR malzonek2_id=?", cur.id, cur.id, cur.id)
		if spRows != nil {
			for spRows.Next() {
				var sid int64
				if spRows.Scan(&sid) == nil {
					add(sid, cur.depth)
				}
			}
			spRows.Close()
		}
		if cur.depth < maxDepth {
			chRows, _ := a.db.Query("SELECT id FROM osoby_genealogia WHERE id_ojca=? OR id_matki=?", cur.id, cur.id)
			if chRows != nil {
				for chRows.Next() {
					var cid int64
					if chRows.Scan(&cid) == nil {
						add(cid, cur.depth+1)
					}
				}
				chRows.Close()
			}
		}
	}

	dbIDs := make([]int64, 0, len(visited))
	for id := range visited {
		dbIDs = append(dbIDs, id)
	}
	sort.Slice(dbIDs, func(i, j int) bool { return dbIDs[i] < dbIDs[j] })
	dbToJSON := map[int64]int64{}
	type raw struct {
		dbID, jsonID   int64
		name, gender   string
		house, notes   *string
		birth, death   *int32
		father, mother *int64
	}
	raws := []raw{}
	for _, id := range dbIDs {
		var r raw
		err := a.db.QueryRow(`SELECT id,json_id,imie_nazwisko,COALESCE(plec,''),numer_domu,rok_urodzenia,rok_smierci,id_ojca,id_matki,uwagi FROM osoby_genealogia WHERE id=?`, id).
			Scan(&r.dbID, &r.jsonID, &r.name, &r.gender, &r.house, &r.birth, &r.death, &r.father, &r.mother, &r.notes)
		if err == nil {
			raws = append(raws, r)
			dbToJSON[r.dbID] = r.jsonID
		}
	}
	spouseMap := map[int64][]int64{}
	for _, id := range dbIDs {
		spRows, _ := a.db.Query("SELECT CASE WHEN malzonek1_id=? THEN malzonek2_id ELSE malzonek1_id END FROM malzenstwa WHERE malzonek1_id=? OR malzonek2_id=?", id, id, id)
		if spRows == nil {
			continue
		}
		for spRows.Next() {
			var sid int64
			if spRows.Scan(&sid) == nil {
				if jsonID, ok := dbToJSON[sid]; ok {
					spouseMap[id] = append(spouseMap[id], jsonID)
				}
			}
		}
		spRows.Close()
	}
	persons := make([]map[string]interface{}, 0, len(raws))
	for _, r := range raws {
		p := map[string]interface{}{"id": r.jsonID, "name": r.name, "gender": r.gender, "houseNumber": r.house, "notes": r.notes, "protocolKey": nil}
		if r.birth != nil {
			p["birthDate"] = map[string]interface{}{"year": *r.birth}
		}
		if r.death != nil {
			p["deathDate"] = map[string]interface{}{"year": *r.death}
		}
		if r.father != nil {
			p["fatherId"] = dbToJSON[*r.father]
		}
		if r.mother != nil {
			p["motherId"] = dbToJSON[*r.mother]
		}
		p["spouseIds"] = spouseMap[r.dbID]
		persons = append(persons, p)
	}
	return map[string]interface{}{"rootId": rootJSONID, "persons": persons}, nil
}

// ============ HELPERS ============

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func valueOr(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return v
}

func prefixHouse(v string) string {
	if strings.TrimSpace(v) == "" {
		return ""
	}
	return "Dom Rodzinny Nr " + v
}

func mapToStruct(m map[string]interface{}, target interface{}) error {
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}

// fixNullSlice konwertuje nil slice na pusty slice, żeby JSON zwracał [] zamiast null.
func fixNullSlice(v interface{}) interface{} {
	if v == nil {
		return nil
	}
	rv := reflect.ValueOf(v)
	if rv.Kind() == reflect.Slice && rv.IsNil() {
		return reflect.MakeSlice(rv.Type(), 0, 0).Interface()
	}
	return v
}
