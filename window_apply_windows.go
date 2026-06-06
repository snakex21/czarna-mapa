//go:build windows

package main

import (
	"czarna-mapa/internal/windowstate"
)

// applyWindowStateOS: ustawia pozycję/rozmiar/zmaksymalizowanie okna Win32.
func applyWindowStateOS(hwnd uintptr, s windowstate.State) {
	if s.Width <= 0 || s.Height <= 0 {
		return
	}
	// Sprawdź, czy zachowany rect mieści się w aktualnym ekranie.
	// Jeśli user przeniósł laptop do innej rozdzielczości, rect może być
	// poza ekranem - wtedy SetWindowPos przesunąłby okno w niewidoczne miejsce.
	if !rectVisibleOnAnyScreen(s.X, s.Y, s.Width, s.Height) {
		// Użyj domyślnej pozycji (środek ekranu) → pomijamy SetWindowPos
		// i tylko zmaksymalizujemy jeśli flaga wskazuje.
		if s.Maximized {
			ShowWindow(hwnd, SW_SHOWMAXIMIZED)
		}
		return
	}
	if s.Maximized {
		// Najpierw ustaw rect (potrzebny do "przywracania po restore"),
		// potem zmaksymalizuj. Dzięki temu ShowWindow(SW_RESTORE) wróci do rect.
		SetWindowPos(hwnd, s.X, s.Y, s.Width, s.Height)
		ShowWindow(hwnd, SW_SHOWMAXIMIZED)
	} else {
		SetWindowPos(hwnd, s.X, s.Y, s.Width, s.Height)
		ShowWindow(hwnd, SW_RESTORE)
	}
}

// rectVisibleOnAnyScreen zwraca true, jeśli przynajmniej fragment rect
// mieści się na którymś monitorze. Chroni przed oknem przesuniętym
// poza widoczny obszar po zmianie rozdzielczości.
func rectVisibleOnAnyScreen(x, y, w, h int) bool {
	const minVisible = 100 // minimum 100x100 px na ekranie
	monitors := getAllMonitorRects()
	for _, m := range monitors {
		// Sprawdź overlap rectów
		ox1, oy1 := intMaxI(x, int(m.Left)), intMaxI(y, int(m.Top))
		ox2, oy2 := intMinI(x+w, int(m.Right)), intMinI(y+h, int(m.Bottom))
		if ox2-ox1 >= minVisible && oy2-oy1 >= minVisible {
			return true
		}
	}
	return false
}

func intMinI(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func intMaxI(a, b int) int {
	if a > b {
		return a
	}
	return b
}
