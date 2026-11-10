// Quantities read from a drawing: tracé lengths and areas per layer, block
// references per block and layer. Nothing is interpreted here: which layer is
// a network and what a block stands for is decided by the métré.

import { CAD_PATH_CLOSED, cadOpenGates, type CadDrawing } from "./model";

export type CadLayerQuantity = {
  layer: number;
  name: string;
  color: number;
  /** Tracé drawn in the plan itself. */
  length: number;
  /** Tracé that comes from block references, kept apart: it is the drawing of a component, seldom a run. */
  blockLength: number;
  /** Area of the closed outlines (polylines, circles, ellipses, splines). */
  closedArea: number;
  /** Area of the hatches, holes taken off. */
  hatchArea: number;
  /** Paths the two lengths add up. */
  paths: number;
};

export type CadBlockQuantity = {
  /** Name shown: the source block of a dynamic block reference, the block name otherwise. */
  label: string;
  layer: number;
  layerName: string;
  count: number;
  /** References, out of `count`, that sit inside another block. */
  nested: number;
  /** Anonymous block the file does not link to a named one. */
  unnamed: boolean;
};

export type CadQuantities = {
  /** Null when lengths are in drawing units. */
  metresPerUnit: number | null;
  unit: "m" | "unité";
  layers: CadLayerQuantity[];
  blocks: CadBlockQuantity[];
  totals: { length: number; blockLength: number; closedArea: number; hatchArea: number; blocks: number };
  /** Size of the whole drawing, in the same unit as the lengths. */
  extents: { width: number; height: number } | null;
  /** The drawing was not read to its end: the quantities are a lower bound. */
  partial: boolean;
};

/** Layers that draw, write or place something, by name: the ones worth listing among all those a file declares. */
export function cadUsedLayers(drawing: CadDrawing): number[] {
  const used = new Uint8Array(drawing.layers.length);
  const mark = (layer: number) => {
    if (layer >= 0 && layer < used.length) used[layer] = 1;
  };
  for (let index = 0; index < drawing.paths.count; index += 1) mark(drawing.paths.layer[index]);
  for (const entry of drawing.texts) mark(entry.layer);
  for (const entry of drawing.inserts) mark(entry.layer);
  // The layer of a reference hides what the block draws, even when nothing else is on it.
  for (const gate of drawing.gates) gate.forEach(mark);
  return drawing.layers.map((_, index) => index).filter((index) => used[index] === 1).sort((a, b) => byName(drawing.layers[a].name, drawing.layers[b].name));
}

export type CadMeasureOptions = {
  /** Unit picked by the user; the unit of the file when left out. */
  metresPerUnit?: number | null;
  /** Layers counted, by layer index; the layers the file shows when left out. */
  shown?: readonly boolean[];
};

/** Kinds of path that are tracé: line, polyline, arc, circle, ellipse, spline. */
const LAST_TRACE_KIND = 5;
const LINE_KIND = 0, ARC_KIND = 2, HATCH_KIND = 6;

const byName = (a: string, b: string) => a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);

