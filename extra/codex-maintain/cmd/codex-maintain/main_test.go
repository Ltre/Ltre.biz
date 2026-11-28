package main

import (
	"context"
	"image/png"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/richardwilkes/toolbox/v2/geom"
	"github.com/richardwilkes/unison"
	"github.com/richardwilkes/unison/enums/mod"
	"ltre.biz/codex-maintain/internal/doctor"
)

func TestMockDiagnosisShowsSeparateProblemCards(t *testing.T) {
	oldDiscover, oldActive, oldDoctor := discoverCandidates, discoverActive, runDoctorReport
	discoverCandidates = func(string) ([]doctor.Candidate, error) { return []doctor.Candidate{{Path: `C:\mock\codex.exe`}}, nil }
	discoverActive = func() ([]string, error) { return nil, nil }
	var healthy atomic.Bool
	runDoctorReport = func(context.Context, string, bool, bool) (doctor.Report, error) {
		if healthy.Load() {
			return doctor.Report{SchemaVersion: 1, OverallStatus: "ok", Checks: []doctor.Check{{ID: "network.websocket_reachability", Status: "ok"}}, Raw: `{"healthy":true}`}, nil
		}
		return doctor.Report{SchemaVersion: 1, OverallStatus: "warning", CodexVersion: "mock", Checks: []doctor.Check{
			{ID: "network.websocket_reachability", Status: "warning", Summary: "handshake timed out", Details: []string{"timeout: 15000 ms"}},
			{ID: "config.mcp", Status: "warning", Summary: "missing variables"},
			{ID: "state.threads", Status: "fail", Summary: "index mismatch"},
		}, Raw: "{\n" + strings.Repeat("mock report line\n", 100) + "last report line\n}", Stderr: "mock stderr line"}, nil
	}
	t.Cleanup(func() { discoverCandidates, discoverActive, runDoctorReport = oldDiscover, oldActive, oldDoctor })
	var ui *app
	var err error
	screen, e := unison.StartHeadless(unison.HeadlessConfig{Width: 1000, Height: 700}, unison.StartupFinishedCallback(func() { ui, err = newApp() }))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(screen.Stop)
	if err != nil {
		t.Fatal(err)
	}
	var initialRows int
	screen.Do(func() { initialRows = len(ui.problemRows) })
	if initialRows != 0 {
		t.Fatal("problem cards shown before diagnosis")
	}
	screen.Click(screen.PanelCenter(ui.diagnose))
	deadline := time.Now().Add(3 * time.Second)
	var done bool
	for time.Now().Before(deadline) {
		screen.Do(func() { done = !ui.busy && len(ui.problemRows) == 3 })
		if done {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !done {
		t.Fatal("mocked report did not produce three separate cards")
	}
	screen.Do(func() {
		if ui.diagnosticScroll.Parent() != nil {
			t.Error("diagnostic log must be collapsed by default")
		}
		for _, row := range ui.problemRows {
			if row.details == nil || row.details.Parent() == nil {
				t.Errorf("missing details button: %s", row.check.ID)
			}
			if row.check.ID == "network.websocket_reachability" {
				if row.repair == nil || row.repair.Parent() != row.details.Parent() {
					t.Error("repair button must be on the websocket card")
				}
			} else if row.repair != nil {
				t.Errorf("unexpected repair on %s", row.check.ID)
			}
		}
		if !ui.rawButton.Enabled() {
			t.Error("raw report should be available on demand")
		}
	})
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
	screen.Click(screen.PanelCenter(ui.rawButton))
	var logVisible bool
	var maxScroll float32
	screen.Do(func() {
		logVisible = ui.diagnosticScroll.Parent() != nil
		maxScroll = ui.diagnosticScroll.Bar(false).MaxValue()
		if !strings.Contains(ui.diagnosticLog.Text(), "last report line") || !strings.Contains(ui.diagnosticLog.Text(), "mock stderr line") {
			t.Error("full stdout and stderr should be retained")
		}
	})
	if !logVisible {
		t.Fatal("diagnostic log did not expand")
	}
	if maxScroll <= 0 {
		t.Fatal("expanded diagnostic log must be scrollable")
	}
	var originalLog string
	screen.Do(func() { originalLog = ui.diagnosticLog.Text() })
	screen.Click(screen.PanelCenter(ui.diagnosticScroll))
	screen.Type("unexpected edit")
	screen.KeyPress(unison.KeyBackspace, mod.None)
	screen.Do(func() {
		if ui.diagnosticLog.Text() != originalLog {
			t.Error("diagnostic log must remain read-only")
		}
	})
	if name := os.Getenv("CODEX_MAINTAIN_EXPANDED_SCREENSHOT"); name != "" {
		f, e := os.Create(name)
		if e != nil {
			t.Fatal(e)
		}
		defer f.Close()
		if e = png.Encode(f, screen.Capture()); e != nil {
			t.Fatal(e)
		}
	}
	screen.Wheel(screen.PanelCenter(ui.diagnosticScroll), geom.NewPoint(0, -3), mod.None)
	var scrolled float32
	screen.Do(func() { scrolled = ui.diagnosticScroll.Bar(false).Value() })
	if scrolled <= 0 {
		t.Error("mouse wheel did not scroll diagnostic log")
	}
	screen.Click(screen.PanelCenter(ui.rawButton))
	screen.Do(func() {
		if ui.diagnosticScroll.Parent() != nil {
			t.Error("diagnostic log did not collapse")
		}
	})
	healthy.Store(true)
	screen.Click(screen.PanelCenter(ui.diagnose))
	done = false
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		screen.Do(func() { done = !ui.busy && ui.report.OverallStatus == "ok" })
		if done {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !done {
		t.Fatal("healthy report did not finish")
	}
	screen.Do(func() {
		if len(ui.problemRows) != 0 {
			t.Error("previous issue cards remained after healthy diagnosis")
		}
	})
}

func TestProblemDetailsPreserveDiagnosticEvidence(t *testing.T) {
	actual, expected, remedy := "15s", "under 15s", "check proxy"
	c := doctor.Check{ID: "network.websocket_reachability", Category: "network", Status: "warning", Summary: "timeout", Details: []string{"endpoint: redacted"}, Issues: []doctor.Issue{{Severity: "warning", Cause: "handshake", Measured: &actual, Expected: &expected, Remedy: &remedy, Fields: []string{"endpoint"}}}}
	text := detailsText(c)
	for _, want := range []string{"timeout", "endpoint: redacted", "handshake", "15s", "under 15s", "check proxy", "endpoint"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q in details", want)
		}
	}
	if !actionableWebSocket(c) {
		t.Fatal("websocket warning should offer repair")
	}
	c.Status = "ok"
	if actionableWebSocket(c) {
		t.Fatal("healthy websocket must not offer repair")
	}
	c.ID = "config.mcp"
	c.Status = "warning"
	if actionableWebSocket(c) {
		t.Fatal("MCP warning must not offer websocket repair")
	}
}
