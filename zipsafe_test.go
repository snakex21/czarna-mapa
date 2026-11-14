package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type zipEntry struct {
	name    string
	body    []byte
	symlink bool
}

func buildZip(t *testing.T, entries []zipEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range entries {
		h := &zip.FileHeader{Name: e.name, Method: zip.Deflate}
		if e.symlink {
			h.SetMode(fs.ModeSymlink | 0o777)
		} else {
			h.SetMode(0o644)
		}
		w, err := zw.CreateHeader(h)
		if err != nil {
			t.Fatalf("CreateHeader(%q): %v", e.name, err)
		}
		if _, err := w.Write(e.body); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func manifestFor(t *testing.T, ids ...string) []byte {
	t.Helper()
	locs := []LocationInfo{}
	for _, id := range ids {
		locs = append(locs, LocationInfo{ID: id, Name: id})
	}
	b, err := json.Marshal(map[string]interface{}{"locations": locs})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestValidateZipEntryName(t *testing.T) {
	good := []string{
		"manifest.json",
		"miejscowosci/czarna/czarna.db",
		"miejscowosci/czarna/protokoly/Adam Nowak/1.jpg",
		"miejscowosci/czarna/history_photos/",
	}
	for _, n := range good {
		if err := validateZipEntryName(n); err != nil {
			t.Errorf("%q powinno przejść: %v", n, err)
		}
	}
	bad := []string{
		"",
		"../evil.txt",
		"miejscowosci/czarna/protokoly/../../../../evil.txt",
		"/abs/evil.txt",
		"C:/Windows/evil.txt",
		"C:evil.txt",
		"miejscowosci/czarna/czarna.db:hidden", // ADS
		"miejscowosci/czarna/czarna.db::$DATA", // ADS
		`miejscowosci\..\..\evil.txt`,          // backslash
		`\\server\share\evil.txt`,              // UNC
		"miejscowosci//czarna/a.txt",           // nieznormalizowane
		"miejscowosci/./czarna/a.txt",
		"miejscowosci/czarna/NUL", // urządzenie Windows
		"miejscowosci/czarna/con.txt",
		"miejscowosci/czarna/COM1.jpg",
		"miejscowosci/czarna/evil.", // Windows obcina kropkę
		"miejscowosci/czarna/evil ", // ... i spację
		"miejscowosci/czarna/a\x00b",
		"..",
	}
	for _, n := range bad {
		if err := validateZipEntryName(n); err == nil {
			t.Errorf("%q powinno zostać odrzucone", n)
		}
	}
}

// Każde złośliwe archiwum musi zostać odrzucone w całości, bez zapisania
// żadnego pliku i bez zmiany rejestru miejscowości.
func TestImportBackupRejectsMaliciousZips(t *testing.T) {
	cases := map[string][]zipEntry{
		"dot-dot": {
			{name: "manifest.json", body: manifestFor(t, "czarna")},
			{name: "miejscowosci/czarna/protokoly/../../../../evil.txt", body: []byte("pwned")},
		},
		"dot-dot-top": {
			{name: "manifest.json", body: manifestFor(t, "czarna")},
			{name: "../evil.txt", body: []byte("pwned")},
		},
		"absolute": {
			{name: "manifest.json", body: manifestFor(t, "czarna")},
			{name: "/evil.txt", body: []byte("pwned")},
		},
		"drive-letter": {
			{name: "manifest.json", body: manifestFor(t, "czarna")},
			{name: "C:/evil.txt", body: []byte("pwned")},
		},
		"ads": {
			{name: "manifest.json", body: manifestFor(t, "czarna")},
			{name: "miejscowosci/czarna/mapa.jpg:evil", body: []byte("pwned")},
		},
		"backslash": {
			{name: "manifest.json", body: manifestFor(t, "czarna")},
			{name: `miejscowosci/czarna/protokoly/..\..\..\..\evil.txt`, body: []byte("pwned")},
		},
		"symlink": {
			{name: "manifest.json", body: manifestFor(t, "czarna")},
			{name: "miejscowosci/czarna/protokoly/link", body: []byte("../../../../"), symlink: true},
		},
		"bad-location-id": {
			{name: "manifest.json", body: manifestFor(t, "../../evil")},
		},
		"bad-location-id-drive": {
			{name: "manifest.json", body: manifestFor(t, "C:")},
		},
	}
	for name, entries := range cases {
		t.Run(name, func(t *testing.T) {
			app := newTestApp(t)
			regBefore, _ := os.ReadFile(app.registryPath())
			parent := filepath.Dir(app.rootDataDir)
			beforeParent := listDir(t, parent)

			_, err := app.importFullBackupZip(buildZip(t, entries), defaultZipLimits)
			if err == nil {
				t.Fatal("złośliwy ZIP został przyjęty")
			}
			if _, statErr := os.Stat(filepath.Join(app.rootDataDir, "locations")); statErr == nil {
				t.Errorf("import zapisał dane mimo odrzucenia (%v)", err)
			}
			regAfter, _ := os.ReadFile(app.registryPath())
			if !bytes.Equal(regBefore, regAfter) {
				t.Error("rejestr miejscowości zmieniony mimo odrzucenia")
			}
			if got := listDir(t, parent); strings.Join(got, ",") != strings.Join(beforeParent, ",") {
				t.Errorf("pojawiły się pliki poza katalogiem danych: %v", got)
			}
		})
	}
}

func listDir(t *testing.T, dir string) []string {
	t.Helper()
	ents, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	out := []string{}
	for _, e := range ents {
		out = append(out, e.Name())
	}
	return out
}

func TestImportBackupZipBombLimits(t *testing.T) {
	app := newTestApp(t)
	big := bytes.Repeat([]byte{0}, 64<<10) // 64 KiB zer kompresuje się do ~100 B

	t.Run("too-many-entries", func(t *testing.T) {
		entries := []zipEntry{{name: "manifest.json", body: manifestFor(t, "czarna")}}
		for i := 0; i < 20; i++ {
			entries = append(entries, zipEntry{name: "miejscowosci/czarna/protokoly/" + string(rune('a'+i)) + ".jpg", body: []byte("x")})
		}
		l := defaultZipLimits
		l.MaxEntries = 10
		if _, err := app.importFullBackupZip(buildZip(t, entries), l); err == nil || !strings.Contains(err.Error(), "za dużo wpisów") {
			t.Fatalf("oczekiwano odrzucenia przez limit wpisów, jest: %v", err)
		}
	})
	t.Run("total-size", func(t *testing.T) {
		entries := []zipEntry{{name: "manifest.json", body: manifestFor(t, "czarna")}}
		for i := 0; i < 4; i++ {
			entries = append(entries, zipEntry{name: "miejscowosci/czarna/protokoly/" + string(rune('a'+i)) + ".jpg", body: big})
		}
		l := defaultZipLimits
		l.MaxTotalBytes = 128 << 10
		if _, err := app.importFullBackupZip(buildZip(t, entries), l); err == nil || !strings.Contains(err.Error(), "przekracza limit") {
			t.Fatalf("oczekiwano odrzucenia przez limit rozmiaru, jest: %v", err)
		}
	})
	t.Run("single-file", func(t *testing.T) {
		entries := []zipEntry{{name: "manifest.json", body: manifestFor(t, "czarna")}, {name: "miejscowosci/czarna/mapa.jpg", body: big}}
		l := defaultZipLimits
		l.MaxFileBytes = 1 << 10
		if _, err := app.importFullBackupZip(buildZip(t, entries), l); err == nil || !strings.Contains(err.Error(), "za duży") {
			t.Fatalf("oczekiwano odrzucenia przez limit pliku, jest: %v", err)
		}
	})
	// Limit w trakcie rozpakowania liczy faktyczne bajty, nie tylko nagłówki.
	t.Run("runtime-budget", func(t *testing.T) {
		zr, err := zip.NewReader(bytes.NewReader(buildZip(t, []zipEntry{{name: "a.bin", body: big}})), int64(len(buildZip(t, []zipEntry{{name: "a.bin", body: big}}))))
		if err != nil {
			t.Fatal(err)
		}
		dir := t.TempDir()
		root, err := os.OpenRoot(dir)
		if err != nil {
			t.Fatal(err)
		}
		defer root.Close()
		b := newZipBudget(defaultZipLimits)
		b.remaining = 1000
		if err := writeZipFileToRoot(zr.File[0], root, "a.bin", b); !errors.Is(err, errZipBudgetExceeded) {
			t.Fatalf("oczekiwano errZipBudgetExceeded, jest %v", err)
		}
		if _, err := os.Stat(filepath.Join(dir, "a.bin")); err == nil {
			t.Error("częściowy plik nie został usunięty")
		}
	})
}

// os.Root nie pozwala wyjść poza katalog nawet przez symlink na dysku.
func TestWriteZipFileToRootStaysInside(t *testing.T) {
	zr, err := zip.NewReader(bytes.NewReader(buildZip(t, []zipEntry{{name: "x", body: []byte("data")}})), int64(len(buildZip(t, []zipEntry{{name: "x", body: []byte("data")}}))))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for _, rel := range []string{"../escape.txt", "sub/../../escape.txt", "C:/escape.txt"} {
		if err := writeZipFileToRoot(zr.File[0], root, rel, newZipBudget(defaultZipLimits)); err == nil {
			t.Errorf("%q: zapis poza root został dopuszczony", rel)
		}
	}
	if err := writeZipFileToRoot(zr.File[0], root, "sub/dir/ok.txt", newZipBudget(defaultZipLimits)); err != nil {
		t.Fatalf("poprawny zapis odrzucony: %v", err)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "sub", "dir", "ok.txt")); string(b) != "data" {
		t.Fatalf("zła zawartość: %q", b)
	}
}

func TestImportBackupRPCRejectsMaliciousBase64(t *testing.T) {
	app := newTestApp(t)
	data := buildZip(t, []zipEntry{
		{name: "manifest.json", body: manifestFor(t, "czarna")},
		{name: "miejscowosci/czarna/protokoly/../../../../evil.txt", body: []byte("pwned")},
	})
	_, err := app.dispatch("miejscowosci_import_backup", map[string]interface{}{
		"data_b64": "data:application/zip;base64," + base64.StdEncoding.EncodeToString(data),
	})
	if err == nil || !strings.Contains(err.Error(), "odrzucono ZIP") {
		t.Fatalf("oczekiwano odrzucenia, jest %v", err)
	}
}
