//go:build !windows

// Stub dla platform innych niż Windows - zachowuje kompatybilność kompilacji
// cross-platform. Na Windows używana jest wersja z window_apply_windows.go.

package main

import (
	"czarna-mapa/internal/windowstate"
)

func applyWindowStateOS(hwnd uintptr, s windowstate.State) {
	// Na nie-Windows: nic nie rób (webview go bindings używają innego API).
}
