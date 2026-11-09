import { describe, expect, it } from "vitest";

import { readDxf } from "@/lib/cad/dxf";
import { circle, dxfBytes, hatch, insert, layer, line, lwpolyline, rec, text, type DxfFixture } from "@/lib/cad/dxf.test-utils";
import { cadQuantitiesCsv, cadUsedLayers, measureCadDrawing } from "@/lib/cad/quantities";

const read = (fixture: DxfFixture) => readDxf(dxfBytes(fixture));

describe("measureCadDrawing: lengths", () => {
  it("adds the tracé of each layer in metres, from the unit of the file", () => {
    const quantities = measureCadDrawing(read({
      layers: [layer("EF", 5), layer("EU", 30)],
      entities: [line("EF", 0, 0, 3000, 0), lwpolyline("EF", [[0, 0], [0, 1000], [500, 1000]]), line("EU", 0, 0, 0, 2500)],
    }));
    expect(quantities.unit).toBe("m");
    expect(quantities.metresPerUnit).toBe(0.001);
    expect(quantities.layers.map((row) => [row.name, row.length, row.paths])).toEqual([["EF", 4.5, 2], ["EU", 2.5, 1]]);
    expect(quantities.totals.length).toBeCloseTo(7, 9);
  });

  it("keeps apart the tracé that comes from block references", () => {
    const quantities = measureCadDrawing(read({
      layers: [layer("EF", 5)],
      blocks: [{ name: "Te", entities: [line("0", 0, 0, 200, 0), line("0", 100, 0, 100, 100)] }],
      entities: [line("EF", 0, 0, 1000, 0), insert("EF", "Te", 0, 0), insert("EF", "Te", 500, 0, [41, 2], [42, 2])],
    }));
    expect(quantities.layers).toEqual([expect.objectContaining({ name: "EF", length: 1, blockLength: expect.closeTo(0.9, 9), paths: 5 })]);
    expect(quantities.totals).toMatchObject({ length: 1, blockLength: expect.closeTo(0.9, 9) });
  });

  it("counts neither dimensions, leaders, fills nor hatch outlines as tracé", () => {
    const quantities = measureCadDrawing(read({
      blocks: [{ name: "*D1", flags: 1, entities: [line("0", 0, 0, 5000, 0)] }],
      entities: [
        rec("DIMENSION", [8, "COTES"], [2, "*D1"], [10, 0], [20, 0], [30, 0], [70, 32], [1, ""]),
        rec("LEADER", [8, "COTES"], [76, 2], [10, 0], [20, 0], [10, 1000], [20, 0]),
        rec("SOLID", [8, "COTES"], [10, 0], [20, 0], [11, 1000], [21, 0], [12, 0], [22, 1000], [13, 1000], [23, 1000]),
        hatch("COTES", [[0, 0], [1000, 0], [1000, 1000], [0, 1000]]),
      ],
    }));
    expect(quantities.layers).toEqual([expect.objectContaining({ name: "COTES", length: 0, blockLength: 0, paths: 0, closedArea: 0, hatchArea: 1 })]);
  });

  it("keeps drawing units when the file gives none, and converts with the unit the user picks", () => {
    const drawing = read({ header: [[9, "$ACADVER"], [1, "AC1027"]], entities: [line("EF", 0, 0, 250, 0), circle("EF", 0, 0, 100)] });
    const raw = measureCadDrawing(drawing);
    expect(raw).toMatchObject({ unit: "unité", metresPerUnit: null });
    expect(raw.layers[0].length).toBeCloseTo(250 + 200 * Math.PI, 9);
    expect(raw.extents).toEqual({ width: 350, height: 200 });
    const picked = measureCadDrawing(drawing, { metresPerUnit: 0.01 });
    expect(picked.unit).toBe("m");
    expect(picked.layers[0].length).toBeCloseTo(2.5 + 2 * Math.PI, 9);
    expect(picked.layers[0].closedArea).toBeCloseTo(Math.PI, 9);
    expect(picked.extents).toEqual({ width: 3.5, height: 2 });
  });
});

