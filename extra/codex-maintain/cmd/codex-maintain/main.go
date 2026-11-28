package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/richardwilkes/toolbox/v2/geom"
	"github.com/richardwilkes/unison"
	"github.com/richardwilkes/unison/enums/align"
	"github.com/richardwilkes/unison/enums/behavior"
	"ltre.biz/codex-maintain/internal/desktop"
	"ltre.biz/codex-maintain/internal/doctor"
	"ltre.biz/codex-maintain/internal/proxy"
	"ltre.biz/codex-maintain/internal/workflow"
)

type app struct {
	window           *unison.Window
	root             *unison.Panel
	path             *unison.Field
	candidates       *unison.PopupMenu[string]
	output           *unison.Field
	status           *unison.Label
	problemPanel     *unison.Panel
	problemRows      []problemRow
	resultArea       *unison.Panel
	leftColumn       *unison.Panel
	rightColumn      *unison.Panel
	rawButton        *unison.Button
	logButton        *unison.Button
	diagnosticLog    *unison.Field
	viewerKind       string
	viewerScroll     *unison.ScrollPanel
	backButton       *unison.Button
	savedDashboard   []*unison.Panel
	diagnose, verify *unison.Button
	cancelButton     *unison.Button
	cancel           context.CancelFunc
	report           doctor.Report
	exe              string
	proxy            proxy.Candidate
	busy             bool
	restarted        bool
}

var discoverCandidates = doctor.Discover
var discoverActive = desktop.ActiveCodex
var runDoctorReport = doctor.Run

