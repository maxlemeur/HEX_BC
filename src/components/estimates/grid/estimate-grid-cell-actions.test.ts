import { describe, expect, it } from "vitest";

import type { EstimateItem } from "@/components/estimates/components/estimate-editor-row/shared";
import type { GridSelection } from "@/hooks/useGridNavigation";

import {
  describeEstimateGridPlanLeftovers,
  groupEstimateGridWrites,
  isEstimateGridCellWritable,
  parseClipboardMatrix,
  planEstimateGridClear,
  planEstimateGridFillDown,
  planEstimateGridPaste,
  readEstimateGridCellText,
  serializeEstimateGridSelection,
  type EstimateGridCellContext,
} from "./estimate-grid-cell-actions";

const LINE_COLUMNS = ["title", "quantity", "unit", "unit_price", "k_fo", "h_mo", "labor_role", "k_mo", "pu_ht", "line_total_ht"];

function line(id: string, overrides: Partial<EstimateItem> = {}): EstimateItem {
  return {
    id,
    item_type: "line",
    title: `Ligne ${id}`,
    quantity: 2,
    unit_code: "u",
    description: null,
    unit_price_ht_cents: 1250,
    k_fo: 1.05,
    k_mo: 1,
    h_mo: 0.5,
    h_mo_per_unit: 0.5,
    h_mo_majoration: 1,
    labor_role_id: null,
    supply_type_id: null,
    pu_ht_cents: 4321,
    line_total_ht_cents: 8642,
    ...overrides,
  } as EstimateItem;
}

function section(id: string, title: string): EstimateItem {
  return { id, item_type: "section", title } as EstimateItem;
}

const context: EstimateGridCellContext = {
  isV3: true,
  currency: "EUR",
  supplyTypeOptions: [
    { id: "st-cu", code: "CU", label: "Cuivre" },
    { id: "st-pvc", code: "PVC", label: "PVC" },
  ],
  laborRoleOptions: [
    { id: "role-plombier", label: "Plombier" },
    { id: "role-chef", label: "Chef de chantier" },
    { id: "role-old", label: "Ancien rôle", disabled: true },
  ],
  legacyUnitByItemId: {},
};

