package service

import (
	"czarna-mapa/internal/models"
	"database/sql"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// cachedProtoDir — zapamiętana ścieżka do protokołów (znaleziona przy pierwszym wywołaniu)
var cachedProtoDir string

// ProtoBaseDir zwraca katalog ze skanami protokołów.
// Przy pierwszym wywołaniu z DB sprawdza konfigurację i zapisuje wynik.
func ProtoBaseDir(db *sql.DB, fallbackDir string) string {
	if cachedProtoDir != "" {
		return cachedProtoDir
	}

	// Sprawdź konfigurację w bazie
	if db != nil {
		var dbPath string
		err := db.QueryRow("SELECT wartosc FROM konfiguracja_systemu WHERE klucz = 'protokoly_path'").Scan(&dbPath)
		if err == nil && dbPath != "" {
			if info, err := os.Stat(dbPath); err == nil && info.IsDir() && hasProtocolImageFolders(dbPath) {
				cachedProtoDir = dbPath
				log.Printf("[PROTOKOLY] Z bazy: %s", dbPath)
				return cachedProtoDir
			}
			nested := filepath.Join(dbPath, "protokoly")
			if info, err := os.Stat(nested); err == nil && info.IsDir() && hasProtocolImageFolders(nested) {
				absPath, _ := filepath.Abs(nested)
				cachedProtoDir = absPath
				db.Exec(`UPDATE konfiguracja_systemu SET wartosc = ? WHERE klucz = 'protokoly_path'`, absPath)
				log.Printf("[PROTOKOLY] Poprawiono sciezke z bazy na: %s", absPath)
				return cachedProtoDir
			}
		}
	}

	// Szukaj automatycznie
	candidates := []string{
		filepath.Join(fallbackDir, "protokoly", "protokoly"),
		filepath.Join(fallbackDir, "protokoly"),
		filepath.Join(fallbackDir, "data", "protokoly", "protokoly"),
		filepath.Join(fallbackDir, "data", "protokoly"),
		"data/protokoly/protokoly",
		"data/protokoly",
		"protokoly/protokoly",
		"protokoly",
	}

	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(cwd, "data", "protokoly", "protokoly"),
			filepath.Join(cwd, "data", "protokoly"),
			filepath.Join(cwd, "protokoly", "protokoly"),
			filepath.Join(cwd, "protokoly"),
		)
	}

	exePath, _ := os.Executable()
	exeDir := filepath.Dir(exePath)
	candidates = append(candidates,
		filepath.Join(exeDir, "data", "protokoly", "protokoly"),
		filepath.Join(exeDir, "data", "protokoly"),
		filepath.Join(exeDir, "protokoly", "protokoly"),
		filepath.Join(exeDir, "protokoly"),
	)

	if home, err := os.UserHomeDir(); err == nil {
		desktop := filepath.Join(home, "Desktop")
		candidates = append(candidates,
			// typowa lokalizacja aktualnego przepisanego projektu
			filepath.Join(desktop, "czarna-mapa", "data", "protokoly", "protokoly"),
			filepath.Join(desktop, "czarna-mapa", "data", "protokoly"),
			// typowa lokalizacja starego projektu Flask
			filepath.Join(desktop, "Projekt Mapa Czarna", "backup", "Czarna", "protokoly"),
			filepath.Join(desktop, "Projekt Mapa Czarna", "protokoly"),
		)
	}

	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && info.IsDir() && hasProtocolImageFolders(c) {
			absPath, _ := filepath.Abs(c)
			cachedProtoDir = absPath
			// Zapisz do bazy na przyszłość
			if db != nil {
				db.Exec(`INSERT INTO konfiguracja_systemu (klucz, wartosc, opis) VALUES ('protokoly_path', ?, 'auto')
				         ON CONFLICT(klucz) DO UPDATE SET wartosc = excluded.wartosc`, absPath)
			}
			log.Printf("[PROTOKOLY] Znaleziono: %s", absPath)
			return cachedProtoDir
		}
	}

	cachedProtoDir = filepath.Join(fallbackDir, "protokoly")
	return cachedProtoDir
}

// hasProtocolImageFolders sprawdza, czy katalog wygląda jak baza protokołów:
// zawiera podfoldery właścicieli z plikami 1.jpg, 2.jpg itd. Dzięki temu nie
// wybieramy omyłkowo katalogu nadrzędnego data/protokoly, gdy właściwy układ to
// data/protokoly/protokoly/<Klucz_Wlasciciela>/<nr>.jpg.
func hasProtocolImageFolders(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if !e.IsDir() {
			if isImage(filepath.Ext(e.Name())) {
				return true
			}
			continue
		}
		children, err := os.ReadDir(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		for _, child := range children {
			if !child.IsDir() && isImage(filepath.Ext(child.Name())) {
				return true
			}
		}
	}
	return false
}

