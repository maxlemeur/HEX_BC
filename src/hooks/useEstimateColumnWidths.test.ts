import { afterEach,beforeEach,describe,expect,it } from "vitest";

import {
parseEstimateColumnWidths
} from "@/hooks/useEstimateColumnWidths";

describe("useEstimateColumnWidths", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

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
