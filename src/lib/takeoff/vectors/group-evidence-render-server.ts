import "server-only";

import { availableParallelism, totalmem } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { PDF_DRAWING_WARNINGS } from "@/lib/pdf/page-render-server";
import { GROUP_EVIDENCE_IMAGES, type EvidenceImagePlan, type GroupImagePlan } from "@/lib/takeoff/vectors/group-evidence-images";

// The images of the v2 group questions (TI-704), drawn once per page: one
// Node child process opens the PDF and analyses the page once (its operator
// list and the box of each operator, PDF.js `recordOperations`, while it
// draws the whole page for panel D), then draws only the windows asked
// (`operationsFilter`: the operators outside a window are skipped) and the
// panels of group-evidence-images.ts, one JPEG per group and per legend
// block. Measured on the heaviest development page (16 MB): a
// 160 pt window in 80 ms instead of 870 ms for the whole page drawn again,
// pixel for pixel the same; the experiment redrew the page for every window
// (2.8 s a group).
// - The session starts before the plan is known (startGroupEvidenceRender):
//   the child loads PDF.js and canvas at once; `ready` resolves once it has
//   the PDF, so that it analyses the page while the caller computes the
//   evidence; `draw` then sends the plan; `cancel` ends a session whose plan
//   never comes.
// - Every panel is drawn as measured: A and C are windows at their own scale
//   and origin, D the page's one drawing. The model is sensitive to them: C cut
//   from a page drawing (shifted under a pixel) changed Decisions' margins on
//   non-networks by up to 0.4 on the development plans, its networks alike.
// - Pictures follow the page reader's drawing reading (page-render-server.ts,
//   TI-715): `stopAtErrors` off so that a raster above
//   maxEmbeddedImagePixels is left out (counted in `dropped_images`) without
//   losing what is painted after it; a content error (PDF_DRAWING_WARNINGS)
//   fails the page's images closed; a page with annotations is then drawn
//   once more without them.
// - The child reads its header, the PDF and then its plan on stdin, gets no
//   environment but PATH and NODE_ENV, writes one bounded line per image, and
//   is killed at its deadline (counted from its start, longer by
//   perImageMs for each image of its plan). Nothing here throws:
//   no canvas, a JPEG over budget, a deadline or a crash give the issue and
//   no image; the caller sends no call for that page.
// - TI-704 latency (the page under 15 s): each image is handed over as soon
//   as it is drawn (draw's listener), so that a call leaves once its own
//   images are drawn, never waiting for the page's last one. A window two
//   groups share (the same focus cell) is drawn once and kept: the same
//   canvas, pixel for pixel (22 groups of the heaviest development page hold
//   15 windows, the windows being some 90 % of a group's drawing).
// - startGroupEvidenceRenders splits a page between processes (each analyses
//   the page, then draws its share; the groups of one window in one), only
//   in local mode on the creator's machine, started with the extraction
//   (groupEvidenceRenderPlan): a process holds up to 1.8 GB on the heaviest
//   development page, a server function one at a time, after the extraction.

export const GROUP_EVIDENCE_RENDER = {
  timeoutMs: 60_000, perImageMs: 1_500, heapMb: 768, maxInputBytes: 64 * 1024 * 1024, maxEmbeddedImagePixels: 8_000_000,
  /** Windows a process keeps for the groups that share them (about 1 MB each). */
  windowCache: 64,
  /** Drawing processes of one page at most (startGroupEvidenceRenders). */
  maxSessions: 3,
} as const;

export type GroupImage = { mimeType: "image/jpeg"; data: string; width: number; height: number; bytes: number };
export type GroupRenderIssue = "canvas_unavailable" | "render_failed" | "too_large" | "timeout";
export type GroupEvidenceImages = {
  legends: Array<GroupImage | null>;
  groups: Array<GroupImage | null>;
  issue: GroupRenderIssue | null;
  /** Embedded images the drawings lack (page-render-server.ts droppedImages). */
  dropped_images: number;
  /** The page's one analysis and its drawings, each legend's and each group's drawing and encoding, in the child. */
  render_ms: { page: number | null; legends: Array<number | null>; groups: Array<number | null> };
  duration_ms: number;
  /** Windows (A or C) a group took from an earlier group of the same focus instead of drawing them. */
  reused_windows?: number;
};
/** An image as soon as it is drawn: a legend block's or a group's, by its index in the plan. */
export type GroupImageEvent = { kind: "legends" | "groups"; index: number; image: GroupImage };
/**
 * A page's drawing session: `ready` once the child has the PDF (it then analyses the page), `draw` sends the plan
 * (once) and hands each image to `onImage` as it is drawn, `sent` once the plan has reached the child (a caller that
 * computes for long after draw waits for it: the plan, some MB, only leaves while its event loop runs), `cancel` ends it
 * where it is (nothing once it has ended).
 */
