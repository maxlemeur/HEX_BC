import { describe, expect, it } from "vitest";

import { DEFAULT_ESTIMATE_COLUMN_ORDER, normalizeEstimateColumnOrder } from "@/hooks/useEstimateColumnOrder";

describe("column order DOM", () => {
  it("ignores invalid keys, duplicates and attempts to move columns across calculation groups", () => {
    const normalized = normalizeEstimateColumnOrder(["marque", "designation", "marque", "unknown", "k_fo"]);
    expect(normalized[0]).toBe("designation");
    expect(normalized.filter((key) => key === "marque")).toHaveLength(1);
    expect(new Set(normalized)).toEqual(new Set(DEFAULT_ESTIMATE_COLUMN_ORDER));
    expect(normalized.indexOf("marque")).toBeGreaterThan(normalized.indexOf("k_mo_site"));
  });
});
