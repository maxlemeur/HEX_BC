"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";

import type { CadExtents } from "@/lib/cad/model";
import {
  cadSceneExtents,
  cadViewLimits,
  drawCadView,
  fitCadViewport,
  panCadViewport,
  zoomCadViewport,
  type CadScene,
  type CadViewLimits,
  type CadViewport,
} from "@/lib/cad/view";

/** A drawing that takes longer than this to draw follows the hand as a picture, and is drawn again once the hand rests. */
const SLOW_DRAW_MS = 30;
const SETTLE_MS = 140;
const ZOOM_STEP = 1.4;
const PAN_STEP = 40;
const MAX_PIXEL_RATIO = 2;

type CadView = {
  show(scene: CadScene, shown: readonly boolean[]): void;
  zoom(factor: number): void;
  fit(): void;
  close(): void;
};

/**
 * The view of one stage: it sizes the canvas, draws the scene and moves it with
 * the wheel, the pointers and the keyboard. Kept out of React, which only tells
 * it what to show: a move redraws the canvas, not the panel around it.
 */
function openCadView(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  options: { touch: boolean; onTextsOverLimit(count: number): void },
): CadView {
  let scene: CadScene | null = null;
  let shown: readonly boolean[] = [];
  let extents: CadExtents | null = null;
  let width = 0, height = 0;
  let viewport: CadViewport | null = null, drawn: CadViewport | null = null;
  let limits: CadViewLimits = { min: 0, max: Infinity };
  // Once moved by hand, the view is no longer fitted again when the stage is resized.
  let touched = false;
  let cost = 0;
  let frame = 0, settle = 0;
  const pointers = new Map<number, { x: number; y: number }>();

  const paint = () => {
    window.cancelAnimationFrame(frame);
    window.clearTimeout(settle);
    frame = 0;
    settle = 0;
    const ctx = canvas.getContext("2d");
    if (!ctx || !scene || !viewport || width <= 0 || height <= 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const started = performance.now();
    const stats = drawCadView(ctx, scene, viewport, { width, height, shown });
    cost = performance.now() - started;
    drawn = viewport;
    canvas.style.transform = "";
    options.onTextsOverLimit(stats.textsOverLimit);
  };

  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(paint);
  };

  const move = (next: CadViewport) => {
    viewport = next;
    touched = true;
    if (cost <= SLOW_DRAW_MS || !drawn) return schedule();
    canvas.style.transform = `translate(${(drawn.x - next.x) * next.scale}px, ${(next.y - drawn.y) * next.scale}px) scale(${next.scale / drawn.scale})`;
    window.clearTimeout(settle);
    settle = window.setTimeout(paint, SETTLE_MS);
  };

  /** The view zooms out to the whole drawing and in on what the layers show, whichever goes further. */
  const bounds = () => {
    if (!scene) return;
    const whole = cadViewLimits(fitCadViewport(scene.drawing.extents, width, height));
    const visible = cadViewLimits(fitCadViewport(extents, width, height));
    limits = { min: Math.min(whole.min, visible.min), max: Math.max(whole.max, visible.max) };
  };

  const fit = () => {
    if (!scene || width <= 0 || height <= 0) return;
    viewport = fitCadViewport(extents, width, height);
    touched = false;
    schedule();
  };

  const zoom = (factor: number, x = width / 2, y = height / 2) => {
    if (viewport) move(zoomCadViewport(viewport, factor, x, y, limits));
  };

  const measure = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (w === width && h === height) return;
    const before = { width, height };
    width = w;
    height = h;
    bounds();
    if (!viewport || !touched || before.width <= 0 || before.height <= 0) return fit();
    // What was at the centre stays there.
    viewport = { scale: viewport.scale, x: viewport.x + (before.width - w) / 2 / viewport.scale, y: viewport.y - (before.height - h) / 2 / viewport.scale };
    schedule();
  };

  const at = (event: { clientX: number; clientY: number }) => {
    const box = stage.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const onWheel = (event: WheelEvent) => {
    if (!viewport) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
    const point = at(event);
    // A pinch on a trackpad comes as a wheel with the control key, in smaller steps.
    zoom(Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015)), point.x, point.y);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch" ? !options.touch : event.button !== 0) return;
    pointers.set(event.pointerId, at(event));
    stage.setPointerCapture?.(event.pointerId);
    stage.dataset.dragging = "true";
  };

  const onPointerMove = (event: PointerEvent) => {
    const before = pointers.get(event.pointerId);
    if (!before || !viewport) return;
    const now = at(event);
    pointers.set(event.pointerId, now);
    if (pointers.size === 1) return move(panCadViewport(viewport, now.x - before.x, now.y - before.y));
    const other = [...pointers].find(([id]) => id !== event.pointerId)?.[1];
    if (!other) return;
    // Two fingers: the sheet follows their middle and zooms with their spread.
    const spreadBefore = Math.hypot(before.x - other.x, before.y - other.y), spread = Math.hypot(now.x - other.x, now.y - other.y);
    const panned = panCadViewport(viewport, (now.x - before.x) / 2, (now.y - before.y) / 2);
    move(spreadBefore > 0 && spread > 0 ? zoomCadViewport(panned, spread / spreadBefore, (now.x + other.x) / 2, (now.y + other.y) / 2, limits) : panned);
  };

  const onPointerEnd = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) delete stage.dataset.dragging;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!viewport || event.ctrlKey || event.metaKey || event.altKey) return;
    const pan: Record<string, [number, number]> = { ArrowLeft: [PAN_STEP, 0], ArrowRight: [-PAN_STEP, 0], ArrowUp: [0, PAN_STEP], ArrowDown: [0, -PAN_STEP] };
    if (Object.hasOwn(pan, event.key)) move(panCadViewport(viewport, pan[event.key][0], pan[event.key][1]));
    else if (event.key === "+" || event.key === "=") zoom(ZOOM_STEP);
    else if (event.key === "-") zoom(1 / ZOOM_STEP);
    else if (event.key === "0") fit();
    else return;
    event.preventDefault();
  };

  stage.addEventListener("wheel", onWheel, { passive: false });
  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", onPointerEnd);
  stage.addEventListener("pointercancel", onPointerEnd);
  stage.addEventListener("keydown", onKeyDown);
  const observer = new ResizeObserver(measure);
  observer.observe(stage);
  measure();

  return {
    show(nextScene, nextShown) {
      const other = nextScene !== scene;
      scene = nextScene;
      shown = nextShown;
      extents = cadSceneExtents(nextScene, nextShown) ?? nextScene.drawing.extents;
      bounds();
      // Showing or hiding a layer leaves the view where it is.
      if (other || !viewport) fit();
      else schedule();
    },
    zoom: (factor) => zoom(factor),
    fit,
    close() {
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerEnd);
      stage.removeEventListener("pointercancel", onPointerEnd);
      stage.removeEventListener("keydown", onKeyDown);
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      delete stage.dataset.dragging;
    },
  };
}

