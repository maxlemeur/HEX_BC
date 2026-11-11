import { describe, expect, it } from "vitest";

import type { CadModel, CadModelObject } from "./fcstd";
import { cadDimensionLabel, cadDimensionValue, cadModelCsv, cadModelKinds } from "./model-quantities";

const object = (label: string, kind: string, dimensions: CadModelObject["dimensions"] = [], type = "Part::FeaturePython"): CadModelObject => ({ name: label, label, type, kind, dimensions });
const length = (value: number, name = "Length") => ({ name, kind: "length" as const, value });
const model = (objects: CadModelObject[], more: Partial<CadModel> = {}): CadModel => ({ objects, total: objects.length, sketches: 0, truncated: false, left: { objects: false, sketches: false, unread: false, dimensions: false }, ...more });

describe("cadModelKinds", () => {
  it("counts the objects of each kind, the most numerous first, then by name", () => {
    const rows = cadModelKinds(model([object("a", "Wall"), object("b", "Pipe Segment"), object("c", "Pipe Segment"), object("d", "Élément"), object("e", "Box")]));
    expect(rows.map((row) => [row.kind, row.count])).toEqual([["Pipe Segment", 2], ["Box", 1], ["Élément", 1], ["Wall", 1]]);
  });

  it("adds up the lengths FreeCAD wrote, and says how many objects gave one", () => {
    const rows = cadModelKinds(model([
      object("Départ", "Pipe Segment", [length(33.7, "Diameter"), length(4250.5)]),
      object("Retour", "Pipe Segment", [length(33.7, "Diameter"), length(1749.5)]),
      object("Piquage", "Pipe Segment", [length(21.3, "Diameter")]),
      object("Mur", "Wall", [{ name: "HorizontalArea", kind: "area", value: 1.2e6 }]),
    ]));
    expect(rows).toEqual([
      { kind: "Pipe Segment", count: 3, length: { total: 6000, objects: 2 } },
      { kind: "Wall", count: 1, length: null },
    ]);
  });

  it("is not fooled by a kind named like a property of Object", () => {
    expect(cadModelKinds(model([object("a", "constructor"), object("b", "__proto__"), object("c", "constructor")])).map((row) => [row.kind, row.count]))
      .toEqual([["constructor", 2], ["__proto__", 1]]);
  });
});

describe("dimensions", () => {
  it("names in French the dimensions FreeCAD names most, and leaves the others as written", () => {
    expect(cadDimensionLabel("Length")).toBe("Longueur");
    expect(cadDimensionLabel("HorizontalArea")).toBe("Surface horizontale");
    expect(cadDimensionLabel("RiserHeight")).toBe("RiserHeight");
    expect(cadDimensionLabel("constructor")).toBe("constructor");
  });

  it("gives lengths in millimetres, areas in m², volumes in m³ and angles in degrees", () => {
    expect(cadDimensionValue(length(4250.5))).toEqual({ value: 4250.5, unit: "mm" });
    expect(cadDimensionValue({ name: "Area", kind: "area", value: 1.2e6 })).toEqual({ value: 1.2, unit: "m²" });
    expect(cadDimensionValue({ name: "Volume", kind: "volume", value: 3e9 })).toEqual({ value: 3, unit: "m³" });
    expect(cadDimensionValue({ name: "Angle", kind: "angle", value: 90 })).toEqual({ value: 90, unit: "°" });
  });
});

describe("cadModelCsv", () => {
  it("writes one line a dimension, and one for an object without any, as Excel opens them", () => {
    const csv = cadModelCsv(model([
      object("Départ chauffage", "Pipe Segment", [length(33.7, "Diameter"), length(4250.5)]),
      object("Mur étanche", "Wall", [{ name: "HorizontalArea", kind: "area", value: 1234567 }, { name: "Volume", kind: "volume", value: 3e9 }, { name: "Angle", kind: "angle", value: 90 }]),
      object("Tracé", "Wire", [], "Part::Part2DObjectPython"),
    ]));
    expect(csv).toBe([
      "﻿Objet;Nature;Type FreeCAD;Dimension;Valeur;Unité",
      "Départ chauffage;Pipe Segment;Part::FeaturePython;Diamètre;33,7;mm",
      "Départ chauffage;Pipe Segment;Part::FeaturePython;Longueur;4250,5;mm",
      "Mur étanche;Wall;Part::FeaturePython;Surface horizontale;1,235;m²",
      "Mur étanche;Wall;Part::FeaturePython;Volume;3;m³",
      "Mur étanche;Wall;Part::FeaturePython;Angle;90;°",
      "Tracé;Wire;Part::Part2DObjectPython;;;",
      "",
    ].join("\r\n"));
  });

  it("never writes as zero a dimension the model gives, however small", () => {
    const csv = cadModelCsv(model([object("Percement", "Hole", [{ name: "Area", kind: "area", value: 314 }, { name: "Volume", kind: "volume", value: 125000 }, length(0.0004), length(-0.0001, "Offset"), length(1234567.891, "Run")])]));
    expect(csv.split("\r\n").slice(1, 6).map((line) => line.split(";").slice(3).join(";"))).toEqual(["Surface;0,000314;m²", "Volume;0,000125;m³", "Longueur;0,0004;mm", "Offset;-0,0001;mm", "Run;1234567,891;mm"]);
  });

  it("writes no cell a spreadsheet would run, and quotes one that holds a separator", () => {
    const csv = cadModelCsv(model([object("=HYPERLINK(\"http://exemple.invalid\")", "@Wall;x", [length(1, "+Length")], "-Part")]));
    expect(csv.split("\r\n")[1]).toBe("\"'=HYPERLINK(\"\"http://exemple.invalid\"\")\";\"'@Wall;x\";'-Part;'+Length;1;mm");
  });
});
