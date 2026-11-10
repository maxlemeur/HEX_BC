// What is counted of the objects of a model: how many of each kind, the
// lengths FreeCAD wrote for them, and the file a spreadsheet opens with every
// object and its dimensions. Nothing is computed from a shape: a dimension is
// a number the software saved with the object.

import type { CadModel, CadModelDimension } from "./fcstd";
import { cadCsvCell } from "./quantities";

export type CadModelKindRow = {
  kind: string;
  count: number;
  /** The sum, in millimetres, of the « Length » of the objects that have one, and how many do; null when none has. */
  length: { total: number; objects: number } | null;
};

const byName = (a: string, b: string) => a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);

/** The kinds of objects, the most numerous first. */
export function cadModelKinds(model: CadModel): CadModelKindRow[] {
  const rows = new Map<string, CadModelKindRow>();
  for (const entry of model.objects) {
    let row = rows.get(entry.kind);
    if (!row) rows.set(entry.kind, (row = { kind: entry.kind, count: 0, length: null }));
    row.count += 1;
    const length = entry.dimensions.find((dimension) => dimension.kind === "length" && dimension.name === "Length");
    if (length) row.length = { total: (row.length?.total ?? 0) + length.value, objects: (row.length?.objects ?? 0) + 1 };
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || byName(a.kind, b.kind));
}

const DIMENSION_LABELS = new Map([
  ["Length", "Longueur"], ["Width", "Largeur"], ["Height", "Hauteur"], ["Diameter", "Diamètre"], ["Radius", "Rayon"], ["Thickness", "Épaisseur"],
  ["Area", "Surface"], ["HorizontalArea", "Surface horizontale"], ["VerticalArea", "Surface verticale"], ["PerimeterLength", "Périmètre"],
  ["Volume", "Volume"], ["Angle", "Angle"],
]);

/** The French name of a dimension FreeCAD names in English; its own name when it is not one of the usual ones. */
export function cadDimensionLabel(name: string): string {
  return DIMENSION_LABELS.get(name) ?? name;
}

export type CadDimensionUnit = "mm" | "m²" | "m³" | "°";

/** A dimension in the unit it is read in on a site: FreeCAD saves millimetres, mm² and mm³. */
export function cadDimensionValue(dimension: CadModelDimension): { value: number; unit: CadDimensionUnit } {
  if (dimension.kind === "area") return { value: dimension.value / 1e6, unit: "m²" };
  if (dimension.kind === "volume") return { value: dimension.value / 1e9, unit: "m³" };
  return { value: dimension.value, unit: dimension.kind === "angle" ? "°" : "mm" };
}

/**
 * A dimension as it is written in France: three decimals for what is counted in units, and three
 * significant digits below one, so that a small hole or a small volume is never written as zero.
 */
export function cadDimensionNumber(value: number, grouped: boolean): string {
  return value.toLocaleString("fr-FR", { ...(Math.abs(value) >= 1 ? { maximumFractionDigits: 3 } : { maximumSignificantDigits: 3 }), useGrouping: grouped });
}

/** Every object with its dimensions as a CSV file Excel opens as is: semicolons, decimal commas, UTF-8 with its mark. */
export function cadModelCsv(model: CadModel): string {
  const lines = ["Objet;Nature;Type FreeCAD;Dimension;Valeur;Unité"];
  for (const entry of model.objects) {
    const head = `${cadCsvCell(entry.label)};${cadCsvCell(entry.kind)};${cadCsvCell(entry.type)}`;
    if (entry.dimensions.length === 0) lines.push(`${head};;;`);
    for (const dimension of entry.dimensions) {
      const { value, unit } = cadDimensionValue(dimension);
      lines.push(`${head};${cadCsvCell(cadDimensionLabel(dimension.name))};${cadDimensionNumber(value, false)};${unit}`);
    }
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
