import { describe, expect, it } from "vitest";

import type { IfcModel, IfcRow } from "./ifc";
import { ifcClassLabel, ifcLengthLabel, ifcModelSummary, ifcQuantities, ifcQuantitiesCsv, ifcSectionLabel, ifcStoreyLabel } from "./ifc-quantities";

const row = (cls: number, type: string, storey: number, count: number, more: Partial<IfcRow> = {}): IfcRow =>
  ({ cls, type, section: null, storey, count, length: 0, lengths: 0, stated: 0, approximate: 0, area: 0, areas: 0, volume: 0, volumes: 0, ...more });

const model = (rows: IfcRow[], more: Partial<IfcModel> = {}): IfcModel => ({
  schema: "IFC4",
  application: "Atelier fictif 1.0",
  classes: ["IfcPipeFitting", "IfcPipeSegment", "IfcWall"],
  storeys: [{ name: "Sous-sol", elevation: -3 }, { name: "Rez-de-chaussée", elevation: 0 }],
  rows,
  elements: rows.reduce((sum, entry) => sum + entry.count, 0),
  counted: rows.reduce((sum, entry) => sum + entry.count, 0),
  truncated: { elements: false, rows: false, geometry: false, apart: false },
  mesh: null,
  ...more,
});

const BOILER_ROOM = model([
  row(0, "Coude PVC:87°", 1, 2),
  row(1, "Flexible:Raccordement", 0, 1, { length: 1.2, lengths: 1, approximate: 1 }),
  row(1, "Tuyau PVC:Évacuation", 0, 2, { section: [110], length: 3.5, lengths: 2 }),
  row(1, "Tuyau PVC:Évacuation", 1, 3, { section: [110], length: 6.06, lengths: 3 }),
  row(1, "Tuyau PVC:Évacuation", -1, 1, { section: [110] }),
  row(2, "", 1, 1, { length: 5, lengths: 1, stated: 1, area: 13.14, areas: 1, volume: 2.628, volumes: 1 }),
]);

const everything = { storey: null, shown: [true, true, true] };

describe("ifcQuantities", () => {
  it("adds up over the storeys the elements of one class, type and section", () => {
    const quantities = ifcQuantities(BOILER_ROOM, everything);

    expect(quantities.rows.map(({ cls, type, section, count, length, lengths, approximate }) => [cls, type, section, count, Math.round(length * 100) / 100, lengths, approximate])).toEqual([
      [0, "Coude PVC:87°", null, 2, 0, 0, 0],
      [1, "Flexible:Raccordement", null, 1, 1.2, 1, 1],
      [1, "Tuyau PVC:Évacuation", [110], 6, 9.56, 5, 0],
      [2, "", null, 1, 5, 1, 0],
    ]);
    expect(quantities.totals).toEqual({ elements: 10, length: expect.closeTo(15.76, 6) });
    expect(quantities.columns).toEqual({ area: true, volume: true });
  });

  it("keeps to one storey, or to what is on none", () => {
    const basement = ifcQuantities(BOILER_ROOM, { ...everything, storey: 0 });
    expect(basement.rows.map(({ type, count }) => [type, count])).toEqual([["Flexible:Raccordement", 1], ["Tuyau PVC:Évacuation", 2]]);
    expect(basement.totals).toEqual({ elements: 3, length: expect.closeTo(4.7, 6) });
    expect(basement.columns).toEqual({ area: false, volume: false });

    expect(ifcQuantities(BOILER_ROOM, { ...everything, storey: -1 }).rows.map(({ type, count }) => [type, count])).toEqual([["Tuyau PVC:Évacuation", 1]]);
  });

  it("leaves out the classes that are hidden, and still says how many elements each class has on the storey", () => {
    const quantities = ifcQuantities(BOILER_ROOM, { storey: 1, shown: [true, false, true] });

    expect(quantities.rows.map(({ cls, count }) => [cls, count])).toEqual([[0, 2], [2, 1]]);
    expect(quantities.totals.elements).toBe(3);
    expect(quantities.classes).toEqual([
      { cls: 0, name: "IfcPipeFitting", label: "Raccords de tuyauterie", count: 2 },
      { cls: 1, name: "IfcPipeSegment", label: "Tuyaux", count: 3 },
      { cls: 2, name: "IfcWall", label: "Murs", count: 1 },
    ]);
  });

  it("takes a class without a say as shown, and a storey the model does not have as none", () => {
    expect(ifcQuantities(BOILER_ROOM, { storey: null, shown: [] }).totals.elements).toBe(10);
    expect(ifcQuantities(BOILER_ROOM, { storey: 7, shown: [] }).rows).toEqual([]);
  });
});

