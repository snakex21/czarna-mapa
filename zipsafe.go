package main

// Bezpieczne rozpakowywanie backupów ZIP (ochrona przed Zip Slip i zip bombami).
//
// Zasady:
//   - całe archiwum jest walidowane PRZED zapisaniem czegokolwiek na dysk
//     (fail closed: jeden zły wpis = odrzucenie całego importu),
//   - nazwy wpisów muszą być lokalne: bez ścieżek absolutnych, "..", liter dysków,
//     dwukropków (ADS), backslashy, znaków sterujących i nazw urządzeń Windows,
//   - symlinki i inne nietypowe pliki są odrzucane,
//   - zapis odbywa się wyłącznie przez os.Root zakotwiczony w katalogu docelowym,
//     więc nawet podmieniony symlink na dysku nie pozwoli wyjść poza katalog,
//   - limity liczby wpisów i łącznego rozmiaru po rozpakowaniu są sprawdzane
//     zarówno na podstawie nagłówków, jak i faktycznie odczytanych bajtów.

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

// zipLimits określa twarde limity dla importowanego archiwum.
type zipLimits struct {
	MaxEntries    int   // maksymalna liczba wpisów w archiwum
	MaxTotalBytes int64 // maksymalny łączny rozmiar po rozpakowaniu
	MaxFileBytes  int64 // maksymalny rozmiar pojedynczego pliku po rozpakowaniu
	MaxJSONBytes  int64 // maksymalny rozmiar pojedynczego JSON-a wczytywanego do pamięci
}

// defaultZipLimits: pełny backup jednej miejscowości ze skanami to ok. 1,9 GB
// i ~500 plików, więc limity mają spory zapas, ale blokują zip bomby.
var defaultZipLimits = zipLimits{
	MaxEntries:    20000,
	MaxTotalBytes: 4 << 30, // 4 GiB
	MaxFileBytes:  1 << 30, // 1 GiB
	MaxJSONBytes:  256 << 20,
}

var errZipBudgetExceeded = errors.New("przekroczono limit rozmiaru rozpakowanych danych (możliwa zip bomba)")

// zipBudget śledzi faktycznie zapisane bajty w trakcie jednego importu.
type zipBudget struct {
	limits    zipLimits
	remaining int64
}

func newZipBudget(l zipLimits) *zipBudget {
	return &zipBudget{limits: l, remaining: l.MaxTotalBytes}
}

var locationIDPattern = regexp.MustCompile(`^[a-z0-9_]{1,64}$`)

// validLocationID sprawdza ID miejscowości pochodzące z niezaufanego manifestu.
// ID trafia do ścieżek (locations/<id>/<id>.db), więc dopuszczamy tylko format
// generowany przez locationID().
func validLocationID(id string) bool {
	return locationIDPattern.MatchString(id)
}

var windowsReservedNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true, "CONIN$": true, "CONOUT$": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true, "COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true, "LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

