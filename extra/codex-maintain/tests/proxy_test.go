package tests

import (
	"ltre.biz/codex-maintain/internal/proxy"
	"testing"
)

func TestSystemProxyCandidates(t *testing.T) {
	c := proxy.Candidates(proxy.Settings{Enabled: true, Server: "http=127.0.0.1:58591;https=127.0.0.1:58591;socks=127.0.0.1:51837"})
	if len(c) != 1 || c[0].Protocol != "http" || c[0].Address != "127.0.0.1:58591" {
		t.Fatalf("unexpected candidates: %+v", c)
	}
	if len(proxy.Candidates(proxy.Settings{Enabled: false, Server: "127.0.0.1:1"})) != 0 {
		t.Fatal("disabled proxy must not be tested as system route")
	}
	c = proxy.Candidates(proxy.Settings{Enabled: true, Server: "http=127.0.0.1:1111;https=127.0.0.1:2222;socks=127.0.0.1:3333"})
	if len(c) != 1 || c[0].Address != "127.0.0.1:2222" {
		t.Fatalf("HTTPS must use HTTPS-specific route: %+v", c)
	}
}
