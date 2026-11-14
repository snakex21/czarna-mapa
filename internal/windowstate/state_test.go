package windowstate

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDefaultsWhenMissing(t *testing.T) {
	s := Load(t.TempDir())
	if s.Width != DefaultWidth || s.Height != DefaultHeight {
		t.Fatalf("oczekiwano domyślnych wymiarów, jest %+v", s)
	}
	if s := Load(""); s.Width != DefaultWidth {
		t.Fatalf("pusty katalog: %+v", s)
	}
}

func TestSaveLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	want := State{Width: 1234, Height: 777, X: -5, Y: 40, Maximized: true}
	if err := Save(dir, want); err != nil {
		t.Fatal(err)
	}
	if got := Load(dir); got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if _, err := os.Stat(filepath.Join(dir, fileName+".tmp")); !os.IsNotExist(err) {
		t.Error("plik .tmp nie został usunięty po zapisie")
	}
}

func TestLoadHandlesBOMAndClampsInvalid(t *testing.T) {
	dir := t.TempDir()
	data := append([]byte{0xEF, 0xBB, 0xBF}, []byte(`{"width":10,"height":99999,"x":1,"y":2}`)...)
	if err := os.WriteFile(filepath.Join(dir, fileName), data, 0o644); err != nil {
		t.Fatal(err)
	}
	s := Load(dir)
	if s.Width != DefaultWidth || s.Height != DefaultHeight || s.X != 1 || s.Y != 2 {
		t.Fatalf("nieoczekiwany stan: %+v", s)
	}
}

func TestLoadCorruptFallsBack(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, fileName), []byte("{not json"), 0o644)
	if s := Load(dir); s.Width != DefaultWidth {
		t.Fatalf("uszkodzony plik: %+v", s)
	}
}
