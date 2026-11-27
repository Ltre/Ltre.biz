package tests

import (
	"context"
	"errors"
	"testing"
	"time"

	"ltre.biz/codex-maintain/internal/config"
	"ltre.biz/codex-maintain/internal/doctor"
	"ltre.biz/codex-maintain/internal/proxy"
	"ltre.biz/codex-maintain/internal/workflow"
)

func TestRepairGateWithMocks(t *testing.T) {
	for _, tc := range []struct {
		name                                         string
		proxyOK, websocketOK, pac, flagOK, wantWrite bool
	}{
		{"proxy failure blocks write", false, true, false, true, false},
		{"websocket failure blocks write", true, false, false, true, false},
		{"unknown PAC blocks write", true, true, true, true, false},
		{"missing system proxy flag blocks write", true, true, false, false, false},
		{"both checks pass", true, true, false, true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			writes := 0
			d := workflow.Dependencies{
				Settings: func(context.Context) (proxy.Settings, error) {
					s := proxy.Settings{Enabled: true, Server: "127.0.0.1:58591"}
					if tc.pac {
						s.PAC = "http://example.invalid/proxy.pac"
					}
					return s, nil
				},
				LocalCandidates: func(context.Context) ([]proxy.Candidate, error) { return nil, nil },
				TestProxy: func(context.Context, proxy.Candidate) (string, error) {
					if !tc.proxyOK {
						return "", errors.New("mock proxy failed")
					}
					return "HTTP 200", nil
				},
				Doctor: func(context.Context, string, bool, bool) (doctor.Report, error) {
					status := "warning"
					if tc.websocketOK {
						status = "ok"
					}
					flag := "disabled"
					if tc.flagOK {
						flag = "enabled"
					}
					return doctor.Report{Checks: []doctor.Check{{ID: "network.env", Details: []string{"respect system proxy: " + flag}}, {ID: "network.websocket_reachability", Status: status}}}, nil
				},
				ConfigPath: func() (string, error) { return "mock-config.toml", nil },
				Apply:      func(string, time.Time) (config.Result, error) { writes++; return config.Result{Changed: true}, nil },
				Now:        time.Now,
			}
			_, err := workflow.Repair(context.Background(), "mock.exe", d)
			if (err == nil) != tc.wantWrite {
				t.Fatalf("error = %v", err)
			}
			if (writes == 1) != tc.wantWrite {
				t.Fatalf("writes = %d", writes)
			}
		})
	}
}

func TestCancellationPreventsConfigWrite(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	writes := 0
	d := workflow.Dependencies{
		Settings: func(context.Context) (proxy.Settings, error) {
			return proxy.Settings{Enabled: true, Server: "127.0.0.1:58591"}, nil
		},
		LocalCandidates: func(context.Context) ([]proxy.Candidate, error) { return nil, nil },
		TestProxy:       func(context.Context, proxy.Candidate) (string, error) { return "HTTP 200", nil },
		Doctor: func(context.Context, string, bool, bool) (doctor.Report, error) {
			return doctor.Report{Checks: []doctor.Check{{ID: "network.env", Details: []string{"respect system proxy: enabled"}}, {ID: "network.websocket_reachability", Status: "ok"}}}, nil
		},
		ConfigPath: func() (string, error) { return "mock.toml", nil },
		Apply:      func(string, time.Time) (config.Result, error) { writes++; return config.Result{}, nil }, Now: time.Now,
	}
	if _, err := workflow.Repair(ctx, "mock.exe", d); err == nil || writes != 0 {
		t.Fatalf("cancelled repair: err=%v writes=%d", err, writes)
	}
}
