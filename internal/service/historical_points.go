package service

import (
	"crypto/sha1"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"czarna-mapa/internal/models"
)

// ============================================================================
// PUNKTY HISTORYCZNE (wzorzec z "Projekt Mapa Czarna")
// ============================================================================
//
// Trzy warstwy danych dla jednego punktu historycznego (= obiekt specjalny):
//
//  1. obiekty_geograficzne (kanoniczne źródło geometrii)
//     - object_name = obiekty_geograficzne.nazwa_lub_numer
//     - kategoria = 'obiekt_specjalny'
//
//  2. historical_points_metadata (display_name, description, source_note)
//     - object_name PK
//
//  3. point_photos (galeria)
//     - id PK, object_name FK (string), filename, caption, position
//
// Endpoint HTTP /point_photos/<plik> serwuje oryginały.
// Miniatury przez /obj_thumb?path=point_photos/<plik>&w=<px>.
// ============================================================================

// pointPhotoDir to katalog z galerią zdjęć (względem dataDir).
const pointPhotoDir = "point_photos"

// Maks. rozmiar uploadu (8 MB surowego base64 ≈ 6 MB pliku).
const maxPhotoDataLen = 8 * 1024 * 1024

// Dozwolone rozszerzenia dla uploadu (jak w "Projekt Mapa Czarna").
var allowedPhotoExt = map[string]bool{
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".webp": true,
	".gif":  true,
}

