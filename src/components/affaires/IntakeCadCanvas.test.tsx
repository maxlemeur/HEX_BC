import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readDxf } from "@/lib/cad/dxf";
import { dxfBytes, layer, line, text } from "@/lib/cad/dxf.test-utils";
import { buildCadScene, CAD_VIEW_MAX_TEXTS } from "@/lib/cad/view";
import { IntakeCadCanvas } from "./IntakeCadCanvas";

const WIDTH = 400, HEIGHT = 300;

/** A canvas context that draws nothing and remembers what it was asked. */
function installCanvas() {
  const context = {
    setTransform: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), stroke: vi.fn(), fill: vi.fn(),
    fillRect: vi.fn(), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  return context;
}

/** jsdom lays nothing out: the stage is given a size. */
function installLayout(width = WIDTH, height = HEIGHT) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(height);
}

/** Frames wait until the test lets them run, as they wait for the screen. */
function installFrames() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return () => act(() => {
    for (const callback of frames.splice(0)) callback(0);
  });
}

// Layers: « 0 », EF, EU. A horizontal run on EF and a vertical one on EU.
const drawing = readDxf(dxfBytes({
  layers: [layer("EF", 5), layer("EU", 30)],
  entities: [line("EF", 0, 0, 4000, 0), line("EU", 0, 0, 0, 3000)],
}));
const scene = buildCadScene(drawing);
const ALL = [true, true, true];

const stage = () => screen.getByRole("group", { name: /^Plan\./ });
/** Where the lines last drawn end, on the screen. */
const ends = (context: ReturnType<typeof installCanvas>) => context.lineTo.mock.calls.map(([x, y]) => [Math.round(x as number), Math.round(y as number)]);

/** The time a drawing takes, as the view measures it: none, unless the test says otherwise. */
function installClock(drawMs = 0) {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => (now += drawMs));
}

function open(shown: readonly boolean[] = ALL, large = false, drawMs = 0) {
  const context = installCanvas();
  installLayout();
  installClock(drawMs);
  const flush = installFrames();
  const view = render(<IntakeCadCanvas scene={scene} shown={shown} label="Plan Réseaux.dxf" large={large} />);
  flush();
  return { context, flush, view };
}

