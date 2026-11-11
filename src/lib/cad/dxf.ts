// DXF reader: an ASCII DXF file into a flat drawing (paths, texts, block
// references) in world coordinates, with every length and area carried from the
// exact geometry. Model-space entities go straight to the drawing; block
// definitions are kept and replayed under each reference once the file is read.

import { aciColor } from "./aci";
import { BYBLOCK, BYLAYER, EntityReader, isSubRecord, type EntitySink, type RawDimension, type RawInsert, type RawText } from "./dxf-entities";
import { DxfRecords, NO_UNITS, num, readHeader, type DxfHeader } from "./dxf-records";
import { decodeDxf } from "./dxf-text";
import { chainLength, compose, determinant, IDENTITY, rotation, scaling, similarityScale, translation, turnedAngle, type Affine } from "./geometry";
import type { CadBlock, CadDrawing, CadInsert, CadLayer, CadText, CadWarning, CadWarningCode } from "./model";

export { aciColor } from "./aci";

export type CadLimits = { maxBytes: number; maxEntities: number; maxPoints: number; maxTexts: number; maxInserts: number; maxDepth: number };

export const CAD_LIMITS: CadLimits = {
  maxBytes: 50 * 1024 * 1024, maxEntities: 2_000_000, maxPoints: 4_000_000, maxTexts: 200_000, maxInserts: 500_000, maxDepth: 16,
};

export type CadReadErrorReason = "empty" | "too_large" | "binary_dxf" | "not_dxf" | "not_dwg" | "not_rvt" | "not_fcstd" | "damaged_fcstd" | "model_too_large" | "unsupported";

export class CadReadError extends Error {
  constructor(readonly reason: CadReadErrorReason) {
    super(`Fichier CAO illisible (${reason}).`);
    this.name = "CadReadError";
  }
}

const BINARY_SENTINEL = "AutoCAD Binary DXF";
const DIMENSION_KIND = 9;

type Item =
  | { item: "path"; layer: number; color: number; kind: number; flags: number; points: number[]; length: number; area: number }
  | { item: "text"; text: RawText }
  | { item: "insert"; insert: RawInsert }
  | { item: "dimension"; dimension: RawDimension };

type BlockDef = { index: number; name: string; baseX: number; baseY: number; xref: boolean; items: Item[] };

/** Where an entity is drawn: under which references, with what they hand down. */
type Context = {
  matrix: Affine; /** Null when the transform stretches. */ scale: number | null; /** Factor on areas. */ area: number;
  /** Layer taken by what sits on layer « 0 », -1 in model space. */ layer0: number; /** Colour of what is BYBLOCK. */ color: number;
  gate: number; block: number; depth: number; dimension: boolean;
};

const ROOT: Context = { matrix: IDENTITY, scale: 1, area: 1, layer0: -1, color: 0xffffff, gate: -1, block: -1, depth: 0, dimension: false };

function grown<T extends Int32Array | Uint32Array | Uint8Array | Float64Array>(array: T, needed: number): T {
  if (needed <= array.length) return array;
  const next = new (array.constructor as new (length: number) => T)(Math.max(needed, array.length * 2));
  next.set(array);
  return next;
}

function decoded(bytes: Uint8Array, maxBytes: number): string {
  if (bytes.length === 0) throw new CadReadError("empty");
  if (bytes.length > maxBytes) throw new CadReadError("too_large");
  if (new TextDecoder("latin1").decode(bytes.subarray(0, BINARY_SENTINEL.length)) === BINARY_SENTINEL) throw new CadReadError("binary_dxf");
  const text = decodeDxf(bytes);
  if (text.trim() === "") throw new CadReadError("empty");
  // Old Mac files end their lines with a lone carriage return.
  return !text.includes("\n") && text.includes("\r") ? text.replace(/\r/g, "\n") : text;
}