// ownerFolder zwraca nazwę folderu właściciela.
func ownerFolder(nazwa string) string {
	return strings.ReplaceAll(nazwa, " ", "_")
}

func normalizeFolderName(s string) string {
	s = strings.TrimSpace(s)
	replacer := strings.NewReplacer(
		" ", "_", "ą", "a", "ć", "c", "ę", "e", "ł", "l", "ń", "n", "ó", "o", "ś", "s", "ż", "z", "ź", "z",
		"Ą", "A", "Ć", "C", "Ę", "E", "Ł", "L", "Ń", "N", "Ó", "O", "Ś", "S", "Ż", "Z", "Ź", "Z",
	)
	return replacer.Replace(s)
}

// ownerProtoDir zwraca ścieżkę do folderu protokołu właściciela.
func ownerProtoDir(db *sql.DB, dataDir, nazwa string) string {
	base := ProtoBaseDir(db, dataDir)
	// Najpierw próbujemy dokładnego identyfikatora. Stary projekt używał w URL-ach
	// klucza/folderu bez polskich znaków (np. Adam_Labudzki), a nie nazwy z bazy.
	candidates := []string{
		nazwa,
		ownerFolder(nazwa),
		normalizeFolderName(nazwa),
	}
	seen := map[string]bool{}
	for _, c := range candidates {
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		direct := filepath.Join(base, c)
		if info, err := os.Stat(direct); err == nil && info.IsDir() {
			return direct
		}
	}

	// Ostatnia próba: porównanie bez wielkości liter i bez polskich znaków.
	if entries, err := os.ReadDir(base); err == nil {
		wanted := strings.ToLower(normalizeFolderName(nazwa))
		for _, e := range entries {
			if e.IsDir() && strings.ToLower(normalizeFolderName(e.Name())) == wanted {
				return filepath.Join(base, e.Name())
			}
		}
	}
	return filepath.Join(base, ownerFolder(nazwa))
}

// RenameOwnerProtocolFolder przenosi folder skanów po zmianie unikalnego klucza właściciela.
func RenameOwnerProtocolFolder(db *sql.DB, dataDir, oldKey, newKey string) error {
	oldKey = strings.TrimSpace(oldKey)
	newKey = strings.TrimSpace(newKey)
	if oldKey == "" || newKey == "" || oldKey == newKey {
		return nil
	}

	oldDir := ownerProtoDir(db, dataDir, oldKey)
	if info, err := os.Stat(oldDir); err != nil || !info.IsDir() {
		return nil
	}

	base := ProtoBaseDir(db, dataDir)
	newDir := filepath.Join(base, newKey)
	if _, err := os.Stat(newDir); err == nil {
		// Nie nadpisuj istniejącego folderu skanów.
		return nil
	}
	return os.Rename(oldDir, newDir)
}

// imageExtensions — rozszerzenia plików graficznych.
var imageExtensions = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true,
}

// isImage sprawdza czy plik jest obrazem.
func isImage(ext string) bool {
	return imageExtensions[strings.ToLower(ext)]
}

// imagePageNumber zwraca numer strony z nazwy pliku (zakładając format "1.jpg").
func imagePageNumber(name string) int64 {
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	n, err := strconv.ParseInt(stem, 10, 64)
	if err != nil {
		return 999999 // Sortuj na koniec
	}
	return n
}

// listImageFiles zwraca posortowaną listę plików graficznych w katalogu.
func listImageFiles(dir string) ([]os.DirEntry, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var images []os.DirEntry
	for _, e := range entries {
		if !e.IsDir() && isImage(filepath.Ext(e.Name())) {
			images = append(images, e)
		}
	}

	sort.Slice(images, func(i, j int) bool {
		return imagePageNumber(images[i].Name()) < imagePageNumber(images[j].Name())
	})

	return images, nil
}

// ListaProtokolow zwraca listę właścicieli z protokołami.
func ListaProtokolow(db *sql.DB, dataDir string) ([]models.ProtokolInfo, error) {
	wlasciciele, err := PobierzWszystkich(db)
	if err != nil {
		return nil, err
	}

	var result []models.ProtokolInfo
	for _, w := range wlasciciele {
		if w.NazwaWlasciciela == "" || w.NumerProtokolu == nil {
			continue
		}

		folderKey := w.UnikalnyKlucz
		if folderKey == "" {
			folderKey = w.NazwaWlasciciela
		}
		dir := ownerProtoDir(db, dataDir, folderKey)
		zdjeciaCount := int32(0)
		if entries, err := listImageFiles(dir); err == nil {
			zdjeciaCount = int32(len(entries))
		}

		result = append(result, models.ProtokolInfo{
			Klucz:            folderKey,
			Nazwa:            w.NazwaWlasciciela,
			NumerProtokolu:   w.NumerProtokolu,
			NumerDomu:        w.NumerDomu,
			DataProtokolu:    w.DataProtokolu,
			MiejsceProtokolu: w.MiejsceProtokolu,
			ZdjeciaCount:     zdjeciaCount,
		})
	}

	return result, nil
}

