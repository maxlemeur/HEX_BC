"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";

import type { IfcMesh } from "@/lib/cad/ifc";
import {
  fitIfcCamera,
  ifcCameraLimits,
  ifcDrawRuns,
  ifcEye,
  ifcShownBounds,
  ifcViewProjection,
  orbitIfcCamera,
  panIfcCamera,
  zoomIfcCamera,
  type IfcBounds,
  type IfcCamera,
  type IfcDrawRun,
} from "@/lib/cad/ifc-view";

const ZOOM_STEP = 1.4;
/** Pixels of the hand an arrow key stands for. */
const KEY_STEP = 40;
const MAX_PIXEL_RATIO = 2;
const BACKGROUND = [0.93, 0.945, 0.96] as const;

// Lit from the eye, and a little from the sky: a face is told from its neighbour whatever the side it is seen from.
const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec4 aColor;
uniform mat4 uMatrix;
uniform vec3 uEye;
varying vec3 vNormal;
varying vec3 vToEye;
varying vec4 vColor;
void main() {
  vNormal = aNormal;
  vToEye = uEye - aPosition;
  vColor = aColor;
  gl_Position = uMatrix * vec4(aPosition, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vToEye;
varying vec4 vColor;
void main() {
  vec3 normal = normalize(vNormal);
  float facing = abs(dot(normal, normalize(vToEye)));
  float light = 0.36 + 0.5 * facing + 0.14 * (0.5 + 0.5 * normal.y);
  gl_FragColor = vec4(vColor.rgb * light, vColor.a);
}`;

type Gl = WebGLRenderingContext | WebGL2RenderingContext;

type Renderer = { draw(matrix: Float32Array, eye: readonly number[], runs: { opaque: IfcDrawRun[]; transparent: IfcDrawRun[] }): void; free(): void };

/** The first context the browser gives that can index every vertex of a model; null when it gives none. */
function openContext(canvas: HTMLCanvasElement): Gl | null {
  const options: WebGLContextAttributes = { alpha: false, antialias: true, depth: true };
  const second = canvas.getContext("webgl2", options) as WebGL2RenderingContext | null;
  if (second) return second;
  const first = canvas.getContext("webgl", options) as WebGLRenderingContext | null;
  // The first WebGL counts vertices to 65 536 unless it has this extension.
  return first && first.getExtension("OES_element_index_uint") ? first : null;
}

/** The mesh on the graphics card, with the program that draws it; null when the card refuses the program. */
function sendMesh(gl: Gl, mesh: IfcMesh): Renderer | null {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER), fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER), program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffers: (WebGLBuffer | null)[] = [];
  const attribute = (name: string, data: Float32Array | Int8Array | Uint8Array, size: number, type: number, normalized: boolean) => {
    const buffer = gl.createBuffer(), location = gl.getAttribLocation(program, name);
    buffers.push(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    if (location < 0) return;
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, type, normalized, 0, 0);
  };
  attribute("aPosition", mesh.positions, 3, gl.FLOAT, false);
  attribute("aNormal", mesh.normals, 3, gl.BYTE, true);
  attribute("aColor", mesh.colors, 4, gl.UNSIGNED_BYTE, true);
  const indices = gl.createBuffer();
  buffers.push(indices);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

  const matrixAt = gl.getUniformLocation(program, "uMatrix"), eyeAt = gl.getUniformLocation(program, "uEye");
  gl.enable(gl.DEPTH_TEST);
  // Shapes are seen from both sides: a wall from the room, a pipe cut by the storey shown.
  gl.disable(gl.CULL_FACE);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], 1);

  return {
    draw(matrix, eye, runs) {
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(matrixAt, false, matrix);
      gl.uniform3fv(eyeAt, eye);
      gl.disable(gl.BLEND);
      for (const run of runs.opaque) gl.drawElements(gl.TRIANGLES, run.count, gl.UNSIGNED_INT, run.start * 4);
      if (runs.transparent.length === 0) return;
      // What is seen through is drawn last, over what is behind it, and hides nothing.
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      for (const run of runs.transparent) gl.drawElements(gl.TRIANGLES, run.count, gl.UNSIGNED_INT, run.start * 4);
      gl.depthMask(true);
    },
    free() {
      for (const buffer of buffers) gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}

type IfcView = {
  /** False when the graphics card refuses the mesh or its program: there is then nothing to look at. */
  show(mesh: IfcMesh, shown: readonly boolean[]): boolean;
  zoom(factor: number): void;
  fit(): void;
  close(): void;
};

/**
 * The view of one stage: it sizes the canvas, draws the mesh and turns it with
 * the pointers, the wheel and the keyboard. Kept out of React, which only tells
 * it what to show. Null when the browser has no WebGL to draw with.
 *
 * The canvas is its own, made when it opens and taken away when it closes: a
 * canvas keeps the context it once gave, even after that context is given back.
 */
function openIfcView(stage: HTMLElement, options: { touch: boolean; label: string }): IfcView | null {
  const canvas = document.createElement("canvas");
  const gl = openContext(canvas);
  if (!gl) return null;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", options.label);
  stage.append(canvas);
  let mesh: IfcMesh | null = null, renderer: Renderer | null = null;
  let shown: readonly boolean[] = [];
  let camera: IfcCamera | null = null;
  let width = 0, height = 0;
  // Once moved by hand, the view is no longer fitted again when the stage is resized.
  let touched = false;
  let frame = 0;
  let closed = false;
  // The graphics card has taken the context back: nothing is drawn until it gives it again.
  let lost = false;
  const pointers = new Map<number, { x: number; y: number; pan: boolean }>();

  const model = (): IfcBounds | null => (mesh ? { min: mesh.min, max: mesh.max } : null);
  const visible = () => (mesh && ifcShownBounds(mesh, shown)) ?? model();
  const aspect = () => (height > 0 ? width / height : 1);

  const paint = () => {
    frame = 0;
    const seen = visible();
    if (!mesh || !renderer || !camera || !seen || width <= 0 || height <= 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    const runs = ifcDrawRuns(mesh, shown);
    // Only what is shown has to be within the depth that is drawn: a part seen alone is seen from as near as it asks.
    renderer.draw(ifcViewProjection(camera, aspect(), seen), ifcEye(camera), runs);
    // Read by the tests of the journeys: what is on the screen, without looking at its pixels.
    canvas.dataset.triangles = String([...runs.opaque, ...runs.transparent].reduce((sum, run) => sum + run.count, 0) / 3);
  };

  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(paint);
  };

  const move = (next: IfcCamera) => {
    camera = next;
    touched = true;
    schedule();
  };

  const fit = () => {
    const bounds = visible();
    if (!bounds || width <= 0 || height <= 0) return;
    camera = fitIfcCamera(bounds, aspect(), camera ?? undefined);
    touched = false;
    schedule();
  };

  const limits = () => {
    const whole = model();
    return whole ? ifcCameraLimits(visible() ?? whole, whole) : null;
  };

  const zoom = (factor: number) => {
    const within = limits();
    if (camera && within) move(zoomIfcCamera(camera, factor, within));
  };

  const measure = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (w === width && h === height) return;
    width = w;
    height = h;
    if (!camera || !touched) fit();
    else schedule();
  };

  const at = (event: { clientX: number; clientY: number }) => {
    const box = stage.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
    // A pinch on a trackpad comes as a wheel with the control key, in smaller steps.
    zoom(Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015)));
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch" ? !options.touch : event.button > 2) return;
    // The left button turns; with the shift key, or the other buttons, it moves.
    pointers.set(event.pointerId, { ...at(event), pan: event.pointerType !== "touch" && (event.shiftKey || event.button !== 0) });
    stage.setPointerCapture?.(event.pointerId);
    stage.dataset.dragging = "true";
  };

  const onPointerMove = (event: PointerEvent) => {
    const before = pointers.get(event.pointerId);
    if (!before || !camera) return;
    const now = { ...at(event), pan: before.pan };
    pointers.set(event.pointerId, now);
    const dx = now.x - before.x, dy = now.y - before.y;
    if (pointers.size === 1) return move(before.pan ? panIfcCamera(camera, dx, dy, height) : orbitIfcCamera(camera, dx, dy));
    const other = [...pointers].find(([id]) => id !== event.pointerId)?.[1], within = limits();
    if (!other || !within) return;
    // Two fingers: the model follows their middle and comes closer with their spread.
    const spreadBefore = Math.hypot(before.x - other.x, before.y - other.y), spread = Math.hypot(now.x - other.x, now.y - other.y);
    const panned = panIfcCamera(camera, dx / 2, dy / 2, height);
    move(spreadBefore > 0 && spread > 0 ? zoomIfcCamera(panned, spread / spreadBefore, within) : panned);
  };

  const onPointerEnd = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) delete stage.dataset.dragging;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!camera || event.ctrlKey || event.metaKey || event.altKey) return;
    const steps: Record<string, [number, number]> = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] };
    if (Object.hasOwn(steps, event.key)) {
      const [dx, dy] = steps[event.key];
      move(event.shiftKey ? panIfcCamera(camera, -dx, -dy, height) : orbitIfcCamera(camera, dx, dy));
    } else if (event.key === "+" || event.key === "=") zoom(ZOOM_STEP);
    else if (event.key === "-") zoom(1 / ZOOM_STEP);
    else if (event.key === "0") fit();
    else return;
    event.preventDefault();
  };

  // The right button moves the model: its menu would open over it.
  const onContextMenu = (event: Event) => event.preventDefault();

  // The graphics card may take the context back, and give it again: what was sent is then sent again.
  const onContextLost = (event: Event) => {
    event.preventDefault();
    window.cancelAnimationFrame(frame);
    frame = 0;
    renderer = null;
    lost = true;
  };
  const onContextRestored = () => {
    lost = false;
    renderer = mesh ? sendMesh(gl, mesh) : null;
    schedule();
  };

  stage.addEventListener("wheel", onWheel, { passive: false });
  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", onPointerEnd);
  stage.addEventListener("pointercancel", onPointerEnd);
  stage.addEventListener("keydown", onKeyDown);
  stage.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  const observer = new ResizeObserver(measure);
  observer.observe(stage);
  measure();

  return {
    show(nextMesh, nextShown) {
      const other = nextMesh !== mesh;
      shown = nextShown;
      if (other) {
        renderer?.free();
        mesh = nextMesh;
        renderer = lost ? null : sendMesh(gl, nextMesh);
        camera = null;
      }
      // Without its context the view waits for it: what is shown now is drawn when it comes back.
      if (!renderer && !lost) return false;
      // Showing or hiding a class leaves the view where it is.
      if (other || !camera) fit();
      else schedule();
      return true;
    },
    zoom,
    fit,
    close() {
      if (closed) return;
      closed = true;
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerEnd);
      stage.removeEventListener("pointercancel", onPointerEnd);
      stage.removeEventListener("keydown", onKeyDown);
      stage.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      delete stage.dataset.dragging;
      renderer?.free();
      renderer = null;
      // A browser keeps few contexts alive: this one is given back at once.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    },
  };
}

/**
 * A model that turns, moves and zooms. `shown` says which groups of the mesh are drawn.
 * `large` is the view opened in full: a finger turns the model there, where it scrolls the page in the small one.
 */
export function IntakeIfcCanvas({
  mesh,
  shown,
  label,
  large = false,
}: {
  mesh: IfcMesh;
  shown: readonly boolean[];
  label: string;
  large?: boolean;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const view = useRef<IfcView | null>(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    if (!stage.current) return;
    const opened = openIfcView(stage.current, { touch: large, label });
    if (!opened) return setAvailable(false);
    view.current = opened;
    return () => {
      opened.close();
      if (view.current === opened) view.current = null;
    };
  }, [large, label]);

  useEffect(() => {
    const opened = view.current;
    if (!opened || opened.show(mesh, shown)) return;
    opened.close();
    view.current = null;
    setAvailable(false);
  }, [mesh, shown, large, label]);

  if (!available) {
    return (
      <div className="document-cad-viewer">
        <p className="document-cad-note document-cad-unavailable" role="status">
          La vue 3D n’est pas disponible dans ce navigateur. Les quantités de la maquette restent disponibles.
        </p>
      </div>
    );
  }

  return (
    <div className="document-cad-viewer">
      <div className="document-pdf-toolbar">
        <div>{large ? "Glissez pour tourner, glissez avec Maj pour déplacer, molette pour zoomer" : "Glissez pour tourner, molette pour zoomer"}</div>
        <div>
          <button type="button" className="document-desk-icon" aria-label="Zoom arrière" onClick={() => view.current?.zoom(1 / ZOOM_STEP)}>
            <Minus size={15} />
          </button>
          <button type="button" className="document-desk-icon" aria-label="Zoom avant" onClick={() => view.current?.zoom(ZOOM_STEP)}>
            <Plus size={15} />
          </button>
          <button type="button" className="document-desk-text" onClick={() => view.current?.fit()}>
            Ajuster
          </button>
        </div>
      </div>
      <div
        ref={stage}
        className={large ? "document-cad-stage document-cad-stage-large" : "document-cad-stage"}
        tabIndex={0}
        role="group"
        aria-label="Maquette en 3D. Flèches pour tourner, Maj et flèches pour déplacer, plus et moins pour zoomer, zéro pour ajuster."
      />
    </div>
  );
}
