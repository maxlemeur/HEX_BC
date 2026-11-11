import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IfcMesh, IfcMeshGroup, IfcPoint } from "@/lib/cad/ifc";
import { IntakeIfcCanvas } from "./IntakeIfcCanvas";

const WIDTH = 400, HEIGHT = 300;
const TRIANGLES = 4, UNSIGNED_INT = 5125;

/** A WebGL context that draws nothing and remembers what it was asked. */
function installWebgl(kind: "webgl2" | "webgl" | null = "webgl2", options: { wideIndices?: boolean; compiles?: boolean } = {}) {
  const asked = {
    drawElements: vi.fn(), uniformMatrix4fv: vi.fn(), uniform3fv: vi.fn(), bufferData: vi.fn(), viewport: vi.fn(), clear: vi.fn(), depthMask: vi.fn(),
    deleteBuffer: vi.fn(), deleteProgram: vi.fn(), useProgram: vi.fn(), loseContext: vi.fn(),
    getShaderParameter: vi.fn(() => options.compiles ?? true), getProgramParameter: vi.fn(() => true),
    getAttribLocation: vi.fn((_program: unknown, name: string) => ["aPosition", "aNormal", "aColor"].indexOf(name)),
  };
  const others = new Map<string, unknown>();
  const gl = new Proxy(asked as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === "TRIANGLES") return TRIANGLES;
      if (key === "UNSIGNED_INT") return UNSIGNED_INT;
      // A constant is a number of its own; anything else is a function that gives back an object.
      if (/^[A-Z0-9_]+$/.test(key)) return 30000 + [...key].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7) % 20000;
      if (key === "getExtension") return (name: string) => (name === "WEBGL_lose_context" ? { loseContext: asked.loseContext } : name === "OES_element_index_uint" && options.wideIndices === false ? null : {});
      if (!others.has(key)) others.set(key, vi.fn(() => ({})));
      return others.get(key);
    },
  });
  // As in a browser, a canvas whose context was given back keeps that dead context: it compiles nothing any more.
  const given = new WeakSet<HTMLCanvasElement>();
  let last: HTMLCanvasElement | null = null;
  const remember = (canvas: HTMLCanvasElement) => void (last = canvas);
  asked.loseContext.mockImplementation(() => void (last && given.add(last)));
  asked.getShaderParameter.mockImplementation(() => (options.compiles ?? true) && !(last && given.has(last)));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((function (this: HTMLCanvasElement, asking: string) {
    if (asking !== kind) return null;
    remember(this);
    return gl;
  }) as never);
  return asked;
}

function installLayout(width = WIDTH, height = HEIGHT) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(height);
}

function installFrames() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return () => act(() => {
    for (const callback of frames.splice(0)) callback(0);
  });
}

const group = (cls: number, storey: number, start: number, count: number, min: IfcPoint, max: IfcPoint, transparent = false): IfcMeshGroup => ({ cls, storey, transparent, start, count, min, max });

// Two storeys of walls, a pipe on the upper one, and a pane of glass.
const MESH: IfcMesh = {
  positions: new Float32Array(9), normals: new Int8Array(9), colors: new Uint8Array(12), indices: new Uint32Array(117),
  groups: [
    group(0, 0, 0, 30, [0, -3, 0], [10, 0, 4]),
    group(0, 1, 30, 60, [0, 0, 0], [10, 3, 4]),
    group(1, 1, 90, 18, [2, 0.5, 1], [3, 1.5, 2]),
    group(2, 1, 108, 9, [4, 1, 0], [6, 2, 0], true),
  ],
  min: [0, -3, 0], max: [10, 3, 4], triangles: 39, truncated: false,
};
const ALL = [true, true, true, true];

const stage = () => screen.getByRole("group", { name: /^Maquette en 3D\./ });
const canvas = () => screen.getByRole("img", { name: "Maquette Chaufferie.ifc" });

function open(shown: readonly boolean[] = ALL, large = false) {
  const gl = installWebgl();
  installLayout();
  const flush = installFrames();
  const view = render(<IntakeIfcCanvas mesh={MESH} shown={shown} label="Maquette Chaufferie.ifc" large={large} />);
  flush();
  return { gl, flush, view };
}