function grid(items: EstimateItem[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const rows = items.map((item) => ({
    rowId: item.id,
    columnKeys: item.item_type === "section" ? ["title"] : LINE_COLUMNS,
  }));
  return { rows, getItem: (rowId: string) => byId.get(rowId) };
}

function single(rowId: string, columnKey: string): GridSelection {
  return { active: { rowId, columnKey }, isRange: false, columnKeys: [columnKey], rows: [{ rowId, columnKeys: [columnKey] }] };
}

function range(rowIds: string[], columnKeys: string[]): GridSelection {
  return {
    active: { rowId: rowIds[0], columnKey: columnKeys[0] },
    isRange: true,
    columnKeys,
    rows: rowIds.map((rowId) => ({ rowId, columnKeys })),
  };
}

describe("readEstimateGridCellText", () => {
  it("reads inputs with a French decimal comma and no grouping", () => {
    const item = line("a", { quantity: 1234.5, unit_price_ht_cents: 123456, k_fo: 1.02 });
    expect(readEstimateGridCellText(item, "quantity", context)).toBe("1234,5");
    expect(readEstimateGridCellText(item, "unit_price", context)).toBe("1234,56");
    expect(readEstimateGridCellText(item, "k_fo", context)).toBe("1,02");
    expect(readEstimateGridCellText(item, "unit", context)).toBe("u");
    expect(readEstimateGridCellText(item, "pu_ht", context)).toBe("43,21");
    expect(readEstimateGridCellText(item, "line_total_ht", context)).toBe("86,42");
  });

  it("reads a type by its label and a legacy unit from its draft", () => {
    const item = line("a", { labor_role_id: "role-plombier", description: "ml" });
    expect(readEstimateGridCellText(item, "labor_role", context)).toBe("Plombier");
    expect(readEstimateGridCellText(item, "unit", { ...context, isV3: false })).toBe("ml");
    expect(
      readEstimateGridCellText(item, "unit", { ...context, isV3: false, legacyUnitByItemId: { a: "m2" } }),
    ).toBe("m2");
  });

  it("knows which cells accept a value", () => {
    const item = line("a");
    expect(isEstimateGridCellWritable(item, "quantity")).toBe(true);
    expect(isEstimateGridCellWritable(item, "pu_ht")).toBe(false);
    expect(isEstimateGridCellWritable(item, "line_total_ht")).toBe(false);
    expect(isEstimateGridCellWritable(item, "supplier")).toBe(false);
    expect(isEstimateGridCellWritable(section("s", "Lot"), "title")).toBe(true);
    expect(isEstimateGridCellWritable(section("s", "Lot"), "quantity")).toBe(false);
  });
});

describe("serializeEstimateGridSelection", () => {
  it("writes one tab-separated line per row", () => {
    const { getItem } = grid([line("a", { k_fo: 1.02 }), line("b", { k_fo: 1.03 })]);
    expect(serializeEstimateGridSelection(range(["a", "b"], ["k_fo", "h_mo"]), getItem, context)).toBe(
      "1,02\t0,5\n1,03\t0,5",
    );
  });

  it("leaves an empty cell where a row has no such column and flattens line breaks", () => {
    const { getItem } = grid([section("s", "Lot\n1"), line("a")]);
    const selection: GridSelection = {
      active: { rowId: "s", columnKey: "title" },
      isRange: true,
      columnKeys: ["title", "quantity"],
      rows: [
        { rowId: "s", columnKeys: ["title"] },
        { rowId: "a", columnKeys: ["title", "quantity"] },
      ],
    };
    expect(serializeEstimateGridSelection(selection, getItem, context)).toBe("Lot 1\t\nLigne a\t2");
  });
});

describe("parseClipboardMatrix", () => {
  it("reads rows, columns and the trailing line break of a spreadsheet", () => {
    expect(parseClipboardMatrix("1\t2\r\n3\t4\r\n")).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(parseClipboardMatrix("123")).toEqual([["123"]]);
    expect(parseClipboardMatrix("")).toEqual([]);
  });

  it("keeps empty cells and reads quoted cells", () => {
    expect(parseClipboardMatrix("a\t\tb")).toEqual([["a", "", "b"]]);
    expect(parseClipboardMatrix('"Tube\ncuivre"\t"dit ""dur"""\n2\t3')).toEqual([
      ["Tube\ncuivre", 'dit "dur"'],
      ["2", "3"],
    ]);
    expect(parseClipboardMatrix('12" écran\t1')).toEqual([['12" écran', "1"]]);
  });
});

describe("planEstimateGridPaste", () => {
  it("writes one value into every cell of the selection", () => {
    const { rows, getItem } = grid([line("a"), line("b"), line("c")]);
    const plan = planEstimateGridPaste(range(["a", "b", "c"], ["k_mo"]), [["1,5"]], rows, getItem, context);
    expect(plan.writes.map((write) => [write.itemId, write.patch])).toEqual([
      ["a", { k_mo: 1.5 }],
      ["b", { k_mo: 1.5 }],
      ["c", { k_mo: 1.5 }],
    ]);
    expect(plan.rejected).toEqual([]);
  });

  it("lays a column from a single cell downwards and drops what falls off the grid", () => {
    const { rows, getItem } = grid([line("a"), section("s", "Lot"), line("b")]);
    const plan = planEstimateGridPaste(single("a", "k_mo"), [["1,1"], ["1,2"], ["1,3"]], rows, getItem, context);
    // The section has no K MO cell: the block continues on the next line.
    expect(plan.writes.map((write) => [write.itemId, write.patch])).toEqual([
      ["a", { k_mo: 1.1 }],
      ["b", { k_mo: 1.2 }],
    ]);
  });

  it("lays a block rightwards in display order and repeats it over a whole multiple", () => {
    const { rows, getItem } = grid([line("a"), line("b"), line("c"), line("d")]);
    const block = planEstimateGridPaste(single("a", "quantity"), [["3", "ml"], ["4", "m2"]], rows, getItem, context);
    expect(block.writes.map((write) => [write.itemId, write.columnKey, write.patch])).toEqual([
      ["a", "quantity", { quantity: 3 }],
      ["a", "unit", { unit_code: "ml" }],
      ["b", "quantity", { quantity: 4 }],
      ["b", "unit", { unit_code: "m2" }],
    ]);

    const repeated = planEstimateGridPaste(
      range(["a", "b", "c", "d"], ["quantity"]),
      [["7"], ["8"]],
      rows,
      getItem,
      context,
    );
    expect(repeated.writes.map((write) => write.patch)).toEqual([
      { quantity: 7 },
      { quantity: 8 },
      { quantity: 7 },
      { quantity: 8 },
    ]);
  });

  it("skips unchanged cells, refuses unreadable text and never writes a computed cell", () => {
    const { rows, getItem } = grid([line("a"), line("b")]);
    const plan = planEstimateGridPaste(
      single("a", "k_mo"),
      [["1", "abc", "12"], ["x", "", ""]],
      rows,
      getItem,
      context,
    );
    // a·k_mo already holds 1; P.U. and total are computed on both lines; b·k_mo cannot be read.
    expect(plan.writes).toEqual([]);
    expect(plan.readOnlyCount).toBe(4);
    expect(plan.rejected.map((entry) => [entry.rowId, entry.columnKey])).toEqual([["b", "k_mo"]]);
    expect(describeEstimateGridPlanLeftovers(plan)).toContain("4 cellules calculées");
    expect(describeEstimateGridPlanLeftovers({ writes: [], rejected: [], readOnlyCount: 0 })).toBeNull();
  });

  it("resolves a type by label or code and refuses an ambiguous or disabled one", () => {
    const { rows, getItem } = grid([line("a"), line("b"), line("c")]);
    const plan = planEstimateGridPaste(
      single("a", "labor_role"),
      [["plombier"], ["Ancien rôle"], [""]],
      rows,
      getItem,
      context,
    );
    expect(plan.writes.map((write) => [write.itemId, write.patch])).toEqual([["a", { labor_role_id: "role-plombier" }]]);
    expect(plan.rejected.map((entry) => entry.rowId)).toEqual(["b"]);
  });

  it("writes a legacy unit as free text with its draft", () => {
    const { rows, getItem } = grid([line("a")]);
    const plan = planEstimateGridPaste(single("a", "unit"), [["ens"]], rows, getItem, { ...context, isV3: false });
    expect(plan.writes).toEqual([
      { itemId: "a", rowId: "a", columnKey: "unit", patch: { description: "ens" }, legacyUnitDraft: "ens" },
    ]);
  });

  it("names a designation pasted blank as the editor does when it is typed empty", () => {
    const { rows, getItem } = grid([section("s", "Lot"), line("a")]);
    const plan = planEstimateGridPaste(range(["s", "a"], ["title"]), [["  "]], rows, getItem, context);
    expect(plan.writes.map((write) => [write.itemId, write.patch])).toEqual([
      ["s", { title: "Sans titre" }],
      ["a", { title: "Nouvelle ligne" }],
    ]);
  });

  it("lays a block that starts on a section title over the columns of the lines under it", () => {
    const { rows, getItem } = grid([section("s", "Lot"), line("a"), line("b")]);
    const plan = planEstimateGridPaste(
      single("s", "title"),
      [["Lot 2", "9"], ["Tube", "3"], ["Coude", "4"]],
      rows,
      getItem,
      context,
    );
    // The section only has a title: its quantity is dropped, the lines take both columns.
    expect(plan.writes.map((write) => [write.itemId, write.patch])).toEqual([
      ["s", { title: "Lot 2" }],
      ["a", { title: "Tube" }],
      ["a", { quantity: 3 }],
      ["b", { title: "Coude" }],
      ["b", { quantity: 4 }],
    ]);
  });

  it("refuses a negative price and a unit outside the referential", () => {
    const { rows, getItem } = grid([line("a")]);
    expect(planEstimateGridPaste(single("a", "unit_price"), [["-3"]], rows, getItem, context).rejected).toHaveLength(1);
    expect(planEstimateGridPaste(single("a", "unit"), [["zzz"]], rows, getItem, context).rejected).toHaveLength(1);
  });
});

describe("planEstimateGridFillDown", () => {
  it("copies the first row of each column down the range", () => {
    const { rows, getItem } = grid([
      line("a", { k_fo: 1.09, labor_role_id: "role-chef" }),
      line("b"),
      line("c", { k_fo: 1.09 }),
    ]);
    const plan = planEstimateGridFillDown(range(["a", "b", "c"], ["k_fo", "labor_role"]), rows, getItem, context);
    expect(plan.writes.map((write) => [write.itemId, write.patch])).toEqual([
      ["b", { k_fo: 1.09 }],
      ["b", { labor_role_id: "role-chef" }],
      ["c", { labor_role_id: "role-chef" }],
    ]);
  });

  it("copies the nearest line above into a single cell, past a section", () => {
    const { rows, getItem } = grid([line("a", { k_fo: 1.04 }), section("s", "Lot"), line("b", { k_fo: 1.2 })]);
    const plan = planEstimateGridFillDown(single("b", "k_fo"), rows, getItem, context);
    expect(plan.writes.map((write) => [write.itemId, write.patch])).toEqual([["b", { k_fo: 1.04 }]]);
    expect(planEstimateGridFillDown(single("a", "k_fo"), rows, getItem, context).writes).toEqual([]);
  });

  it("copies the per-unit hours of the v3 grid and the total hours of the legacy grid", () => {
    const { rows, getItem } = grid([line("a", { h_mo: 3, h_mo_per_unit: 1.5 }), line("b")]);
    const selection = range(["a", "b"], ["h_mo"]);
    expect(planEstimateGridFillDown(selection, rows, getItem, context).writes[0].patch).toEqual({ h_mo_per_unit: 1.5 });
    expect(
      planEstimateGridFillDown(selection, rows, getItem, { ...context, isV3: false }).writes[0].patch,
    ).toEqual({ h_mo: 3 });
  });

  it("does not copy a type that is no longer offered and says why", () => {
    const { rows, getItem } = grid([line("a", { labor_role_id: "role-old" }), line("b"), line("c")]);
    const plan = planEstimateGridFillDown(range(["a", "b", "c"], ["labor_role"]), rows, getItem, context);
    expect(plan.writes).toEqual([]);
    expect(plan.rejected.map((entry) => entry.rowId)).toEqual(["b", "c"]);
    expect(plan.rejected[0].message).toContain("« Ancien rôle »");
  });

  it("fills a line from a line and a section title from a section title", () => {
    const { rows, getItem } = grid([section("s", "Lot 1"), line("a"), section("t", "Lot 2"), line("b")]);
    const fromSection = planEstimateGridFillDown(range(["s", "a", "t", "b"], ["title"]), rows, getItem, context);
    expect(fromSection.writes.map((write) => [write.itemId, write.patch])).toEqual([["t", { title: "Lot 1" }]]);

    const fromLine = planEstimateGridFillDown(range(["a", "t", "b"], ["title"]), rows, getItem, context);
    expect(fromLine.writes.map((write) => [write.itemId, write.patch])).toEqual([["b", { title: "Ligne a" }]]);

    // A single section title takes the nearest section title above, not the line in between.
    const single_ = planEstimateGridFillDown(single("t", "title"), rows, getItem, context);
    expect(single_.writes.map((write) => [write.itemId, write.patch])).toEqual([["t", { title: "Lot 1" }]]);
  });

  it("leaves computed cells alone", () => {
    const { rows, getItem } = grid([line("a"), line("b", { pu_ht_cents: 1 })]);
    const plan = planEstimateGridFillDown(range(["a", "b"], ["pu_ht"]), rows, getItem, context);
    expect(plan.writes).toEqual([]);
    expect(plan.readOnlyCount).toBe(1);
  });
});

describe("planEstimateGridClear", () => {
  it("puts every input back to its empty value and skips what is already empty", () => {
    const { getItem } = grid([line("a"), line("b", { unit_price_ht_cents: 0 })]);
    const plan = planEstimateGridClear(range(["a", "b"], ["unit_price", "k_fo", "pu_ht"]), getItem, context);
    expect(plan.writes.map((write) => [write.itemId, write.patch])).toEqual([
      ["a", { unit_price_ht_cents: 0 }],
      ["a", { k_fo: 1 }],
      ["b", { k_fo: 1 }],
    ]);
    expect(plan.readOnlyCount).toBe(2);
  });

  it("clears a unit and a type to nothing", () => {
    const { getItem } = grid([line("a", { labor_role_id: "role-chef" })]);
    const plan = planEstimateGridClear(range(["a"], ["unit", "labor_role"]), getItem, context);
    expect(plan.writes.map((write) => write.patch)).toEqual([{ unit_code: null }, { labor_role_id: null }]);
  });
});

describe("planEstimateGridClear on a designation", () => {
  it("never leaves a row nameless: the editor's default name is written", () => {
    const { getItem } = grid([section("s", "Lot"), line("a"), line("b", { title: "Nouvelle ligne" })]);
    const plan = planEstimateGridClear(range(["s", "a", "b"], ["title"]), getItem, context);
    expect(plan.writes.map((write) => [write.itemId, write.patch])).toEqual([
      ["s", { title: "Sans titre" }],
      ["a", { title: "Nouvelle ligne" }],
    ]);
  });
});

describe("groupEstimateGridWrites", () => {
  it("merges the cells of one line into one patch", () => {
    const { rows, getItem } = grid([line("a"), line("b")]);
    const plan = planEstimateGridPaste(single("a", "quantity"), [["3", "ml"], ["4", "m2"]], rows, getItem, context);
    expect(groupEstimateGridWrites(plan.writes)).toEqual([
      { itemId: "a", patch: { quantity: 3, unit_code: "ml" } },
      { itemId: "b", patch: { quantity: 4, unit_code: "m2" } },
    ]);
  });
});
