// Fictional DXF files for the tests: written record by record, so each test
// states exactly the group codes it relies on.

export type DxfPair = readonly [code: number, value: string | number];
export type DxfRecord = string[];

export function rec(type: string, ...pairs: DxfPair[]): DxfRecord {
  return ["0", type, ...pairs.flatMap(([code, value]) => [String(code), String(value)])];
}

export type DxfBlockFixture = { name: string; base?: [number, number]; flags?: number; entities: DxfRecord[] };

export type DxfFixture = {
  header?: DxfPair[];
  layers?: DxfRecord[];
  blockRecords?: DxfRecord[];
  blocks?: DxfBlockFixture[];
  entities?: DxfRecord[];
  /** Line ending, CRLF by default as AutoCAD writes. */
  eol?: string;
  /** False cuts the file before « EOF ». */
  eof?: boolean;
};

export function dxfText(fixture: DxfFixture): string {
  const lines: string[] = [];
  const header = fixture.header ?? [[9, "$ACADVER"], [1, "AC1027"], [9, "$INSUNITS"], [70, 4]];
  lines.push("0", "SECTION", "2", "HEADER", ...header.flatMap(([code, value]) => [String(code), String(value)]), "0", "ENDSEC");
  lines.push("0", "SECTION", "2", "TABLES");
  lines.push("0", "TABLE", "2", "LAYER", ...(fixture.layers ?? []).flat(), "0", "ENDTAB");
  if (fixture.blockRecords) lines.push("0", "TABLE", "2", "BLOCK_RECORD", ...fixture.blockRecords.flat(), "0", "ENDTAB");
  lines.push("0", "ENDSEC");
  lines.push("0", "SECTION", "2", "BLOCKS");
  for (const block of fixture.blocks ?? []) {
    lines.push(...rec("BLOCK", [8, "0"], [2, block.name], [70, block.flags ?? 0], [10, block.base?.[0] ?? 0], [20, block.base?.[1] ?? 0], [30, 0]));
    lines.push(...block.entities.flat(), "0", "ENDBLK", "8", "0");
  }
  lines.push("0", "ENDSEC");
  lines.push("0", "SECTION", "2", "ENTITIES", ...(fixture.entities ?? []).flat(), "0", "ENDSEC");
  if (fixture.eof !== false) lines.push("0", "EOF");
  const eol = fixture.eol ?? "\r\n";
  return lines.join(eol) + eol;
}

export function dxfBytes(fixture: DxfFixture, encoding: "utf8" | "latin1" = "utf8"): Uint8Array {
  return new Uint8Array(Buffer.from(dxfText(fixture), encoding));
}

export function layer(name: string, color = 7, ...pairs: DxfPair[]): DxfRecord {
  return rec("LAYER", [2, name], [70, 0], [62, color], [6, "Continuous"], ...pairs);
}

export function line(layerName: string, x0: number, y0: number, x1: number, y1: number, ...pairs: DxfPair[]): DxfRecord {
  return rec("LINE", [8, layerName], [10, x0], [20, y0], [30, 0], [11, x1], [21, y1], [31, 0], ...pairs);
}

/** Vertices as [x, y] or [x, y, bulge]. */
export function lwpolyline(layerName: string, vertices: (readonly [number, number] | readonly [number, number, number])[], closed = false, ...pairs: DxfPair[]): DxfRecord {
  return rec("LWPOLYLINE", [8, layerName], [90, vertices.length], [70, closed ? 1 : 0],
    ...vertices.flatMap((vertex): DxfPair[] => (vertex[2] ? [[10, vertex[0]], [20, vertex[1]], [42, vertex[2]]] : [[10, vertex[0]], [20, vertex[1]]])),
    ...pairs);
}

export function circle(layerName: string, x: number, y: number, radius: number, ...pairs: DxfPair[]): DxfRecord {
  return rec("CIRCLE", [8, layerName], [10, x], [20, y], [30, 0], [40, radius], ...pairs);
}

export function arc(layerName: string, x: number, y: number, radius: number, start: number, end: number, ...pairs: DxfPair[]): DxfRecord {
  return rec("ARC", [8, layerName], [10, x], [20, y], [30, 0], [40, radius], [50, start], [51, end], ...pairs);
}

export function insert(layerName: string, block: string, x: number, y: number, ...pairs: DxfPair[]): DxfRecord {
  return rec("INSERT", [8, layerName], [2, block], [10, x], [20, y], [30, 0], ...pairs);
}

export function text(layerName: string, x: number, y: number, height: number, value: string, ...pairs: DxfPair[]): DxfRecord {
  return rec("TEXT", [8, layerName], [10, x], [20, y], [30, 0], [40, height], [1, value], ...pairs);
}

/** Solid hatch whose loops are polylines: the first is the outline, the following ones its holes. */
export function hatch(layerName: string, ...loops: [number, number][][]): DxfRecord {
  const loop = (points: [number, number][]): DxfPair[] => [[92, 2], [72, 0], [73, 1], [93, points.length], ...points.flatMap(([x, y]): DxfPair[] => [[10, x], [20, y]]), [97, 0]];
  return rec("HATCH", [8, layerName], [10, 0], [20, 0], [30, 0], [2, "SOLID"], [70, 1], [71, 0], [91, loops.length], ...loops.flatMap(loop), [75, 0], [76, 1], [98, 0]);
}
