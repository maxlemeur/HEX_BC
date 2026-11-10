import { describe, expect, it } from "vitest";

import { cadLayerSummary, cadPlotFileName, cadPlotMessage, cadQuantitiesFileName, cadReadMessage, cadUnitChoices, cadWarningMessages, formatCadQuantity } from "@/lib/cad/messages";
import type { CadWarningCode } from "@/lib/cad/model";

describe("cadReadMessage", () => {
  it.each(["empty", "too_large", "binary_dxf", "not_dxf", "not_dwg", "not_rvt", "unsupported"])("says what to do about %s", (reason) => {
    const message = cadReadMessage(reason);
    expect(message).not.toBe(cadReadMessage("failed"));
    expect(message).not.toContain(reason);
    expect(message.endsWith(".")).toBe(true);
  });

  it("tells how to get a DXF that can be read from a binary one", () => {
    expect(cadReadMessage("binary_dxf")).toContain("DXF ASCII");
  });

  it("falls back on one sentence for what it does not know, a name of Object included", () => {
    expect(cadReadMessage("toString")).toBe(cadReadMessage("failed"));
    expect(cadReadMessage("no_drawing")).toBe(cadReadMessage("failed"));
  });
});

describe("cadPlotMessage", () => {
  it.each(["truncated", "unknown_unit", "invalid_denominator", "empty", "does_not_fit", "too_large", "no_drawing"])("says what to do about %s", (reason) => {
    const message = cadPlotMessage(reason);
    expect(message).not.toBe(cadPlotMessage("failed"));
    expect(message).not.toContain(reason);
    expect(message.endsWith(".")).toBe(true);
  });

  it("does not confuse a file too heavy to read with a plot too heavy to keep", () => {
    expect(cadPlotMessage("too_large")).not.toBe(cadReadMessage("too_large"));
    expect(cadPlotMessage("unknown_unit")).toContain("unité");
    expect(cadPlotMessage("constructor")).toBe(cadPlotMessage("failed"));
  });
});

describe("cadWarningMessages", () => {
  const codes: CadWarningCode[] = [
    "truncated_file", "limit_entities", "limit_points", "limit_texts", "limit_inserts",
    "missing_block", "xref_missing", "block_cycle", "depth_limit", "spline_fit_points",
  ];

  it.each(codes)("has a sentence for %s", (code) => {
    const [message, ...others] = cadWarningMessages([{ code, detail: "3" }]);
    expect(others).toEqual([]);
    expect(message).not.toContain(code);
    expect(message.endsWith(".")).toBe(true);
  });

  it("says nothing of a drawing read without a warning", () => {
    expect(cadWarningMessages([])).toEqual([]);
  });

  it("names the blocks of one kind of warning in one sentence", () => {
    const messages = cadWarningMessages([
      { code: "missing_block", detail: "VANNE" },
      { code: "xref_missing", detail: "FOND-ARCHI" },
      { code: "missing_block", detail: "WC" },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("VANNE, WC");
    expect(messages[1]).toContain("FOND-ARCHI");
  });

  it("names five blocks at most and counts the others", () => {
    const [message] = cadWarningMessages(Array.from({ length: 8 }, (_, index) => ({ code: "missing_block" as const, detail: `B${index}` })));
    expect(message).toContain("B0, B1, B2, B3, B4 et 3 autres");
    expect(message).not.toContain("B5");
  });

  it("counts the splines whose length is approached", () => {
    expect(cadWarningMessages([{ code: "spline_fit_points", detail: "1" }])[0]).toContain("1 spline ");
    expect(cadWarningMessages([{ code: "spline_fit_points", detail: "12" }])[0]).toContain("12 splines ");
  });

  it("does not repeat a name it does not know how to read", () => {
    const unknown = { code: "constructor", detail: "x" } as unknown as { code: CadWarningCode };
    expect(cadWarningMessages([unknown])).toEqual([]);
  });
});

describe("cadUnitChoices", () => {
  it("offers the usual units and none, the file's one first chosen", () => {
    const choices = cadUnitChoices({ code: 4, metresPerUnit: 0.001, name: "millimètre" });
    expect(choices.map((choice) => choice.label)).toEqual(["Millimètres (unité du fichier)", "Centimètres", "Mètres", "Unités du dessin"]);
    expect(choices.map((choice) => choice.metresPerUnit)).toEqual([0.001, 0.01, 1, null]);
    expect(choices.filter((choice) => choice.fromFile).map((choice) => choice.value)).toEqual(["0.001"]);
    expect(new Set(choices.map((choice) => choice.value)).size).toBe(choices.length);
  });

  it("adds the file's unit when it is not a usual one", () => {
    const choices = cadUnitChoices({ code: 1, metresPerUnit: 0.0254, name: "pouce" });
    expect(choices[0]).toEqual({ value: "0.0254", label: "Pouce (unité du fichier)", metresPerUnit: 0.0254, fromFile: true });
    expect(choices).toHaveLength(5);
  });

  it("starts in drawing units when the file gives none", () => {
    const choices = cadUnitChoices({ code: 0, metresPerUnit: null, name: "sans unité" });
    expect(choices.map((choice) => choice.label)).toEqual(["Unités du dessin (le fichier n’en donne pas)", "Millimètres", "Centimètres", "Mètres"]);
    expect(choices[0]).toMatchObject({ value: "", metresPerUnit: null, fromFile: true });
  });
});

describe("formatCadQuantity", () => {
  it("writes a quantity as it is read in France", () => {
    expect(formatCadQuantity(1234.5678)).toBe("1 234,57");
    expect(formatCadQuantity(12)).toBe("12");
    expect(formatCadQuantity(0.004)).toBe("0");
    expect(formatCadQuantity(-0)).toBe("0");
  });
});

describe("cadLayerSummary", () => {
  it("counts in French, singular and plural", () => {
    expect(cadLayerSummary({ layers: 1, length: 12, unit: "m", blocks: 1 })).toBe("1 calque · 12 m de tracé · 1 bloc");
    expect(cadLayerSummary({ layers: 3, length: 1234.5, unit: "m", blocks: 0 })).toBe("3 calques · 1 234,5 m de tracé");
    expect(cadLayerSummary({ layers: 2, length: 80, unit: "unité", blocks: 4 })).toBe("2 calques · 80 unités de tracé · 4 blocs");
    expect(cadLayerSummary({ layers: 0, length: 0, unit: "m", blocks: 0 })).toBe("Aucun calque affiché");
  });
});

describe("file names", () => {
  it("names the plotted PDF after the original and its scale", () => {
    expect(cadPlotFileName("Réseaux EF.DXF", 50)).toBe("Réseaux EF (tracé 1-50).pdf");
    expect(cadPlotFileName("plan", 100)).toBe("plan (tracé 1-100).pdf");
  });

  it("names the quantities after the original", () => {
    expect(cadQuantitiesFileName("Réseaux EF.dxf")).toBe("Réseaux EF - quantités.csv");
  });

  it("keeps a name the dossier accepts when the original's is very long", () => {
    const name = cadPlotFileName(`${"a".repeat(300)}.dxf`, 2500);
    expect(name.length).toBeLessThanOrEqual(160);
    expect(name.endsWith(" (tracé 1-2500).pdf")).toBe(true);
  });
});