func main() {
	unison.Start(unison.StartupFinishedCallback(func() {
		if _, err := newApp(); err != nil {
			unison.ErrorDialogWithError("启动失败", err)
		}
	}))
}
func newApp() (*app, error) {
	w, err := unison.NewWindow("Codex 维护工具")
	if err != nil {
		return nil, err
	}
	a := &app{window: w, root: w.Content()}
	a.root.SetLayout(&unison.FlexLayout{Columns: 1, VSpacing: 10})
	a.root.SetBorder(unison.NewEmptyBorder(geom.NewUniformInsets(24)))
	paintSurface(a.root, canvasColor, 0)
	header := unison.NewPanel()
	header.SetLayout(&unison.FlexLayout{Columns: 1, VSpacing: 5})
	a.root.AddChild(header)
	header.AddChild(makeLabel("CODEX MAINTAIN  /  健康检查", 11, accentColor, true))
	header.AddChild(makeLabel("Codex 诊断中心", 23, textColor, true))
	header.AddChild(makeLabel("检查连接与运行状态，逐项查看问题并安全修复。", 13, mutedColor, false))
	hint := makeLabel("CODEX 程序路径", 11, mutedColor, true)
	a.root.AddChild(hint)
	a.path = unison.NewField()
	a.path.Font = font(13, false)
	a.path.EditableInk = cardColor
	a.path.OnEditableInk = textColor
	a.path.SetLayoutData(&unison.FlexLayoutData{HAlign: align.Fill, HGrab: true})
	a.root.AddChild(a.path)
	a.candidates = unison.NewPopupMenu[string]()
	a.candidates.Font = font(13, false)
	a.candidates.BackgroundInk = cardColor
	a.candidates.OnBackgroundInk = textColor
	a.candidates.EdgeInk = borderColor
	a.candidates.CornerRadius = geom.NewUniformSize(7)
	a.candidates.VMargin = 5
	a.candidates.SetLayoutData(&unison.FlexLayoutData{HAlign: align.Fill, HGrab: true})
	a.candidates.ChoiceMadeCallback = func(p *unison.PopupMenu[string], index int, item string) { p.SelectIndex(index); a.path.SetText(item) }
	row := unison.NewPanel()
	row.SetLayout(&unison.FlexLayout{Columns: 3, HSpacing: 10})
	a.root.AddChild(row)
	a.diagnose = unison.NewButton()
	styleButton(a.diagnose, true)
	a.diagnose.SetTitle("执行 Codex 诊断")
	a.diagnose.ClickCallback = a.runDoctor
	row.AddChild(a.diagnose)
	a.verify = unison.NewButton()
	styleButton(a.verify, false)
	a.verify.SetTitle("重启后验证")
	a.verify.ClickCallback = a.verifyAfter
	a.cancelButton = unison.NewButton()
	styleButton(a.cancelButton, false)
	a.cancelButton.SetTitle("取消当前操作")
	a.cancelButton.ClickCallback = func() {
		if a.cancel != nil {
			a.cancel()
			a.cancelButton.SetEnabled(false)
			a.add("已请求取消，正在等待当前步骤结束……")
		}
	}
	a.status = makeLabel("", 13, mutedColor, false)
	a.status.SetTitle("尚未诊断：请选择 Codex 程序并执行诊断")
	a.root.AddChild(a.status)
	a.output = unison.NewMultiLineField()
	a.output.Font = font(13, false)
	a.output.EditableInk = cardColor
	a.output.OnEditableInk = textColor
	a.output.SetWrap(true)
	readableLogField(a.output)
	a.output.SetText("请选择 Codex 程序并执行诊断。工具不会在诊断阶段修改配置。")
	a.resultArea = unison.NewPanel()
	a.resultArea.SetLayout(&resultColumns{gap: 16})
	a.resultArea.SetLayoutData(&unison.FlexLayoutData{HAlign: align.Fill, VAlign: align.Fill, HGrab: true, VGrab: true})
	a.root.AddChild(a.resultArea)
	a.leftColumn = unison.NewPanel()
	a.leftColumn.SetLayout(&unison.FlexLayout{Columns: 1, VSpacing: 10})
	a.resultArea.AddChild(a.leftColumn)
	a.leftColumn.AddChild(makeLabel("诊断结果  ·  最近一次完整检查", 15, textColor, true))
	a.problemPanel = unison.NewPanel()
	a.problemPanel.SetLayout(&unison.FlexLayout{Columns: 1, VSpacing: 10})
	placeholder := unison.NewLabel()
	placeholder.Font = font(14, false)
	placeholder.OnBackgroundInk = mutedColor
	placeholder.SetTitle("执行诊断后，问题会逐项显示在这里。")
	a.problemPanel.AddChild(placeholder)
	scroll := unison.NewScrollPanel()
	scroll.BackgroundInk = canvasColor
	scroll.SetContent(a.problemPanel, behavior.Follow, behavior.Unmodified)
	scroll.SetLayoutData(&unison.FlexLayoutData{HAlign: align.Fill, VAlign: align.Fill, HGrab: true, VGrab: true})
	a.leftColumn.AddChild(scroll)
	a.rightColumn = unison.NewPanel()
	a.rightColumn.SetLayout(&unison.FlexLayout{Columns: 1, VSpacing: 12})
	a.rightColumn.SetBorder(unison.NewCompoundBorder(unison.NewLineBorder(borderColor, geom.NewUniformSize(11), geom.NewUniformInsets(1), false), unison.NewEmptyBorder(geom.NewUniformInsets(16))))
	paintSurface(a.rightColumn, cardColor, 11)
	a.resultArea.AddChild(a.rightColumn)
	a.rightColumn.AddChild(makeLabel("日志与记录", 15, textColor, true))
	a.rightColumn.AddChild(makeLabel("在窗口内查看完整内容", 12, mutedColor, false))
	a.rawButton = unison.NewButton()
	styleButton(a.rawButton, false)
	a.rawButton.SetTitle("展开完整诊断日志")
	a.rawButton.SetEnabled(false)
	a.rawButton.SetLayoutData(&unison.FlexLayoutData{HAlign: align.Fill, HGrab: true})
	a.rawButton.ClickCallback = func() { a.openViewer("diagnostic") }
	a.rightColumn.AddChild(a.rawButton)
	a.logButton = unison.NewButton()
	styleButton(a.logButton, false)
	a.logButton.SetTitle("查看操作记录")
	a.logButton.SetLayoutData(&unison.FlexLayoutData{HAlign: align.Fill, HGrab: true})
	a.logButton.ClickCallback = func() { a.openViewer("operations") }
	a.rightColumn.AddChild(a.logButton)
	a.diagnosticLog = unison.NewMultiLineField()
	a.diagnosticLog.Font = font(13, false)
	a.diagnosticLog.EditableInk = cardColor
	a.diagnosticLog.OnEditableInk = textColor
	a.diagnosticLog.SetWrap(true)
	readableLogField(a.diagnosticLog)
	root, err := doctor.DefaultRoot()
	if err == nil {
		candidates, e := discoverCandidates(root)
		if e == nil && len(candidates) > 0 {
			for _, candidate := range candidates {
				a.candidates.AddItem(candidate.Path)
			}
			if len(candidates) == 1 {
				a.path.SetText(candidates[0].Path)
				a.candidates.SelectIndex(0)
			}
			if len(candidates) > 1 {
				a.root.AddChildAtIndex(a.candidates, a.root.IndexOfChild(a.path)+1)
				active, activeErr := discoverActive()
				match := -1
				if activeErr == nil {
					for i, c := range candidates {
						for _, p := range active {
							if strings.EqualFold(c.Path, p) {
								if match == -1 {
									match = i
								} else if match != i {
									match = -2
								}
							}
						}
					}
				}
				if match >= 0 {
					a.path.SetText(candidates[match].Path)
					a.candidates.SelectIndex(match)
				}
				var paths []string
				for _, c := range candidates {
					paths = append(paths, c.Path)
				}
				if match >= 0 {
					a.setLog("根据当前桌面端进程选择了匹配程序；仍可手动更改。\n" + strings.Join(paths, "\n"))
				} else {
					a.setLog("发现多个程序且未能唯一确认当前版本，请从列表选择后再诊断：\n" + strings.Join(paths, "\n"))
				}
			}
		} else if e != nil {
			a.setLog("查找桌面端程序失败：" + e.Error())
		}
	}
	w.SetContentRect(geom.NewRect(50, 50, 900, 700))
	w.ToFront()
	return a, nil
}
func (a *app) setBusy(b bool) {
	a.busy = b
	a.diagnose.SetEnabled(!b)
	for _, row := range a.problemRows {
		if row.repair != nil {
			row.repair.SetEnabled(!b)
		}
	}
	a.verify.SetEnabled(!b)
	row := a.diagnose.Parent()
	if row != nil {
		if b {
			a.cancelButton.SetEnabled(true)
			if row.IndexOfChild(a.cancelButton) < 0 {
				row.AddChild(a.cancelButton)
			}
		} else {
			row.RemoveChild(a.cancelButton)
			a.cancel = nil
		}
		row.MarkForLayoutAndRedraw()
	}
}
func (a *app) setLog(s string) {
	a.output.SetText(s)
	lines := strings.SplitN(s, "\n", 2)
	a.status.SetTitle(shorten(lines[0], 90))
	a.status.MarkForLayoutAndRedraw()
}
func (a *app) add(s string) {
	a.setLog(a.output.Text() + "\n" + s)
	a.status.SetTitle(shorten(s, 90))
	a.status.MarkForLayoutAndRedraw()
}
func (a *app) runDoctor() {
	if a.busy {
		return
	}
	a.exe = strings.TrimSpace(a.path.Text())
	if a.exe == "" {
		unison.ErrorDialogWithMessage("请选择程序", "请输入 Codex 桌面端的 codex.exe 路径。")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	a.cancel = cancel
	a.setBusy(true)
	a.rawButton.SetEnabled(false)
	a.diagnosticLog.SetText("诊断进行中……")
	a.problemPanel.RemoveAllChildren()
	a.problemRows = nil
	a.problemPanel.MarkForLayoutAndRedraw()
	a.setLog("正在运行完整诊断，请稍候……")
	go func() {
		defer cancel()
		r, err := runDoctorReport(ctx, a.exe, false, false)
		unison.InvokeTask(func() {
			a.setBusy(false)
			logText := formatDiagnosticLog(r)
			if err != nil {
				logText += "\n诊断未完成：" + err.Error() + "\n"
			}
			a.diagnosticLog.SetText(logText)
			a.rawButton.SetEnabled(err != nil || r.Raw != "" || r.Stderr != "" || r.ExitError != "")
			if err != nil {
				a.setLog("诊断未完成：" + err.Error())
				return
			}
			a.report = r
			var b strings.Builder
			fmt.Fprintf(&b, "诊断完成：%s 版本 %s\n", r.OverallStatus, r.CodexVersion)
			problems := r.Problems()
			if len(problems) == 0 {
				b.WriteString("没有报告警告或失败。\n")
			}
			for _, c := range problems {
				fmt.Fprintf(&b, "\n[%s] %s：%s\n", c.Status, c.ID, c.Summary)
				fmt.Fprintf(&b, "  说明：%s\n", doctor.Guidance(c))
				for _, d := range c.Details {
					fmt.Fprintf(&b, "  %s\n", d)
				}
				for _, i := range c.Issues {
					fmt.Fprintf(&b, "  原因：%s\n", i.Cause)
					if i.Measured != nil {
						fmt.Fprintf(&b, "  实际：%s\n", *i.Measured)
					}
					if i.Expected != nil {
						fmt.Fprintf(&b, "  预期：%s\n", *i.Expected)
					}
					if i.Remedy != nil {
						fmt.Fprintf(&b, "  建议：%s\n", *i.Remedy)
					}
				}
				if c.Remediation != nil {
					fmt.Fprintf(&b, "  建议：%s\n", *c.Remediation)
				}
			}
			a.setLog(b.String())
			a.renderProblems(r)
		})
	}()
}
func (a *app) fix(checkID string) {
	if a.busy {
		return
	}
	if strings.TrimSpace(a.path.Text()) != a.exe {
		unison.ErrorDialogWithMessage("程序路径已改变", "请先重新执行诊断。")
		return
	}
	valid := false
	for _, c := range a.report.Checks {
		if c.ID == checkID && actionableWebSocket(c) {
			valid = true
			break
		}
	}
	if !valid {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	a.cancel = cancel
	a.setBusy(true)
	a.setLog("正在读取系统代理并测试网络；配置尚未修改……")
	go func() {
		defer cancel()
		result, e := workflow.Repair(ctx, a.exe, workflow.RealDependencies())
		if e != nil {
			a.finishError(e)
			return
		}
		unison.InvokeTask(func() {
			a.proxy = result.Proxy
			a.setBusy(false)
			a.setLog(fmt.Sprintf("代理和临时 WebSocket 检查通过。\n%s\n配置：%s\n修改：%v；备份：%s\n\n配置已就绪。重启桌面端后点击‘重启后验证’。", result.Log, result.ConfigPath, result.Config.Changed, result.Config.Backup))
			if a.diagnose.Parent().IndexOfChild(a.verify) < 0 {
				a.diagnose.Parent().AddChild(a.verify)
			}
			if unison.YesNoDialog("现在重启 ChatGPT？", "请先保存或完成正在运行的任务。工具需要你通过托盘菜单正常退出；确认退出后将自动重新启动并检查。") == unison.ModalResponseOK {
				a.restart()
			}
		})
	}()
}
func (a *app) finishError(err error) {
	unison.InvokeTask(func() {
		a.setBusy(false)
		a.setLog("操作未完成：" + err.Error())
		unison.ErrorDialogWithMessage("操作未完成", "请查看操作记录了解失败原因和后续处理。")
	})
}
func (a *app) restart() {
	if a.busy {
		return
	}
	a.restarted = false
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	a.cancel = cancel
	a.setBusy(true)
	a.add("正在确认当前 ChatGPT 桌面端进程……")
	go func() {
		defer cancel()
		initial, err := desktop.Processes()
		if err != nil || len(initial) == 0 {
			a.finishError(fmt.Errorf("无法确认当前桌面端进程，请手动重启后选择重启后验证：%v", err))
			return
		}
		unison.InvokeTask(func() {
			a.add("请现在右键 ChatGPT 托盘图标并选择退出；工具正在等待正常退出。")
		})
		if err = desktop.WaitExit(ctx, initial); err != nil {
			a.finishError(err)
			return
		}
		unison.InvokeTask(func() { a.add("原实例已退出，正在启动桌面端……") })
		if err = ctx.Err(); err != nil {
			a.finishError(err)
			return
		}
		if err = desktop.Launch(ctx); err != nil {
			a.finishError(err)
			return
		}
		if err = desktop.WaitStart(ctx, initial); err != nil {
			a.finishError(err)
			return
		}
		unison.InvokeTask(func() {
			a.restarted = true
			a.setBusy(false)
			a.add("已观察到新实例。应用是否完全就绪仍需确认；开始网络复查。")
			a.verifyAfter()
		})
	}()
}
func (a *app) verifyAfter() {
	if a.busy {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	a.cancel = cancel
	a.setBusy(true)
	a.setLog("正在检查代理和重启后的网络配置……")
	go func() {
		defer cancel()
		v, pe := proxy.Test(ctx, a.proxy)
		r, e := runDoctorReport(ctx, a.exe, true, false)
		unison.InvokeTask(func() {
			a.setBusy(false)
			if e != nil {
				a.setLog("复查未完成：" + e.Error())
				return
			}
			ws, ok := r.WebSocket()
			enabled, known := r.SystemProxyEnabled()
			verdict := "网络复查未通过或结果不完整，请查看详情。"
			if pe == nil && ok && ws.Status == "ok" && known && enabled {
				if a.restarted {
					verdict = "已确认进程重启，代理和 WebSocket 检查通过。"
				} else {
					verdict = "代理和 WebSocket 检查通过，但工具未确认桌面端重启。"
				}
			}
			a.setLog(fmt.Sprintf("%s\n代理检查：%s（错误：%v）\n系统代理启用：%v（已识别：%v）\nWebSocket：%v，状态=%s，%s\n已确认旧实例退出并检测到新实例：%v\n\n%s\n\n应用是否完全就绪仍需确认；一次握手成功也不能保证长期稳定。", verdict, v, pe, enabled, known, ok, ws.Status, ws.Summary, a.restarted, r.Raw))
		})
	}()
}
