import { renderHook } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it } from "vitest";

import { useColumnVisibility } from "@/hooks/useColumnVisibility";

const STORAGE_KEY = "est-col-vis";
const STORAGE_KEY_CUSTOM = "est-col-custom";
const STORAGE_KEY_OVERRIDE = "est-col-override";

describe("useColumnVisibility", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

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
});