export type GroupEvidenceSession = {
  ready?: Promise<void>;
  draw(plan: Omit<EvidenceImagePlan, "page">, onImage?: (event: GroupImageEvent) => void): Promise<GroupEvidenceImages>;
  sent?: () => Promise<void>;
  cancel(): void;
};

const MARK = "__GROUP_EVIDENCE__";

const CHILD_SCRIPT = String.raw`
const MARK = ${JSON.stringify(MARK)};
const send = (message) => process.stdout.write(MARK + JSON.stringify(message) + "\n");
const LEFT_OUT = ${JSON.stringify(PDF_DRAWING_WARNINGS.leftOut)};
const CONTENT_ERRORS = ${JSON.stringify(PDF_DRAWING_WARNINGS.contentErrors)};
const LAYOUT = ${JSON.stringify(GROUP_EVIDENCE_IMAGES)};
// stdin: a header line, the PDF (header.bytes), then the plan line.
const parts = [];
let size = 0, stage = "header", header = null, pdfBytes = null;
let resolvePlan;
const planReady = new Promise((resolve) => { resolvePlan = resolve; });
let resolvePdf;
const pdfReady = new Promise((resolve) => { resolvePdf = resolve; });
let resolveHeader;
const headerReady = new Promise((resolve) => { resolveHeader = resolve; });
const take = () => { const all = Buffer.concat(parts, size); parts.length = 0; size = 0; return all; };
const keep = (rest) => { if (rest.length > 0) { parts.push(rest); size += rest.length; } };
let planLine = false;
process.stdin.on("data", (chunk) => {
  parts.push(chunk);
  size += chunk.length;
  // Only the new chunk is searched for the plan's end: the plan may be megabytes long.
  if (stage === "plan" && chunk.indexOf(10) >= 0) planLine = true;
  if (stage === "header") {
    const all = take();
    const end = all.indexOf(10);
    if (end < 0) { keep(all); return; }
    header = JSON.parse(all.subarray(0, end).toString("utf8"));
    keep(all.subarray(end + 1));
    stage = "pdf";
    resolveHeader();
  }
  if (stage === "pdf") {
    if (size < header.bytes) return;
    const all = take();
    pdfBytes = new Uint8Array(all.subarray(0, header.bytes));
    const rest = all.subarray(header.bytes);
    keep(rest);
    planLine = rest.indexOf(10) >= 0;
    stage = "plan";
    resolvePdf();
  }
  if (stage === "plan" && planLine) {
    const all = take();
    stage = "done";
    resolvePlan(JSON.parse(all.subarray(0, all.indexOf(10)).toString("utf8")));
  }
});
process.stdin.on("end", () => resolvePlan(null));
// The render being drawn: only counts are kept.
let seen = null;
console.warn = (...args) => {
  const current = seen;
  if (!current) return;
  const message = args.map(String).join(" ");
  if (LEFT_OUT.some((prefix) => message.startsWith(prefix))) current.dropped++;
  else if (!current.failed && CONTENT_ERRORS.some((prefix) => message.startsWith(prefix))) {
    current.failed = true;
    queueMicrotask(() => { if (!current.done && current.task) current.task.cancel(); });
  }
};
const white = (canvas) => { const context = canvas.getContext("2d"); context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); return context; };
async function run() {
  // Canvas and PDF.js load while the PDF is still coming.
  await headerReady;
  let graphics = null;
  if (header.canvasPath) { try { graphics = require(header.canvasPath); } catch {} }
  if (!graphics) { send({ canvas: false }); process.exit(0); }
  const pdfjsLoading = import(header.pdfUrl);
  await pdfReady;
  let font = "sans-serif";
  try { if (graphics.GlobalFonts.registerFromPath(header.fontPath, "GroupEvidenceSans")) font = "GroupEvidenceSans"; } catch {}
  const encode = (canvas, qualities) => {
    for (const quality of qualities) {
      const jpeg = canvas.encodeSync("jpeg", quality);
      if (jpeg.length <= header.maxBytes) return { mimeType: "image/jpeg", data: jpeg.toString("base64"), width: canvas.width, height: canvas.height, bytes: jpeg.length };
    }
    return null;
  };
  const pdfjs = await pdfjsLoading;
  const open = () => pdfjs.getDocument({ data: new Uint8Array(pdfBytes), standardFontDataUrl: header.packageRoot + "/standard_fonts/",
    cMapUrl: header.packageRoot + "/cmaps/", cMapPacked: true, wasmUrl: header.packageRoot + "/wasm/", iccUrl: header.packageRoot + "/iccs/",
    useWorkerFetch: false, verbosity: 1, useSystemFonts: true, maxImageSize: header.maxEmbeddedImagePixels, stopAtErrors: false });
  const started = Date.now();
  let task = open();
  let pdf = await task.promise;
  let page = await pdf.getPage(header.page);
  const size = page.getViewport({ scale: 1 });
  const P = LAYOUT.panelPx, C = LAYOUT.captionPx, inner = P - C;
  const detailScale = inner / LAYOUT.detailPt, contextScale = inner / LAYOUT.contextPt;
  const pageScale = Math.min(P / size.width, inner / size.height);
  // The page drawn whole for panel D, recording each operator's box: the page's one analysis.
  const drawWhole = async (scale, annotationMode) => {
    const canvas = graphics.createCanvas(Math.max(1, Math.ceil(size.width * scale)), Math.max(1, Math.ceil(size.height * scale)));
    const context = white(canvas);
    seen = { dropped: 0, failed: false, done: false, task: null };
    seen.task = page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale }), annotationMode, recordOperations: true });
    try { await seen.task.promise; } catch (error) { if (!seen.failed) throw error; }
    seen.done = true;
    const result = { canvas, dropped: seen.dropped, failed: seen.failed };
    seen = null;
    return result;
  };
  let annotationMode = pdfjs.AnnotationMode.ENABLE;
  let first = await drawWhole(pageScale, annotationMode);
  if (first.failed && (await page.getAnnotations()).length > 0) {
    // As the page reader: a broken annotation is left out, on a new reading (the failed one may still be working).
    await task.destroy().catch(() => {});
    task = open();
    pdf = await task.promise;
    page = await pdf.getPage(header.page);
    annotationMode = pdfjs.AnnotationMode.DISABLE;
    first = await drawWhole(pageScale, annotationMode);
  }
  if (first.failed) { send({ issue: "render_failed" }); return; }
  const pageCanvas = first.canvas;
  const boxes = page.recordedBBoxes;
  send({ page_ms: Date.now() - started, dropped: first.dropped });
  const plan = await planReady;
  if (!plan) { await task.destroy().catch(() => {}); return; }
  // A window of the page at a scale: only the operators whose box meets it are drawn.
  const drawWindow = async (window, scale, width, height) => {
    const canvas = graphics.createCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
    const context = white(canvas);
    const x0 = window.x0 / size.width, y0 = window.y0 / size.height, x1 = window.x1 / size.width, y1 = window.y1 / size.height;
    const operationsFilter = boxes ? (index) => !boxes.isEmpty(index) && boxes.minX(index) <= x1 && boxes.maxX(index) >= x0
      && boxes.minY(index) <= y1 && boxes.maxY(index) >= y0 : undefined;
    seen = { dropped: 0, failed: false, done: false, task: null };
    seen.task = page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale, offsetX: -window.x0 * scale, offsetY: -window.y0 * scale }),
      annotationMode, operationsFilter });
    try { await seen.task.promise; } catch (error) { if (!seen.failed) throw error; }
    seen.done = true;
    const failed = seen.failed;
    seen = null;
    if (failed) throw new Error("content error");
    return canvas;
  };
  // A window two groups share (the same focus) is drawn once and kept: the same canvas, pixel for pixel.
  const windows = new Map();
  let reused = 0;
  const keptWindow = async (window, scale, width, height) => {
    const key = [window.x0, window.y0, window.x1, window.y1, scale, width, height].join(" ");
    const kept = windows.get(key);
    if (kept) { reused++; return kept; }
    const canvas = await drawWindow(window, scale, width, height);
    if (windows.size >= header.windowCache) windows.delete(windows.keys().next().value);
    windows.set(key, canvas);
    return canvas;
  };
  for (const [index, legend] of plan.legends.entries()) {
    const begun = Date.now();
    const box = legend.box;
    const canvas = await drawWindow(box, legend.scale, (box.x1 - box.x0) * legend.scale, (box.y1 - box.y0) * legend.scale);
    const image = encode(canvas, LAYOUT.legend.jpegQualities);
    send(image ? { legend: index, image, render_ms: Date.now() - begun } : { legend: index, issue: "too_large", render_ms: Date.now() - begun });
  }
  const fade = (context, alpha) => { context.fillStyle = "rgba(255,255,255," + alpha + ")"; context.fillRect(0, 0, P, P); };
  const strokeGroup = (context, paths, x0, y0, scale, minWidth, trueWidth) => {
    for (const pass of [0, 1]) {
      for (const path of paths) {
        if (pass === 0 && !path.outline) continue;
        const width = Math.max(minWidth, trueWidth ? path.width * scale : 0);
        context.strokeStyle = pass === 0 ? LAYOUT.outline.color : path.color;
        context.lineWidth = pass === 0 ? width + LAYOUT.outline.extraPx : width;
        context.beginPath();
        for (let point = 0; point < path.points.length; point += 2) {
          const x = (path.points[point] - x0) * scale, y = C + (path.points[point + 1] - y0) * scale;
          if (point === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.stroke();
      }
    }
  };
  const panel = (sheet, px, py, label, draw) => {
    const canvas = graphics.createCanvas(P, P);
    const context = white(canvas);
    context.lineJoin = "round";
    context.lineCap = "round";
    draw(context);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, P, C);
    context.fillStyle = "#000000";
    context.font = LAYOUT.captionFontPx + "px " + font;
    context.textBaseline = "middle";
    context.fillText(label, 6, C / 2);
    context.strokeStyle = LAYOUT.border;
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, P - 1, P - 1);
    sheet.drawImage(canvas, px, py);
  };
  const frame = (context, x, y, width, height) => {
    context.strokeStyle = LAYOUT.frame.color;
    context.lineWidth = LAYOUT.frame.widthPx;
    context.strokeRect(x, y, width, height);
  };
  for (const [index, group] of plan.groups.entries()) {
    const begun = Date.now();
    const sheetCanvas = graphics.createCanvas(2 * P, 2 * P);
    const sheet = white(sheetCanvas);
    // A: the real plan over the pipe-scale window, its width the panel's at that scale, centred on the group's focus.
    const detailWidth = P / detailScale;
    const dx0 = group.detail.x0 + (LAYOUT.detailPt - detailWidth) / 2, dy0 = group.detail.y0;
    const real = await keptWindow({ x0: dx0, y0: dy0, x1: dx0 + detailWidth, y1: group.detail.y1 }, detailScale, P, inner);
    panel(sheet, 0, 0, "A " + group.alias + " : plan réel, tronçon (" + LAYOUT.detailPt + " pt)", (context) => context.drawImage(real, 0, C));
    panel(sheet, P, 0, "B " + group.alias + " : même vue, groupe dans sa couleur", (context) => {
      context.drawImage(real, 0, C);
      fade(context, LAYOUT.fade.detail);
      strokeGroup(context, group.paths, dx0, dy0, detailScale, LAYOUT.minLineWidthPx.detail, true);
    });
    // C: the surroundings, a window at their own scale.
    const contextWidth = P / contextScale;
    const cx0 = group.context.x0 + (LAYOUT.contextPt - contextWidth) / 2, cy0 = group.context.y0;
    const around = await keptWindow({ x0: cx0, y0: cy0, x1: cx0 + contextWidth, y1: group.context.y1 }, contextScale, P, inner);
    panel(sheet, 0, P, "C " + group.alias + " : environs (" + LAYOUT.contextPt + " pt), groupe en couleur", (context) => {
      context.drawImage(around, 0, C);
      fade(context, LAYOUT.fade.context);
      strokeGroup(context, group.paths, cx0, cy0, contextScale, LAYOUT.minLineWidthPx.context, false);
      frame(context, (dx0 - cx0) * contextScale, C + (dy0 - cy0) * contextScale, detailWidth * contextScale, LAYOUT.detailPt * contextScale);
    });
    // D: the whole page, its drawing at its own scale.
    panel(sheet, P, P, "D " + group.alias + " : page entière, groupe en couleur", (context) => {
      context.drawImage(pageCanvas, 0, C);
      fade(context, LAYOUT.fade.page);
      strokeGroup(context, group.paths, 0, 0, pageScale, LAYOUT.minLineWidthPx.page, false);
      frame(context, group.context.x0 * pageScale, C + group.context.y0 * pageScale, LAYOUT.contextPt * pageScale, LAYOUT.contextPt * pageScale);
    });
    const image = encode(sheetCanvas, LAYOUT.jpegQualities);
    send(image ? { group: index, image, render_ms: Date.now() - begun } : { group: index, issue: "too_large", render_ms: Date.now() - begun });
  }
  send({ done: true, reused });
  await task.destroy().catch(() => {});
}
run().catch(() => send({ failed: true }));
`;

