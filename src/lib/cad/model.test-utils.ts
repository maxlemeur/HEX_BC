import {
  CAD_PATH_CLOSED, CAD_PATH_COMPOUND, CAD_PATH_FILLED, CAD_PATH_KINDS, type CadDrawing, type CadPathKind,
} from "@/lib/cad/model";

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

/** One path as an object, to read a drawing in the tests: the arrays stay the working form. */
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

export function listCadPaths(drawing: CadDrawing): CadPathView[] {
  return Array.from({ length: drawing.paths.count }, (_, index) => cadPathAt(drawing, index));
}
