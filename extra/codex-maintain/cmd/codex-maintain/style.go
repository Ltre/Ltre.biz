package main

import (
	"github.com/richardwilkes/toolbox/v2/geom"
	"github.com/richardwilkes/unison"
	"github.com/richardwilkes/unison/enums/paintstyle"
	"github.com/richardwilkes/unison/enums/weight"
)

var (
	canvasColor      = unison.RGB(246, 248, 252)
	cardColor        = unison.RGB(255, 255, 255)
	borderColor      = unison.RGB(225, 231, 240)
	textColor        = unison.RGB(28, 42, 62)
	mutedColor       = unison.RGB(95, 111, 133)
	accentColor      = unison.RGB(54, 96, 214)
	accentHoverColor = unison.RGB(39, 78, 187)
	warningColor     = unison.RGB(156, 98, 26)
	failureColor     = unison.RGB(187, 62, 74)
)

func font(size float32, bold bool) unison.Font {
	d := unison.SystemFont.Descriptor()
	d.Size = size
	if bold {
		d.Weight = weight.SemiBold
	}
	return d.Font()
}
func makeLabel(text string, size float32, ink unison.Ink, bold bool) *unison.Label {
	l := unison.NewLabel()
	l.Font = font(size, bold)
	l.OnBackgroundInk = ink
	l.SetTitle(text)
	return l
}
func paintSurface(p *unison.Panel, color unison.Color, radius float32) {
	p.DrawCallback = func(c *unison.Canvas, _ geom.Rect) {
		r := p.ContentRect(true)
		paint := color.Paint(c, r, paintstyle.Fill)
		if radius > 0 {
			c.DrawRoundedRect(r, geom.NewUniformSize(radius), paint)
		} else {
			c.DrawRect(r, paint)
		}
	}
}
func styleButton(b *unison.Button, primary bool) {
	b.Font = font(13, true)
	b.HMargin = 15
	b.VMargin = 8
	b.CornerRadius = geom.NewUniformSize(8)
	if primary {
		b.BackgroundInk = accentColor
		b.OnBackgroundInk = cardColor
		b.EdgeInk = accentColor
		b.SelectionInk = accentHoverColor
		b.OnSelectionInk = cardColor
	} else {
		b.BackgroundInk = cardColor
		b.OnBackgroundInk = textColor
		b.EdgeInk = borderColor
		b.SelectionInk = unison.RGB(232, 238, 252)
		b.OnSelectionInk = accentColor
	}
}