function resolveRuntime() {
  // Resolved through Node's own require, as page-render-server.ts does: bundlers rewrite static imports of node:module.
  const requireFromProject = process.getBuiltinModule("node:module").createRequire(join(process.cwd(), "package.json"));
  const packageRoot = join(process.cwd(), "node_modules/pdfjs-dist");
  const pdfUrl = pathToFileURL(requireFromProject.resolve(["pdfjs-dist", "legacy", "build", "pdf.mjs"].join("/"))).href;
  let canvasPath: string | null = null;
  try {
    canvasPath = requireFromProject.resolve("@napi-rs/canvas");
  } catch {
    canvasPath = null;
  }
  return { packageRoot, pdfUrl, canvasPath, fontPath: join(packageRoot, "standard_fonts/LiberationSans-Regular.ttf") };
}

type ChildMessage = {
  canvas?: boolean; issue?: GroupRenderIssue; page_ms?: number; dropped?: number;
  legend?: number; group?: number; image?: GroupImage; render_ms?: number; done?: true; failed?: true; reused?: number;
};

type RenderOptions = {
  timeoutMs?: number;
  /** Test seam: null stands for a server without the canvas module. */
  canvasPath?: string | null;
  maxBytes?: number;
};

/**
 * Starts a page's drawing session: the child analyses the page at once, the plan follows with `draw` (one plan per
 * session). Never throws: every failure is the issue of the images `draw` gives.
 */