// validateZipEntryName odrzuca nazwy, które mogłyby wyjść poza katalog docelowy
// albo zachowują się specjalnie na Windows.
func validateZipEntryName(name string) error {
	if name == "" {
		return fmt.Errorf("pusta nazwa wpisu")
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			return fmt.Errorf("%q: znak sterujący w nazwie", name)
		}
	}
	if strings.Contains(name, `\`) {
		return fmt.Errorf("%q: backslash w nazwie", name)
	}
	if strings.Contains(name, ":") {
		return fmt.Errorf("%q: dwukropek w nazwie (litera dysku lub ADS)", name)
	}
	if strings.HasPrefix(name, "/") {
		return fmt.Errorf("%q: ścieżka absolutna", name)
	}
	trimmed := strings.TrimSuffix(name, "/")
	if trimmed == "" || path.Clean(trimmed) != trimmed {
		return fmt.Errorf("%q: nieznormalizowana ścieżka", name)
	}
	for _, seg := range strings.Split(trimmed, "/") {
		if seg == ".." || seg == "." || seg == "" {
			return fmt.Errorf("%q: niedozwolony segment ścieżki", name)
		}
		if strings.HasSuffix(seg, ".") || strings.HasSuffix(seg, " ") {
			return fmt.Errorf("%q: segment kończy się kropką lub spacją", name)
		}
		base := strings.ToUpper(seg)
		if i := strings.IndexByte(base, '.'); i >= 0 {
			base = base[:i]
		}
		if windowsReservedNames[strings.TrimRight(base, " ")] {
			return fmt.Errorf("%q: zarezerwowana nazwa urządzenia Windows", name)
		}
	}
	if !filepath.IsLocal(filepath.FromSlash(trimmed)) {
		return fmt.Errorf("%q: ścieżka nie jest lokalna", name)
	}
	return nil
}

// validateZipArchive sprawdza całe archiwum przed jakimkolwiek zapisem.
func validateZipArchive(zr *zip.Reader, l zipLimits) error {
	if len(zr.File) > l.MaxEntries {
		return fmt.Errorf("za dużo wpisów w ZIP: %d (limit %d)", len(zr.File), l.MaxEntries)
	}
	var total uint64
	for _, f := range zr.File {
		if err := validateZipEntryName(f.Name); err != nil {
			return err
		}
		mode := f.Mode()
		if mode&fs.ModeSymlink != 0 {
			return fmt.Errorf("%q: symlinki są niedozwolone", f.Name)
		}
		if mode&(fs.ModeDevice|fs.ModeNamedPipe|fs.ModeSocket|fs.ModeCharDevice|fs.ModeIrregular) != 0 {
			return fmt.Errorf("%q: nieobsługiwany typ pliku", f.Name)
		}
		if f.UncompressedSize64 > uint64(l.MaxFileBytes) {
			return fmt.Errorf("%q: plik za duży (%d B, limit %d B)", f.Name, f.UncompressedSize64, l.MaxFileBytes)
		}
		total += f.UncompressedSize64
		if total > uint64(l.MaxTotalBytes) {
			return fmt.Errorf("łączny rozmiar po rozpakowaniu przekracza limit %d B", l.MaxTotalBytes)
		}
	}
	return nil
}

// findZipFile zwraca wpis o dokładnie podanej nazwie (nazwy są już zwalidowane).
func findZipFile(zr *zip.Reader, name string) *zip.File {
	for _, f := range zr.File {
		if f.Name == name {
			return f
		}
	}
	return nil
}

// readZipJSONLimited dekoduje JSON z wpisu, czytając najwyżej MaxJSONBytes.
func readZipJSONLimited(zr *zip.Reader, name string, l zipLimits, target interface{}) error {
	f := findZipFile(zr, name)
	if f == nil {
		return fmt.Errorf("not found in ZIP: %s: %w", name, fs.ErrNotExist)
	}
	if f.UncompressedSize64 > uint64(l.MaxJSONBytes) {
		return fmt.Errorf("%s: JSON za duży", name)
	}
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	lr := &io.LimitedReader{R: rc, N: l.MaxJSONBytes + 1}
	if err := json.NewDecoder(lr).Decode(target); err != nil {
		return err
	}
	if lr.N <= 0 {
		return fmt.Errorf("%s: JSON za duży", name)
	}
	return nil
}

// extractZipEntry zapisuje jeden wpis do root/rel. rel jest ścieżką z ukośnikami,
// względną do katalogu root. Zwraca fs.ErrNotExist, jeśli wpisu nie ma w ZIP.
func extractZipEntry(zr *zip.Reader, zipName string, root *os.Root, rel string, b *zipBudget) error {
	f := findZipFile(zr, zipName)
	if f == nil {
		return fmt.Errorf("not found in ZIP: %s: %w", zipName, fs.ErrNotExist)
	}
	return writeZipFileToRoot(f, root, rel, b)
}

func writeZipFileToRoot(f *zip.File, root *os.Root, rel string, b *zipBudget) error {
	if err := validateZipEntryName(rel); err != nil {
		return err
	}
	if f.FileInfo().IsDir() {
		return nil
	}
	if dir := path.Dir(rel); dir != "." {
		if err := root.MkdirAll(filepath.FromSlash(dir), 0o755); err != nil {
			return err
		}
	}
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	limit := b.limits.MaxFileBytes
	if b.remaining < limit {
		limit = b.remaining
	}
	out, err := root.OpenFile(filepath.FromSlash(rel), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	n, copyErr := io.Copy(out, io.LimitReader(rc, limit+1))
	closeErr := out.Close()
	if n > limit {
		_ = root.Remove(filepath.FromSlash(rel))
		return errZipBudgetExceeded
	}
	b.remaining -= n
	if copyErr != nil {
		_ = root.Remove(filepath.FromSlash(rel))
		return copyErr
	}
	return closeErr
}

// extractZipDirTo rozpakowuje wszystkie pliki spod prefiksu zipPrefix do
// root/subdir. Zwraca liczbę zapisanych plików; błąd przerywa import.
func extractZipDirTo(zr *zip.Reader, zipPrefix string, root *os.Root, subdir string, b *zipBudget) (int, error) {
	prefix := strings.TrimSuffix(zipPrefix, "/") + "/"
	count := 0
	for _, f := range zr.File {
		if !strings.HasPrefix(f.Name, prefix) || f.FileInfo().IsDir() {
			continue
		}
		rel := strings.TrimPrefix(f.Name, prefix)
		if rel == "" {
			continue
		}
		if err := writeZipFileToRoot(f, root, path.Join(subdir, rel), b); err != nil {
			return count, fmt.Errorf("%s: %w", f.Name, err)
		}
		count++
	}
	return count, nil
}
