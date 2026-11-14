// jpegpack kopiuje katalog skanów do paczki release, rekompresując pliki JPEG
// do zadanej jakości. Oryginały w źródle nie są zmieniane.
//
//	go run ./tools/jpegpack -src data\protokoly -dst dist\...\data\protokoly -q 85
//
// Segmenty APP1 (EXIF, m.in. orientacja) i APP2 (profil ICC) są przenoszone
// z oryginału. Jeśli nowy plik nie jest mniejszy, kopiowany jest oryginał.
package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"flag"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
)

func main() {
	src := flag.String("src", "", "katalog źródłowy (nie jest modyfikowany)")
	dst := flag.String("dst", "", "katalog docelowy (nie może istnieć)")
	q := flag.Int("q", 85, "jakość JPEG 1-100")
	flag.Parse()
	if *src == "" || *dst == "" || *q < 1 || *q > 100 {
		flag.Usage()
		os.Exit(2)
	}
	if _, err := os.Stat(*dst); err == nil {
		log.Fatalf("%s już istnieje", *dst)
	}
	var files []string
	err := filepath.WalkDir(*src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type().IsRegular() {
			files = append(files, p)
		}
		return nil
	})
	if err != nil {
		log.Fatal(err)
	}
	var inBytes, outBytes, recompressed atomic.Int64
	jobs := make(chan string)
	var wg sync.WaitGroup
	var firstErr error
	var errOnce sync.Once
	for i := 0; i < runtime.NumCPU(); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for p := range jobs {
				rel, _ := filepath.Rel(*src, p)
				out := filepath.Join(*dst, rel)
				in, n, re, err := packFile(p, out, *q)
				if err != nil {
					errOnce.Do(func() { firstErr = fmt.Errorf("%s: %w", p, err) })
					continue
				}
				inBytes.Add(in)
				outBytes.Add(n)
				if re {
					recompressed.Add(1)
				}
			}
		}()
	}
	for _, f := range files {
		jobs <- f
	}
	close(jobs)
	wg.Wait()
	if firstErr != nil {
		log.Fatal(firstErr)
	}
	fmt.Printf("jpegpack: %d plików, %d zrekompresowanych (q%d), %.1f MB -> %.1f MB\n",
		len(files), recompressed.Load(), *q, float64(inBytes.Load())/1e6, float64(outBytes.Load())/1e6)
}

func packFile(src, dst string, q int) (inSize, outSize int64, recompressed bool, err error) {
	orig, err := os.ReadFile(src)
	if err != nil {
		return 0, 0, false, err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return 0, 0, false, err
	}
	data := orig
	ext := strings.ToLower(filepath.Ext(src))
	if ext == ".jpg" || ext == ".jpeg" {
		if re, err := recompress(orig, q); err == nil && len(re) < len(orig) {
			data = re
			recompressed = true
		} else if err != nil {
			log.Printf("pomijam rekompresję %s: %v", src, err)
		}
	}
	if err := os.WriteFile(dst, data, 0o644); err != nil {
		return 0, 0, false, err
	}
	return int64(len(orig)), int64(len(data)), recompressed, nil
}

func recompress(orig []byte, q int) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(orig))
	if err != nil {
		return nil, err
	}
	var enc bytes.Buffer
	if err := jpeg.Encode(&enc, img, &jpeg.Options{Quality: q}); err != nil {
		return nil, err
	}
	meta, err := metadataSegments(orig)
	if err != nil {
		return nil, err
	}
	b := enc.Bytes()
	if len(b) < 2 || b[0] != 0xFF || b[1] != 0xD8 {
		return nil, errors.New("encoder nie zwrócił SOI")
	}
	out := make([]byte, 0, len(b)+len(meta))
	out = append(out, 0xFF, 0xD8)
	out = append(out, meta...)
	out = append(out, b[2:]...)
	return out, nil
}

// metadataSegments zwraca surowe segmenty APP1 (EXIF/XMP) i APP2 (ICC)
// z nagłówka JPEG (do pierwszego SOS).
func metadataSegments(b []byte) ([]byte, error) {
	if len(b) < 4 || b[0] != 0xFF || b[1] != 0xD8 {
		return nil, errors.New("to nie jest JPEG")
	}
	var out []byte
	r := bytes.NewReader(b[2:])
	for {
		var hdr [2]byte
		if _, err := io.ReadFull(r, hdr[:]); err != nil {
			return out, nil
		}
		if hdr[0] != 0xFF {
			return nil, errors.New("uszkodzony nagłówek JPEG")
		}
		marker := hdr[1]
		if marker == 0xD9 || marker == 0xDA { // EOI / SOS: koniec nagłówka
			return out, nil
		}
		if marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7) {
			continue
		}
		var l uint16
		if err := binary.Read(r, binary.BigEndian, &l); err != nil || l < 2 {
			return nil, errors.New("uszkodzona długość segmentu")
		}
		payload := make([]byte, int(l)-2)
		if _, err := io.ReadFull(r, payload); err != nil {
			return nil, err
		}
		if marker == 0xE1 || marker == 0xE2 {
			out = append(out, 0xFF, marker, byte(l>>8), byte(l))
			out = append(out, payload...)
		}
	}
}