export function startGroupEvidenceRender(bytes: Uint8Array, page: number, options: RenderOptions = {}): GroupEvidenceSession {
  const started = Date.now();
  const maxBytes = options.maxBytes ?? GROUP_EVIDENCE_IMAGES.maxBytes;
  const maxLine = 64 * 1024 + Math.ceil((maxBytes * 4) / 3);
  const state = {
    issue: null as GroupRenderIssue | null, ended: false, dropped: 0, pageMs: null as number | null,
    images: { legends: new Map<number, GroupImage>(), groups: new Map<number, GroupImage>() },
    times: { legends: new Map<number, number>(), groups: new Map<number, number>() },
    imageIssue: null as GroupRenderIssue | null,
    reused: 0,
  };
  let plan: Omit<EvidenceImagePlan, "page"> | null = null;
  let listener: ((event: GroupImageEvent) => void) | null = null;
  let resolveEnd: () => void = () => {};
  const ended = new Promise<void>((resolve) => {
    resolveEnd = resolve;
  });
  let child: import("node:child_process").ChildProcessByStdio<import("node:stream").Writable, import("node:stream").Readable, null> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  let resolveSent: () => void = () => {};
  const sent = new Promise<void>((resolve) => {
    resolveSent = resolve;
  });
  const finish = (issue: GroupRenderIssue | null) => {
    if (state.ended) return;
    state.ended = true;
    state.issue ??= issue;
    if (timer) clearTimeout(timer);
    child?.kill("SIGKILL");
    resolveReady();
    resolveSent();
    resolveEnd();
  };
  const timeoutMs = options.timeoutMs ?? GROUP_EVIDENCE_RENDER.timeoutMs;
  /**
   * The deadline, counted from the start, then from the plan for its `images` (a session may start with the page's
   * extraction, TI-704): longer by perImageMs each. A given timeoutMs never moves.
   */
  const arm = (images: number) => {
    if (state.ended) return;
    if (timer) clearTimeout(timer);
    const from = options.timeoutMs === undefined && images > 0 ? Math.max(started, Date.now()) : started;
    const extra = options.timeoutMs === undefined ? images * GROUP_EVIDENCE_RENDER.perImageMs : 0;
    timer = setTimeout(() => finish("timeout"), Math.max(0, from + timeoutMs + extra - Date.now()));
  };
  const result = (): GroupEvidenceImages => {
    const legends = (plan?.legends ?? []).map((_, index) => state.images.legends.get(index) ?? null);
    const groups = (plan?.groups ?? []).map((_, index) => state.images.groups.get(index) ?? null);
    const timedOut = state.issue === "timeout";
    return {
      legends: timedOut ? legends.map(() => null) : legends, groups: timedOut ? groups.map(() => null) : groups,
      issue: state.issue ?? state.imageIssue, dropped_images: state.dropped,
      render_ms: { page: state.pageMs, legends: (plan?.legends ?? []).map((_, index) => state.times.legends.get(index) ?? null),
        groups: (plan?.groups ?? []).map((_, index) => state.times.groups.get(index) ?? null) },
      duration_ms: Date.now() - started, reused_windows: state.reused,
    };
  };
  const runtime = resolveRuntime();
  const canvasPath = options.canvasPath === undefined ? runtime.canvasPath : options.canvasPath;
  if (!canvasPath) finish("canvas_unavailable");
  else if (!bytes.byteLength || bytes.byteLength > GROUP_EVIDENCE_RENDER.maxInputBytes) finish("render_failed");
  else {
    try {
      const { spawn } = process.getBuiltinModule("node:child_process");
      child = spawn(process.execPath, [`--max-old-space-size=${GROUP_EVIDENCE_RENDER.heapMb}`, "-e", CHILD_SCRIPT], {
        stdio: ["pipe", "pipe", "ignore"],
        cwd: process.cwd(),
        // The drawing needs no key, token or server secret.
        env: { PATH: process.env.PATH ?? "", NODE_ENV: process.env.NODE_ENV ?? "development" },
      });
      const running = child;
      arm(0);
      let pending = "";
      let outputBytes = 0;
      const decoder = new TextDecoder();
      running.stdout.on("data", (chunk: Buffer) => {
        if (state.ended) return;
        outputBytes += chunk.byteLength;
        const expected = plan ? plan.legends.length + plan.groups.length : 0;
        if (outputBytes > maxLine * (expected + 4)) return finish("render_failed");
        pending += decoder.decode(chunk, { stream: true });
        if (pending.length > maxLine) return finish("render_failed");
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (!line.startsWith(MARK)) continue;
          let message: ChildMessage;
          try {
            message = JSON.parse(line.slice(MARK.length)) as ChildMessage;
          } catch {
            return finish("render_failed");
          }
          if (message.canvas === false) return finish("canvas_unavailable");
          if (message.failed) return finish("render_failed");
          if (message.issue && message.legend === undefined && message.group === undefined) return finish(message.issue);
          if (message.page_ms !== undefined) {
            state.pageMs = message.page_ms;
            state.dropped = Math.max(0, Math.floor(message.dropped ?? 0));
          }
          if (message.done) {
            state.reused = Math.max(0, Math.floor(message.reused ?? 0));
            const complete = plan !== null && plan.legends.every((_, index) => state.images.legends.has(index))
              && plan.groups.every((_, index) => state.images.groups.has(index));
            return finish(complete ? null : state.imageIssue ?? "render_failed");
          }
          const kind = message.legend !== undefined ? "legends" as const : message.group !== undefined ? "groups" as const : null;
          const index = message.legend ?? message.group;
          const size = kind === null || !plan ? 0 : plan[kind].length;
          if (kind === null || index === undefined || !Number.isInteger(index) || index < 0 || index >= size) continue;
          if (message.render_ms !== undefined) state.times[kind].set(index, message.render_ms);
          if (message.image) {
            state.images[kind].set(index, message.image);
            // Handed over as drawn: the caller's call may leave before the page's last image.
            try {
              listener?.({ kind, index, image: message.image });
            } catch {
              // A listener's error is the caller's own, never the drawing's.
            }
          } else state.imageIssue ??= message.issue ?? "render_failed";
        }
      });
      running.once("error", () => finish("render_failed"));
      running.once("close", () => finish("render_failed"));
      running.stdin.on("error", () => finish("render_failed"));
      running.stdout.on("error", () => finish("render_failed"));
      const header = JSON.stringify({ ...runtime, canvasPath, page, maxBytes, bytes: bytes.byteLength,
        maxEmbeddedImagePixels: GROUP_EVIDENCE_RENDER.maxEmbeddedImagePixels, windowCache: GROUP_EVIDENCE_RENDER.windowCache });
      running.stdin.write(`${header}\n`);
      // Ready once the child has read the PDF: the caller then computes while the child analyses the page.
      running.stdin.write(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), () => resolveReady());
    } catch {
      finish("render_failed");
    }
  }
  let drawn: Promise<GroupEvidenceImages> | null = null;
  return {
    ready,
    draw(next, onImage) {
      if (drawn) return drawn;
      listener = onImage ?? null;
      plan = { legends: next.legends, groups: next.groups.map((group) => ({ ...group })) };
      arm(plan.legends.length + plan.groups.length);
      if (!state.ended && child) {
        try {
          child.stdin.end(`${JSON.stringify({ legends: plan.legends, groups: plan.groups.map((group) => ({ alias: group.alias, detail: group.detail,
            context: group.context, paths: group.paths })) })}\n`, () => resolveSent());
        } catch {
          finish("render_failed");
        }
      } else resolveSent();
      drawn = ended.then(result);
      return drawn;
    },
    sent: () => (drawn ? sent : Promise.resolve()),
    cancel() {
      finish(state.issue);
    },
  };
}