// LadujZdjeciaProtokolu ładuje wszystkie zdjęcia dla właściciela jako base64 data URL.
func LadujZdjeciaProtokolu(db *sql.DB, dataDir, nazwaWlasciciela string) ([]string, error) {
	dir := ownerProtoDir(db, dataDir, nazwaWlasciciela)
	log.Printf("[PROTOKOLY] Szukam obrazow w: %s", dir)
	entries, err := listImageFiles(dir)
	if err != nil {
		log.Printf("[PROTOKOLY] Blad listowania: %v", err)
		return nil, nil
	}
	log.Printf("[PROTOKOLY] Znaleziono %d plikow", len(entries))

	var zdjecia []string
	for _, e := range entries {
		path := filepath.Join(dir, e.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		ext := strings.TrimPrefix(filepath.Ext(e.Name()), ".")
		if ext == "jpeg" {
			ext = "jpg"
		}
		b64 := base64.StdEncoding.EncodeToString(data)
		zdjecia = append(zdjecia, fmt.Sprintf("data:image/%s;base64,%s", ext, b64))
	}

	return zdjecia, nil
}

// ListaZdjecProtokolu zwraca listę nazw plików zdjęć dla właściciela.
func ListaZdjecProtokolu(db *sql.DB, dataDir, nazwaWlasciciela string) ([]models.ZdjecieInfo, error) {
	dir := ownerProtoDir(db, dataDir, nazwaWlasciciela)
	entries, err := listImageFiles(dir)
	if err != nil {
		return nil, nil
	}

	var result []models.ZdjecieInfo
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		result = append(result, models.ZdjecieInfo{
			Nazwa:   e.Name(),
			Rozmiar: info.Size(),
		})
	}
	return result, nil
}

// DodajZdjecieProtokolu kopiuje plik do folderu protokołu.
func DodajZdjecieProtokolu(db *sql.DB, dataDir, nazwaWlasciciela, srcPath, ext string) (*models.ZdjecieInfo, error) {
	dir := ownerProtoDir(db, dataDir, nazwaWlasciciela)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("nie można utworzyć katalogu: %w", err)
	}

	// Znajdź kolejny numer
	index := 1
	for {
		target := filepath.Join(dir, fmt.Sprintf("%d.%s", index, ext))
		if _, err := os.Stat(target); os.IsNotExist(err) {
			data, err := os.ReadFile(srcPath)
			if err != nil {
				return nil, fmt.Errorf("błąd odczytu źródła: %w", err)
			}
			if err := os.WriteFile(target, data, 0644); err != nil {
				return nil, fmt.Errorf("błąd zapisu: %w", err)
			}
			info, _ := os.Stat(target)
			size := int64(0)
			if info != nil {
				size = info.Size()
			}
			return &models.ZdjecieInfo{
				Nazwa:   fmt.Sprintf("%d.%s", index, ext),
				Rozmiar: size,
			}, nil
		}
		index++
		if index > 999 {
			return nil, fmt.Errorf("osiągnięto maksymalną liczbę zdjęć (999)")
		}
	}
}

// UsunZdjecieProtokolu usuwa zdjęcie z folderu protokołu.
func UsunZdjecieProtokolu(db *sql.DB, dataDir, nazwaWlasciciela, nazwaPliku string) error {
	dir := ownerProtoDir(db, dataDir, nazwaWlasciciela)
	plik := filepath.Join(dir, nazwaPliku)

	// Bezpieczeństwo: nie pozwól na wyjście poza katalog
	absDir, _ := filepath.Abs(dir)
	absPlik, _ := filepath.Abs(plik)
	if !strings.HasPrefix(absPlik, absDir) {
		return fmt.Errorf("nieprawidłowa ścieżka pliku")
	}

	return os.Remove(plik)
}