export function measureCadDrawing(drawing: CadDrawing, options: CadMeasureOptions = {}): CadQuantities {
  const { layers, blocks, paths, inserts } = drawing;
  const metresPerUnit = options.metresPerUnit === undefined ? drawing.units.metresPerUnit : options.metresPerUnit;
  const factor = metresPerUnit !== null && metresPerUnit > 0 ? metresPerUnit : null;
  const shown = (layer: number) => (options.shown ? options.shown[layer] === true : layers[layer].visible);
  const open = cadOpenGates(drawing, shown);
  const counted = (layer: number, gate: number) => shown(layer) && (gate < 0 || open[gate] === 1);

  const direct = new Float64Array(layers.length), inBlocks = new Float64Array(layers.length);
  const closed = new Float64Array(layers.length), hatched = new Float64Array(layers.length);
  const pathCounts = new Uint32Array(layers.length), touched = new Uint8Array(layers.length);
  for (let index = 0; index < paths.count; index += 1) {
    const layer = paths.layer[index], kind = paths.kind[index];
    if (!counted(layer, paths.gate[index])) continue;
    if (kind === HATCH_KIND) { hatched[layer] += paths.area[index]; touched[layer] = 1; continue; }
    if (kind > LAST_TRACE_KIND) continue;
    if (paths.block[index] < 0) direct[layer] += paths.length[index]; else inBlocks[layer] += paths.length[index];
    if (kind !== LINE_KIND && kind !== ARC_KIND && (paths.flags[index] & CAD_PATH_CLOSED) !== 0) closed[layer] += paths.area[index];
    pathCounts[layer] += 1;
    touched[layer] = 1;
  }

  // Two conversions in a row keep round figures round (1 000 000 mm² is 1 m², not 1,0000000000000002).
  const toLength = (value: number) => (factor === null ? value : value * factor);
  const toArea = (value: number) => (factor === null ? value : value * factor * factor);
  const rows: CadLayerQuantity[] = [];
  const totals = { length: 0, blockLength: 0, closedArea: 0, hatchArea: 0, blocks: 0 };
  for (let layer = 0; layer < layers.length; layer += 1) {
    if (touched[layer] === 0) continue;
    const row: CadLayerQuantity = {
      layer, name: layers[layer].name, color: layers[layer].color, length: toLength(direct[layer]), blockLength: toLength(inBlocks[layer]),
      closedArea: toArea(closed[layer]), hatchArea: toArea(Math.max(0, hatched[layer])), paths: pathCounts[layer],
    };
    rows.push(row);
    totals.length += row.length; totals.blockLength += row.blockLength; totals.closedArea += row.closedArea; totals.hatchArea += row.hatchArea;
  }
  rows.sort((a, b) => byName(a.name, b.name));

  // A dynamic block reference and its source block are one component: they are counted under one name.
  const counts = new Map<string, CadBlockQuantity>();
  for (const insert of inserts) {
    const block = blocks[insert.block];
    if (block.xref || !counted(insert.layer, insert.gate)) continue;
    const key = `${insert.layer}\u0000${block.label.toUpperCase()}`;
    let row = counts.get(key);
    if (!row) {
      row = { label: block.label, layer: insert.layer, layerName: layers[insert.layer].name, count: 0, nested: 0, unnamed: block.anonymous && block.label === block.name };
      counts.set(key, row);
    }
    // The name as its definition spells it wins over the spelling of an anonymous copy.
    if (!block.anonymous) row.label = block.label;
    row.count += 1;
    if (insert.depth > 0) row.nested += 1;
    totals.blocks += 1;
  }
  const blockRows = [...counts.values()].sort((a, b) => byName(a.label, b.label) || byName(a.layerName, b.layerName));

  const extents = drawing.extents === null ? null : { width: toLength(drawing.extents.x1 - drawing.extents.x0), height: toLength(drawing.extents.y1 - drawing.extents.y0) };
  return { metresPerUnit: factor, unit: factor === null ? "unité" : "m", layers: rows, blocks: blockRows, totals, extents, partial: drawing.truncated };
}

const decimal = (value: number) => value.toFixed(2).replace(".", ",");

/** A cell a spreadsheet cannot run as a formula, quoted when it holds a separator. */
export function cadCsvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replaceAll("\"", "\"\"")}"` : safe;
}

/** The quantities as a CSV file Excel opens as is: semicolons, decimal commas, UTF-8 with its mark. */
export function cadQuantitiesCsv(quantities: CadQuantities): string {
  const unit = quantities.unit, squared = unit === "m" ? "m²" : "unité²";
  const lines = ["Nature;Calque;Désignation;Quantité;Unité"];
  for (const row of quantities.layers) {
    const name = cadCsvCell(row.name);
    if (row.length > 0) lines.push(`Longueur;${name};Tracé direct;${decimal(row.length)};${unit}`);
    if (row.blockLength > 0) lines.push(`Longueur;${name};Tracé des blocs;${decimal(row.blockLength)};${unit}`);
    if (row.closedArea > 0) lines.push(`Surface;${name};Contours fermés;${decimal(row.closedArea)};${squared}`);
    if (row.hatchArea > 0) lines.push(`Surface;${name};Hachures;${decimal(row.hatchArea)};${squared}`);
  }
  for (const row of quantities.blocks) lines.push(`Bloc;${cadCsvCell(row.layerName)};${cadCsvCell(row.label)};${row.count};u`);
  return `﻿${lines.join("\r\n")}\r\n`;
}