/** Draws a page's legend blocks and group images in one child process; never throws. */
export async function renderGroupEvidence(bytes: Uint8Array, plan: EvidenceImagePlan, options: RenderOptions = {}): Promise<GroupEvidenceImages> {
  if (plan.legends.length === 0 && plan.groups.length === 0) {
    return { legends: [], groups: [], issue: null, dropped_images: 0, render_ms: { page: null, legends: [], groups: [] }, duration_ms: 0, reused_windows: 0 };
  }
  return startGroupEvidenceRender(bytes, plan.page, options).draw(plan);
}

/**
 * How a page is drawn (TI-704): its processes, and whether they start with its extraction or once it has ended. On a
 * server, one process once the extraction has ended (a process holds up to 1.8 GB on the heaviest development page, the
 * extraction 1.3 GB: a function's memory holds one at a time). In local mode, on the creator's machine, with the
 * extraction: one process per 8 GiB of memory (beside a development server and a browser), two cores left to the job
 * and its extraction, GROUP_EVIDENCE_RENDER.maxSessions at most.
 */
export function groupEvidenceRenderPlan(mode: "server" | "local", machine: { cores: number; memoryBytes: number } = {
  cores: availableParallelism(), memoryBytes: totalmem(),
}): { sessions: number; withExtraction: boolean } {
  if (mode === "server") return { sessions: 1, withExtraction: false };
  return { sessions: Math.max(1, Math.min(GROUP_EVIDENCE_RENDER.maxSessions, machine.cores - 2, Math.floor(machine.memoryBytes / 2 ** 33))),
    withExtraction: true };
}

