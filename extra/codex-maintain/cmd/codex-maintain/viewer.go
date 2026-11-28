package main

import (
	"github.com/richardwilkes/toolbox/v2/geom"
	"github.com/richardwilkes/unison"
	"github.com/richardwilkes/unison/enums/align"
	"github.com/richardwilkes/unison/enums/behavior"
)

// openViewer swaps the current window content while retaining dashboard nodes,
// so ongoing tasks and the original report continue to update in place.
func (a *app) openViewer(kind string) {
	if a.viewerKind != "" {
		return
	}
	field := a.output
	title := "操作记录"
	if kind == "diagnostic" {
		field = a.diagnosticLog
		title = "完整诊断日志"
	} else if kind != "operations" {
		return
	}
	a.savedDashboard = append([]*unison.Panel(nil), a.root.Children()...)
	a.root.RemoveAllChildren()
	a.viewerKind = kind
	header := unison.NewPanel()
	header.SetLayout(&unison.FlexLayout{Columns: 2, HSpacing: 16})
	a.root.AddChild(header)
	a.backButton = unison.NewButton()
	styleButton(a.backButton, false)
	a.backButton.SetTitle("← 返回诊断结果")
	a.backButton.ClickCallback = a.closeViewer
	header.AddChild(a.backButton)
	header.AddChild(makeLabel(title, 20, textColor, true))
	a.root.AddChild(makeLabel("可滚动查看和复制内容；返回后诊断状态会保留。", 13, mutedColor, false))
	a.viewerScroll = unison.NewScrollPanel()
	a.viewerScroll.BackgroundInk = cardColor
	a.viewerScroll.SetContent(field, behavior.Follow, behavior.Unmodified)
	a.viewerScroll.SetLayoutData(&unison.FlexLayoutData{HAlign: align.Fill, VAlign: align.Fill, HGrab: true, VGrab: true, MinSize: geom.NewSize(0, 100)})
	a.root.AddChild(a.viewerScroll)
	a.root.MarkForLayoutAndRedraw()
}
func (a *app) closeViewer() {
	if a.viewerKind == "" {
		return
	}
	a.root.RemoveAllChildren()
	for _, child := range a.savedDashboard {
		a.root.AddChild(child)
	}
	a.savedDashboard = nil
	a.viewerKind = ""
	a.viewerScroll = nil
	a.backButton = nil
	a.root.MarkForLayoutAndRedraw()
}
