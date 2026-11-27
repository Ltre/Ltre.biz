// Package doctor discovers the desktop runtime and reads its diagnostic report.
package doctor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ltre.biz/codex-maintain/internal/childproc"
)

type Issue struct {
	Severity string  `json:"severity"`
	Cause    string  `json:"cause"`
	Measured *string `json:"measured"`
	Expected *string `json:"expected"`
	Remedy   *string `json:"remedy"`
}
type Check struct {
	ID          string   `json:"id"`
	Category    string   `json:"category"`
	Status      string   `json:"status"`
	Summary     string   `json:"summary"`
	Details     []string `json:"details"`
	Issues      []Issue  `json:"issues"`
	Remediation *string  `json:"remediation"`
}
type Report struct {
	SchemaVersion int     `json:"schemaVersion"`
	OverallStatus string  `json:"overallStatus"`
	CodexVersion  string  `json:"codexVersion"`
	Checks        []Check `json:"checks"`
	Raw           string  `json:"-"`
}
type Candidate struct {
	Path     string
	Modified time.Time
}

func Discover(root string) ([]Candidate, error) {
	var candidates []Candidate
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && strings.EqualFold(d.Name(), "codex.exe") {
			info, e := d.Info()
			if e != nil {
				return e
			}
			candidates = append(candidates, Candidate{path, info.ModTime()})
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("扫描桌面端程序目录：%w", err)
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].Modified.After(candidates[j].Modified) })
	return candidates, nil
}