/** What a frame drew: the runs of indices, and the matrix it drew them with. */
function drawn(gl: ReturnType<typeof installWebgl>) {
  return {
    runs: gl.drawElements.mock.calls.map(([mode, count, type, offset]) => [mode, count, type, offset]),
    matrix: [...(gl.uniformMatrix4fv.mock.calls.at(-1)?.[2] as Float32Array ?? [])],
  };
}

/** Where the middle of the model lands: across and up from -1 to 1, and how far from the eye. */
function middle(matrix: number[]) {
  const [x, y, z] = [5, 0, 2];
  const at = (row: number) => matrix[row] * x + matrix[4 + row] * y + matrix[8 + row] * z + matrix[12 + row];
  return { x: at(0) / at(3), y: at(1) / at(3), away: at(3) };
}

function redrawn(gl: ReturnType<typeof installWebgl>, flush: () => void) {
  gl.drawElements.mockClear();
  flush();
  return drawn(gl);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("IntakeIfcCanvas", () => {
  it("draws the mesh once, what is opaque before what is seen through, and says how many triangles are on the screen", () => {
    const { gl } = open();

    expect(drawn(gl).runs).toEqual([[TRIANGLES, 108, UNSIGNED_INT, 0], [TRIANGLES, 9, UNSIGNED_INT, 108 * 4]]);
    expect(canvas().dataset.triangles).toBe("39");
    // What is seen through does not hide what is behind it: the depth is not written while it is drawn.
    expect(gl.depthMask.mock.calls.map(([on]) => on)).toEqual([true, false, true]);
    // The four buffers of the mesh are sent once.
    expect(gl.bufferData).toHaveBeenCalledTimes(4);
    expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, WIDTH, HEIGHT);
  });

  it("draws only what is shown, without moving the view nor sending the mesh again", () => {
    const { gl, flush, view } = open();
    const before = drawn(gl).matrix;

    view.rerender(<IntakeIfcCanvas mesh={MESH} shown={[true, false, true, false]} label="Maquette Chaufferie.ifc" />);
    const after = redrawn(gl, flush);

    expect(after.runs).toEqual([[TRIANGLES, 30, UNSIGNED_INT, 0], [TRIANGLES, 18, UNSIGNED_INT, 90 * 4]]);
    // Every point stays where it was on the screen; only how deep the view reaches follows what is shown.
    const onScreen = (matrix: number[]) => matrix.filter((_, index) => index % 4 !== 2);
    expect(onScreen(after.matrix)).toEqual(onScreen(before));
    expect(canvas().dataset.triangles).toBe("16");
    expect(gl.bufferData).toHaveBeenCalledTimes(4);
  });

  it("draws nothing when nothing is shown, and keeps the view for what comes back", () => {
    const { gl, flush, view } = open();

    const before = drawn(gl).matrix;

    view.rerender(<IntakeIfcCanvas mesh={MESH} shown={[false, false, false, false]} label="Maquette Chaufferie.ifc" />);
    expect(redrawn(gl, flush).runs).toEqual([]);
    expect(canvas().dataset.triangles).toBe("0");

    view.rerender(<IntakeIfcCanvas mesh={MESH} shown={ALL} label="Maquette Chaufferie.ifc" />);
    const back = redrawn(gl, flush);
    expect(back.runs).toHaveLength(2);
    expect(back.matrix).toEqual(before);
    expect(gl.bufferData).toHaveBeenCalledTimes(4);
  });

  it("comes as close to a small part shown alone as that part asks, not as the whole model does", () => {
    // The pipe alone: a cube of a metre in a model of ten.
    const { gl, flush } = open([false, false, true, false], true);
    // How far from the eye the middle of the pipe is, which the view is fitted on.
    const away = (matrix: number[]) => matrix[3] * 2.5 + matrix[7] * 1 + matrix[11] * 1.5 + matrix[15];

    for (let turn = 0; turn < 40; turn += 1) fireEvent.wheel(stage(), { deltaY: -4000 });

    // A five-hundredth of half its diagonal, where the whole model would stop seven times further.
    expect(away(redrawn(gl, flush).matrix)).toBeCloseTo(Math.sqrt(3) / 2 / 500, 5);
  });

  it("turns with the hand, moves with the shift key, and comes closer with the wheel", () => {
    const { gl, flush } = open(ALL, true);
    const fitted = drawn(gl).matrix;

    fireEvent.pointerDown(stage(), { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage(), { pointerId: 1, clientX: 160, clientY: 120 });
    fireEvent.pointerUp(stage(), { pointerId: 1 });
    const turned = redrawn(gl, flush).matrix;
    expect(turned).not.toEqual(fitted);
    // Turning keeps the middle of the model at the middle of the view, as far as it was.
    expect(middle(fitted)).toEqual({ x: expect.closeTo(0, 5), y: expect.closeTo(0, 5), away: expect.any(Number) });
    expect(middle(turned)).toEqual({ x: expect.closeTo(0, 5), y: expect.closeTo(0, 5), away: expect.closeTo(middle(fitted).away, 4) });

    fireEvent.pointerDown(stage(), { pointerId: 2, button: 0, shiftKey: true, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage(), { pointerId: 2, shiftKey: true, clientX: 140, clientY: 100 });
    fireEvent.pointerUp(stage(), { pointerId: 2 });
    const moved = redrawn(gl, flush).matrix;
    // 40 pixels to the right in a view 400 wide: a fifth of the half-width.
    expect(middle(moved)).toEqual({ x: expect.closeTo(0.2, 5), y: expect.closeTo(0, 5), away: expect.closeTo(middle(turned).away, 4) });

    fireEvent.wheel(stage(), { deltaY: -400 });
    const closer = redrawn(gl, flush).matrix;
    expect(middle(closer).away).toBeLessThan(middle(moved).away);
  });

  it("is driven from the keyboard and by its buttons, and fits again what is shown", async () => {
    const user = userEvent.setup();
    const { gl, flush } = open(ALL, true);
    const fitted = drawn(gl).matrix;

    stage().focus();
    await user.keyboard("{ArrowLeft}");
    const turned = redrawn(gl, flush).matrix;
    expect(turned).not.toEqual(fitted);
    await user.keyboard("+");
    expect(middle(redrawn(gl, flush).matrix).away).toBeLessThan(middle(turned).away);
    await user.click(screen.getByRole("button", { name: "Zoom arrière" }));
    await user.click(screen.getByRole("button", { name: "Zoom arrière" }));
    expect(middle(redrawn(gl, flush).matrix).away).toBeGreaterThan(middle(turned).away);

    // Fitting again brings the model whole in the view, seen from where the hand left it.
    await user.click(screen.getByRole("button", { name: "Ajuster" }));
    expect(middle(redrawn(gl, flush).matrix)).toEqual({ x: expect.closeTo(0, 5), y: expect.closeTo(0, 5), away: expect.closeTo(middle(fitted).away, 4) });

    // The keys are the stage's: they are heard once it has the focus again.
    stage().focus();
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(middle(redrawn(gl, flush).matrix).x).not.toBeCloseTo(0, 3);
    await user.keyboard("0");
    expect(middle(redrawn(gl, flush).matrix)).toEqual({ x: expect.closeTo(0, 5), y: expect.closeTo(0, 5), away: expect.closeTo(middle(fitted).away, 4) });
  });

  it("leaves the page scroll under a finger in the small view, and under the wheel nowhere", () => {
    const { gl, flush } = open(ALL, false);
    const fitted = drawn(gl).matrix;

    fireEvent.pointerDown(stage(), { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage(), { pointerId: 1, pointerType: "touch", clientX: 160, clientY: 120 });
    expect(redrawn(gl, flush).matrix).toEqual(fitted);

    const wheel = new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true });
    stage().dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
  });

  it("frees what it holds of the graphics card when it closes", () => {
    const { gl, view } = open();

    view.unmount();
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(4);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(gl.loseContext).toHaveBeenCalledTimes(1);
  });

  it("draws again when React mounts it twice, as it does in development", () => {
    const gl = installWebgl();
    installLayout();
    const flush = installFrames();
    render(<StrictMode><IntakeIfcCanvas mesh={MESH} shown={ALL} label="Maquette Chaufferie.ifc" /></StrictMode>);
    flush();

    expect(screen.queryByRole("status")).toBeNull();
    expect(drawn(gl).runs).toHaveLength(2);
    expect(screen.getAllByRole("img", { name: "Maquette Chaufferie.ifc" })).toHaveLength(1);
    expect(gl.loseContext).toHaveBeenCalledTimes(1);
  });

  it("opens a new context when it goes from the small view to the large one", () => {
    const { gl, flush, view } = open();

    view.rerender(<IntakeIfcCanvas mesh={MESH} shown={ALL} label="Maquette Chaufferie.ifc" large />);
    expect(redrawn(gl, flush).runs).toHaveLength(2);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("sends the mesh again and redraws when the graphics card gives the context back", () => {
    const { gl, flush } = open();

    const lost = new Event("webglcontextlost", { cancelable: true });
    act(() => void canvas().dispatchEvent(lost));
    // Saying no to the default is what allows the context to come back.
    expect(lost.defaultPrevented).toBe(true);
    act(() => void canvas().dispatchEvent(new Event("webglcontextrestored")));
    expect(redrawn(gl, flush).runs).toHaveLength(2);
    expect(gl.bufferData).toHaveBeenCalledTimes(8);
  });

  it("stays open when what is shown changes while the graphics card has taken the context back", () => {
    const { gl, flush, view } = open();

    act(() => void canvas().dispatchEvent(new Event("webglcontextlost", { cancelable: true })));
    view.rerender(<IntakeIfcCanvas mesh={MESH} shown={[true, false, true, false]} label="Maquette Chaufferie.ifc" />);
    // Nothing can be drawn for now, and nothing says that the view is gone.
    expect(redrawn(gl, flush).runs).toEqual([]);
    expect(screen.queryByRole("status")).toBeNull();

    act(() => void canvas().dispatchEvent(new Event("webglcontextrestored")));
    expect(redrawn(gl, flush).runs).toEqual([[TRIANGLES, 30, UNSIGNED_INT, 0], [TRIANGLES, 18, UNSIGNED_INT, 90 * 4]]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says that the view is not available where the browser has no WebGL, or cannot index so many vertices", () => {
    installWebgl(null);
    installLayout();
    installFrames();
    const view = render(<IntakeIfcCanvas mesh={MESH} shown={ALL} label="Maquette Chaufferie.ifc" />);

    expect(screen.getByRole("status")).toHaveTextContent("La vue 3D n’est pas disponible dans ce navigateur. Les quantités de la maquette restent disponibles.");
    expect(screen.queryByRole("button", { name: "Ajuster" })).toBeNull();
    view.unmount();

    installWebgl("webgl", { wideIndices: false });
    render(<IntakeIfcCanvas mesh={MESH} shown={ALL} label="Maquette Chaufferie.ifc" />);
    expect(screen.getByRole("status")).toHaveTextContent("La vue 3D n’est pas disponible");
  });

  it("draws with the first WebGL where the second is missing", () => {
    const gl = installWebgl("webgl");
    installLayout();
    const flush = installFrames();
    render(<IntakeIfcCanvas mesh={MESH} shown={ALL} label="Maquette Chaufferie.ifc" />);
    flush();

    expect(drawn(gl).runs).toHaveLength(2);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says that the view is not available when its program is refused", () => {
    const gl = installWebgl("webgl2", { compiles: false });
    installLayout();
    installFrames();
    const view = render(<IntakeIfcCanvas mesh={MESH} shown={ALL} label="Maquette Chaufferie.ifc" />);

    expect(screen.getByRole("status")).toHaveTextContent("La vue 3D n’est pas disponible");
    // The context it opened is given back, once.
    view.unmount();
    expect(gl.loseContext).toHaveBeenCalledTimes(1);
  });
});