// PunktIstnieje sprawdza czy obiekt specjalny o danej nazwie istnieje
// w obiekty_geograficzne. object_name = nazwa_lub_numer.
func PunktIstnieje(database *sql.DB, objectName string) (bool, error) {
	var id int64
	err := database.QueryRow(
		`SELECT id FROM obiekty_geograficzne WHERE nazwa_lub_numer = ? AND kategoria = 'obiekt_specjalny' LIMIT 1`,
		objectName,
	).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// PobierzPunktyHistoryczne zwraca FeatureCollection dla warstwy mapy.
// Łączy obiekty_geograficzne (geometria) + historical_points_metadata +
// point_photos (galeria).
func PobierzPunktyHistoryczne(database *sql.DB) (map[string]any, error) {
	rows, err := database.Query(`
		SELECT
			og.id,
			og.nazwa_lub_numer,
			COALESCE(m.display_name, '') AS display_name,
			COALESCE(m.description, '') AS description,
			COALESCE(m.source_note, '') AS source_note,
			og.geometria_geojson
		FROM obiekty_geograficzne og
		LEFT JOIN historical_points_metadata m ON m.object_name = og.nazwa_lub_numer
		WHERE og.kategoria = 'obiekt_specjalny'
		  AND og.geometria_geojson IS NOT NULL
		ORDER BY og.nazwa_lub_numer
	`)
	if err != nil {
		return nil, fmt.Errorf("query punkty historyczne: %w", err)
	}
	defer rows.Close()

	type featureRow struct {
		id          int64
		objectName  string
		displayName string
		description string
		sourceNote  string
		geometry    string // surowy JSON
	}

	var collected []featureRow
	for rows.Next() {
		var fr featureRow
		if err := rows.Scan(&fr.id, &fr.objectName, &fr.displayName, &fr.description, &fr.sourceNote, &fr.geometry); err != nil {
			return nil, err
		}
		collected = append(collected, fr)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Zbierz nazwy obiektów, żeby pobrać zdjęcia jednym zapytaniem
	names := make([]any, 0, len(collected))
	placeholders := make([]string, 0, len(collected))
	for _, fr := range collected {
		names = append(names, fr.objectName)
		placeholders = append(placeholders, "?")
	}
	photoMap := make(map[string][]models.PointPhotoInline)
	if len(names) > 0 {
		q := `SELECT object_name, filename, COALESCE(caption, ''), position
		      FROM point_photos
		      WHERE object_name IN (` + strings.Join(placeholders, ",") + `)
		      ORDER BY object_name, position, id`
		prows, err := database.Query(q, names...)
		if err != nil {
			return nil, fmt.Errorf("query photos: %w", err)
		}
		defer prows.Close()
		for prows.Next() {
			var on, fn, cap string
			var pos int
			if err := prows.Scan(&on, &fn, &cap, &pos); err != nil {
				return nil, err
			}
			photoMap[on] = append(photoMap[on], models.PointPhotoInline{Filename: fn, Caption: cap})
		}
		if err := prows.Err(); err != nil {
			return nil, err
		}
	}

	// Zbuduj FeatureCollection
	features := make([]map[string]any, 0, len(collected))
	for _, fr := range collected {
		// Parsuj geometrię — może być string lub binary
		var geom any
		if err := json.Unmarshal([]byte(fr.geometry), &geom); err != nil {
			log.Printf("[HP] geometria %d: %v — pomijam", fr.id, err)
			continue
		}
		props := models.HistoricalPointProperties{
			ObjectName:  fr.objectName,
			DisplayName: fr.displayName,
			Description: fr.description,
			SourceNote:  fr.sourceNote,
			Photos:      photoMap[fr.objectName],
		}
		photosJSON, _ := json.Marshal(photoMap[fr.objectName])
		rawProps, _ := json.Marshal(map[string]any{
			"object_name":  props.ObjectName,
			"display_name": props.DisplayName,
			"description":  props.Description,
			"source_note":  props.SourceNote,
			"photos":       json.RawMessage(photosJSON),
		})
		features = append(features, map[string]any{
			"type":       "Feature",
			"id":         fr.id,
			"geometry":   geom,
			"properties": json.RawMessage(rawProps),
		})
	}
	return map[string]any{"type": "FeatureCollection", "features": features}, nil
}

// ListaObiektowSpecjalnych zwraca uproszczoną listę obiektów specjalnych
// (z metadanymi i galerią). Używana przez edytor admina.
func ListaObiektowSpecjalnych(database *sql.DB) ([]models.HistoricalPoint, error) {
	rows, err := database.Query(`
		SELECT og.nazwa_lub_numer
		FROM obiekty_geograficzne og
		WHERE og.kategoria = 'obiekt_specjalny'
		ORDER BY og.nazwa_lub_numer
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.HistoricalPoint
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		hp, err := PobierzPunktHistoryczny(database, name)
		if err != nil {
			return nil, err
		}
		if hp != nil {
			result = append(result, *hp)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// PobierzPunktHistoryczny zwraca pełne dane jednego punktu (z galerią).
// Zwraca (nil, nil) jeśli obiekt specjalny nie istnieje.
func PobierzPunktHistoryczny(database *sql.DB, objectName string) (*models.HistoricalPoint, error) {
	istnieje, err := PunktIstnieje(database, objectName)
	if err != nil {
		return nil, err
	}
	if !istnieje {
		return nil, nil
	}
	hp := &models.HistoricalPoint{ObjectName: objectName, Photos: []models.PointPhoto{}}

	// metadane (mogą nie istnieć)
	err = database.QueryRow(
		`SELECT display_name, description, source_note FROM historical_points_metadata WHERE object_name = ?`,
		objectName,
	).Scan(&hp.DisplayName, &hp.Description, &hp.SourceNote)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	// galeria
	rows, err := database.Query(
		`SELECT id, filename, COALESCE(caption, ''), position, created_at
		 FROM point_photos WHERE object_name = ? ORDER BY position, id`,
		objectName,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var p models.PointPhoto
		if err := rows.Scan(&p.ID, &p.Filename, &p.Caption, &p.Position, &p.CreatedAt); err != nil {
			return nil, err
		}
		hp.Photos = append(hp.Photos, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return hp, nil
}

// ZapiszPunktHistoryczny upsertuje metadane (display_name, description, source_note).
// object_name musi istnieć w obiekty_geograficzne jako obiekt_specjalny.
func ZapiszPunktHistoryczny(database *sql.DB, meta models.HistoricalPointMetadata) error {
	objectName := strings.TrimSpace(meta.ObjectName)
	if objectName == "" {
		return errors.New("object_name jest wymagane")
	}
	istnieje, err := PunktIstnieje(database, objectName)
	if err != nil {
		return err
	}
	if !istnieje {
		return fmt.Errorf("obiekt specjalny %q nie istnieje", objectName)
	}
	_, err = database.Exec(`
		INSERT INTO historical_points_metadata (object_name, display_name, description, source_note)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(object_name) DO UPDATE SET
			display_name = excluded.display_name,
			description  = excluded.description,
			source_note  = excluded.source_note
	`, objectName, meta.DisplayName, meta.Description, meta.SourceNote)
	return err
}

// DodajZdjeciePunktu uploaduje base64 → plik w data/point_photos/, zapisuje
// wpis w point_photos. Zwraca PointPhoto z nadanym id i position.
// dataURL to "data:image/jpeg;base64,..." albo sam base64.
func DodajZdjeciePunktu(database *sql.DB, dataDir, objectName, dataURL, filename string) (models.PointPhoto, error) {
	objectName = strings.TrimSpace(objectName)
	if objectName == "" {
		return models.PointPhoto{}, errors.New("object_name jest wymagane")
	}
	istnieje, err := PunktIstnieje(database, objectName)
	if err != nil {
		return models.PointPhoto{}, err
	}
	if !istnieje {
		return models.PointPhoto{}, fmt.Errorf("obiekt specjalny %q nie istnieje", objectName)
	}

	// Rozdziel data URL
	payload := dataURL
	if idx := strings.Index(dataURL, ","); idx > 0 && strings.HasPrefix(dataURL, "data:") {
		payload = dataURL[idx+1:]
	}
	payload = strings.TrimSpace(payload)
	if len(payload) > maxPhotoDataLen {
		return models.PointPhoto{}, fmt.Errorf("plik za duży (max %d bajtów base64)", maxPhotoDataLen)
	}
	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return models.PointPhoto{}, fmt.Errorf("nieprawidłowy base64: %w", err)
	}

	// Ustal bezpieczną nazwę pliku
	safeName := filepath.Base(filename)
	ext := strings.ToLower(filepath.Ext(safeName))
	if !allowedPhotoExt[ext] {
		return models.PointPhoto{}, fmt.Errorf("dozwolone: jpg, jpeg, png, webp, gif (dostałem: %q)", ext)
	}
	hash := quickHash(raw)
	finalName := fmt.Sprintf("%d_%s%s", time.Now().Unix(), hash, ext)
	fullPath := filepath.Join(dataDir, pointPhotoDir, finalName)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		return models.PointPhoto{}, err
	}
	if err := os.WriteFile(fullPath, raw, 0644); err != nil {
		return models.PointPhoto{}, err
	}

	// Position = max+1
	var maxPos sql.NullInt64
	_ = database.QueryRow(`SELECT MAX(position) FROM point_photos WHERE object_name = ?`, objectName).Scan(&maxPos)
	newPos := 0
	if maxPos.Valid {
		newPos = int(maxPos.Int64) + 1
	}

	// Wstaw
	res, err := database.Exec(
		`INSERT INTO point_photos (object_name, filename, caption, position) VALUES (?, ?, '', ?)`,
		objectName, finalName, newPos,
	)
	if err != nil {
		_ = os.Remove(fullPath) // wycofaj plik
		return models.PointPhoto{}, err
	}
	id, _ := res.LastInsertId()
	log.Printf("[HP] dodano zdjęcie %s dla %s (id=%d, pos=%d)", finalName, objectName, id, newPos)
	return models.PointPhoto{
		ID: id, ObjectName: objectName, Filename: finalName, Caption: "", Position: newPos,
	}, nil
}

// UsunZdjeciePunktu usuwa wpis z point_photos + plik z dysku.
func UsunZdjeciePunktu(database *sql.DB, dataDir string, id int64) error {
	var filename string
	err := database.QueryRow(`SELECT filename FROM point_photos WHERE id = ?`, id).Scan(&filename)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil // idempotent
		}
		return err
	}
	if _, err := database.Exec(`DELETE FROM point_photos WHERE id = ?`, id); err != nil {
		return err
	}
	fullPath := filepath.Join(dataDir, pointPhotoDir, filepath.Base(filename))
	_ = os.Remove(fullPath) // najlepsza próba
	return nil
}

// AktualizujCaption zmienia podpis zdjęcia.
func AktualizujCaption(database *sql.DB, id int64, caption string) error {
	if len(caption) > 500 {
		caption = caption[:500]
	}
	_, err := database.Exec(`UPDATE point_photos SET caption = ? WHERE id = ?`, caption, id)
	return err
}

// AktualizujKolejnoscZdjec ustawia position zgodnie z kolejnością w ids.
// idsInOrder to tablica id w nowej kolejności (0..N-1 → position).
func AktualizujKolejnoscZdjec(database *sql.DB, objectName string, idsInOrder []int64) error {
	tx, err := database.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(`UPDATE point_photos SET position = ? WHERE id = ? AND object_name = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for i, id := range idsInOrder {
		if _, err := stmt.Exec(i, id, objectName); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// PointPhotoPath zwraca pełną ścieżkę do pliku zdjęcia (używane przez HTTP handler).
func PointPhotoPath(dataDir, filename string) (string, error) {
	safe := filepath.Base(filename)
	full := filepath.Join(dataDir, pointPhotoDir, safe)
	absData, _ := filepath.Abs(dataDir)
	absFile, _ := filepath.Abs(full)
	if !strings.HasPrefix(absFile, absData+string(filepath.Separator)) {
		return "", errors.New("ścieżka poza dataDir")
	}
	return full, nil
}

// PointPhotoRelPath buduje ścieżkę względną do użycia w /obj_thumb.
func PointPhotoRelPath(filename string) string {
	return pointPhotoDir + "/" + filepath.Base(filename)
}

// quickHash zwraca 8-znakowy skrót SHA1 z pierwszych 4 bajtów payloadu.
func quickHash(b []byte) string {
	sum := sha1.Sum(b)
	return hex.EncodeToString(sum[:4])
}
