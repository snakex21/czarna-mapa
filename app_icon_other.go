//go:build !windows

package main

import "unsafe"

func setWindowIcon(hwnd unsafe.Pointer) {}
