// The drawing read from a CAD original (DXF today; a converted DWG gives the
// same model). Model space only, blocks expanded, in drawing units, y up, seen
// in plan (z ignored). Paths are a struct of arrays: a consultation plan holds
// hundreds of thousands of them, and the reader runs in a web worker whose
// result is transferred, not copied.

export const CAD_PATH_KINDS = ["line", "polyline", "arc", "circle", "ellipse", "spline", "hatch", "solid", "leader", "dimension"] as const;
export type CadPathKind = (typeof CAD_PATH_KINDS)[number];

/** The outline returns to its first point (which is not repeated). */
export const CAD_PATH_CLOSED = 1;
/** Filled outline (solid hatch, SOLID, TRACE). */
export const CAD_PATH_FILLED = 2;
/** Further loop of the previous path's shape (hatch boundaries fill even-odd). */
export const CAD_PATH_COMPOUND = 4;

export type CadPaths = {
  count: number;
  /** Layer the path is drawn on, once layer « 0 » inside a block took the layer of its reference. */
  layer: Int32Array;
  /** Entry of the drawing's `gates` the path is drawn under, -1 when drawn directly: hiding one of its layers hides the path. */
  gate: Int32Array;
  /** Outermost block the path is drawn through, -1 when drawn directly in model space. */
  block: Int32Array;
  /** 0xRRGGBB, BYLAYER and BYBLOCK resolved. */
  color: Uint32Array;
  /** Index in CAD_PATH_KINDS. */
  kind: Uint8Array;
  flags: Uint8Array;
  /** First point of the path in `points` (in points, not in numbers). */
  start: Uint32Array;
  size: Uint32Array;
  /** Length in drawing units, from the geometry itself (arcs and bulges are exact, not their chords). */
  length: Float64Array;
  /** Area in square drawing units of a closed outline, 0 otherwise. Hatch loops are signed: a hole is negative. */
  area: Float64Array;
};

export type CadLayer = {
  name: string;
  /** 0xRRGGBB. */
  color: number;
  on: boolean;
  frozen: boolean;
  plot: boolean;
  /** Shown when the file is opened: on and not frozen. */
  visible: boolean;
};

export type CadBlock = {
  name: string;
  /** Name to show and count under: the source block of a dynamic block reference (« *U12 »), else the name. */
  label: string;
  /** « *U… », « *D… », « *X… »: created by the software, not named by the draughtsman. */
  anonymous: boolean;
  xref: boolean;
};

export type CadTextKind = "text" | "mtext" | "attribute" | "dimension";

export type CadText = {
  layer: number;
  /** Entry of the drawing's `gates`, -1 when written directly in model space. */
  gate: number;
  block: number;
  color: number;
  x: number;
  y: number;
  /** Capital height in drawing units. */
  height: number;
  /** Radians, counter-clockwise. */
  angle: number;
  /** Width over the font's own: the width factor the text is written with, times what a reference stretches it by along its line. Absent when 1. */
  stretch?: number;
  /** 0 left, 1 centre, 2 right of (x, y). */
  align: 0 | 1 | 2;
  /** 0 baseline, 1 bottom, 2 middle, 3 top at (x, y). */
  baseline: 0 | 1 | 2 | 3;
  /** Plain text, formatting codes removed, « \n » between the lines of a paragraph. */
  text: string;
  kind: CadTextKind;
};

/** One drawn occurrence of a block (arrays and nested references expanded). */
export type CadInsert = {
  block: number;
  layer: number;
  /** Entry of the drawing's `gates`: the layers of this reference and of those it is nested in. */
  gate: number;
  /** Occurrence this one is nested in, -1 in model space. */
  parent: number;
  depth: number;
  x: number;
  y: number;
  /** Radians. */
  rotation: number;
  scaleX: number;
  scaleY: number;
  attributes: { tag: string; value: string }[];
};

