package tests

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ltre.biz/codex-maintain/internal/config"
)

func TestPrepareConfig(t *testing.T) {
	cases := []struct {
		name, input, want string
		changed, fail     bool
	}{
		{"insert existing section", "# 备注\r\n[features]\r\nother = true\r\n[model]\r\nx = 1\r\n", "respect_system_proxy = true\r\n[model]", true, false},
		{"replace preserves comment", "[features]\nrespect_system_proxy = false # keep\n", "respect_system_proxy = true # keep", true, false},
		{"already true", "[features]\nrespect_system_proxy = true\n", "respect_system_proxy = true", false, false},
		{"new section", "model = 'abc'\n", "[features]\nrespect_system_proxy = true", true, false},
		{"invalid toml", "[features]\nfoo = [\n", "", false, true},
		{"ambiguous format", "[features]\nrespect_system_proxy = 3\n", "", false, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			out, changed, err := config.Prepare([]byte(c.input))
			if c.fail {
				if err == nil {
					t.Fatal("expected failure")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if changed != c.changed || !strings.Contains(string(out), c.want) {
				t.Fatalf("changed=%v out=%q", changed, out)
			}
		})
	}
}
func TestBackupCollisionPreservesExisting(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	orig := []byte("[features]\nrespect_system_proxy = false\n")
	if err := os.WriteFile(path, orig, 0600); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 28, 2, 30, 0, 0, time.Local)
	old := path + ".backup-20261128-0230"
	if err := os.WriteFile(old, []byte("pre-existing"), 0600); err != nil {
		t.Fatal(err)
	}
	r, err := config.Apply(path, now)
	if err != nil {
		t.Fatal(err)
	}
	if r.Backup != old+"-1" || !r.Changed {
		t.Fatalf("unexpected result: %+v", r)
	}
	b, _ := os.ReadFile(old)
	if string(b) != "pre-existing" {
		t.Fatal("overwrote an existing backup")
	}
	b, _ = os.ReadFile(r.Backup)
	if string(b) != string(orig) {
		t.Fatal("backup content mismatch")
	}
}
