package main

import (
	"context"
	"github.com/richardwilkes/unison"
	"image/png"
	"ltre.biz/codex-maintain/internal/doctor"
	"os"
	"testing"
	"time"
)

func TestInitialWindowBuildsWithMockDiscovery(t *testing.T) {
	old := discoverCandidates
	oldActive := discoverActive
	oldDoctor := runDoctorReport
	discoverCandidates = func(string) ([]doctor.Candidate, error) { return []doctor.Candidate{{Path: `C:\mock\codex.exe`}}, nil }
	t.Cleanup(func() { discoverCandidates = old })
	discoverActive = func() ([]string, error) { return nil, nil }
	t.Cleanup(func() { discoverActive = oldActive })
	runDoctorReport = func(context.Context, string, bool, bool) (doctor.Report, error) {
		return doctor.Report{SchemaVersion: 1, OverallStatus: "warning", Checks: []doctor.Check{{ID: "network.websocket_reachability", Status: "warning", Summary: "mock timeout"}}, Raw: "{}"}, nil
	}
	t.Cleanup(func() { runDoctorReport = oldDoctor })
	var err error
	var ui *app
	screen, e := unison.StartHeadless(unison.HeadlessConfig{Width: 1000, Height: 700}, unison.StartupFinishedCallback(func() { ui, err = newApp() }))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(screen.Stop)
	if err != nil {
		t.Fatal(err)
	}
	if name := os.Getenv("CODEX_MAINTAIN_MOCK_SCREENSHOT"); name != "" {
		f, e := os.Create(name)
		if e != nil {
			t.Fatal(e)
		}
		defer f.Close()
		if e = png.Encode(f, screen.Capture()); e != nil {
			t.Fatal(e)
		}
	}
	var visible bool
	screen.Do(func() { visible = ui.diagnose.Parent().IndexOfChild(ui.repair) >= 0 })
	if visible {
		t.Fatal("repair button shown before diagnosis")
	}
	screen.Click(screen.PanelCenter(ui.diagnose))
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		screen.Do(func() { visible = ui.diagnose.Parent().IndexOfChild(ui.repair) >= 0 })
		if visible {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("mocked websocket warning did not show repair button")
}