export function readDxf(bytes: Uint8Array, options: { limits?: Partial<CadLimits> } = {}): CadDrawing {
  const limits: CadLimits = { ...CAD_LIMITS, ...options.limits };
  const records = new DxfRecords(decoded(bytes, limits.maxBytes));
  if (records.peekType() !== "SECTION") throw new CadReadError("not_dxf");

  let header: DxfHeader = { version: { code: "", label: "version inconnue" }, units: { ...NO_UNITS } };
  const layers: CadLayer[] = [], layerIndex = new Map<string, number>();
  const blocks: CadBlock[] = [], defs = new Map<string, BlockDef>();
  const gates: number[][] = [], gateIndex = new Map<string, number>();
  const recordNames = new Map<string, string>(), dynamicSources = new Map<string, string>();
  const texts: CadText[] = [], inserts: CadInsert[] = [], warnings: CadWarning[] = [];
  const counts = { entities: 0, skipped_paper_space: 0, skipped_invisible: 0 };
  const unsupported = new Map<string, number>(), warned = new Set<string>(), active = new Set<BlockDef>();
  const deferred: Item[] = [];
  let truncated = false, stopped = false, splineFits = 0, entities = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;

  /** Points kept in block definitions, and references expanded, dimensions and dead ends included. */
  let pathCount = 0, pointCount = 0, definedPoints = 0, expansions = 0;
  let pLayer = new Int32Array(256), pGate = new Int32Array(256), pBlock = new Int32Array(256), pColor = new Uint32Array(256);
  let pKind = new Uint8Array(256), pFlags = new Uint8Array(256), pStart = new Uint32Array(256), pSize = new Uint32Array(256);
  let pLength = new Float64Array(256), pArea = new Float64Array(256), coords = new Float64Array(4096);

  function stop(code: CadWarningCode): void {
    if (stopped) return;
    stopped = true;
    partial(code);
  }

  /** Something is left out and the reading goes on: said once. */
  function partial(code: CadWarningCode): void {
    truncated = true;
    if (warned.has(code)) return;
    warned.add(code);
    warnings.push({ code });
  }

  /** Counts a reference against the limit; false once the limit is reached. */
  function expanded(): boolean {
    if (expansions >= limits.maxInserts) { stop("limit_inserts"); return false; }
    expansions += 1;
    return true;
  }

  function warnOnce(code: CadWarningCode, detail: string): void {
    const key = `${code}\n${detail.toUpperCase()}`;
    if (warned.has(key)) return;
    warned.add(key);
    warnings.push({ code, detail });
  }

  function layerOf(name: string): number {
    const trimmed = name.trim() || "0", key = trimmed.toUpperCase();
    let index = layerIndex.get(key);
    if (index === undefined) {
      index = layers.length;
      layers.push({ name: trimmed, color: 0xffffff, on: true, frozen: false, plot: true, visible: true });
      layerIndex.set(key, index);
    }
    return index;
  }
  layerOf("0");

  const tint = (color: number, layer: number, context: Context): number => (color === BYLAYER ? layers[layer].color : color === BYBLOCK ? context.color : color);
  const layerIn = (layer: number, context: Context): number => (layer === 0 && context.layer0 >= 0 ? context.layer0 : layer);

  function emitPath(context: Context, layer: number, color: number, kind: number, flags: number, source: ArrayLike<number>, length: number, area: number): void {
    if (stopped) return;
    const size = source.length >> 1;
    if (pointCount + size > limits.maxPoints) { stop("limit_points"); return; }
    if (pathCount === pLayer.length) {
      const needed = pathCount + 1;
      pLayer = grown(pLayer, needed); pGate = grown(pGate, needed); pBlock = grown(pBlock, needed); pColor = grown(pColor, needed);
      pKind = grown(pKind, needed); pFlags = grown(pFlags, needed); pStart = grown(pStart, needed); pSize = grown(pSize, needed);
      pLength = grown(pLength, needed); pArea = grown(pArea, needed);
    }
    coords = grown(coords, 2 * (pointCount + size));
    const matrix = context.matrix, at = 2 * pointCount, same = matrix === IDENTITY;
    for (let index = 0; index < size; index += 1) {
      const sx = source[2 * index], sy = source[2 * index + 1];
      // « + 0 » turns a negative zero into zero.
      const x = (same ? sx : matrix[0] * sx + matrix[2] * sy + matrix[4]) + 0, y = (same ? sy : matrix[1] * sx + matrix[3] * sy + matrix[5]) + 0;
      coords[at + 2 * index] = x; coords[at + 2 * index + 1] = y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const effective = layerIn(layer, context);
    pLayer[pathCount] = effective; pGate[pathCount] = context.gate; pBlock[pathCount] = context.block;
    pColor[pathCount] = tint(color, effective, context);
    pKind[pathCount] = context.dimension ? DIMENSION_KIND : kind; pFlags[pathCount] = flags;
    pStart[pathCount] = pointCount; pSize[pathCount] = size;
    // A similarity scales the exact length; a stretch leaves only the points to measure.
    pLength[pathCount] = same ? length : context.scale !== null ? length * context.scale : chainLength(coords.subarray(at, at + 2 * size), (flags & 1) === 1);
    pArea[pathCount] = area * context.area;
    pathCount += 1;
    pointCount += size;
  }

  function emitText(context: Context, raw: RawText): void {
    if (stopped) return;
    if (texts.length >= limits.maxTexts) { stop("limit_texts"); return; }
    const matrix = context.matrix, same = matrix === IDENTITY, layer = layerIn(raw.layer, context);
    const x = (same ? raw.x : matrix[0] * raw.x + matrix[2] * raw.y + matrix[4]) + 0, y = (same ? raw.y : matrix[1] * raw.x + matrix[3] * raw.y + matrix[5]) + 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    let height = raw.height * Math.sqrt(context.area), stretch = raw.stretch;
    if (context.scale === null) {
      // A stretch does not scale a text evenly: its line takes the length of the stretched direction, its height what is left of the area.
      const cos = Math.cos(raw.angle), sin = Math.sin(raw.angle);
      const along = Math.hypot(matrix[0] * cos + matrix[2] * sin, matrix[1] * cos + matrix[3] * sin);
      height = along > 0 ? (raw.height * context.area) / along : 0;
      if (context.area > 0) stretch = (raw.stretch * along * along) / context.area;
    }
    const entry: CadText = {
      layer, gate: context.gate, block: context.block, color: tint(raw.color, layer, context), x, y,
      height, angle: turnedAngle(matrix, raw.angle), align: raw.align, baseline: raw.baseline,
      text: raw.text, kind: context.dimension ? "dimension" : raw.kind,
    };
    if (Number.isFinite(stretch) && Math.abs(stretch - 1) > 1e-9) entry.stretch = stretch;
    texts.push(entry);
  }

  /** The gate of what a reference on `layer` draws, the reference itself being drawn under `gate`. */
  function gateUnder(gate: number, layer: number): number {
    if (gate >= 0 && gates[gate].includes(layer)) return gate;
    const key = `${gate},${layer}`;
    let index = gateIndex.get(key);
    if (index === undefined) {
      index = gates.length;
      gates.push(gate < 0 ? [layer] : [...gates[gate], layer]);
      gateIndex.set(key, index);
    }
    return index;
  }

  function replay(def: BlockDef, context: Context, parent: number): void {
    for (const item of def.items) {
      if (stopped) return;
      if (item.item === "path") emitPath(context, item.layer, item.color, item.kind, item.flags, item.points, item.length, item.area);
      else if (item.item === "text") emitText(context, item.text);
      else if (item.item === "insert") expandInsert(context, item.insert, parent);
      else expandDimension(context, item.dimension, parent);
    }
  }

  function expandInsert(context: Context, raw: RawInsert, parent: number): void {
    if (stopped) return;
    const def = defs.get(raw.name.toUpperCase());
    // A reference that draws nothing still costs its visit.
    if (!def) { warnOnce("missing_block", raw.name); expanded(); return; }
    if (active.has(def)) { warnOnce("block_cycle", def.name); expanded(); return; }
    if (context.depth >= limits.maxDepth) { warnOnce("depth_limit", def.name); truncated = true; expanded(); return; }
    if (def.xref) warnOnce("xref_missing", def.name);
    const layer = layerIn(raw.layer, context), color = tint(raw.color, layer, context);
    // Every reference on the way gates what it draws: hiding the layer of a nested one hides its content too.
    const gate = gateUnder(context.gate, layer);
    const block = context.block >= 0 ? context.block : def.index;
    const outer = compose(context.matrix, raw.ocs);
    let turn = raw.rotation, scaleX = raw.sx, scaleY = raw.sy;
    if (outer !== IDENTITY) {
      const cos = Math.cos(raw.rotation), sin = Math.sin(raw.rotation);
      const ux = outer[0] * cos + outer[2] * sin, uy = outer[1] * cos + outer[3] * sin;
      const vx = outer[2] * cos - outer[0] * sin, vy = outer[3] * cos - outer[1] * sin;
      turn = Math.atan2(uy, ux);
      scaleX = raw.sx * Math.hypot(ux, uy);
      scaleY = raw.sy * Math.hypot(vx, vy) * (determinant(outer) < 0 ? -1 : 1);
    }
    const inner = compose(scaling(raw.sx, raw.sy), translation(-def.baseX, -def.baseY));
    active.add(def);
    for (let row = 0; row < raw.rows && !stopped; row += 1) {
      for (let column = 0; column < raw.columns && !stopped; column += 1) {
        const first = row === 0 && column === 0;
        const place = compose(translation(raw.x, raw.y), compose(rotation(raw.rotation), translation(column * raw.dx, row * raw.dy)));
        const matrix = compose(outer, compose(place, inner));
        const child: Context = { matrix, scale: similarityScale(matrix), area: Math.abs(determinant(matrix)), layer0: layer, color, gate, block, depth: context.depth + 1, dimension: context.dimension };
        if (!expanded()) break;
        let index = parent;
        // The arrowheads of a dimension are not block references of the plan.
        if (!context.dimension) {
          const px = place[4], py = place[5];
          index = inserts.length;
          inserts.push({
            block: def.index, layer, gate, parent, depth: context.depth,
            x: (outer === IDENTITY ? px : outer[0] * px + outer[2] * py + outer[4]) + 0, y: (outer === IDENTITY ? py : outer[1] * px + outer[3] * py + outer[5]) + 0,
            rotation: turn, scaleX, scaleY, attributes: first ? raw.attributes : [],
          });
        }
        // Attributes are entities of the space that holds the reference, not of the block.
        if (first) for (const text of raw.attributeTexts) emitText({ ...child, matrix: context.matrix, scale: context.scale, area: context.area, layer0: context.layer0 }, text);
        replay(def, child, index);
      }
    }
    active.delete(def);
  }

  function expandDimension(context: Context, raw: RawDimension, parent: number): void {
    if (stopped) return;
    const def = defs.get(raw.name.toUpperCase());
    if (!expanded()) return;
    if (!def) { warnOnce("missing_block", raw.name); return; }
    if (active.has(def) || context.depth >= limits.maxDepth) return;
    const layer = layerIn(raw.layer, context);
    active.add(def);
    // Like a reference, a dimension gates what its block draws: hiding its layer hides the lines its block keeps on others.
    replay(def, { ...context, layer0: layer, color: tint(raw.color, layer, context), gate: gateUnder(context.gate, layer), depth: context.depth + 1, dimension: true }, parent);
    active.delete(def);
  }

  let open: BlockDef | null = null;
  const shared = {
    layerOf,
    unsupported: (type: string) => { unsupported.set(type, (unsupported.get(type) ?? 0) + 1); },
    splineFit: () => { splineFits += 1; },
  };
  const modelReader = new EntityReader({
    ...shared,
    path: (layer, color, kind, flags, points, length, area) => emitPath(ROOT, layer, color, kind, flags, points, length, area),
    room: () => limits.maxPoints - pointCount,
    overflow: () => stop("limit_points"),
    text: (text) => emitText(ROOT, text),
    // Outside a block a constant attribute definition draws nothing.
    constant: () => {},
    // A block may be defined after its reference: both wait for the end of the file.
    insert: (insert) => { deferred.push({ item: "insert", insert }); },
    dimension: (dimension) => { deferred.push({ item: "dimension", dimension }); },
    skipped: (why) => { if (why === "paper") counts.skipped_paper_space += 1; else counts.skipped_invisible += 1; },
  } satisfies EntitySink);
  const blockReader = new EntityReader({
    ...shared,
    // A definition holds no more points than a drawing: what does not fit is left out, and the reading goes on.
    path: (layer, color, kind, flags, points, length, area) => {
      const size = points.length >> 1;
      if (definedPoints + size > limits.maxPoints) { partial("limit_points"); return; }
      definedPoints += size;
      open?.items.push({ item: "path", layer, color, kind, flags, points, length, area });
    },
    room: () => limits.maxPoints - definedPoints,
    overflow: () => partial("limit_points"),
    text: (text) => { open?.items.push({ item: "text", text }); },
    constant: (text) => { open?.items.push({ item: "text", text }); },
    insert: (insert) => { open?.items.push({ item: "insert", insert }); },
    dimension: (dimension) => { open?.items.push({ item: "dimension", dimension }); },
    skipped: () => {},
  } satisfies EntitySink);

  function readLayer(): void {
    const index = layerOf(records.first(2) ?? "0"), aci = num(records.first(62) ?? "7"), rgb = records.first(420);
    const on = aci >= 0, frozen = (num(records.first(70)) & 1) === 1;
    layers[index] = {
      name: layers[index].name, color: rgb !== undefined ? num(rgb) & 0xffffff : aciColor(Math.abs(aci)),
      on, frozen, plot: num(records.first(290) ?? "1") !== 0, visible: on && !frozen,
    };
  }

  function readBlockRecord(): void {
    const name = (records.first(2) ?? "").trim(), handle = records.first(5);
    if (handle !== undefined) recordNames.set(handle.trim().toUpperCase(), name);
    // An anonymous block drawn from a dynamic block names it in its extended data.
    let tagged = false;
    for (let index = 0; index < records.count; index += 1) {
      if (records.codes[index] === 1001) tagged = records.values[index].trim() === "AcDbBlockRepBTag";
      else if (tagged && records.codes[index] === 1005) { dynamicSources.set(name.toUpperCase(), records.values[index].trim().toUpperCase()); break; }
    }
  }

  function openBlock(): void {
    const name = (records.first(2) ?? records.first(3) ?? "").trim(), flags = num(records.first(70));
    // The spaces themselves are blocks; their content is read from ENTITIES.
    if (/^[*$](MODEL|PAPER)_SPACE/i.test(name)) return;
    open = { index: blocks.length, name, baseX: num(records.first(10)), baseY: num(records.first(20)), xref: (flags & 4) !== 0, items: [] };
    blocks.push({ name, label: name, anonymous: (flags & 1) === 1, xref: open.xref });
    defs.set(name.toUpperCase(), open);
  }

  function closeBlock(): void {
    blockReader.flush();
    open = null;
  }

  /** False once the limit on entities is reached. */
  function counted(type: string, model: boolean): boolean {
    if (isSubRecord(type)) return true;
    if (entities >= limits.maxEntities) { stop("limit_entities"); return false; }
    entities += 1;
    if (model) counts.entities += 1;
    return true;
  }

  let section = "";
  while (!stopped && records.next()) {
    const type = records.type;
    if (type === "SECTION") {
      section = (records.first(2) ?? "").trim().toUpperCase();
      if (section === "HEADER") header = readHeader(records);
    } else if (type === "ENDSEC") {
      if (section === "ENTITIES") modelReader.flush();
      if (section === "BLOCKS") closeBlock();
      section = "";
    } else if (section === "TABLES") {
      if (type === "LAYER") readLayer();
      else if (type === "BLOCK_RECORD") readBlockRecord();
    } else if (section === "BLOCKS") {
      if (type === "BLOCK") { closeBlock(); openBlock(); }
      else if (type === "ENDBLK") closeBlock();
      else if (open && counted(type, false)) blockReader.read(records);
    } else if (section === "ENTITIES" && counted(type, true)) modelReader.read(records);
  }
  // A limit stops the reading before the end: only a file that ends by itself too early is a cut file.
  if (!stopped && !records.ended) { truncated = true; warnings.push({ code: "truncated_file" }); }
  modelReader.flush();
  closeBlock();
  for (const item of deferred) {
    if (item.item === "insert") expandInsert(ROOT, item.insert, -1);
    else if (item.item === "dimension") expandDimension(ROOT, item.dimension, -1);
  }
  if (splineFits > 0) warnings.push({ code: "spline_fit_points", detail: String(splineFits) });
  for (const block of blocks) {
    const source = dynamicSources.get(block.name.toUpperCase());
    const label = source === undefined ? undefined : recordNames.get(source);
    if (label !== undefined && label !== "") block.label = label;
  }

  return {
    format: "dxf", version: header.version, units: header.units, layers, blocks, gates,
    paths: {
      count: pathCount, layer: pLayer.slice(0, pathCount), gate: pGate.slice(0, pathCount), block: pBlock.slice(0, pathCount),
      color: pColor.slice(0, pathCount), kind: pKind.slice(0, pathCount), flags: pFlags.slice(0, pathCount), start: pStart.slice(0, pathCount),
      size: pSize.slice(0, pathCount), length: pLength.slice(0, pathCount), area: pArea.slice(0, pathCount),
    },
    points: coords.slice(0, 2 * pointCount), texts, inserts,
    extents: x0 <= x1 && y0 <= y1 ? { x0, y0, x1, y1 } : null,
    counts,
    unsupported: [...unsupported].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    warnings, truncated,
  };
}
