import "server-only";

import { join } from "node:path";

import { renderPdfPages } from "@/lib/pdf/page-render-server";
import type { Box } from "@/lib/takeoff/vectors/geometry";
import { GROUP_SHEET, type SheetPlan } from "@/lib/takeoff/vectors/group-sheet";

// Images of the Decisions batches of vector groups (TI-662 L3c). The sheets
// planned by group-sheet.ts (contact sheets, dedicated renders) are drawn by
// @napi-rs/canvas in a separate Node process killed at its deadline (as
// page-render-server.ts does), which reads the plans on stdin, gets no
// environment but PATH and NODE_ENV, and writes one bounded line per sheet.
// The alias is printed in Liberation Sans (shipped with pdfjs-dist), never a
// system font the server may lack. The legend extract (image 1) is a pdfjs
// render of a page-space crop (renderPdfPages). Nothing here throws: a missing
// canvas module, a JPEG over budget, a child past its deadline or a crash give
// `images` null and the issue; the caller then sends no call for that page.

export const GROUP_SHEET_RENDER = { timeoutMs: 30_000, heapMb: 512 } as const;
/** Legend extract: one page of a plan, the page reader's bounds for heavy plans (page-triage-server). */
export const GROUP_LEGEND_RENDER = { timeoutMs: 60_000, heapMb: 768, maxInputBytes: 64 * 1024 * 1024, maxEmbeddedImagePixels: 8_000_000 } as const;

export type GroupImage = { mimeType: "image/jpeg"; data: string; width: number; height: number; bytes: number };
export type GroupRenderIssue = "canvas_unavailable" | "render_failed" | "too_large" | "timeout";
export type GroupSheetsResult = {
  images: Array<GroupImage | null>;
  issue: GroupRenderIssue | null;
  /** Drawing and encoding time of each sheet in the child (null when not drawn). */
  render_ms: Array<number | null>;
  duration_ms: number;
};
export type GroupLegendResult = { image: GroupImage | null; issue: GroupRenderIssue | null; duration_ms: number };

const MARK = "__GROUP_SHEET__";

const SHEET_SCRIPT = String.raw`
const MARK = ${JSON.stringify(MARK)};
const send = (message) => process.stdout.write(MARK + JSON.stringify(message) + "\n");
const input = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
let graphics = null;
if (input.canvasPath) { try { graphics = require(input.canvasPath); } catch {} }
if (!graphics) { send({ canvas: false }); process.exit(0); }
send({ canvas: true });
let font = "sans-serif";
try { if (graphics.GlobalFonts.registerFromPath(input.fontPath, "GroupSheetSans")) font = "GroupSheetSans"; } catch {}
const strokeAll = (context, polylines) => {
  context.beginPath();
  for (const line of polylines) {
    context.moveTo(line[0], line[1]);
    for (let index = 2; index < line.length; index += 2) context.lineTo(line[index], line[index + 1]);
  }
  context.stroke();
};
input.sheets.forEach((sheet, index) => {
  const started = Date.now();
  try {
    const canvas = graphics.createCanvas(sheet.width, sheet.height);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, sheet.width, sheet.height);
    context.lineJoin = "round";
    context.lineCap = "round";
    for (const tile of sheet.tiles) {
      context.save();
      context.beginPath();
      context.rect(tile.x, tile.y, tile.size, tile.size);
      context.clip();
      context.translate(tile.x, tile.y);
      context.strokeStyle = input.contextColor;
      context.lineWidth = input.contextLineWidth;
      strokeAll(context, tile.context);
      context.strokeStyle = tile.color;
      context.lineWidth = tile.lineWidth;
      strokeAll(context, tile.group);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, tile.size, input.labelPx);
      context.fillStyle = "#000000";
      context.font = Math.round(input.labelPx * 0.7) + "px " + font;
      context.textBaseline = "middle";
      context.fillText(tile.label, 6, input.labelPx / 2);
      context.strokeStyle = "#9a9a9a";
      context.lineWidth = 1;
      context.strokeRect(0.5, 0.5, tile.size - 1, tile.size - 1);
      context.restore();
    }
    let image = null;
    for (const quality of input.jpegQualities) {
      const jpeg = canvas.encodeSync("jpeg", quality);
      if (jpeg.length <= input.maxBytes) {
        image = { mimeType: "image/jpeg", data: jpeg.toString("base64"), width: sheet.width, height: sheet.height, bytes: jpeg.length };
        break;
      }
    }
    send(image ? { sheet: index, image, render_ms: Date.now() - started } : { sheet: index, issue: "too_large", render_ms: Date.now() - started });
  } catch {
    send({ sheet: index, issue: "render_failed", render_ms: Date.now() - started });
  }
});
send({ done: true });
`;

function resolveCanvas(): string | null {
  try {
    // Resolved through Node's own require, as page-render-server.ts does: bundlers rewrite static imports of node:module.
    return process.getBuiltinModule("node:module").createRequire(join(process.cwd(), "package.json")).resolve("@napi-rs/canvas");
  } catch {
    return null;
  }
}

type SheetMessage = { canvas?: boolean; sheet?: number; image?: GroupImage; issue?: GroupRenderIssue; render_ms?: number; done?: true };

