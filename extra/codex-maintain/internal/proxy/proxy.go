// Package proxy discovers Windows proxy settings and tests explicit endpoints.
package proxy

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"net"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"ltre.biz/codex-maintain/internal/childproc"
)

type Settings struct {
	Enabled bool
	Server  string
	PAC     string
}
type Candidate struct {
	Protocol string
	Address  string
	Source   string
}

func SettingsWindows(ctx context.Context) (Settings, error) {
	var s Settings
	cmd := exec.CommandContext(ctx, "reg.exe", "query", `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`)
	childproc.Hide(cmd)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return s, fmt.Errorf("读取 Windows 代理设置失败：%w：%s", err, out.String())
	}
	for _, line := range strings.Split(out.String(), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		v := strings.Join(fields[2:], " ")
		switch fields[0] {
		case "ProxyEnable":
			s.Enabled = v == "0x1"
		case "ProxyServer":
			s.Server = v
		case "AutoConfigURL":
			s.PAC = v
		}
	}
	return s, nil
}
func Candidates(s Settings) []Candidate {
	var list []Candidate
	seen := map[string]bool{}
	add := func(proto, addr string) {
		addr = strings.TrimSpace(addr)
		addr = strings.TrimPrefix(addr, "http://")
		addr = strings.TrimPrefix(addr, "socks5://")
		if strings.ContainsAny(addr, "@/?#") {
			return
		}
		if _, _, err := net.SplitHostPort(addr); err != nil {
			return
		}
		key := proto + addr
		if !seen[key] {
			seen[key] = true
			list = append(list, Candidate{proto, addr, "Windows 系统代理"})
		}
	}
	if !s.Enabled {
		return list
	}
	var httpsAddr, socksAddr, defaultAddr string
	for _, p := range strings.Split(s.Server, ";") {
		pair := strings.SplitN(p, "=", 2)
		if len(pair) == 1 {
			defaultAddr = pair[0]
			continue
		}
		switch strings.ToLower(strings.TrimSpace(pair[0])) {
		case "https":
			httpsAddr = pair[1]
		case "socks":
			socksAddr = pair[1]
		}
	}
	// The HTTPS-specific route takes precedence. Never promote an unrelated
	// HTTP-only or SOCKS candidate when the HTTPS route fails its probe.
	if httpsAddr != "" {
		add("http", httpsAddr)
	} else if defaultAddr != "" {
		add("http", defaultAddr)
	} else if socksAddr != "" {
		add("socks5h", socksAddr)
	}
	return list
}

// LocalCandidates reports loopback ports owned by known proxy processes. The
// protocol is a candidate until an actual HTTPS probe succeeds.
func LocalCandidates(ctx context.Context) ([]Candidate, error) {
	listeners, err := Listeners(ctx)
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, "tasklist.exe", "/FO", "CSV", "/NH")
	childproc.Hide(cmd)
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	rows, err := csv.NewReader(strings.NewReader(string(out))).ReadAll()
	if err != nil {
		return nil, err
	}
	names := map[string]string{}
	for _, row := range rows {
		if len(row) < 2 {
			continue
		}
		n := strings.ToLower(row[0])
		for _, key := range []string{"trojan", "clash", "mihomo", "v2ray", "xray", "sing-box", "hiddify", "nekoray"} {
			if strings.Contains(n, key) {
				names[row[1]] = row[0]
				break
			}
		}
	}
	seen := map[string]bool{}
	var result []Candidate
	for _, l := range listeners {
		name, ok := names[l.PID]
		if !ok {
			continue
		}
		host := "127.0.0.1"
		if l.Address == "[::1]" || l.Address == "[::]" {
			host = "::1"
		}
		address := net.JoinHostPort(host, l.Port)
		for _, proto := range []string{"http", "socks5h"} {
			key := proto + address
			if !seen[key] {
				seen[key] = true
				result = append(result, Candidate{Protocol: proto, Address: address, Source: fmt.Sprintf("%s (PID %s)，协议待验证", name, l.PID)})
			}
		}
	}
	return result, nil
}

var loopback = regexp.MustCompile(`^\s*(?:TCP)\s+(127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\]):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$`)

type Listener struct{ Address, Port, PID string }

func Listeners(ctx context.Context) ([]Listener, error) {
	cmd := exec.CommandContext(ctx, "netstat.exe", "-ano", "-p", "tcp")
	childproc.Hide(cmd)
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	var list []Listener
	for _, line := range strings.Split(string(out), "\n") {
		if m := loopback.FindStringSubmatch(line); m != nil {
			list = append(list, Listener{m[1], m[2], m[3]})
		}
	}
	return list, nil
}
func Test(ctx context.Context, c Candidate) (string, error) {
	if c.Protocol != "http" && c.Protocol != "socks5h" {
		return "", fmt.Errorf("不支持的代理协议：%s", c.Protocol)
	}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "curl.exe", "--silent", "--show-error", "--output", "NUL", "--max-time", "20", "--proxy", c.Protocol+"://"+c.Address, "--write-out", "HTTP %{http_code}, total %{time_total}s", "https://chatgpt.com/")
	childproc.Hide(cmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("代理 HTTPS 检查失败：%w", err)
	}
	s := strings.TrimSpace(string(out))
	if !strings.HasPrefix(s, "HTTP 2") && !strings.HasPrefix(s, "HTTP 3") {
		return s, fmt.Errorf("代理返回非成功状态：%s", s)
	}
	return s, nil
}
