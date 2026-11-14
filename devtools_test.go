package main

import "testing"

func TestDevToolsDisabledByDefault(t *testing.T) {
	noEnv := func(string) string { return "" }
	if devToolsEnabled([]string{"app.exe"}, noEnv) {
		t.Fatal("DevTools muszą być domyślnie wyłączone")
	}
	if !devToolsEnabled([]string{"app.exe", "--debug"}, noEnv) {
		t.Fatal("--debug powinno włączać DevTools")
	}
	env := func(k string) string {
		if k == "CZARNA_DEBUG" {
			return "1"
		}
		return ""
	}
	if !devToolsEnabled([]string{"app.exe"}, env) {
		t.Fatal("CZARNA_DEBUG=1 powinno włączać DevTools")
	}
	zero := func(k string) string { return "0" }
	if devToolsEnabled(nil, zero) {
		t.Fatal("CZARNA_DEBUG=0 nie może włączać DevTools")
	}
}
