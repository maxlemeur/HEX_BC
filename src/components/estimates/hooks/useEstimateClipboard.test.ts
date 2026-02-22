import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useEstimateClipboard } from "@/components/estimates/hooks/useEstimateClipboard";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

function createItem(partial: Partial<EstimateItem>): EstimateItem {
  return {
    id: "",
    version_id: "version-1",
    parent_id: null,
    item_type: "line",
    title: "",
    description: null,
    quantity: 1,
    unit_price_ht_cents: 0,
    tax_rate_bp: 2000,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
    pu_ht_cents: 0,
    line_total_ht_cents: 0,
    position: 0,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    selected_supplier_price_id: null,
    h_mo_atelier: null,
    k_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: null,
    labor_role_chantier_id: null,
    created_at: new Date().toISOString(),
    ...partial,
  } as EstimateItem;
}

describe("useEstimateClipboard", () => {
  it("copies selected rows through async clipboard API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText,
      },
    });

    const tableCardRef = createRef<HTMLDivElement>();
    tableCardRef.current = document.createElement("div");
    const insertionAnchorItemIdRef = createRef<string | null>();

    const { result } = renderHook(() =>
      useEstimateClipboard({
        isReadOnly: false,
        tableCardRef,
        insertionAnchorItemIdRef,
        items: [
          createItem({ id: "line-1", title: "Tube acier", quantity: 2, h_mo_majoration: 1.15 }),
        ],
        selectedLineIdList: ["line-1"],
        hasSelectedLines: true,
        mergedUnitDrafts: { "line-1": "u" },
        supplyTypeById: new Map(),
        onPasteRows: vi.fn().mockResolvedValue(undefined),
      })
    );

    await act(async () => {
      await result.current.copySelectedRowsToClipboard();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain("Tube acier");
  });

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
