//go:build windows

package main

import (
	_ "embed"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

//go:embed resources/app.ico
var embeddedAppIcon []byte

const (
	imageIcon      = 1
	lrLoadFromFile = 0x00000010
	wmSetIcon      = 0x0080
	iconSmall      = 0
	iconBig        = 1
)

var (
	user32          = syscall.NewLazyDLL("user32.dll")
	procLoadImageW  = user32.NewProc("LoadImageW")
	procSendMessage = user32.NewProc("SendMessageW")
)

func setWindowIcon(hwnd unsafe.Pointer) {
	if hwnd == nil || len(embeddedAppIcon) == 0 {
		return
	}
	iconPath := filepath.Join(os.TempDir(), "czarna-mapa-app.ico")
	_ = os.WriteFile(iconPath, embeddedAppIcon, 0644)
	pathPtr, err := syscall.UTF16PtrFromString(iconPath)
	if err != nil {
		return
	}
	small := loadIconFromFile(pathPtr, 16, 16)
	big := loadIconFromFile(pathPtr, 32, 32)
	if small != 0 {
		_, _, _ = procSendMessage.Call(uintptr(hwnd), wmSetIcon, iconSmall, small)
	}
	if big != 0 {
		_, _, _ = procSendMessage.Call(uintptr(hwnd), wmSetIcon, iconBig, big)
	}
}

func loadIconFromFile(path *uint16, width, height int) uintptr {
	h, _, _ := procLoadImageW.Call(0, uintptr(unsafe.Pointer(path)), imageIcon, uintptr(width), uintptr(height), lrLoadFromFile)
	return h
}
