import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clampEstimateColumnWidth,
  parseEstimateColumnWidths,
  useEstimateColumnWidths,
} from "@/hooks/useEstimateColumnWidths";

const STORAGE_KEY = "est-col-widths-v1";

describe("useEstimateColumnWidths", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("clamps narrow and oversized tracks", () => {
    expect(clampEstimateColumnWidth("designation", 120)).toBe(220);
    expect(clampEstimateColumnWidth("designation", 800)).toBe(640);
    expect(clampEstimateColumnWidth("quantity", 12)).toBe(48);
    expect(clampEstimateColumnWidth("quantity", 400)).toBe(320);
  });

  it("keeps only supported finite persisted widths", () => {
    expect(
      parseEstimateColumnWidths(
        JSON.stringify({
          designation: 410.4,
          quantity: 8,
          obsolete: 200,
          unit: "90",
        }),
      ),
    ).toEqual({ designation: 410, quantity: 48 });
    expect(parseEstimateColumnWidths("{bad-json")).toEqual({});
  });

  it("persists adjustments and removes a reset column", () => {
    const { result } = renderHook(() => useEstimateColumnWidths());

    act(() => result.current.setColumnWidth("designation", 430));
    act(() => result.current.setColumnWidth("quantity", 92));

    expect(result.current.widths).toEqual({ designation: 430, quantity: 92 });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual({
      designation: 430,
      quantity: 92,
    });

    act(() => result.current.resetColumnWidth("designation"));

    expect(result.current.widths).toEqual({ quantity: 92 });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual({
      quantity: 92,
    });
  });
});
