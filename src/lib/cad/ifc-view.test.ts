import { describe, expect, it } from "vitest";

import type { IfcMesh, IfcMeshGroup, IfcPoint } from "./ifc";
import {
  fitIfcCamera, ifcCameraLimits, ifcDrawRuns, ifcEye, ifcShownBounds, ifcShownGroups, ifcViewProjection, orbitIfcCamera, panIfcCamera, zoomIfcCamera,
  type IfcBounds, type IfcCamera,
} from "./ifc-view";

const group = (cls: number, storey: number, start: number, count: number, min: IfcPoint, max: IfcPoint, transparent = false): IfcMeshGroup => ({ cls, storey, transparent, start, count, min, max });

const mesh = (groups: IfcMeshGroup[]): IfcMesh => ({
  positions: new Float32Array(), normals: new Int8Array(), colors: new Uint8Array(), indices: new Uint32Array(), groups,
  min: [0, -3, 0], max: [10, 3, 4], triangles: 0, truncated: false,
});

const MESH = mesh([
  group(0, 0, 0, 30, [0, -3, 0], [10, 0, 4]),
  group(0, 1, 30, 60, [0, 0, 0], [10, 3, 4]),
  group(1, 1, 90, 12, [2, 0.5, 1], [3, 1.5, 2]),
  group(2, -1, 102, 6, [9, -3, 0], [10, -2, 1]),
  group(1, 1, 108, 9, [2, 0.5, 1], [3, 1.5, 2], true),
]);

/** Where a point of the model lands on the screen: -1 to 1 across and up, and in depth. */
function project(matrix: Float32Array, [x, y, z]: IfcPoint): IfcPoint {
  const at = (row: number) => matrix[row] * x + matrix[4 + row] * y + matrix[8 + row] * z + matrix[12 + row];
  return [at(0) / at(3), at(1) / at(3), at(2) / at(3)];
}

const corners = ({ min, max }: IfcBounds): IfcPoint[] => [0, 1, 2, 3, 4, 5, 6, 7].map((corner) => [corner & 1 ? max[0] : min[0], corner & 2 ? max[1] : min[1], corner & 4 ? max[2] : min[2]]);

const BOX: IfcBounds = { min: [0, -3, 0], max: [10, 3, 4] };

describe("what a storey and the classes show of the mesh", () => {
  it("shows every group by default, and those of one storey or of none", () => {
    expect(ifcShownGroups(MESH, { storey: null, shown: [] })).toEqual([true, true, true, true, true]);
    expect(ifcShownGroups(MESH, { storey: 1, shown: [] })).toEqual([false, true, true, false, true]);
    expect(ifcShownGroups(MESH, { storey: -1, shown: [] })).toEqual([false, false, false, true, false]);
  });

  it("hides the groups of a hidden class", () => {
    expect(ifcShownGroups(MESH, { storey: null, shown: [true, false, true] })).toEqual([true, true, false, true, false]);
  });

  it("boxes what is shown, and nothing when nothing is", () => {
    expect(ifcShownBounds(MESH, [false, false, true, true, false])).toEqual({ min: [2, -3, 0], max: [10, 1.5, 2] });
    expect(ifcShownBounds(MESH, [false, false, false, false, false])).toBeNull();
  });

  it("draws neighbouring groups in one run, what is opaque apart from what is seen through", () => {
    expect(ifcDrawRuns(MESH, [true, true, true, true, true])).toEqual({ opaque: [{ start: 0, count: 108 }], transparent: [{ start: 108, count: 9 }] });
    expect(ifcDrawRuns(MESH, [true, false, true, true, false])).toEqual({ opaque: [{ start: 0, count: 30 }, { start: 90, count: 18 }], transparent: [] });
    expect(ifcDrawRuns(MESH, [false, false, false, false, false])).toEqual({ opaque: [], transparent: [] });
  });
});

