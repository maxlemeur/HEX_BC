import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useFocusItemHighlight } from "@/hooks/useFocusItemHighlight";

// The editor opened on a line (`focusItemId`, the landing after « Envoyer au tableau de chiffrage ») scrolled to it but
// never highlighted it: the highlight was asked for on mount, before the version was shown, when the editor's
// highlighting ignores the request (useEstimateEditorAiDialogsController, captureCurrentRouteScope), and never again.
// Found by the landing journey's `data-highlighted` assertion (the independent review of eea9e030). Written before the
// fix.

const LINE = "33333333-3333-4333-8333-333333333333";
const OTHER = "33333333-3333-4333-8333-333333333334";
const flush = () => act(async () => { await Promise.resolve(); });

describe("useFocusItemHighlight", () => {
  it("highlights the line once its version is shown, not before", async () => {
    const highlight = vi.fn();
    const { rerender } = renderHook(({ ready }) => useFocusItemHighlight(LINE, ready, highlight), { initialProps: { ready: false } });
    await flush();
    expect(highlight).not.toHaveBeenCalled();
    rerender({ ready: true });
    await flush();
    expect(highlight).toHaveBeenCalledExactlyOnceWith([LINE]);
  });

  it("highlights it once, whatever re-renders the editor after", async () => {
    const highlight = vi.fn();
    const { rerender } = renderHook(({ callback }) => useFocusItemHighlight(LINE, true, callback), { initialProps: { callback: highlight } });
    await flush();
    const next = vi.fn();
    rerender({ callback: next });
    await flush();
    expect(highlight).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it("highlights another line the editor is asked to show", async () => {
    const highlight = vi.fn();
    const { rerender } = renderHook(({ line }) => useFocusItemHighlight(line, true, highlight), { initialProps: { line: LINE } });
    await flush();
    rerender({ line: OTHER });
    await flush();
    expect(highlight.mock.calls).toEqual([[[LINE]], [[OTHER]]]);
  });

  // The re-check of 0fd09a20 (finding 5): ?focusItemId=A, back to the editor's plain address, then a link to A again while
  // the editor stayed mounted: the line was scrolled to, never highlighted. Written before the fix.
  it("highlights a line again when it is asked for again after the editor was shown without one (A → none → A)", async () => {
    const highlight = vi.fn();
    const { rerender } = renderHook(({ line }) => useFocusItemHighlight(line, true, highlight),
      { initialProps: { line: LINE as string | null } });
    await flush();
    rerender({ line: null });
    await flush();
    rerender({ line: LINE });
    await flush();
    expect(highlight.mock.calls).toEqual([[[LINE]], [[LINE]]]);
  });

  it("highlights nothing without a line", async () => {
    const highlight = vi.fn();
    renderHook(() => useFocusItemHighlight(null, true, highlight));
    await flush();
    expect(highlight).not.toHaveBeenCalled();
  });
});