// PobierzZdjecieProtokolu zwraca pojedyncze zdjęcie jako base64 data URL.
func PobierzZdjecieProtokolu(db *sql.DB, dataDir, nazwaWlasciciela, nazwaPliku string) (string, error) {
	dir := ownerProtoDir(db, dataDir, nazwaWlasciciela)
	plik := filepath.Join(dir, nazwaPliku)

	absDir, _ := filepath.Abs(dir)
	absPlik, _ := filepath.Abs(plik)
	if !strings.HasPrefix(absPlik, absDir) {
		return "", fmt.Errorf("nieprawidłowa ścieżka pliku")
	}

	data, err := os.ReadFile(plik)
	if err != nil {
		return "", fmt.Errorf("błąd odczytu: %w", err)
	}

	ext := strings.TrimPrefix(filepath.Ext(nazwaPliku), ".")
	if ext == "jpeg" {
		ext = "jpg"
	}
	b64 := base64.StdEncoding.EncodeToString(data)
	return fmt.Sprintf("data:image/%s;base64,%s", ext, b64), nil
}

// UstawNumerZdjecia zmienia numer zdjęcia (przenumerowuje strony).
func UstawNumerZdjecia(db *sql.DB, dataDir, nazwaWlasciciela, nazwaPliku string, nowyNumer int64) (*models.ZdjecieInfo, error) {
	if nowyNumer < 1 || nowyNumer > 999 {
		return nil, fmt.Errorf("numer strony musi być w zakresie 1-999")
	}

	dir := ownerProtoDir(db, dataDir, nazwaWlasciciela)
	entries, err := listImageFiles(dir)
	if err != nil {
		return nil, err
	}

	// Znajdź pozycję pliku
	pos := -1
	for i, e := range entries {
		if e.Name() == nazwaPliku {
			pos = i
			break
		}
	}
	if pos == -1 {
		return nil, fmt.Errorf("nie znaleziono pliku")
	}

	// Przenieś na nową pozycję
	item := entries[pos]
	entries = append(entries[:pos], entries[pos+1:]...)
	target := int(nowyNumer - 1)
	if target > len(entries) {
		target = len(entries)
	}
	entries = append(entries[:target], append([]os.DirEntry{item}, entries[target:]...)...)

	// Renumeruj
	if err := renumberPages(dir, entries); err != nil {
		return nil, err
	}

	// Odczytaj nowy stan
	newEntries, _ := listImageFiles(dir)
	if target < len(newEntries) {
		e := newEntries[target]
		info, _ := e.Info()
		size := int64(0)
		if info != nil {
			size = info.Size()
		}
		return &models.ZdjecieInfo{Nazwa: e.Name(), Rozmiar: size}, nil
	}

	return nil, fmt.Errorf("nie znaleziono pliku po renumeracji")
}

// PrzesunZdjecie przesuwa zdjęcie w górę lub w dół.
func PrzesunZdjecie(db *sql.DB, dataDir, nazwaWlasciciela, nazwaPliku, kierunek string) error {
	dir := ownerProtoDir(db, dataDir, nazwaWlasciciela)
	entries, err := listImageFiles(dir)
	if err != nil {
		return err
	}

	pos := -1
	for i, e := range entries {
		if e.Name() == nazwaPliku {
			pos = i
			break
		}
	}
	if pos == -1 {
		return fmt.Errorf("nie znaleziono pliku")
	}

	otherPos := -1
	switch kierunek {
	case "up":
		if pos > 0 {
			otherPos = pos - 1
		}
	case "down":
		if pos+1 < len(entries) {
			otherPos = pos + 1
		}
	}
	if otherPos == -1 {
		return nil
	}

	entries[pos], entries[otherPos] = entries[otherPos], entries[pos]
	return renumberPages(dir, entries)
}

// renumberPages przenumerowuje pliki w katalogu.
func renumberPages(dir string, entries []os.DirEntry) error {
	if len(entries) == 0 {
		return nil
	}

	// Najpierw przenieś do tymczasowych nazw
	tmpNames := make([]string, len(entries))
	ts := time.Now().UnixNano()
	for i, e := range entries {
		ext := filepath.Ext(e.Name())
		tmp := filepath.Join(dir, fmt.Sprintf(".__tmp_page_%d_%d%s", i+1, ts, ext))
		src := filepath.Join(dir, e.Name())
		if err := os.Rename(src, tmp); err != nil {
			return fmt.Errorf("błąd przygotowania renumeracji: %w", err)
		}
		tmpNames[i] = tmp
	}

	// Potem do właściwych nazw
	for i, tmp := range tmpNames {
		ext := filepath.Ext(tmp)
		dst := filepath.Join(dir, fmt.Sprintf("%d%s", i+1, ext))
		if err := os.Rename(tmp, dst); err != nil {
			return fmt.Errorf("błąd renumeracji: %w", err)
		}
	}

	return nil
}