describe("what is written of an IFC model", () => {
  it("names the usual classes in French and leaves the others as the file names them", () => {
    expect(ifcClassLabel("IfcFlowSegment")).toBe("Tuyaux, gaines et chemins de câbles");
    expect(ifcClassLabel("IfcSanitaryTerminal")).toBe("Appareils sanitaires");
    expect(ifcClassLabel("IfcSomethingNew")).toBe("IfcSomethingNew");
    expect(ifcClassLabel("constructor")).toBe("constructor");
  });

  it("writes a section as it is read on a site", () => {
    expect(ifcSectionLabel([110])).toBe("Ø 110 mm");
    expect(ifcSectionLabel([19.1])).toBe("Ø 19,1 mm");
    expect(ifcSectionLabel([400, 350])).toBe("400 × 350 mm");
    expect(ifcSectionLabel(null)).toBe("");
  });

  it("writes a length with what it is worth", () => {
    expect(ifcLengthLabel({ count: 3, length: 6.06, lengths: 3, approximate: 0 })).toBe("6,06 m");
    // Measured on the mesh: approximate.
    expect(ifcLengthLabel({ count: 1, length: 1.2, lengths: 1, approximate: 1 })).toBe("≈ 1,2 m");
    // One element of the six has no length.
    expect(ifcLengthLabel({ count: 6, length: 9.56, lengths: 5, approximate: 0 })).toBe("9,56 m (5 sur 6)");
    expect(ifcLengthLabel({ count: 2, length: 0, lengths: 0, approximate: 0 })).toBe("");
  });

  it("names a storey, and what is in none", () => {
    expect(ifcStoreyLabel(BOILER_ROOM, 1)).toBe("Rez-de-chaussée");
    expect(ifcStoreyLabel(BOILER_ROOM, -1)).toBe("Hors niveau");
    expect(ifcStoreyLabel(BOILER_ROOM, 9)).toBe("Hors niveau");
  });

  it("sums up a model in one line", () => {
    expect(ifcModelSummary(BOILER_ROOM)).toBe("IFC4 · 10 éléments · 2 niveaux");
    expect(ifcModelSummary(model([row(0, "", -1, 1)], { storeys: [{ name: "RDC", elevation: 0 }], elements: 1234 }))).toBe("IFC4 · 1\u202f234 éléments · 1 niveau");
    expect(ifcModelSummary(model([], { storeys: [] }))).toBe("IFC4 · Aucun élément");
  });
});

describe("ifcQuantitiesCsv", () => {
  it("writes one line for each class, type, section and storey shown, as a file Excel opens as is", () => {
    const csv = ifcQuantitiesCsv(BOILER_ROOM, { storey: null, shown: [true, true, false] });

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Classe IFC;Nature;Type;Section;Niveau;Nombre;Longueur (m);Longueurs approchées;Surface (m²);Volume (m³)",
      "IfcPipeFitting;Raccords de tuyauterie;Coude PVC:87°;;Rez-de-chaussée;2;;;;",
      "IfcPipeSegment;Tuyaux;Flexible:Raccordement;;Sous-sol;1;1,2;1;;",
      "IfcPipeSegment;Tuyaux;Tuyau PVC:Évacuation;Ø 110 mm;Sous-sol;2;3,5;;;",
      "IfcPipeSegment;Tuyaux;Tuyau PVC:Évacuation;Ø 110 mm;Rez-de-chaussée;3;6,06;;;",
      "IfcPipeSegment;Tuyaux;Tuyau PVC:Évacuation;Ø 110 mm;Hors niveau;1;;;;",
      "",
    ]);
  });

  it("writes the declared area and volume, and keeps to the chosen storey", () => {
    const lines = ifcQuantitiesCsv(BOILER_ROOM, { storey: 1, shown: [false, false, true] }).slice(1).split("\r\n");

    expect(lines.slice(1)).toEqual(["IfcWall;Murs;;;Rez-de-chaussée;1;5;;13,14;2,628", ""]);
  });

  it("lets no name of the model run as a formula or break out of its cell", () => {
    const hostile = model([row(0, "=HYPERLINK(\"http://example.test\")", 0, 1), row(0, "a;b\nc", 0, 1)], { storeys: [{ name: "+1", elevation: 0 }] });
    const lines = ifcQuantitiesCsv(hostile, { storey: null, shown: [] }).slice(1).split("\r\n");

    expect(lines[1]).toBe("IfcPipeFitting;Raccords de tuyauterie;\"'=HYPERLINK(\"\"http://example.test\"\")\";;'+1;1;;;;");
    expect(lines[2]).toBe("IfcPipeFitting;Raccords de tuyauterie;\"a;b\nc\";;'+1;1;;;;");
  });
});