export type CadUnits = {
  /** $INSUNITS. */
  code: number;
  /** Null when the file does not say (« sans unité »): the user then chooses. */
  metresPerUnit: number | null;
  name: string;
};

export type CadExtents = { x0: number; y0: number; x1: number; y1: number };

export type CadWarningCode =
  | "truncated_file"
  | "limit_entities"
  | "limit_points"
  | "limit_texts"
  | "limit_inserts"
  | "missing_block"
  | "xref_missing"
  | "block_cycle"
  | "depth_limit"
  | "spline_fit_points";

export type CadWarning = { code: CadWarningCode; detail?: string };

export type CadDrawing = {
  format: "dxf";
  /** $ACADVER and the release it names (« AC1027 », « AutoCAD 2013 »). */
  version: { code: string; label: string };
  units: CadUnits;
  layers: CadLayer[];
  blocks: CadBlock[];
  /**
   * Layers of the block references something is drawn through, outermost first and each layer once.
   * Paths, texts and occurrences name an entry: they show when every layer of it does.
   */
  gates: number[][];
  paths: CadPaths;
  /** x, y pairs of all paths. */
  points: Float64Array;
  texts: CadText[];
  inserts: CadInsert[];
  /** Box of all paths and texts, null for an empty drawing. */
  extents: CadExtents | null;
  counts: { entities: number; skipped_paper_space: number; skipped_invisible: number };
  /** Entity types read past (3D solids, images, tables…), most frequent first. */
  unsupported: { type: string; count: number }[];
  warnings: CadWarning[];
  /** A limit or the end of a cut file stopped the reading: quantities are partial and must not be used. */
  truncated: boolean;
};

export type CadPathView = {
  layer: string;
  /** Layers of the block references the path is drawn through, outermost first; empty when drawn directly. */
  gates: string[];
  block: string | null;
  color: number;
  kind: CadPathKind;
  closed: boolean;
  filled: boolean;
  compound: boolean;
  points: [number, number][];
  length: number;
  area: number;
};

/** One path as an object (tests, small exports): the arrays stay the working form. */
export function cadPathAt(drawing: CadDrawing, index: number): CadPathView {
  const { paths, points } = drawing;
  const start = paths.start[index];
  const list: [number, number][] = [];
  for (let point = start; point < start + paths.size[index]; point += 1) list.push([points[2 * point], points[2 * point + 1]]);
  const gate = paths.gate[index], block = paths.block[index];
  return {
    layer: drawing.layers[paths.layer[index]].name,
    gates: gate < 0 ? [] : drawing.gates[gate].map((layer) => drawing.layers[layer].name),
    block: block < 0 ? null : drawing.blocks[block].name,
    color: paths.color[index],
    kind: CAD_PATH_KINDS[paths.kind[index]],
    closed: (paths.flags[index] & CAD_PATH_CLOSED) !== 0,
    filled: (paths.flags[index] & CAD_PATH_FILLED) !== 0,
    compound: (paths.flags[index] & CAD_PATH_COMPOUND) !== 0,
    points: list,
    length: paths.length[index],
    area: paths.area[index],
  };
}

/** By entry of `gates`, 1 when every layer of the entry is shown. */
export function cadOpenGates(drawing: Pick<CadDrawing, "gates">, shown: (layer: number) => boolean): Uint8Array {
  return Uint8Array.from(drawing.gates, (layers) => (layers.every(shown) ? 1 : 0));
}

export function listCadPaths(drawing: CadDrawing): CadPathView[] {
  return Array.from({ length: drawing.paths.count }, (_, index) => cadPathAt(drawing, index));
}

/** Typed arrays of a drawing, to transfer it out of a worker without copying. */
export function cadTransferables(drawing: CadDrawing): ArrayBuffer[] {
  const { paths } = drawing;
  return [paths.layer, paths.gate, paths.block, paths.color, paths.kind, paths.flags, paths.start, paths.size, paths.length, paths.area, drawing.points]
    .map((array) => array.buffer as ArrayBuffer);
}