describe("the camera", () => {
  it("fits the whole box in the view, wide or tall, and fills it", () => {
    for (const aspect of [16 / 9, 1, 0.5]) {
      const camera = fitIfcCamera(BOX, aspect);
      const seen = corners(BOX).map((corner) => project(ifcViewProjection(camera, aspect, BOX), corner));
      for (const [x, y, z] of seen) {
        expect(Math.abs(x)).toBeLessThanOrEqual(1);
        expect(Math.abs(y)).toBeLessThanOrEqual(1);
        expect(Math.abs(z)).toBeLessThan(1);
      }
      expect(Math.max(...seen.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]))).toBeGreaterThan(0.5);
    }
  });

  it("looks at the middle of the box, from above", () => {
    const camera = fitIfcCamera(BOX, 1.5);

    expect(camera.target).toEqual([5, 0, 2]);
    expect(ifcEye(camera)[1]).toBeGreaterThan(camera.target[1]);
    const [x, y] = project(ifcViewProjection(camera, 1.5, BOX), camera.target);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
  });

  it("keeps the angles it is given when it fits again", () => {
    const turned = orbitIfcCamera(fitIfcCamera(BOX, 1), 120, -40);
    const fitted = fitIfcCamera({ min: [0, 0, 0], max: [1, 1, 1] }, 1, turned);

    expect([fitted.yaw, fitted.pitch]).toEqual([turned.yaw, turned.pitch]);
    expect(fitted.distance).toBeLessThan(turned.distance);
  });

  it("turns around its target with the hand, and never past the vertical", () => {
    const camera = fitIfcCamera(BOX, 1);
    const turned = orbitIfcCamera(camera, 100, 0);
    expect(turned.yaw).not.toBe(camera.yaw);
    expect(turned.pitch).toBe(camera.pitch);
    expect(turned.target).toEqual(camera.target);
    expect(turned.distance).toBe(camera.distance);

    expect(orbitIfcCamera(camera, 0, 100_000).pitch).toBeLessThan(Math.PI / 2);
    expect(orbitIfcCamera(camera, 0, 100_000).pitch).toBeGreaterThan(1.5);
    expect(orbitIfcCamera(camera, 0, -100_000).pitch).toBeGreaterThan(-Math.PI / 2);
    // The eye stays at the same distance of what it looks at.
    const eye = ifcEye(turned);
    expect(Math.hypot(eye[0] - turned.target[0], eye[1] - turned.target[1], eye[2] - turned.target[2])).toBeCloseTo(turned.distance, 9);
  });

  it("moves with the hand: what was at the centre follows the pointer", () => {
    const camera: IfcCamera = orbitIfcCamera(fitIfcCamera(BOX, 2), 37, 11);
    const moved = panIfcCamera(camera, 80, -30, 400);

    // A view 800 by 400: 80 pixels to the right is a fifth of the half-width, 30 pixels up 0,15 of the half-height.
    const [x, y] = project(ifcViewProjection(moved, 2, BOX), camera.target);
    expect(x).toBeCloseTo(0.2, 6);
    expect(y).toBeCloseTo(0.15, 6);
    expect(moved.distance).toBe(camera.distance);
  });

  it("comes closer and goes away within its limits", () => {
    const camera = fitIfcCamera(BOX, 1), limits = ifcCameraLimits(BOX);

    expect(zoomIfcCamera(camera, 2, limits).distance).toBeCloseTo(camera.distance / 2, 9);
    expect(zoomIfcCamera(camera, 1e9, limits).distance).toBe(limits.min);
    expect(zoomIfcCamera(camera, 1e-9, limits).distance).toBe(limits.max);
    expect(limits.min).toBeGreaterThan(0);
    expect(limits.max).toBeGreaterThan(camera.distance);
  });

  it("comes as close as what is shown asks, and goes as far as the whole model does", () => {
    // A valve of a metre in a building of ten: it is looked at from nearer than the building is.
    const valve: IfcBounds = { min: [2, 0.5, 1], max: [3, 1.5, 2] };
    const limits = ifcCameraLimits(valve, BOX);

    expect(limits.min).toBe(ifcCameraLimits(valve).min);
    expect(limits.min).toBeLessThan(ifcCameraLimits(BOX).min / 5);
    expect(limits.max).toBe(ifcCameraLimits(BOX).max);
  });

  it("still draws the whole model in depth from inside it and from far away", () => {
    const limits = ifcCameraLimits(BOX);
    for (const factor of [1e9, 1, 1e-9]) {
      const camera = zoomIfcCamera(fitIfcCamera(BOX, 1), factor, limits);
      const matrix = ifcViewProjection(camera, 1, BOX);
      expect([...matrix].every(Number.isFinite)).toBe(true);
      // What is in front of the eye is within the depth that is drawn.
      const eye = ifcEye(camera), ahead: IfcPoint = [0, 1, 2].map((axis) => eye[axis] + (camera.target[axis] - eye[axis]) * 0.5) as IfcPoint;
      expect(Math.abs(project(matrix, ahead)[2])).toBeLessThan(1);
    }
  });

  it("fits a model that is a single point without dividing by nothing", () => {
    const point: IfcBounds = { min: [3, 3, 3], max: [3, 3, 3] };
    const camera = fitIfcCamera(point, 1);

    expect(camera.distance).toBeGreaterThan(0);
    expect([...ifcViewProjection(camera, 1, point)].every(Number.isFinite)).toBe(true);
    expect(ifcCameraLimits(point).min).toBeGreaterThan(0);
  });
});
