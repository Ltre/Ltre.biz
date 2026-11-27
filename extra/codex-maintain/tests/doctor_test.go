package tests

import (
	"ltre.biz/codex-maintain/internal/doctor"
	"testing"
)

func TestReportParsing(t *testing.T) {
	r, err := doctor.Parse([]byte(`{"schemaVersion":1,"overallStatus":"warning","codexVersion":"0.167","checks":[{"id":"network.websocket_reachability","status":"warning","summary":"timed out"},{"id":"threads.inventory","status":"warning","summary":"issue"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Problems()) != 2 {
		t.Fatal("lost problems")
	}
	c, ok := r.WebSocket()
	if !ok || c.Status != "warning" {
		t.Fatal("websocket warning not recognized")
	}
	if _, err = doctor.Parse([]byte(`{"schemaVersion":1,"checks":[]}`)); err == nil {
		t.Fatal("empty report must fail")
	}
}

func TestOlderDoctorObjectShape(t *testing.T) {
	r, err := doctor.Parse([]byte(`{"schemaVersion":1,"overallStatus":"warning","checks":{"network.websocket_reachability":{"id":"network.websocket_reachability","category":"network","status":"warning","summary":"timeout","details":{"connect timeout":"15000 ms","endpoint":"redacted"},"remediation":"check proxy"}}}`))
	if err != nil {
		t.Fatal(err)
	}
	c, ok := r.WebSocket()
	if !ok || len(c.Details) != 2 || c.Remediation == nil {
		t.Fatalf("object report not preserved: %+v", r)
	}
}

func TestSystemProxyState(t *testing.T) {
	r, err := doctor.Parse([]byte(`{"schemaVersion":1,"checks":{"network.env":{"id":"network.env","status":"ok","details":{"respect system proxy":"enabled"}}}}`))
	if err != nil {
		t.Fatal(err)
	}
	enabled, known := r.SystemProxyEnabled()
	if !enabled || !known {
		t.Fatal("enabled proxy was not recognized")
	}
	r.Checks[0].Details = []string{"respect system proxy: unexpected"}
	if _, known = r.SystemProxyEnabled(); known {
		t.Fatal("unknown value must not be treated as verified")
	}
}
