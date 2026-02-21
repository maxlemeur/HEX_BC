import { describe, expect, it } from "vitest";

import {
  createSpreadsheetNavigationModel,
  resolveSpreadsheetNextCellId,
} from "@/hooks/useSpreadsheetNavigation";

describe("useSpreadsheetNavigation helpers", () => {
  it("builds a model with unique non-empty columns only", () => {
    const model = createSpreadsheetNavigationModel([
      { rowId: "row-1", columnKeys: ["title", "", "title", "quantity"] },
      { rowId: "row-2", columnKeys: [] },
    ]);

    expect(model.flatIds).toEqual(["row-1::title", "row-1::quantity"]);
    expect(model.rowOrder).toEqual(["row-1"]);
  });

  it("wraps on Tab and Shift+Tab", () => {
    const model = createSpreadsheetNavigationModel([
      { rowId: "row-1", columnKeys: ["title", "quantity"] },
      { rowId: "row-2", columnKeys: ["title", "quantity"] },
    ]);

    expect(resolveSpreadsheetNextCellId(model, "row-2::quantity", "next")).toBe(
      "row-1::title"
    );
    expect(resolveSpreadsheetNextCellId(model, "row-1::title", "previous")).toBe(
      "row-2::quantity"
    );
  });

  it("moves vertically with wrap and skips rows without the same column", () => {
    const model = createSpreadsheetNavigationModel([
      { rowId: "row-1", columnKeys: ["title", "quantity"] },
      { rowId: "row-2", columnKeys: ["title"] },
      { rowId: "row-3", columnKeys: ["title", "quantity"] },
    ]);

    expect(resolveSpreadsheetNextCellId(model, "row-1::quantity", "down")).toBe(
      "row-3::quantity"
    );
    expect(resolveSpreadsheetNextCellId(model, "row-3::quantity", "down")).toBe(
      "row-1::quantity"
    );
    expect(resolveSpreadsheetNextCellId(model, "row-1::quantity", "up")).toBe(
      "row-3::quantity"
    );
  });

  it("falls back to first cell when current cell is unknown", () => {
    const model = createSpreadsheetNavigationModel([
      { rowId: "row-1", columnKeys: ["title"] },
      { rowId: "row-2", columnKeys: ["title"] },
    ]);

    expect(resolveSpreadsheetNextCellId(model, "missing::cell", "next")).toBe(
      "row-1::title"
    );
  });
});
