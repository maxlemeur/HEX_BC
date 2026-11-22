import { act, renderHook } from "@testing-library/react";
import type { FocusEvent, KeyboardEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CataloguePriceSuggestion,
  EstimateItem,
} from "@/components/estimates/components/estimate-editor-row/shared";
import { useCatalogueSuggestions } from "@/components/estimates/components/estimate-editor-row/useCatalogueSuggestions";

const suggestion = {
  price_source: "supplier_offer",
  supplier_price_id: null,
  product_id: "product-1",
  product_designation: "Coude PVC 90°",
  product_reference: null,
  supplier_id: null,
  supplier_name: null,
  supplier_reference: null,
  unit: "u",
  unit_price_cents: 1200,
  adjusted_unit_price_cents: 1200,
  currency: "EUR",
} as unknown as CataloguePriceSuggestion;

vi.mock("@/components/estimates/components/estimate-editor-row/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/estimates/components/estimate-editor-row/shared")>()),
  fetchCatalogueSuggestions: vi.fn(async () => [suggestion]),
}));

const line = {
  id: "line-1",
  item_type: "line",
  title: "Coude PVC",
  description: "u",
  unit_code: null,
} as unknown as EstimateItem;

function renderSuggestions() {
  const onPatchItem = vi.fn();
  const titleEditorProps = {
    ref: () => undefined,
    tabIndex: -1,
    onFocus: vi.fn(),
    onBlur: vi.fn(),
    onKeyDown: vi.fn(),
  };
  const view = renderHook(() =>
    useCatalogueSuggestions({
      supplyTypes: [],
      versionId: "version-1",
      item: line,
      isReadOnly: false,
      titleEditorProps: titleEditorProps as never,
      onPatchItem,
    })
  );
  return { ...view, onPatchItem, titleEditorProps };
}

function keyDown(init: { key: string; metaKey?: boolean; ctrlKey?: boolean }) {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...init,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLInputElement>;
}

describe("useCatalogueSuggestions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function showSuggestions(view: ReturnType<typeof renderSuggestions>) {
    act(() => view.result.current.handleLineTitleFocus({} as FocusEvent<HTMLInputElement>));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(view.result.current.catalogueSuggestions).toEqual([suggestion]);
  }

  it("leaves ⌘/Ctrl+Entrée to the editor shortcut while suggestions are shown", async () => {
    const view = renderSuggestions();
    await showSuggestions(view);

    for (const command of [{ metaKey: true }, { ctrlKey: true }]) {
      const event = keyDown({ key: "Enter", ...command });
      act(() => view.result.current.handleLineTitleKeyDown(event));
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(view.onPatchItem).not.toHaveBeenCalled();
    expect(view.titleEditorProps.onKeyDown).toHaveBeenCalledTimes(2);
  });

  it("still applies the active suggestion on Entrée alone", async () => {
    const view = renderSuggestions();
    await showSuggestions(view);

    const event = keyDown({ key: "Enter" });
    act(() => view.result.current.handleLineTitleKeyDown(event));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(view.onPatchItem).toHaveBeenCalledWith(
      "line-1",
      expect.objectContaining({ product_id: "product-1", title: "Coude PVC 90°" }),
      { persist: true }
    );
  });
});