/** What a window drawn, a window kept and a legend block cost a process, measured on the heaviest development page (about 330, 45 and 80 ms). */
const SHARE_COST = { window: 1, kept: 0.15, legend: 0.25 } as const;
const windowsOf = (group: Pick<GroupImagePlan, "detail" | "context">) => [group.detail.x0, group.detail.y0, group.detail.x1, group.detail.y1,
  group.context.x0, group.context.y0, group.context.x1, group.context.y1].join(" ");

/**
 * The process of each group of a plan, in its order: the groups of one window to the process that draws it (it keeps the
 * window), any other to the least busy one (the first on a tie); the first process draws the `legends` blocks first.
 */
export function renderShares(groups: ReadonlyArray<Pick<GroupImagePlan, "detail" | "context">>, sessions: number, legends = 0): number[] {
  const count = Math.max(1, Math.floor(sessions));
  const load = Array.from({ length: count }, (_, share) => (share === 0 ? legends * SHARE_COST.legend : 0));
  const owner = new Map<string, number>();
  return groups.map((group) => {
    const key = windowsOf(group);
    const known = owner.get(key);
    if (known !== undefined) {
      load[known] += SHARE_COST.kept;
      return known;
    }
    const share = load.indexOf(Math.min(...load));
    owner.set(key, share);
    load[share] += SHARE_COST.window;
    return share;
  });
}