/** What the next frame draws. */
function redrawn(context: ReturnType<typeof installCanvas>, flush: () => void) {
  context.lineTo.mockClear();
  flush();
  return ends(context);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("IntakeCadCanvas", () => {
  it("draws the plan fitted to its stage, on a white sheet", () => {
    const { context } = open();
    const canvas = screen.getByRole("img", { name: "Plan Réseaux.dxf" }) as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([WIDTH, HEIGHT]);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, WIDTH, HEIGHT);
    // 4000 × 3000 in 400 × 300 less 12 px of margin: 0,092 px per unit, the drawing centred.
    expect(ends(context)).toEqual([[384, 288], [16, 12]]);
    expect(context.stroke).toHaveBeenCalledTimes(2);
  });

  it("draws only the layers shown, and stays where it is when one is hidden", async () => {
    const { context, flush, view } = open();
    await userEvent.click(screen.getByRole("button", { name: "Zoom arrière" }));
    const [run] = redrawn(context, flush);
    view.rerender(<IntakeCadCanvas scene={scene} shown={[true, true, false]} label="Plan Réseaux.dxf" />);
    expect(redrawn(context, flush)).toEqual([run]);
  });

  it("zooms about the centre with its buttons and fits again when asked", async () => {
    const { context, flush } = open();
    const fitted = ends(context);
    await userEvent.click(screen.getByRole("button", { name: "Zoom arrière" }));
    // The ends of the runs come closer to the centre by the step of the zoom.
    const towardsCentre = (x: number, y: number) => [Math.round(200 + (x - 200) / 1.4), Math.round(150 + (y - 150) / 1.4)];
    expect(redrawn(context, flush)).toEqual([towardsCentre(384, 288), towardsCentre(16, 12)]);

    await userEvent.click(screen.getByRole("button", { name: "Zoom avant" }));
    expect(redrawn(context, flush)).toEqual(fitted);

    await userEvent.click(screen.getByRole("button", { name: "Zoom arrière" }));
    flush();
    await userEvent.click(screen.getByRole("button", { name: "Ajuster" }));
    expect(redrawn(context, flush)).toEqual(fitted);
  });

  it("moves and zooms from the keyboard", () => {
    const { context, flush } = open();
    const fitted = ends(context);
    fireEvent.keyDown(stage(), { key: "ArrowLeft" });
    expect(redrawn(context, flush)).toEqual(fitted.map(([x, y]) => [x + 40, y]));
    fireEvent.keyDown(stage(), { key: "ArrowDown" });
    expect(redrawn(context, flush)).toEqual(fitted.map(([x, y]) => [x + 40, y - 40]));
    fireEvent.keyDown(stage(), { key: "-" });
    expect(redrawn(context, flush)).not.toEqual(fitted);
    fireEvent.keyDown(stage(), { key: "0" });
    expect(redrawn(context, flush)).toEqual(fitted);
    // A shortcut of the browser is left to it.
    fireEvent.keyDown(stage(), { key: "+", ctrlKey: true });
    expect(redrawn(context, flush)).toEqual([]);
  });

  it("zooms with the wheel on the point under the pointer, without scrolling the page", () => {
    const { context, flush } = open();
    const wheel = new WheelEvent("wheel", { deltaY: -100, clientX: 384, clientY: 288, bubbles: true, cancelable: true });
    act(() => void stage().dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(true);
    const zoomed = redrawn(context, flush);
    // What was under the pointer is still there; the rest moved away from it.
    expect(zoomed).toEqual([[384, 288]]);
  });

  it("follows a drag of the mouse", () => {
    const { context, flush } = open();
    const fitted = ends(context);
    fireEvent.pointerDown(stage(), { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100 });
    expect(stage().dataset.dragging).toBe("true");
    fireEvent.pointerMove(stage(), { pointerId: 1, pointerType: "mouse", clientX: 130, clientY: 90 });
    expect(redrawn(context, flush)).toEqual(fitted.map(([x, y]) => [x + 30, y - 10]));
    fireEvent.pointerUp(stage(), { pointerId: 1, pointerType: "mouse" });
    expect(stage().dataset.dragging).toBeUndefined();
    fireEvent.pointerMove(stage(), { pointerId: 1, pointerType: "mouse", clientX: 300, clientY: 300 });
    expect(redrawn(context, flush)).toEqual([]);
  });

  it("leaves a finger to scroll the page in the small view and follows it in the large one", () => {
    const small = open();
    fireEvent.pointerDown(stage(), { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage(), { pointerId: 1, pointerType: "touch", clientX: 150, clientY: 100 });
    expect(redrawn(small.context, small.flush)).toEqual([]);
    small.view.unmount();
    vi.restoreAllMocks();

    const large = open(ALL, true);
    const fitted = ends(large.context);
    fireEvent.pointerDown(stage(), { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage(), { pointerId: 1, pointerType: "touch", clientX: 150, clientY: 100 });
    expect(redrawn(large.context, large.flush)).toEqual(fitted.map(([x, y]) => [x + 50, y]));
  });

  it("zooms with two fingers spreading, about their middle", () => {
    const { context, flush } = open(ALL, true);
    // One finger holds the corner where the two runs meet, the other moves away along the EF run.
    fireEvent.pointerDown(stage(), { pointerId: 1, pointerType: "touch", clientX: 16, clientY: 288 });
    fireEvent.pointerDown(stage(), { pointerId: 2, pointerType: "touch", clientX: 116, clientY: 288 });
    fireEvent.pointerMove(stage(), { pointerId: 2, pointerType: "touch", clientX: 216, clientY: 288 });
    // The spread doubled: the plan is twice as large, and the corner is still under the first finger.
    expect(redrawn(context, flush)).toEqual([[16 + 2 * 368, 288], [16, 288 - 2 * 276]]);
  });

  it("carries a drawing that is slow to draw as a picture, and draws it again once the hand rests", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { context } = open(ALL, false, 50);
    const canvas = screen.getByRole("img", { name: "Plan Réseaux.dxf" });
    context.lineTo.mockClear();
    fireEvent.keyDown(stage(), { key: "ArrowLeft" });
    fireEvent.keyDown(stage(), { key: "ArrowLeft" });
    // As jsdom writes a move of 80 px to the right.
    expect(canvas.style.transform).toBe("translate(80px) scale(1)");
    expect(ends(context)).toEqual([]);

    act(() => void vi.advanceTimersByTime(140));
    expect(canvas.style.transform).toBe("");
    expect(ends(context)).toEqual([[384 + 80, 288], [16 + 80, 12]]);
  });

  it("says how many texts wait for a closer zoom", () => {
    const labels = Array.from({ length: CAD_VIEW_MAX_TEXTS + 3 }, (_, index) => text("EF", (index % 100) * 500, Math.floor(index / 100) * 500, 200, `T${index}`));
    const crowded = buildCadScene(readDxf(dxfBytes({ layers: [layer("EF", 5)], entities: labels })));
    installCanvas();
    installLayout(4000, 3000);
    const flush = installFrames();
    render(<IntakeCadCanvas scene={crowded} shown={[true, true]} label="Plan" />);
    flush();
    expect(screen.getByRole("status")).toHaveTextContent("3 textes non écrits à ce zoom : zoomez pour les lire.");
  });

  it("stops listening when it is closed", () => {
    const { context, flush, view } = open();
    const target = stage();
    view.unmount();
    fireEvent.keyDown(target, { key: "ArrowRight" });
    expect(redrawn(context, flush)).toEqual([]);
  });
});
