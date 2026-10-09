import { act,renderHook } from "@testing-library/react";
import { createRef } from "react";
import { describe,expect,it,vi } from "vitest";

import { useEstimateClipboard } from "@/components/estimates/hooks/useEstimateClipboard";

describe("useEstimateClipboard", () => {

  it("builds preview and confirms paste rows", async () => {
    const onPasteRows = vi.fn().mockResolvedValue(undefined);
    const tableCardRef = createRef<HTMLDivElement>();
    tableCardRef.current = document.createElement("div");
    const insertionAnchorItemIdRef = createRef<string | null>();
    insertionAnchorItemIdRef.current = "line-anchor";

    const { result } = renderHook(() =>
      useEstimateClipboard({
        isReadOnly: false,
        tableCardRef,
        insertionAnchorItemIdRef,
        items: [],
        selectedLineIdList: [],
        hasSelectedLines: false,
        mergedUnitDrafts: {},
        supplyTypeById: new Map(),
        onPasteRows,
      })
    );

    act(() => {
      result.current.openPastePreviewFromText("designation\tquantity\nTube\t2");
    });

    expect(result.current.isPastePreviewOpen).toBe(true);
    expect(result.current.pasteDialogRows.length).toBeGreaterThan(0);

    await act(async () => {
      await result.current.handleConfirmPastePreview();
    });

    expect(onPasteRows).toHaveBeenCalledTimes(1);
    expect(onPasteRows.mock.calls[0]?.[0]).toMatchObject({
      anchorRowId: "line-anchor",
    });
  });
});
