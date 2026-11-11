// The view of an IFC model: which groups of its mesh a storey and the classes
// show, and the camera that turns around it. Y is upwards, as in the mesh.
// Nothing here draws: the canvas does, with the matrix computed here.

import type { IfcMesh, IfcPoint } from "./ifc";
import type { IfcFilter } from "./ifc-quantities";

export type IfcBounds = { min: IfcPoint; max: IfcPoint };

/** The eye looks at `target` from `distance`, turned by `yaw` around the vertical and raised by `pitch` above the horizon, in radians. */
export type IfcCamera = { target: IfcPoint; distance: number; yaw: number; pitch: number };

export type IfcCameraLimits = { min: number; max: number };

export type IfcDrawRun = { start: number; count: number };

/** The vertical angle the view opens by. */
const FIELD_OF_VIEW = (35 * Math.PI) / 180;
const DEFAULT_ANGLES = { yaw: (35 * Math.PI) / 180, pitch: (28 * Math.PI) / 180 };
const MAX_PITCH = Math.PI / 2 - 0.02;
/** Radians a pixel of the hand turns the model by. */
const ORBIT_SPEED = 0.008;
/** The far plane over the near one: what a depth buffer of 24 bits tells apart. */
const DEPTH_RATIO = 4000;

/** Whether each group of the mesh is shown: on the storey kept, and of a class that is not hidden. */
export function ifcShownGroups(mesh: IfcMesh, filter: IfcFilter): boolean[] {
  return mesh.groups.map((group) => (filter.storey === null || group.storey === filter.storey) && filter.shown[group.cls] !== false);
}

/** The box around the groups shown; null when none is. */
export function ifcShownBounds(mesh: IfcMesh, shown: readonly boolean[]): IfcBounds | null {
  const min: IfcPoint = [Infinity, Infinity, Infinity], max: IfcPoint = [-Infinity, -Infinity, -Infinity];
  let any = false;
  mesh.groups.forEach((group, index) => {
    if (!shown[index]) return;
    any = true;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], group.min[axis]);
      max[axis] = Math.max(max[axis], group.max[axis]);
    }
  });
  return any ? { min, max } : null;
}

/** The indices to draw, neighbouring groups in one run: first what is opaque, then what is seen through. */
export function ifcDrawRuns(mesh: IfcMesh, shown: readonly boolean[]): { opaque: IfcDrawRun[]; transparent: IfcDrawRun[] } {
  const runs = { opaque: [] as IfcDrawRun[], transparent: [] as IfcDrawRun[] };
  mesh.groups.forEach((group, index) => {
    if (!shown[index] || group.count <= 0) return;
    const list = group.transparent ? runs.transparent : runs.opaque, last = list.at(-1);
    if (last && last.start + last.count === group.start) last.count += group.count;
    else list.push({ start: group.start, count: group.count });
  });
  return runs;
}

const centre = ({ min, max }: IfcBounds): IfcPoint => [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
/** Half the diagonal of a box, and never nothing: a model may be a single point. */
const radius = ({ min, max }: IfcBounds) => Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2, 1e-3);

/** The camera that sees the whole box, from the angles of `from`, or from above a corner. */
export function fitIfcCamera(bounds: IfcBounds, aspect: number, from: Pick<IfcCamera, "yaw" | "pitch"> = DEFAULT_ANGLES): IfcCamera {
  const vertical = FIELD_OF_VIEW / 2, horizontal = Math.atan(Math.tan(vertical) * Math.max(aspect, 0.05));
  // The ball around the box is seen whole through the narrower of the two angles.
  return { target: centre(bounds), distance: (radius(bounds) / Math.sin(Math.min(vertical, horizontal))) * 1.04, yaw: from.yaw, pitch: from.pitch };
}

/** How close the eye comes and how far it goes: as close as what is `shown` asks, as far as the `whole` model does. */
export function ifcCameraLimits(shown: IfcBounds, whole: IfcBounds = shown): IfcCameraLimits {
  return { min: radius(shown) / 500, max: radius(whole) * 40 };
}

/** Where the eye is. */
export function ifcEye({ target, distance, yaw, pitch }: IfcCamera): IfcPoint {
  return [target[0] + distance * Math.cos(pitch) * Math.sin(yaw), target[1] + distance * Math.sin(pitch), target[2] + distance * Math.cos(pitch) * Math.cos(yaw)];
}

/** Turns around the target: `dx` pixels to the right bring the right of the model forward, `dy` pixels down raise the eye. */
export function orbitIfcCamera(camera: IfcCamera, dx: number, dy: number): IfcCamera {
  const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, camera.pitch + dy * ORBIT_SPEED));
  return { ...camera, yaw: (camera.yaw - dx * ORBIT_SPEED) % (2 * Math.PI), pitch };
}

/** The right and the up of the screen, in the model. */
function screenAxes({ yaw, pitch }: IfcCamera): { right: IfcPoint; up: IfcPoint } {
  return {
    right: [Math.cos(yaw), 0, -Math.sin(yaw)],
    up: [-Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch), -Math.sin(pitch) * Math.cos(yaw)],
  };
}

/** Moves the model with the hand, by `dx` and `dy` pixels (down is positive) in a view `height` pixels high. */
export function panIfcCamera(camera: IfcCamera, dx: number, dy: number, height: number): IfcCamera {
  const perPixel = (2 * camera.distance * Math.tan(FIELD_OF_VIEW / 2)) / Math.max(height, 1);
  const { right, up } = screenAxes(camera);
  return { ...camera, target: [0, 1, 2].map((axis) => camera.target[axis] - right[axis] * dx * perPixel + up[axis] * dy * perPixel) as IfcPoint };
}

/** Comes closer by `factor` (further below 1), within the limits. */
export function zoomIfcCamera(camera: IfcCamera, factor: number, limits: IfcCameraLimits): IfcCamera {
  return { ...camera, distance: Math.max(limits.min, Math.min(limits.max, camera.distance / factor)) };
}

/**
 * The matrix that takes a point of the model to the screen (column by column, as WebGL reads it):
 * the perspective times the view. `drawn` is the box of what is drawn, which sets how deep the view reaches.
 */
export function ifcViewProjection(camera: IfcCamera, aspect: number, drawn: IfcBounds): Float32Array {
  const eye = ifcEye(camera), { right, up } = screenAxes(camera);
  const back: IfcPoint = [Math.cos(camera.pitch) * Math.sin(camera.yaw), Math.sin(camera.pitch), Math.cos(camera.pitch) * Math.cos(camera.yaw)];
  const dot = (a: IfcPoint, b: IfcPoint) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // The furthest what is drawn reaches from the eye, and the nearest plane that still tells depths apart.
  const middle = centre(drawn), reach = Math.hypot(eye[0] - middle[0], eye[1] - middle[1], eye[2] - middle[2]) + radius(drawn);
  const far = Math.max(reach, camera.distance) * 1.01, near = Math.max(far / DEPTH_RATIO, Math.min(camera.distance / 10, far / 2));
  const f = 1 / Math.tan(FIELD_OF_VIEW / 2), a = f / Math.max(aspect, 0.05), c = (far + near) / (near - far), d = (2 * far * near) / (near - far);
  const tx = -dot(right, eye), ty = -dot(up, eye), tz = -dot(back, eye);
  return new Float32Array([
    a * right[0], f * up[0], c * back[0], -back[0],
    a * right[1], f * up[1], c * back[1], -back[1],
    a * right[2], f * up[2], c * back[2], -back[2],
    a * tx, f * ty, c * tz + d, -tz,
  ]);
}
