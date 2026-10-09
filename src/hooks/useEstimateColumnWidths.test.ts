import { afterEach,beforeEach,describe,expect,it } from "vitest";

import {
clampEstimateColumnWidth,
parseEstimateColumnWidths
} from "@/hooks/useEstimateColumnWidths";

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
});