func Parse(raw []byte) (Report, error) {
	var report Report
	var envelope struct {
		SchemaVersion int             `json:"schemaVersion"`
		OverallStatus string          `json:"overallStatus"`
		CodexVersion  string          `json:"codexVersion"`
		Checks        json.RawMessage `json:"checks"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return report, fmt.Errorf("无法解析 doctor JSON：%w", err)
	}
	report.SchemaVersion = envelope.SchemaVersion
	report.OverallStatus = envelope.OverallStatus
	report.CodexVersion = envelope.CodexVersion
	var items []json.RawMessage
	trimmed := bytes.TrimSpace(envelope.Checks)
	if len(trimmed) == 0 {
		return report, errors.New("诊断报告缺少 checks")
	}
	if trimmed[0] == '[' {
		if err := json.Unmarshal(trimmed, &items); err != nil {
			return report, err
		}
	} else if trimmed[0] == '{' {
		var byID map[string]json.RawMessage
		if err := json.Unmarshal(trimmed, &byID); err != nil {
			return report, err
		}
		keys := make([]string, 0, len(byID))
		for k := range byID {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			items = append(items, byID[k])
		}
	} else {
		return report, errors.New("不支持的 doctor checks 格式")
	}
	for _, item := range items {
		var wire struct {
			ID          string          `json:"id"`
			Category    string          `json:"category"`
			Status      string          `json:"status"`
			Summary     string          `json:"summary"`
			Details     json.RawMessage `json:"details"`
			Issues      []Issue         `json:"issues"`
			Remediation *string         `json:"remediation"`
		}
		if err := json.Unmarshal(item, &wire); err != nil {
			return report, fmt.Errorf("诊断项目解析失败：%w", err)
		}
		c := Check{ID: wire.ID, Category: wire.Category, Status: wire.Status, Summary: wire.Summary, Issues: wire.Issues, Remediation: wire.Remediation}
		d := bytes.TrimSpace(wire.Details)
		if len(d) > 0 && string(d) != "null" {
			if d[0] == '[' {
				if err := json.Unmarshal(d, &c.Details); err != nil {
					return report, fmt.Errorf("诊断详情解析失败：%w", err)
				}
			} else if d[0] == '{' {
				var fields map[string]any
				if err := json.Unmarshal(d, &fields); err != nil {
					return report, err
				}
				keys := make([]string, 0, len(fields))
				for k := range fields {
					keys = append(keys, k)
				}
				sort.Strings(keys)
				for _, k := range keys {
					c.Details = append(c.Details, fmt.Sprintf("%s: %v", k, fields[k]))
				}
			} else {
				return report, errors.New("不支持的 doctor details 格式")
			}
		}
		report.Checks = append(report.Checks, c)
	}
	if report.SchemaVersion <= 0 || len(report.Checks) == 0 {
		return report, errors.New("诊断报告缺少版本或检查结果，不能判定为健康")
	}
	for _, c := range report.Checks {
		if c.ID == "" || c.Status == "" {
			return report, errors.New("诊断检查缺少 ID 或状态")
		}
	}
	report.Raw = string(raw)
	return report, nil
}
func (r Report) WebSocket() (Check, bool) {
	for _, c := range r.Checks {
		if strings.Contains(strings.ToLower(c.ID), "websocket") {
			return c, true
		}
	}
	return Check{}, false
}

// SystemProxyEnabled returns unknown if a doctor version omits or changes the field.
func (r Report) SystemProxyEnabled() (bool, bool) {
	for _, c := range r.Checks {
		if c.ID != "network.env" {
			continue
		}
		for _, line := range c.Details {
			key, value, ok := strings.Cut(line, ":")
			if !ok || strings.TrimSpace(strings.ToLower(key)) != "respect system proxy" {
				continue
			}
			switch strings.ToLower(strings.TrimSpace(value)) {
			case "enabled", "true":
				return true, true
			case "disabled", "false":
				return false, true
			}
		}
	}
	return false, false
}
func (r Report) Problems() []Check {
	var result []Check
	for _, c := range r.Checks {
		if c.Status != "ok" {
			result = append(result, c)
		}
	}
	return result
}

// Guidance provides context without treating an optional warning as proven damage.
func Guidance(c Check) string {
	id := strings.ToLower(c.ID)
	switch {
	case strings.Contains(id, "websocket"):
		return "WebSocket 握手失败可能影响连接稳定性；请检查代理路由和网络。"
	case strings.Contains(id, "mcp"):
		return "MCP 诊断显示配置提示；诊断进程的环境不一定等于桌面端插件环境。"
	case strings.Contains(id, "thread") || strings.Contains(id, "rollout"):
		return "会话文件与索引可能不一致，可能影响历史会话恢复；请先保留数据，不要自动删除。"
	case strings.Contains(id, "sandbox"):
		return "沙盒检查存在异常，请查看下方详情；不要为了消除提示直接关闭沙盒。"
	case strings.Contains(id, "auth"):
		return "认证检查存在提示；请根据下方详情确认登录状态，不要分享认证文件。"
	default:
		return "请查看诊断原文及建议；未知状态不能视为检查通过。"
	}
}
func Run(ctx context.Context, exe string, networkOnly, override bool) (Report, error) {
	args := []string{"doctor", "--json"}
	if networkOnly {
		args = append(args, "--network-only")
	}
	if override {
		args = append(args, "-c", "features.respect_system_proxy=true")
	}
	cmd := exec.CommandContext(ctx, exe, args...)
	childproc.Hide(cmd)
	cmd.Stdin = nil
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if ctx.Err() != nil {
		return Report{}, fmt.Errorf("诊断超时或已取消：%w", ctx.Err())
	}
	report, parseErr := Parse(stdout.Bytes())
	if parseErr != nil && err != nil {
		return Report{}, fmt.Errorf("doctor 执行失败：%w；%s", err, strings.TrimSpace(stderr.String()))
	}
	if parseErr != nil {
		return Report{}, parseErr
	}
	return report, nil
}
func DefaultRoot() (string, error) {
	p := os.Getenv("LOCALAPPDATA")
	if p == "" {
		return "", errors.New("LOCALAPPDATA 未设置")
	}
	return filepath.Join(p, "OpenAI", "Codex", "bin"), nil
}
