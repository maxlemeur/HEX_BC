import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type ColumnKey,
  type ColumnPreset,
  useColumnVisibility,
} from "@/hooks/useColumnVisibility";

const STORAGE_KEY = "est-col-vis";
const STORAGE_KEY_CUSTOM = "est-col-custom";
const STORAGE_KEY_OVERRIDE = "est-col-override";

const STANDARD_COLUMNS: ColumnKey[] = [
  "supply_type",
  "k_fo",
  "labor_role",
  "k_mo",
];
const FULL_COLUMNS: ColumnKey[] = [
  ...STANDARD_COLUMNS,
  "ds",
  "marge",
  "marque",
];

describe("useColumnVisibility", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it.each<[ColumnPreset, ColumnKey[]]>([
    ["essential", []],
    ["standard", STANDARD_COLUMNS],
    ["full", FULL_COLUMNS],
  ])("exposes the exact %s preset", (preset, expectedColumns) => {
    localStorage.setItem(STORAGE_KEY, preset);
    localStorage.setItem(STORAGE_KEY_OVERRIDE, "false");

    const { result } = renderHook(() => useColumnVisibility());

    expect([...result.current.visibleColumns]).toEqual(expectedColumns);
    expect(result.current.hiddenAdvancedCount).toBe(8 - expectedColumns.length);
  });

  it("moves from a preset to custom and back when the columns match again", () => {
    localStorage.setItem(STORAGE_KEY, "standard");
    const { result } = renderHook(() => useColumnVisibility());

    act(() => {
      result.current.toggleColumn("marque");
    });

    expect(result.current.preset).toBe("custom");
    expect([...result.current.visibleColumns]).toEqual([
      ...STANDARD_COLUMNS,
      "marque",
    ]);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("custom");
    expect(localStorage.getItem(STORAGE_KEY_OVERRIDE)).toBe("true");

    act(() => {
      result.current.toggleColumn("marque");
    });

    expect(result.current.preset).toBe("standard");
    expect([...result.current.visibleColumns]).toEqual(STANDARD_COLUMNS);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY_CUSTOM) ?? "null")).toEqual(
      STANDARD_COLUMNS
    );
  });

  it("persists an automatic preset without creating a manual override", () => {
    const { result, unmount } = renderHook(() => useColumnVisibility());

    act(() => {
      result.current.setPresetAuto("standard");
    });

    expect(result.current.preset).toBe("standard");
    expect(result.current.hasManualOverride).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("standard");
    expect(localStorage.getItem(STORAGE_KEY_OVERRIDE)).toBeNull();

    unmount();
    const { result: remountedResult } = renderHook(() => useColumnVisibility());

    expect(remountedResult.current.preset).toBe("standard");
    expect(remountedResult.current.hasManualOverride).toBe(false);
  });

  it.each<ColumnPreset>(["full", "custom"])(
    "migrates the legacy %s preset to a manual override",
    (preset) => {
      localStorage.setItem(STORAGE_KEY, preset);

      const { result } = renderHook(() => useColumnVisibility());

      expect(result.current.hasManualOverride).toBe(true);
      expect(localStorage.getItem(STORAGE_KEY_OVERRIDE)).toBe("true");
    }
  );

  it("falls back safely when persisted values are malformed", () => {
    localStorage.setItem(STORAGE_KEY, "dense");
    localStorage.setItem(STORAGE_KEY_CUSTOM, "{not-json");
    localStorage.setItem(STORAGE_KEY_OVERRIDE, "maybe");

    const { result } = renderHook(() => useColumnVisibility());

    expect(result.current.preset).toBe("essential");
    expect(result.current.customColumns).toEqual([]);
    expect([...result.current.visibleColumns]).toEqual([]);
    expect(result.current.hasManualOverride).toBe(false);
  });

  it("ignores unknown custom column keys loaded from storage", () => {
    localStorage.setItem(STORAGE_KEY, "custom");
    localStorage.setItem(STORAGE_KEY_OVERRIDE, "false");
    localStorage.setItem(
      STORAGE_KEY_CUSTOM,
      JSON.stringify(["supply_type", "obsolete_column", "marge"])
    );

    const { result } = renderHook(() => useColumnVisibility());

    expect(result.current.customColumns).toEqual(["supply_type", "marge"]);
    expect([...result.current.visibleColumns]).toEqual(["supply_type", "marge"]);
  });
});
