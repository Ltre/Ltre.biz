// Package workflow coordinates the repair gate with injectable dependencies.
package workflow

import (
	"context"
	"fmt"
	"strings"
	"time"

	"ltre.biz/codex-maintain/internal/config"
	"ltre.biz/codex-maintain/internal/doctor"
	"ltre.biz/codex-maintain/internal/proxy"
)

type Dependencies struct {
	Settings        func(context.Context) (proxy.Settings, error)
	LocalCandidates func(context.Context) ([]proxy.Candidate, error)
	TestProxy       func(context.Context, proxy.Candidate) (string, error)
	Doctor          func(context.Context, string, bool, bool) (doctor.Report, error)
	ConfigPath      func() (string, error)
	Apply           func(string, time.Time) (config.Result, error)
	Now             func() time.Time
}

func RealDependencies() Dependencies {
	return Dependencies{proxy.SettingsWindows, proxy.LocalCandidates, proxy.Test, doctor.Run, config.Path, config.Apply, time.Now}
}

type Result struct {
	Proxy      proxy.Candidate
	Log        string
	ConfigPath string
	Config     config.Result
}

func Repair(ctx context.Context, exe string, d Dependencies) (Result, error) {
	var result Result
	var log strings.Builder
	s, err := d.Settings(ctx)
	if err != nil {
		return result, err
	}
	if s.PAC != "" {
		return result, fmt.Errorf("检测到 PAC 自动代理，无法确认系统实际选用的代理端口；已停止自动修改")
	}
	cs := proxy.Candidates(s)
	if len(cs) == 0 {
		return result, fmt.Errorf("没有可直接测试的系统代理（启用=%v）；请检查 Windows 代理设置", s.Enabled)
	}
	fmt.Fprintf(&log, "系统代理已启用：%v；PAC 已配置：%v\n", s.Enabled, s.PAC != "")
	local, localErr := d.LocalCandidates(ctx)
	if localErr != nil {
		fmt.Fprintf(&log, "读取本地代理软件监听端口失败：%v\n", localErr)
	} else {
		for _, c := range local {
			fmt.Fprintf(&log, "代理候选 %s://%s：%s\n", c.Protocol, c.Address, c.Source)
		}
	}
	var passed bool
	for _, c := range cs {
		value, e := d.TestProxy(ctx, c)
		fmt.Fprintf(&log, "%s://%s：%s", c.Protocol, c.Address, value)
		if e != nil {
			fmt.Fprintf(&log, "（失败：%v）\n", e)
		} else {
			log.WriteString("（通过）\n")
			result.Proxy = c
			passed = true
			break
		}
	}
	result.Log = log.String()
	if !passed {
		return result, fmt.Errorf("系统代理 HTTPS 检查未通过：\n%s", result.Log)
	}
	// Probe at most eight recognized loopback candidates concurrently. These
	// additional results are informative; only the system route gates writes.
	if len(local) > 0 {
		type probeResult struct {
			candidate proxy.Candidate
			value     string
			err       error
		}
		limit := len(local)
		if limit > 8 {
			limit = 8
			fmt.Fprintf(&log, "代理候选共 %d 项，仅检查前 8 项。\n", len(local))
		}
		ch := make(chan probeResult, limit)
		for _, candidate := range local[:limit] {
			go func(c proxy.Candidate) {
				probeCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
				defer cancel()
				v, e := d.TestProxy(probeCtx, c)
				ch <- probeResult{c, v, e}
			}(candidate)
		}
		for i := 0; i < limit; i++ {
			p := <-ch
			fmt.Fprintf(&log, "候选 %s://%s：%s", p.candidate.Protocol, p.candidate.Address, p.value)
			if p.err != nil {
				fmt.Fprintf(&log, "（未通过：%v）\n", p.err)
			} else {
				log.WriteString("（通过）\n")
			}
		}
		result.Log = log.String()
	}
	r, err := d.Doctor(ctx, exe, true, true)
	if err != nil {
		return result, err
	}
	enabled, known := r.SystemProxyEnabled()
	if !known || !enabled {
		return result, fmt.Errorf("无法确认临时诊断已启用系统代理（已识别=%v、启用=%v），未修改配置。\n%s", known, enabled, r.Raw)
	}
	ws, ok := r.WebSocket()
	if !ok || ws.Status != "ok" {
		return result, fmt.Errorf("临时启用系统代理后 WebSocket 未通过，未修改配置。\n%s\n%s", result.Log, r.Raw)
	}
	if err := ctx.Err(); err != nil {
		return result, fmt.Errorf("操作已取消，未修改配置：%w", err)
	}
	result.ConfigPath, err = d.ConfigPath()
	if err != nil {
		return result, err
	}
	if err = ctx.Err(); err != nil {
		return result, fmt.Errorf("操作已取消，未修改配置：%w", err)
	}
	result.Config, err = d.Apply(result.ConfigPath, d.Now())
	if err != nil {
		return result, err
	}
	return result, nil
}
