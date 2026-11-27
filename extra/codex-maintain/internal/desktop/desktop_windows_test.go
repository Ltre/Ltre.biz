//go:build windows

package desktop

import (
	"context"
	"errors"
	"testing"
)

func TestWaitExitAndStartUseSnapshots(t *testing.T) {
	old := processSnapshot
	t.Cleanup(func() { processSnapshot = old })
	processSnapshot = func() (map[uint32]bool, error) { return map[uint32]bool{}, nil }
	if err := WaitExit(context.Background(), map[uint32]bool{100: true}); err != nil {
		t.Fatal(err)
	}
	processSnapshot = func() (map[uint32]bool, error) { return map[uint32]bool{200: true}, nil }
	if err := WaitStart(context.Background(), map[uint32]bool{100: true}); err != nil {
		t.Fatal(err)
	}
	processSnapshot = func() (map[uint32]bool, error) { return nil, errors.New("mock access failure") }
	if err := WaitExit(context.Background(), map[uint32]bool{100: true}); err == nil {
		t.Fatal("must not treat inspection failure as exit")
	}
}
