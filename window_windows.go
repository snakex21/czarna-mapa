//go:build windows

// Plik: window_windows.go
// Cienka warstwa nad Win32 API (user32.dll) do odczytu/zapisu pozycji,
// rozmiaru i stanu zmaksymalizowania głównego okna WebView2.

package main

import (
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	winUser32              = windows.NewLazySystemDLL("user32.dll")
	procGetWindowRect      = winUser32.NewProc("GetWindowRect")
	procIsZoomed           = winUser32.NewProc("IsZoomed")
	procSetWindowPos       = winUser32.NewProc("SetWindowPos")
	procShowWindow         = winUser32.NewProc("ShowWindow")
	procEnumDisplayMonitors = winUser32.NewProc("EnumDisplayMonitors")
	procGetMonitorInfo     = winUser32.NewProc("GetMonitorInfoW")
)

// Rect jest prostokątem okna w screen-coordinates (górny lewy + dolny prawy).
type Rect struct {
	Left, Top, Right, Bottom int32
}

// Width / Height zwracają wymiary prostokąta.
func (r Rect) Width() int  { return int(r.Right - r.Left) }
func (r Rect) Height() int { return int(r.Bottom - r.Top) }
func (r Rect) X() int      { return int(r.Left) }
func (r Rect) Y() int      { return int(r.Top) }

// GetWindowRect zwraca outer-rect (z ramką tytułu) okna.
func GetWindowRect(hwnd uintptr) (Rect, error) {
	var r Rect
	r0, _, e1 := syscall.SyscallN(procGetWindowRect.Addr(), hwnd, uintptr(unsafe.Pointer(&r)))
	if r0 == 0 {
		return r, e1
	}
	return r, nil
}

// IsZoomed zwraca true gdy okno jest zmaksymalizowane.
func IsZoomed(hwnd uintptr) bool {
	r, _, _ := syscall.SyscallN(procIsZoomed.Addr(), hwnd)
	return r != 0
}

// SetWindowPos ustawia pozycję i rozmiar okna (SWP_NOZORDER = nie ruszaj Z-order).
func SetWindowPos(hwnd uintptr, x, y, w, h int) {
	const SWP_NOZORDER = 0x0004
	const SWP_NOACTIVATE = 0x0010
	syscall.SyscallN(procSetWindowPos.Addr(),
		hwnd, 0, // hWndInsertAfter = HWND_TOP
		uintptr(int32(x)), uintptr(int32(y)),
		uintptr(int32(w)), uintptr(int32(h)),
		uintptr(SWP_NOZORDER|SWP_NOACTIVATE))
}

// ShowWindow wysyła komendę SW_SHOWMAXIMIZED lub SW_RESTORE.
func ShowWindow(hwnd uintptr, cmd int) {
	syscall.SyscallN(procShowWindow.Addr(), hwnd, uintptr(int32(cmd)))
}

const (
	SW_RESTORE      = 9
	SW_SHOWMAXIMIZED = 3
)

// MonitorInfoEx - struktura zwracana przez GetMonitorInfoW.
// Używamy mniej niż 32 chars w nazwie (CCHDEVICENAME = 32), więc struct ma 40 bajtów.
type monitorInfoEx struct {
	CbSize    uint32
	RcMonitor Rect
	RcWork    Rect
	DwFlags   uint32
	SzDevice  [32]uint16
}

type monitorEnumProc = uintptr

// monitorEnumCallback - callback dla EnumDisplayMonitors.
// Zbiera recty monitorów do przekazanego slice'a.
var monitorRects []Rect

// getAllMonitorRects zwraca slice Rect dla wszystkich aktywnych monitorów.
func getAllMonitorRects() []Rect {
	monitorRects = nil
	// LPDWORD = nil (nie chcemy monitor handles)
	procEnumDisplayMonitors.Call(
		0, 0,
		syscall.NewCallback(monitorEnumCallback),
		0,
	)
	return monitorRects
}

func monitorEnumCallback(hMonitor uintptr, _ uintptr, _ uintptr, _ uintptr) uintptr {
	var info monitorInfoEx
	info.CbSize = uint32(unsafe.Sizeof(info))
	r, _, _ := syscall.SyscallN(procGetMonitorInfo.Addr(), hMonitor, uintptr(unsafe.Pointer(&info)))
	if r != 0 {
		monitorRects = append(monitorRects, info.RcMonitor)
	}
	return 1 // TRUE = kontynuuj enumerację
}
