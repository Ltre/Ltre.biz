package main

import (
	"fmt"
	"strings"

	"github.com/richardwilkes/toolbox/v2/geom"
	"github.com/richardwilkes/unison"
	"github.com/richardwilkes/unison/enums/align"
	"github.com/richardwilkes/unison/enums/behavior"
	"github.com/richardwilkes/unison/enums/mod"
	"ltre.biz/codex-maintain/internal/doctor"
)

// readableLogField permits navigation, selection and copying without editing.
func readableLogField(f *unison.Field) {
	f.RuneTypedCallback = func(rune) bool { return true }
	f.KeyDownCallback = func(key unison.KeyCode, mods mod.Modifiers, repeat bool) bool {
		switch key {
		case unison.KeyBackspace, unison.KeyDelete, unison.KeyReturn, unison.KeyNumPadEnter:
			return true
		}
		if mods.OSMenuCommandDown() && (key == unison.KeyX || key == unison.KeyV) {
			return true
		}
		return f.DefaultKeyDown(key, mods, repeat)
	}
	for _, id := range []int{unison.CutItemID, unison.PasteItemID, unison.DeleteItemID} {
		f.InstallCmdHandlers(id, func(any) bool { return false }, func(any) {})
	}
}

type problemRow struct {
	check   doctor.Check
	card    *unison.Panel
	details *unison.Button
	repair  *unison.Button
}