describe("measureCadDrawing: areas", () => {
  it("adds closed outlines and takes the holes off the hatches", () => {
    const quantities = measureCadDrawing(read({
      header: [[9, "$INSUNITS"], [70, 6]],
      entities: [
        lwpolyline("LOCAL", [[0, 0], [4, 0], [4, 3], [0, 3]], true), lwpolyline("LOCAL", [[0, 0], [4, 0], [4, 3]]),
        hatch("SOL", [[0, 0], [10, 0], [10, 10], [0, 10]], [[4, 4], [6, 4], [6, 6], [4, 6]]),
      ],
    }));
    expect(quantities.layers.map((row) => [row.name, row.closedArea, row.hatchArea])).toEqual([["LOCAL", 12, 0], ["SOL", 0, 96]]);
    expect(quantities.totals).toMatchObject({ closedArea: 12, hatchArea: 96 });
  });
});

describe("measureCadDrawing: blocks", () => {
  const fixture: DxfFixture = {
    layers: [layer("SANITAIRES", 3), layer("MOBILIER", 8)],
    blockRecords: [rec("BLOCK_RECORD", [5, "2A"], [2, "Lavabo"]), rec("BLOCK_RECORD", [5, "3F"], [2, "*U7"], [1001, "AcDbBlockRepBTag"], [1070, 1], [1005, "2A"])],
    blocks: [
      { name: "WC", entities: [circle("0", 0, 0, 200)] },
      { name: "Lavabo", entities: [circle("0", 0, 0, 150)] },
      { name: "*U7", flags: 1, entities: [circle("0", 0, 0, 160)] },
      { name: "*U9", flags: 1, entities: [circle("0", 0, 0, 10)] },
      { name: "Salle de bains", entities: [insert("SANITAIRES", "WC", 0, 0), insert("SANITAIRES", "Lavabo", 1000, 0)] },
      { name: "Fond", flags: 4, entities: [] },
    ],
    entities: [
      insert("SANITAIRES", "WC", 0, 0), insert("SANITAIRES", "wc", 5000, 0), insert("MOBILIER", "WC", 9000, 0),
      insert("SANITAIRES", "*U7", 0, 3000), insert("SANITAIRES", "Lavabo", 0, 6000), insert("SANITAIRES", "*U9", 0, 9000),
      insert("MOBILIER", "Salle de bains", 20000, 0), insert("MOBILIER", "Salle de bains", 30000, 0, [70, 2], [44, 5000]),
      insert("0", "Fond", 0, 0),
    ],
  };

  it("counts the references by block and layer, nested ones included, a dynamic block under its name", () => {
    const { blocks, totals } = measureCadDrawing(read(fixture));
    expect(blocks.map((row) => [row.label, row.layerName, row.count, row.nested, row.unnamed])).toEqual([
      ["*U9", "SANITAIRES", 1, 0, true],
      ["Lavabo", "SANITAIRES", 5, 3, false],
      ["Salle de bains", "MOBILIER", 3, 0, false],
      ["WC", "MOBILIER", 1, 0, false],
      ["WC", "SANITAIRES", 5, 3, false],
    ]);
    expect(totals.blocks).toBe(15);
  });

  it("leaves out what the hidden layers hold: their tracé, their references and what these contain", () => {
    const drawing = read({ ...fixture, entities: [...(fixture.entities ?? []), line("MOBILIER", 0, 0, 1000, 0), line("SANITAIRES", 0, 0, 2000, 0)] });
    const shown = drawing.layers.map((entry) => entry.name !== "MOBILIER");
    const { blocks, layers } = measureCadDrawing(drawing, { shown });
    expect(blocks.map((row) => [row.label, row.layerName, row.count])).toEqual([["*U9", "SANITAIRES", 1], ["Lavabo", "SANITAIRES", 2], ["WC", "SANITAIRES", 2]]);
    expect(layers.map((row) => row.name)).toEqual(["SANITAIRES"]);
    expect(layers[0].length).toBe(2);
  });

  it("follows the layers the file hides unless told otherwise", () => {
    const drawing = read({ layers: [rec("LAYER", [2, "GELE"], [70, 1], [62, 2])], entities: [line("GELE", 0, 0, 1000, 0), line("EF", 0, 0, 1000, 0)] });
    expect(measureCadDrawing(drawing).layers.map((row) => row.name)).toEqual(["EF"]);
    expect(measureCadDrawing(drawing, { shown: drawing.layers.map(() => true) }).layers.map((row) => row.name)).toEqual(["EF", "GELE"]);
  });
});

