package main

import "strings"

// debugBuild można ustawić przy budowaniu wersji deweloperskiej:
//
//	go build -ldflags "-X main.debugBuild=1" .
//
// W buildzie release (scripts\build.bat) zostaje puste.
var debugBuild = ""

// devToolsEnabled decyduje, czy WebView ma mieć włączone DevTools (konsola,
// "Zbadaj element"). Domyślnie wyłączone; włącza je flaga --debug,
// zmienna środowiskowa CZARNA_DEBUG=1 albo build z debugBuild=1.
func devToolsEnabled(args []string, getenv func(string) string) bool {
	if debugBuild == "1" {
		return true
	}
	for _, a := range args {
		if a == "--debug" || a == "-debug" {
			return true
		}
	}
	switch strings.ToLower(strings.TrimSpace(getenv("CZARNA_DEBUG"))) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}
