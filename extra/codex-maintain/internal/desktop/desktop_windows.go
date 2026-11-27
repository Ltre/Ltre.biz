//go:build windows

// Package desktop observes the packaged application without terminating processes.
package desktop

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var processSnapshot = Processes

// Processes reports only ChatGPT.exe instances from the Codex MSIX package in
// the current Windows session. Inaccessible matching processes fail closed.
func Processes() (map[uint32]bool, error) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(snap)
	var currentSession uint32
	if err = windows.ProcessIdToSessionId(uint32(os.Getpid()), &currentSession); err != nil {
		return nil, err
	}
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	err = windows.Process32First(snap, &e)
	found := map[uint32]bool{}
	for err == nil {
		if strings.EqualFold(windows.UTF16ToString(e.ExeFile[:]), "ChatGPT.exe") {
			var session uint32
			if e2 := windows.ProcessIdToSessionId(e.ProcessID, &session); e2 != nil {
				return nil, e2
			}
			if session == currentSession {
				h, e2 := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, e.ProcessID)
				if e2 != nil {
					return nil, fmt.Errorf("无法核实 ChatGPT 进程 %d 的路径：%w", e.ProcessID, e2)
				}
				buf := make([]uint16, 32768)
				size := uint32(len(buf))
				e2 = windows.QueryFullProcessImageName(h, 0, &buf[0], &size)
				windows.CloseHandle(h)
				if e2 != nil {
					return nil, e2
				}
				path := strings.ToLower(windows.UTF16ToString(buf[:size]))
				if strings.Contains(path, `\windowsapps\openai.codex_`) {
					found[e.ProcessID] = true
				}
			}
		}
		err = windows.Process32Next(snap, &e)
	}
	if !errors.Is(err, windows.ERROR_NO_MORE_FILES) {
		return nil, err
	}
	return found, nil
}

// ActiveCodex finds codex.exe descendants of the identified desktop processes.
// It reads process metadata without signalling or changing any process.
func ActiveCodex() ([]string, error) {
	roots, err := Processes()
	if err != nil {
		return nil, err
	}
	if len(roots) == 0 {
		return nil, nil
	}
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(snap)
	type item struct {
		pid, parent uint32
		name        string
	}
	var entries []item
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	err = windows.Process32First(snap, &e)
	for err == nil {
		entries = append(entries, item{e.ProcessID, e.ParentProcessID, windows.UTF16ToString(e.ExeFile[:])})
		err = windows.Process32Next(snap, &e)
	}
	if !errors.Is(err, windows.ERROR_NO_MORE_FILES) {
		return nil, err
	}
	parents := map[uint32]uint32{}
	for _, p := range entries {
		parents[p.pid] = p.parent
	}
	seen := map[string]bool{}
	var result []string
	for _, p := range entries {
		if !strings.EqualFold(p.name, "codex.exe") {
			continue
		}
		ancestor := p.parent
		owned := false
		for i := 0; i < 64 && ancestor != 0; i++ {
			if roots[ancestor] {
				owned = true
				break
			}
			next := parents[ancestor]
			if next == ancestor {
				break
			}
			ancestor = next
		}
		if !owned {
			continue
		}
		h, e2 := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, p.pid)
		if e2 != nil {
			continue
		}
		buf := make([]uint16, 32768)
		size := uint32(len(buf))
		e2 = windows.QueryFullProcessImageName(h, 0, &buf[0], &size)
		windows.CloseHandle(h)
		if e2 != nil {
			continue
		}
		path := windows.UTF16ToString(buf[:size])
		key := strings.ToLower(path)
		if !seen[key] {
			seen[key] = true
			result = append(result, path)
		}
	}
	return result, nil
}
func WaitExit(ctx context.Context, initial map[uint32]bool) error {
	if len(initial) == 0 {
		return errors.New("未发现可确认的桌面端进程，无法验证正常退出")
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		p, err := processSnapshot()
		if err != nil {
			return err
		}
		if len(p) == 0 {
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("等待正常退出超时或已取消：%w", ctx.Err())
		case <-ticker.C:
		}
	}
}
func Launch(ctx context.Context) error {
	const script = `$items = @(Get-StartApps | Where-Object { $_.AppID -like 'OpenAI.Codex_*!*' }); if ($items.Count -ne 1) { throw "无法唯一确定 Codex 桌面应用的启动入口（数量：$($items.Count)）" }; Start-Process explorer.exe -ArgumentList ('shell:AppsFolder\' + $items[0].AppID)`
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.SysProcAttr = &windows.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("启动桌面应用失败：%w；%s", err, string(out))
	}
	return nil
}
func WaitStart(ctx context.Context, initial map[uint32]bool) error {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		p, err := processSnapshot()
		if err != nil {
			return err
		}
		for id := range p {
			if !initial[id] {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("未能确认新实例：%w", ctx.Err())
		case <-ticker.C:
		}
	}
}
