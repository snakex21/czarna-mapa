package service

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestThumbnailSupportsWebP(t *testing.T) {
	dir := t.TempDir()
	// Wygenerowany obraz 2x2, bez danych użytkownika.
	data, err := base64.StdEncoding.DecodeString("UklGRhwAAABXRUJQVlA4TA8AAAAvAUAAAAfQ/4j+ByKi/wEA")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "photo.webp"), data, 0600); err != nil {
		t.Fatal(err)
	}
	result, err := GenerujThumbnail(dir, "photo.webp", 240)
	if err != nil {
		t.Fatalf("Dozwolony upload WebP musi mieć miniaturę: %v", err)
	}
	f, err := os.Open(result)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, format, err := image.Decode(f)
	if err != nil || format != "jpeg" || img.Bounds().Dx() != 2 {
		t.Fatalf("Nieprawidłowa miniatura: %s %v", format, err)
	}
}

func TestThumbnailInvalidatesSameSizeReplacement(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "photo.png")
	encode := func(c color.RGBA) []byte {
		img := image.NewRGBA(image.Rect(0, 0, 2, 2))
		for y := 0; y < 2; y++ {
			for x := 0; x < 2; x++ {
				img.SetRGBA(x, y, c)
			}
		}
		var buf bytes.Buffer
		encoder := png.Encoder{CompressionLevel: png.NoCompression}
		if err := encoder.Encode(&buf, img); err != nil {
			t.Fatal(err)
		}
		return buf.Bytes()
	}
	oldData, newData := encode(color.RGBA{R: 255, A: 255}), encode(color.RGBA{B: 255, A: 255})
	if len(oldData) != len(newData) {
		t.Fatal("Fixtures muszą mieć ten sam rozmiar")
	}
	write := func(data []byte, stamp time.Time) {
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, stamp, stamp); err != nil {
			t.Fatal(err)
		}
	}
	write(oldData, time.Unix(1000000000, 0))
	oldThumb, err := GenerujThumbnail(dir, "photo.png", 240)
	if err != nil {
		t.Fatal(err)
	}
	write(newData, time.Unix(1000000010, 0))
	newThumb, err := GenerujThumbnail(dir, "photo.png", 240)
	if err != nil {
		t.Fatal(err)
	}
	if oldThumb == newThumb {
		t.Fatal("Zmiana obrazu o tym samym rozmiarze zwraca starą miniaturę")
	}
	f, err := os.Open(newThumb)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	r, _, b, _ := img.At(0, 0).RGBA()
	if b <= r {
		t.Fatal("Miniatura nie zawiera nowego niebieskiego obrazu")
	}
	cached, err := GenerujThumbnail(dir, "photo.png", 240)
	if err != nil || cached != newThumb {
		t.Fatalf("Brak cache hit: %s %v", cached, err)
	}
}
