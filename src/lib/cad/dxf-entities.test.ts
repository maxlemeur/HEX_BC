import { describe, expect, it, vi } from "vitest";

import { EntityReader, type EntitySink } from "@/lib/cad/dxf-entities";
import { DxfRecords } from "@/lib/cad/dxf-records";
import { hatch, lwpolyline, rec, type DxfPair, type DxfRecord } from "@/lib/cad/dxf.test-utils";

// A curve is turned into points only when the space that receives it can hold
// them: one record of a crafted file must not fill the memory before the limit
// on points is looked at.
function reading(entities: DxfRecord[], room = 100) {
  const path = vi.fn<EntitySink["path"]>(), overflow = vi.fn<EntitySink["overflow"]>();
  const reader = new EntityReader({
    layerOf: () => 0, path, overflow, room: () => room,
    text: () => {}, constant: () => {}, insert: () => {}, dimension: () => {}, unsupported: () => {}, splineFit: () => {}, skipped: () => {},
  });
  const records = new DxfRecords([...entities.flat(), "0", "EOF"].join("\r\n") + "\r\n");
  while (records.next()) reader.read(records);
  reader.flush();
  return { path, overflow };
}

const pointsOf = (path: ReturnType<typeof reading>["path"]) => path.mock.calls.map((call) => call[4].length / 2);

describe("EntityReader: curves are counted before they are turned into points", () => {
  it("leaves out a polyline whose arcs would not fit", () => {
    // 300 half circles: 300 vertices and 35 points more for each arc.
    const { path, overflow } = reading([lwpolyline("0", Array.from({ length: 300 }, (_, index) => [index, 0, 1] as const))]);
    expect(overflow).toHaveBeenCalledTimes(1);
    expect(path).not.toHaveBeenCalled();
  });

  it("reads a polyline that fills exactly the room left", () => {
    const { path, overflow } = reading([lwpolyline("0", Array.from({ length: 100 }, (_, index) => [index, index % 2] as const))]);
    expect(overflow).not.toHaveBeenCalled();
    expect(pointsOf(path)).toEqual([100]);
  });

  it("leaves out an old-style polyline whose arcs would not fit", () => {
    const { path, overflow } = reading([
      rec("POLYLINE", [8, "0"], [66, 1], [70, 0]),
      ...Array.from({ length: 10 }, (_, index) => rec("VERTEX", [8, "0"], [10, index], [20, 0], [42, 1])),
      rec("SEQEND"),
    ]);
    expect(overflow).toHaveBeenCalledTimes(1);
    expect(path).not.toHaveBeenCalled();
  });

  it("leaves out a spline whose samples would not fit", () => {
    // Degree 3, 20 control points: 17 spans of 24 samples.
    const knots = [0, 0, 0, 0, ...Array.from({ length: 16 }, (_, index) => index + 1), 17, 17, 17, 17];
    const { path, overflow } = reading([rec("SPLINE", [8, "0"], [70, 8], [71, 3], [72, knots.length], [73, 20],
      ...knots.map((knot): DxfPair => [40, knot]),
      ...Array.from({ length: 20 }, (_, index): DxfPair[] => [[10, index], [20, index % 2], [30, 0]]).flat())]);
    expect(overflow).toHaveBeenCalledTimes(1);
    expect(path).not.toHaveBeenCalled();
  });

  it("leaves out a hatch whose loop of arcs would not fit", () => {
    const corners = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const { path, overflow } = reading([rec("HATCH", [8, "0"], [10, 0], [20, 0], [30, 0], [2, "SOLID"], [70, 1], [71, 0], [91, 1],
      [92, 2], [72, 1], [73, 1], [93, 4], ...corners.flatMap(([x, y]): DxfPair[] => [[10, x], [20, y], [42, 1]]), [97, 0], [75, 0], [76, 1], [98, 0])]);
    expect(overflow).toHaveBeenCalledTimes(1);
    expect(path).not.toHaveBeenCalled();
  });

  it("leaves out the whole hatch when its loops together would not fit", () => {
    const ring = (x: number): [number, number][] => Array.from({ length: 60 }, (_, index) => [x + Math.cos(index / 10), Math.sin(index / 10)]);
    const { path, overflow } = reading([hatch("0", ring(0), ring(100))]);
    expect(overflow).toHaveBeenCalledTimes(1);
    expect(path).not.toHaveBeenCalled();
  });

  it("reads a hatch whose loops fit", () => {
    const { path, overflow } = reading([hatch("0", [[0, 0], [10, 0], [10, 10], [0, 10]], [[2, 2], [4, 2], [4, 4], [2, 4]])]);
    expect(overflow).not.toHaveBeenCalled();
    expect(pointsOf(path)).toEqual([4, 4]);
  });
});
