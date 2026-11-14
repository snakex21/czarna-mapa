//go:build smoke && windows

// Harness smoke testu (TYLKO z -tags smoke; nie trafia do buildu release).
//
// Uruchomienie (patrz README, sekcja "Smoke test"):
//
//	go build -tags smoke -o smoke.exe .
//	set CZARNA_SMOKE_SCRIPT=scripts\smoke\smoke.js
//	set CZARNA_SMOKE_OUT=<katalog na zrzuty i raport>
//	set CZARNA_SMOKE_MALICIOUS=<ścieżka do złośliwego ZIP-a>
//	smoke.exe   (w katalogu z KOPIĄ danych)
//
// Skrypt JS jest wstrzykiwany do strony i przeklikuje aplikację; Go udostępnia
// mu zrzut ekranu okna (PrintWindow), odczyt pliku ZIP i zapis raportu.

package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"

	webview "github.com/webview/webview_go"
	"golang.org/x/sys/windows"
)

func init() { testHook = installSmokeHook }

var (
	smokeGdi32             = windows.NewLazySystemDLL("gdi32.dll")
	procPrintWindow        = winUser32.NewProc("PrintWindow")
	procGetWindowDC        = winUser32.NewProc("GetWindowDC")
	procReleaseDC          = winUser32.NewProc("ReleaseDC")
	procCreateCompatibleDC = smokeGdi32.NewProc("CreateCompatibleDC")
	procSelectObject       = smokeGdi32.NewProc("SelectObject")
	procCreateDIBSection   = smokeGdi32.NewProc("CreateDIBSection")
	procGdiFlush           = smokeGdi32.NewProc("GdiFlush")
	procDeleteObject       = smokeGdi32.NewProc("DeleteObject")
	procDeleteDC           = smokeGdi32.NewProc("DeleteDC")
)

func installSmokeHook(w webview.WebView, hwnd uintptr) {
	script := os.Getenv("CZARNA_SMOKE_SCRIPT")
	if script == "" {
		return
	}
	out := os.Getenv("CZARNA_SMOKE_OUT")
	js, err := os.ReadFile(script)
	if err != nil {
		log.Printf("[SMOKE] %v", err)
		return
	}
	_ = w.Bind("smokeReadFileB64", func(p string) (string, error) {
		b, err := os.ReadFile(p)
		return base64.StdEncoding.EncodeToString(b), err
	})
	_ = w.Bind("smokeShot", func(name string) error {
		return captureWindowPNG(hwnd, filepath.Join(out, filepath.Base(name)))
	})
	_ = w.Bind("smokeReport", func(s string) error {
		return os.WriteFile(filepath.Join(out, "smoke_report.json"), []byte(s), 0o644)
	})
	_ = w.Bind("smokeQuit", func() { w.Terminate() })
	cfg, _ := json.Marshal(map[string]string{"malicious": os.Getenv("CZARNA_SMOKE_MALICIOUS")})
	w.Init(fmt.Sprintf("window.__SMOKE=%s;\n%s", cfg, js))
	log.Printf("[SMOKE] skrypt %s wstrzyknięty", script)
}

// captureWindowPNG zapisuje zawartość okna (PrintWindow + PW_RENDERFULLCONTENT)
// do sekcji DIB i dalej do PNG.
func captureWindowPNG(hwnd uintptr, path string) error {
	r, err := GetWindowRect(hwnd)
	if err != nil {
		return err
	}
	wd, ht := r.Width(), r.Height()
	// Wszystkie wywołania GDI na jednym wątku systemowym.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	type bitmapInfoHeader struct {
		Size                         uint32
		Width, Height                int32
		Planes, BitCount             uint16
		Compression, SizeImage       uint32
		XPels, YPels, ClrUsed, ClrIm int32
	}
	hdr := bitmapInfoHeader{Width: int32(wd), Height: -int32(ht), Planes: 1, BitCount: 32}
	hdr.Size = uint32(unsafe.Sizeof(hdr))

	wdc, _, _ := syscall.SyscallN(procGetWindowDC.Addr(), hwnd)
	defer syscall.SyscallN(procReleaseDC.Addr(), hwnd, wdc)
	mdc, _, _ := syscall.SyscallN(procCreateCompatibleDC.Addr(), wdc)
	defer syscall.SyscallN(procDeleteDC.Addr(), mdc)
	var bits unsafe.Pointer
	dib, _, _ := syscall.SyscallN(procCreateDIBSection.Addr(), mdc, uintptr(unsafe.Pointer(&hdr)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if wdc == 0 || mdc == 0 || dib == 0 || bits == nil {
		return fmt.Errorf("GDI: wdc=%x mdc=%x dib=%x (%dx%d)", wdc, mdc, dib, wd, ht)
	}
	defer syscall.SyscallN(procDeleteObject.Addr(), dib)
	old, _, _ := syscall.SyscallN(procSelectObject.Addr(), mdc, dib)
	ok, _, e := syscall.SyscallN(procPrintWindow.Addr(), hwnd, mdc, 2)
	syscall.SyscallN(procGdiFlush.Addr())
	if ok == 0 {
		syscall.SyscallN(procSelectObject.Addr(), mdc, old)
		return fmt.Errorf("PrintWindow: %v", e)
	}
	src := unsafe.Slice((*byte)(bits), wd*ht*4)
	img := image.NewNRGBA(image.Rect(0, 0, wd, ht))
	for i := 0; i < len(src); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = src[i+2], src[i+1], src[i], 255
	}
	syscall.SyscallN(procSelectObject.Addr(), mdc, old)
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return png.Encode(f, img)
}