/** Draws the sheets in one child process; never throws. */
export async function renderGroupSheets(sheets: readonly SheetPlan[], options: {
  timeoutMs?: number;
  /** Test seam: null stands for a server without the canvas module. */
  canvasPath?: string | null;
  maxBytes?: number;
} = {}): Promise<GroupSheetsResult> {
  const started = Date.now();
  const result: GroupSheetsResult = { images: sheets.map(() => null), issue: null, render_ms: sheets.map(() => null), duration_ms: 0 };
  const done = (issue: GroupRenderIssue | null) => ({ ...result, issue: result.issue ?? issue, duration_ms: Date.now() - started });
  if (sheets.length === 0) return done(null);
  const canvasPath = options.canvasPath === undefined ? resolveCanvas() : options.canvasPath;
  if (!canvasPath) return done("canvas_unavailable");
  const maxBytes = options.maxBytes ?? GROUP_SHEET.maxBytes;
  const payload = JSON.stringify({
    canvasPath, fontPath: join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"),
    contextColor: GROUP_SHEET.contextColor, contextLineWidth: GROUP_SHEET.contextLineWidthPx, labelPx: GROUP_SHEET.labelPx,
    jpegQualities: GROUP_SHEET.jpegQualities, maxBytes,
    sheets: sheets.map((sheet) => ({
      width: sheet.width, height: sheet.height,
      tiles: sheet.tiles.map((tile) => ({ x: tile.x, y: tile.y, size: tile.size, label: tile.label, color: tile.plan.color,
        lineWidth: tile.plan.lineWidth, group: tile.plan.group, context: tile.plan.context })),
    })),
  });
  const maxLine = 64 * 1024 + Math.ceil((maxBytes * 4) / 3);
  try {
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, [`--max-old-space-size=${GROUP_SHEET_RENDER.heapMb}`, "-e", SHEET_SCRIPT], {
      stdio: ["pipe", "pipe", "ignore"],
      cwd: process.cwd(),
      // The drawing needs no key, token or server secret.
      env: { PATH: process.env.PATH ?? "", NODE_ENV: process.env.NODE_ENV ?? "development" },
    });
    return await new Promise<GroupSheetsResult>((resolve) => {
      let pending = "";
      let outputBytes = 0;
      let settled = false;
      const decoder = new TextDecoder();
      const finish = (issue: GroupRenderIssue | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        if (issue === "timeout") result.images = sheets.map(() => null);
        resolve(done(issue));
      };
      const timer = setTimeout(() => {
        result.issue = "timeout";
        finish("timeout");
      }, options.timeoutMs ?? GROUP_SHEET_RENDER.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        if (settled) return;
        outputBytes += chunk.byteLength;
        if (outputBytes > maxLine * (sheets.length + 2)) return finish("render_failed");
        pending += decoder.decode(chunk, { stream: true });
        if (pending.length > maxLine) return finish("render_failed");
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (!line.startsWith(MARK)) continue;
          let message: SheetMessage;
          try {
            message = JSON.parse(line.slice(MARK.length)) as SheetMessage;
          } catch {
            return finish("render_failed");
          }
          if (message.canvas === false) return finish("canvas_unavailable");
          if (message.done) return finish(result.images.every(Boolean) ? null : "render_failed");
          if (typeof message.sheet !== "number" || message.sheet < 0 || message.sheet >= sheets.length) continue;
          result.render_ms[message.sheet] = message.render_ms ?? null;
          if (message.image) result.images[message.sheet] = message.image;
          else result.issue ??= message.issue ?? "render_failed";
        }
      });
      child.once("error", () => finish("render_failed"));
      child.once("close", () => finish("render_failed"));
      child.stdin.on("error", () => finish("render_failed"));
      child.stdout.on("error", () => finish("render_failed"));
      child.stdin.end(payload);
    });
  } catch {
    return done("render_failed");
  }
}

/** Image 1: a pdfjs render of the legend crop (page space) at ≤ legendMaxEdgePx, else the whole page; never throws. */
export async function renderLegendExtract(bytes: Uint8Array, page: number, crop: Box | null): Promise<GroupLegendResult> {
  const rendered = await renderPdfPages(bytes, {
    pages: [page],
    maxTextCharsPerPage: 1,
    maxTextItemsPerPage: 1,
    textItemOverflow: "truncate",
    image: {
      mode: "each", maxEdgePx: GROUP_SHEET.legendMaxEdgePx, jpegQualities: [...GROUP_SHEET.jpegQualities], maxBytes: GROUP_SHEET.maxBytes,
      crop, maxScale: GROUP_SHEET.legendMaxScale,
    },
    limits: { maxInputBytes: GROUP_LEGEND_RENDER.maxInputBytes, maxPages: 1, timeoutMs: GROUP_LEGEND_RENDER.timeoutMs,
      maxHeapMb: GROUP_LEGEND_RENDER.heapMb, maxEmbeddedImagePixels: GROUP_LEGEND_RENDER.maxEmbeddedImagePixels },
  });
  const target = rendered.pages.find((entry) => entry.page === page);
  const image = target?.image ?? null;
  if (image) {
    return { image: { mimeType: image.mimeType, data: image.data, width: image.width, height: image.height, bytes: image.bytes }, issue: null, duration_ms: rendered.durationMs };
  }
  const issue: GroupRenderIssue = rendered.timedOut ? "timeout"
    : target?.imageIssue === "canvas_unavailable" ? "canvas_unavailable" : target?.imageIssue === "too_large" ? "too_large" : "render_failed";
  return { image: null, issue, duration_ms: rendered.durationMs };
}
