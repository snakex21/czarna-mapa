package service

import (
	"crypto/sha1"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/disintegration/imaging"
)

// ============================================================================
// MINIATURY Z CACHE DYSKOWYM
// Serwujemy z `data/obj_thumbs/<sha1>_<w>w.jpg`.
// Źródła (ścieżki względne do dataDir):
//   - protokoly/<Klucz>/<plik>.jpg   (skan protokołu)
//   - history_photos/<plik>.jpg      (zdjęcie miejscowości)
//   - point_photos/<plik>.<ext>      (galeria punktu historycznego)
// Wszystkie przechodzą przez tę samą funkcję GenerujThumbnail.
// ============================================================================

// ThumbBaseDir to katalog cache miniaturek (względem dataDir).
const ThumbBaseDir = "obj_thumbs"

// maxThumbW to maksymalna szerokość miniaturki (zabezpieczenie przed
// żądaniem 10000px). Domyślnie generujemy 240/400/800 warianty.
var maxThumbW = 800

// GenerujThumbnail produkuje miniaturkę JPEG o szerokości `w` z cache'em.
// Zwraca ścieżkę do istniejącego pliku .jpg w katalogu cache.
//
//	w — żądana szerokość w px; 0 oznacza oryginał (bez resize).
func GenerujThumbnail(dataDir, srcRel string, w int) (string, error) {
	if w < 0 {
		w = 0
	}
	if w > maxThumbW {
		w = maxThumbW
	}
	srcRel = filepath.ToSlash(filepath.Clean(srcRel))
	if srcRel == "." || strings.HasPrefix(srcRel, "..") || filepath.IsAbs(srcRel) {
		return "", fmt.Errorf("nieprawidłowa ścieżka źródła")
	}

	srcPath := filepath.Join(dataDir, filepath.FromSlash(srcRel))
	absData, _ := filepath.Abs(dataDir)
	absSrc, _ := filepath.Abs(srcPath)
	if !strings.HasPrefix(absSrc, absData+string(os.PathSeparator)) {
		return "", fmt.Errorf("ścieżka poza dataDir")
	}

	srcInfo, err := os.Stat(srcPath)
	if err != nil {
		return "", err
	}

	// Klucz cache: hash(srcRel) + rozmiar pliku + w
	sum := sha1.Sum([]byte(srcRel + "|" + strconv.FormatInt(srcInfo.Size(), 10) + "|" + strconv.Itoa(w)))
	cacheKey := fmt.Sprintf("%x_%dw.jpg", sum, w)
	cacheDir := filepath.Join(dataDir, ThumbBaseDir)
	cachePath := filepath.Join(cacheDir, cacheKey)

	// Cache hit
	if _, err := os.Stat(cachePath); err == nil {
		return cachePath, nil
	}

	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return "", err
	}

	// Wczytaj + zdekoduj
	f, err := os.Open(srcPath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return "", fmt.Errorf("decode %s: %w", srcPath, err)
	}

	// Resize (jeśli potrzebny)
	if w > 0 {
		bounds := img.Bounds()
		if bounds.Dx() > w {
			img = imaging.Resize(img, w, 0, imaging.Lanczos)
		}
	}

	// Zapisz jako JPEG (jakość 80 — kompromis rozmiar/jakość)
	out, err := os.Create(cachePath)
	if err != nil {
		return "", err
	}
	defer out.Close()
	if err := imaging.Encode(out, img, imaging.JPEG, imaging.JPEGQuality(80)); err != nil {
		_ = os.Remove(cachePath)
		return "", err
	}
	log.Printf("[THUMB] %s → %s (%dw)", srcRel, cacheKey, w)
	return cachePath, nil
}

// RozdzielaczŚcieżek pomaga endpointowi HTTP zdecydować skąd czytać plik
// źródłowy. Przyjmuje parametr `path` (np. "protokoly/Adam/1.jpg") i zwraca
// pełną ścieżkę na dysku.
func RozdzielaczŚcieżek(dataDir, path string) (string, error) {
	path = filepath.ToSlash(filepath.Clean(path))
	if path == "." || strings.HasPrefix(path, "..") || filepath.IsAbs(path) {
		return "", fmt.Errorf("nieprawidłowa ścieżka")
	}
	full := filepath.Join(dataDir, filepath.FromSlash(path))
	absData, _ := filepath.Abs(dataDir)
	absFile, _ := filepath.Abs(full)
	if !strings.HasPrefix(absFile, absData+string(os.PathSeparator)) {
		return "", fmt.Errorf("ścieżka poza dataDir")
	}
	return full, nil
}

// mimeForExt zwraca Content-Type dla rozszerzenia.
func MimeForExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	default:
		return "application/octet-stream"
	}
}

// copyFileIfExists kopiuje src do dst z opcją nadpisania. Nieużywane na razie
// — zostawione jako helper, gdyby trzeba było przenieść plik do cache'a
// atomowo.
func copyFileIfExists(dst io.Writer, src string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(dst, f)
	return err
}