/**
 * A page's drawing split between `sessions` processes (renderShares), each started at once and analysing the page:
 * the same images as one process, each handed over as drawn under its index in the whole plan. One process failing
 * stops the others. One session is startGroupEvidenceRender itself. Never throws.
 */
export function startGroupEvidenceRenders(bytes: Uint8Array, page: number, options: RenderOptions & { sessions?: number } = {}): GroupEvidenceSession {
  const { sessions = 1, ...rest } = options;
  const count = Math.max(1, Math.min(GROUP_EVIDENCE_RENDER.maxSessions, Math.floor(sessions)));
  if (count === 1) return startGroupEvidenceRender(bytes, page, rest);
  const children = Array.from({ length: count }, () => startGroupEvidenceRender(bytes, page, rest));
  const cancel = () => {
    for (const child of children) child.cancel();
  };
  let drawn: Promise<GroupEvidenceImages> | null = null;
  let planned: Promise<void> = Promise.resolve();
  return {
    ready: Promise.all(children.map((child) => child.ready)).then(() => undefined),
    sent: () => planned,
    draw(plan, onImage) {
      if (drawn) return drawn;
      const shares = renderShares(plan.groups, count, plan.legends.length);
      const own = children.map((_, share) => shares.flatMap((owner, index) => (owner === share ? [index] : [])));
      const parts = children.map((child, share) => {
        const legends = share === 0 ? plan.legends : [];
        if (legends.length === 0 && own[share].length === 0) {
          child.cancel();
          return Promise.resolve(null);
        }
        return child.draw({ legends, groups: own[share].map((index) => plan.groups[index]) },
          onImage && ((event) => onImage(event.kind === "legends" ? event : { ...event, index: own[share][event.index] })))
          .then((images) => {
            // A process that fails leaves the page without all its images: the others stop drawing.
            if (images.issue !== null || images.legends.some((image) => image === null) || images.groups.some((image) => image === null)) cancel();
            return images;
          });
      });
      planned = Promise.all(children.map((child) => child.sent?.())).then(() => undefined);
      drawn = Promise.all(parts).then((done): GroupEvidenceImages => {
        const groups: Array<GroupImage | null> = plan.groups.map(() => null);
        const groupsMs: Array<number | null> = plan.groups.map(() => null);
        done.forEach((part, share) => own[share].forEach((index, local) => {
          groups[index] = part?.groups[local] ?? null;
          groupsMs[index] = part?.render_ms.groups[local] ?? null;
        }));
        const pages = done.flatMap((part) => (part?.render_ms.page === null || part === null ? [] : [part.render_ms.page]));
        return {
          legends: plan.legends.map((_, index) => done[0]?.legends[index] ?? null), groups,
          issue: done.find((part) => part !== null && part.issue !== null)?.issue ?? null,
          dropped_images: Math.max(0, ...done.map((part) => part?.dropped_images ?? 0)),
          render_ms: { page: pages.length ? Math.max(...pages) : null, legends: plan.legends.map((_, index) => done[0]?.render_ms.legends[index] ?? null),
            groups: groupsMs },
          duration_ms: Math.max(0, ...done.map((part) => part?.duration_ms ?? 0)),
          reused_windows: done.reduce((total, part) => total + (part?.reused_windows ?? 0), 0),
        };
      });
      return drawn;
    },
    cancel,
  };
}
