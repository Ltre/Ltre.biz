package main

import (
	"github.com/richardwilkes/toolbox/v2/geom"
	"github.com/richardwilkes/unison"
)

// resultColumns divides the usable width, excluding the gutter, 61.8/38.2.
type resultColumns struct{ gap float32 }

func (l *resultColumns) LayoutSizes(_ *unison.Panel, _ geom.Size) (geom.Size, geom.Size, geom.Size) {
	return geom.NewSize(0, 140), geom.NewSize(800, 350), geom.NewSize(unison.DefaultMaxSize, unison.DefaultMaxSize)
}
func (l *resultColumns) PerformLayout(target *unison.Panel) {
	children := target.Children()
	if len(children) != 2 {
		return
	}
	r := target.ContentRect(false)
	gap := min(l.gap, max(r.Width, 0))
	width := max(0, r.Width-gap)
	left := width * 0.618
	children[0].SetFrameRect(geom.NewRect(r.X, r.Y, left, max(r.Height, 0)))
	children[1].SetFrameRect(geom.NewRect(r.X+left+gap, r.Y, width-left, max(r.Height, 0)))
}