func formatDiagnosticLog(r doctor.Report) string {
	var b strings.Builder
	if r.Raw != "" {
		b.WriteString("标准输出（原始诊断报告）：\n")
		b.WriteString(r.Raw)
		b.WriteString("\n")
	}
	if r.Stderr != "" {
		b.WriteString("\n标准错误输出：\n")
		b.WriteString(r.Stderr)
		b.WriteString("\n")
	}
	if r.ExitError != "" {
		fmt.Fprintf(&b, "\n进程退出状态：%s\n", r.ExitError)
	}
	return b.String()
}
func shorten(s string, max int) string {
	s = strings.Join(strings.Fields(s), " ")
	r := []rune(s)
	if len(r) > max {
		return string(r[:max]) + "…"
	}
	return s
}
func problemName(c doctor.Check) string {
	id := strings.ToLower(c.ID)
	switch {
	case strings.Contains(id, "websocket"):
		return "WebSocket 连接"
	case strings.Contains(id, "mcp"):
		return "MCP 配置"
	case strings.Contains(id, "thread") || strings.Contains(id, "rollout"):
		return "会话文件与索引"
	case strings.Contains(id, "sandbox"):
		return "沙盒"
	case strings.Contains(id, "auth"):
		return "登录与认证"
	default:
		return c.ID
	}
}
func statusName(status string) string {
	switch strings.ToLower(status) {
	case "warning", "warn":
		return "警告"
	case "fail", "failed", "error":
		return "失败"
	default:
		return "未确认：" + status
	}
}
func actionableWebSocket(c doctor.Check) bool {
	s := strings.ToLower(c.Status)
	return strings.Contains(strings.ToLower(c.ID), "websocket") && (s == "warning" || s == "warn" || s == "fail" || s == "failed" || s == "error")
}
func detailsText(c doctor.Check) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s\n状态：%s\n检查项：%s\n类别：%s\n\n诊断说明：%s\n\n影响与建议：%s\n", problemName(c), statusName(c.Status), c.ID, c.Category, c.Summary, doctor.Guidance(c))
	if len(c.Details) > 0 {
		b.WriteString("\n检查详情：\n")
		for _, d := range c.Details {
			fmt.Fprintf(&b, "• %s\n", d)
		}
	}
	for _, i := range c.Issues {
		fmt.Fprintf(&b, "\n原因：%s\n", i.Cause)
		if i.Severity != "" {
			fmt.Fprintf(&b, "严重程度：%s\n", i.Severity)
		}
		if i.Measured != nil {
			fmt.Fprintf(&b, "实际：%s\n", *i.Measured)
		}
		if i.Expected != nil {
			fmt.Fprintf(&b, "预期：%s\n", *i.Expected)
		}
		if i.Remedy != nil {
			fmt.Fprintf(&b, "建议：%s\n", *i.Remedy)
		}
		if len(i.Fields) > 0 {
			fmt.Fprintf(&b, "相关字段：%s\n", strings.Join(i.Fields, ", "))
		}
	}
	if c.Remediation != nil {
		fmt.Fprintf(&b, "\n处理建议：%s\n", *c.Remediation)
	}
	return b.String()
}
func showTextWindow(title, text string) {
	w, err := unison.NewWindow(title)
	if err != nil {
		unison.ErrorDialogWithError("无法打开详情", err)
		return
	}
	content := w.Content()
	content.SetLayout(&unison.FlexLayout{Columns: 1, VSpacing: 8})
	content.SetBorder(unison.NewEmptyBorder(geom.NewUniformInsets(20)))
	paintSurface(content, canvasColor, 0)
	label := makeLabel(title, 18, textColor, true)
	content.AddChild(label)
	field := unison.NewMultiLineField()
	field.Font = font(13, false)
	field.EditableInk = cardColor
	field.OnEditableInk = textColor
	field.SetWrap(true)
	field.SetText(text)
	readableLogField(field)
	scroll := unison.NewScrollPanel()
	scroll.BackgroundInk = cardColor
	scroll.SetContent(field, behavior.Fill, behavior.Fill)
	scroll.SetLayoutData(&unison.FlexLayoutData{HAlign: align.Fill, VAlign: align.Fill, HGrab: true, VGrab: true})
	content.AddChild(scroll)
	w.SetContentRect(geom.NewRect(110, 110, 760, 550))
	w.ToFront()
}
func (a *app) renderProblems(report doctor.Report) {
	a.problemPanel.RemoveAllChildren()
	a.problemRows = nil
	problems := report.Problems()
	a.status.SetTitle(fmt.Sprintf("诊断完成 · %d 项需要关注 · Codex %s", len(problems), report.CodexVersion))
	a.status.MarkForLayoutAndRedraw()
	if len(problems) == 0 {
		label := makeLabel("✓  没有报告警告或失败。", 14, mutedColor, false)
		a.problemPanel.AddChild(label)
	}
	for _, check := range problems {
		c := check
		card := unison.NewPanel()
		card.SetLayout(&unison.FlexLayout{Columns: 2, HSpacing: 14})
		card.SetLayoutData(&unison.FlexLayoutData{HAlign: align.Fill, HGrab: true})
		paintSurface(card, cardColor, 11)
		card.SetBorder(unison.NewCompoundBorder(unison.NewLineBorder(borderColor, geom.NewUniformSize(11), geom.NewUniformInsets(1), false), unison.NewEmptyBorder(geom.NewUniformInsets(15))))
		info := unison.NewPanel()
		info.SetLayout(&unison.FlexLayout{Columns: 1, VSpacing: 5})
		info.SetLayoutData(&unison.FlexLayoutData{HAlign: align.Fill, HGrab: true})
		card.AddChild(info)
		statusInk := warningColor
		if strings.EqualFold(c.Status, "fail") || strings.EqualFold(c.Status, "error") {
			statusInk = failureColor
		}
		title := makeLabel(statusName(c.Status)+"  ·  "+problemName(c), 15, statusInk, true)
		info.AddChild(title)
		summary := makeLabel(shorten(c.Summary, 26), 13, textColor, false)
		info.AddChild(summary)
		guidance := makeLabel(shorten(doctor.Guidance(c), 20), 12, mutedColor, false)
		info.AddChild(guidance)
		actions := unison.NewPanel()
		actions.SetLayout(&unison.FlexLayout{Columns: 1, VSpacing: 8})
		card.AddChild(actions)
		detail := unison.NewButton()
		styleButton(detail, false)
		detail.SetTitle("查看详情")
		detail.ClickCallback = func() { showTextWindow(problemName(c)+" · 详情", detailsText(c)) }
		actions.AddChild(detail)
		row := problemRow{check: c, card: card, details: detail}
		if actionableWebSocket(c) {
			repair := unison.NewButton()
			styleButton(repair, true)
			repair.SetTitle("修复 WebSocket 问题")
			repair.ClickCallback = func() { a.fix(c.ID) }
			actions.AddChild(repair)
			row.repair = repair
		}
		a.problemPanel.AddChild(card)
		a.problemRows = append(a.problemRows, row)
	}
	a.problemPanel.MarkForLayoutAndRedraw()
}