/**
 * A drawing on a sheet that zooms and moves. `large` is the view opened in full:
 * a finger moves the sheet there, where it scrolls the page in the small one.
 */
export function IntakeCadCanvas({
  scene,
  shown,
  label,
  large = false,
}: {
  scene: CadScene;
  shown: readonly boolean[];
  label: string;
  large?: boolean;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<CadView | null>(null);
  const [textsOverLimit, setTextsOverLimit] = useState(0);

  useEffect(() => {
    if (!stage.current || !canvas.current) return;
    const opened = openCadView(stage.current, canvas.current, { touch: large, onTextsOverLimit: setTextsOverLimit });
    view.current = opened;
    return () => {
      opened.close();
      if (view.current === opened) view.current = null;
    };
  }, [large]);

  useEffect(() => {
    view.current?.show(scene, shown);
  }, [scene, shown, large]);

  return (
    <div className="document-cad-viewer">
      <div className="document-pdf-toolbar">
        <div>{large ? "Glissez pour déplacer, molette pour zoomer" : "Molette pour zoomer"}</div>
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
        aria-label="Plan. Flèches pour déplacer, plus et moins pour zoomer, zéro pour ajuster."
      >
        <canvas ref={canvas} role="img" aria-label={label} />
      </div>
      {textsOverLimit > 0 && (
        <p className="document-cad-note" role="status">
          {textsOverLimit.toLocaleString("fr-FR")} texte{textsOverLimit > 1 ? "s" : ""} non écrit{textsOverLimit > 1 ? "s" : ""} à ce zoom : zoomez pour les lire.
        </p>
      )}
    </div>
  );
}
