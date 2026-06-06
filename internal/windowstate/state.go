// Package windowstate zapisuje i odczytuje rozmiar/pozycję/zmaksymalizowanie
// głównego okna aplikacji (używane przez Win32 API w main.go).
package windowstate

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
)

// State opisuje wymiary i pozycję okna przy ostatnim zamknięciu aplikacji.
type State struct {
	Width     int  `json:"width"`     // szerokość okna w px
	Height    int  `json:"height"`    // wysokość okna w px
	X         int  `json:"x"`         // pozycja lewego górnego rogu (klient/outer wg implementacji)
	Y         int `json:"y"`
	Maximized bool `json:"maximized"` // true = okno było zmaksymalizowane przy zamknięciu
}

const fileName = "window_state.json"

// Domyślne wymiary używane przy pierwszym uruchomieniu.
const (
	DefaultWidth  = 1400
	DefaultHeight = 900
)

// Load wczytuje stan z pliku. Jeśli plik nie istnieje lub jest uszkodzony,
// zwraca wartości domyślne (bez błędu).
func Load(dataDir string) State {
	def := State{Width: DefaultWidth, Height: DefaultHeight}
	if dataDir == "" {
		return def
	}
	path := filepath.Join(dataDir, fileName)
	b, err := os.ReadFile(path)
	if err != nil {
		return def
	}
	// Strip UTF-8 BOM jeśli obecny (PowerShell/Notatnik czasem dodają).
	if len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF {
		b = b[3:]
	}
	var s State
	if err := json.Unmarshal(b, &s); err != nil {
		log.Printf("[windowstate] błąd JSON w %s: %v", path, err)
		return def
	}
	// Walidacja - nie pozwól na śmiesznie małe/duże wartości
	if s.Width < 400 || s.Width > 10000 {
		s.Width = def.Width
	}
	if s.Height < 300 || s.Height > 10000 {
		s.Height = def.Height
	}
	return s
}

// Save zapisuje stan do pliku (atomicznie przez zapis do .tmp i rename).
func Save(dataDir string, s State) error {
	if dataDir == "" {
		return nil
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	final := filepath.Join(dataDir, fileName)
	tmp := final + ".tmp"
	if err := os.WriteFile(tmp, b, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, final)
}