describe("measureCadDrawing: partial readings", () => {
  it("says when the drawing was not read to its end", () => {
    expect(measureCadDrawing(read({ entities: [line("EF", 0, 0, 1000, 0)] })).partial).toBe(false);
    expect(measureCadDrawing(read({ entities: [line("EF", 0, 0, 1000, 0)], eof: false })).partial).toBe(true);
  });

  it("returns empty tables for an empty drawing", () => {
    expect(measureCadDrawing(read({}))).toMatchObject({ layers: [], blocks: [], extents: null, totals: { length: 0, blockLength: 0, closedArea: 0, hatchArea: 0, blocks: 0 } });
  });
});

describe("cadUsedLayers", () => {
  it("lists by name the layers that draw, write or place something, the one a block reference sits on included", () => {
    const drawing = read({
      layers: [layer("Vide"), layer("Textes"), layer("EF", 5), layer("Appareils"), layer("Détail")],
      blocks: [{ name: "WC", entities: [line("Détail", 0, 0, 100, 0)] }],
      entities: [line("EF", 0, 0, 1000, 0), text("Textes", 0, 0, 100, "R+1"), insert("Appareils", "WC", 0, 0)],
    });
    expect(cadUsedLayers(drawing).map((index) => drawing.layers[index].name)).toEqual(["Appareils", "Détail", "EF", "Textes"]);
  });

  it("lists nothing for a drawing without a tracé", () => {
    expect(cadUsedLayers(read({ layers: [layer("EF")], entities: [] }))).toEqual([]);
  });
});

describe("cadQuantitiesCsv", () => {
  it("writes one line per quantity, with French decimals and a separator Excel opens", () => {
    const csv = cadQuantitiesCsv(measureCadDrawing(read({
      layers: [layer("EF", 5)],
      blocks: [{ name: "Vanne", entities: [line("0", 0, 0, 100, 0)] }],
      entities: [line("EF", 0, 0, 12340, 0), insert("EF", "Vanne", 0, 0), lwpolyline("EF", [[0, 0], [2000, 0], [2000, 1500], [0, 1500]], true)],
    })));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Nature;Calque;Désignation;Quantité;Unité",
      "Longueur;EF;Tracé direct;19,34;m",
      "Longueur;EF;Tracé des blocs;0,10;m",
      "Surface;EF;Contours fermés;3,00;m²",
      "Bloc;EF;Vanne;1;u",
      "",
    ]);
  });

  it("quotes separators and defuses names a spreadsheet would run as a formula", () => {
    const csv = cadQuantitiesCsv(measureCadDrawing(read({
      header: [[9, "$ACADVER"], [1, "AC1027"]],
      blocks: [{ name: "=HYPERLINK(\"x\")", entities: [] }],
      entities: [line("EF;EFS", 0, 0, 10, 0), insert("EF;EFS", "=HYPERLINK(\"x\")", 0, 0)],
    })));
    expect(csv).toContain("Longueur;\"EF;EFS\";Tracé direct;10,00;unité");
    expect(csv).toContain("Bloc;\"EF;EFS\";\"'=HYPERLINK(\"\"x\"\")\";1;u");
  });
});
