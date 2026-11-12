import "server-only";

import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Shared server-side PDF page reader: text (`getTextContent`) and a JPEG
 * thumbnail per page, rendered with PDF.js and the optional `@napi-rs/canvas`.
 *
 * Callers: intake classification (first pages), takeoff page triage (every
 * page), the takeoff bench, and the legend extract of the vector groups'
 * Decisions calls (a page-space `crop`, enlarged up to `maxScale`). Parsing and rasterization run in a separate Node
 * process that is killed at the deadline, even during native decoding. The V8
 * heap limit does not bound native buffers; input size, page count, text,
 * bitmap size and stdout have their own bounds. No file is written to disk and
 * the child receives no secret (only PATH and NODE_ENV).
 *
 * The function never throws: a corrupt PDF, a missing canvas module or the
 * deadline yield `status` `partial`/`failed`, issues, and `image: null`.
 *
 * Text comes from a reading that stops at the first content error
 * (`stopAtErrors`). Pictures come from a second reading of the same bytes,
 * opened at the first render, that does not stop: under `stopAtErrors` an
 * embedded image above `maxEmbeddedImagePixels` throws, and PDF.js resolves the
 * render with the operators read before it, so the text and strokes painted
 * after the image were missing without any error (TI-715). pdfjs-dist 6.5.438
 * reports through `console.warn` what that reading leaves out; re-read these
 * messages on a pdfjs upgrade:
 * - left out of the picture, counted in `droppedImages`: an image above the
 *   bound, never decoded ("Image exceeded maximum allowed size and was
 *   removed."), and an image PDF.js cannot decode ("Unable to decode image",
 *   also skipped under `stopAtErrors`);
 * - the errors `stopAtErrors` throws while building the drawing (inline image,
 *   pattern, colour space, shading, XObject, ExtGState, marked content, glyph
 *   path, content sub-stream): the picture fails closed, `render_failed`, where
 *   the first reading resolved a partial one. The first such warning cancels
 *   the render. An annotation's appearance warns them too, though
 *   `stopAtErrors` drops only that annotation: a page with annotations is
 *   drawn again without them, and fails only if that render fails too; when
 *   that render lacks no image, the strict reading draws the page with its
 *   annotations, dropping the broken one as it always did;
 * - any other warning is one `stopAtErrors` also only warns about (a font file
 *   that cannot be read, an operator or annotation PDF.js ignores).
 * After a failed render the drawing reading is reopened, so that work it may
 * still run does not count against the next render.
 */

export type PdfPageImage = {
  mimeType: "image/jpeg";
  /** Raw base64, without data URL prefix. */
  data: string;
  width: number;
  height: number;
  bytes: number;
  /**
   * Almost no ink (under 0.05 % of sampled pixels darker than near-white): an
   * empty page, or a page whose only content is an image the render left out
   * (a scan above `maxEmbeddedImagePixels`, see `droppedImages`). Callers
   * relying on the picture must treat it as missing.
   */
  blank: boolean;
};

export type PdfPageImageIssue = "canvas_unavailable" | "too_large" | "render_failed" | "not_requested";

export type PdfRenderedPage = {
  page: number;
  text: string;
  textTruncated: boolean;
  image: PdfPageImage | null;
  imageIssue: PdfPageImageIssue | null;
  /**
   * Embedded images the picture lacks: above `maxEmbeddedImagePixels` (never
   * decoded) or undecodable. What the page paints around them is drawn; a
   * caller relying on the picture knows a raster (a scan, a background) is
   * missing from it. 0 without a picture. Counted per paint from PDF.js's
   * warnings: an undecodable image shared by several pages is reported on the
   * first only.
   */
  droppedImages: number;
  renderMs: number;
  /** The page itself could not be read (`truncate` mode only; `fail` aborts the document). */
  failed: boolean;
};

export type PdfRenderResult = {
  status: "complete" | "partial" | "failed";
  pageCount: number | null;
  pages: PdfRenderedPage[];
  /** Requested pages beyond the document. */
  missingPages: number[];
  timedOut: boolean;
  canvasAvailable: boolean;
  durationMs: number;
};

export type PdfRenderImageOptions =
  | {
      /** Render a thumbnail right after the text of every requested page. */
      mode: "each";
      maxEdgePx?: number;
      /** Tried in order until the JPEG fits `maxBytes`; otherwise `too_large`. */
      jpegQualities?: number[];
      maxBytes?: number;
      /**
       * Render only this box, in page space (the viewport at scale 1: points after /Rotate and UserUnit, origin
       * top left, y down, as the vector extraction reads it), clamped to the page.
       */
      crop?: { x0: number; y0: number; x1: number; y1: number } | null;
      /** Largest scale of a crop (a small box is enlarged up to it, within maxEdgePx); a whole page is never enlarged. */
      maxScale?: number;
    }
  | {
      /** After the text pass, render `page` only if the trimmed text is shorter. */
      mode: "if_text_below";
      minTextChars: number;
      page: number;
      maxEdgePx?: number;
      jpegQualities?: number[];
      maxBytes?: number;
    };

export type PdfRenderOptions = {
  /** 1-based page numbers, read in this order. */
  pages: number[];
  maxTextCharsPerPage?: number;
  /** Stop reading further pages once the cumulated text reaches it (sampling). */
  maxTotalTextChars?: number | null;
  /** `fail` aborts the document (historical intake bound); `truncate` keeps the first items. */
  textItemOverflow?: "fail" | "truncate";
  maxTextItemsPerPage?: number;
  image?: PdfRenderImageOptions | null;
  limits?: Partial<PdfRenderLimits>;
  /** Stop as soon as the document reports more pages (`status: "failed"`, `pageCount` set). */
  maxDocumentPages?: number;
};

export type PdfRenderLimits = {
  maxInputBytes: number;
  maxPages: number;
  timeoutMs: number;
  maxHeapMb: number;
  /** PDF.js `maxImageSize`, in pixels, for embedded images. */
  maxEmbeddedImagePixels: number;
};

/** Historical intake bounds (first two pages, text first, one thumbnail at most). */
export const PDF_RENDER_DEFAULT_LIMITS: PdfRenderLimits = {
  maxInputBytes: 50 * 1024 * 1024,
  maxPages: 2000,
  timeoutMs: 15_000,
  maxHeapMb: 192,
  maxEmbeddedImagePixels: 8_000_000,
};

export const PDF_THUMBNAIL_DEFAULTS = { maxEdgePx: 1200, jpegQualities: [75], maxBytes: 1_500_000 } as const;
export const PDF_TEXT_DEFAULTS = { maxTextCharsPerPage: 12_000, maxTextItemsPerPage: 20_000 } as const;

const MARK = "__PDF_PAGE_RENDER__";
// Base64 thumbnail (≤ 4/3 × maxBytes) + bounded text, JSON-escaped, per line.
const LINE_OVERHEAD_BYTES = 256 * 1024;

const CHILD_SCRIPT = String.raw`
const input = JSON.parse(process.argv[1]);
const bytes = require("node:fs").readFileSync(0);
const MARK = ${JSON.stringify(MARK)};
const send = message => process.stdout.write(MARK + JSON.stringify(message) + "\n");
// What the drawing reading leaves out, as pdfjs-dist 6.5.438 warns it (module comment of page-render-server.ts).
const LEFT_OUT = ["Image exceeded maximum allowed size and was removed.", 'Unable to decode image "'].map(text => "Warning: " + text);
const CONTENT_ERRORS = ["Unable to decode inline image: ", "handleTilingType - ignoring pattern: ", "ensureStateFont: ",
  "_handleColorSpace - ignoring ColorSpace: ", "parseShading - ignoring shading: ", "getOperatorList - ignoring XObject: ",
  "getOperatorList - ignoring Shading: ", "getOperatorList - ignoring ExtGState: ", "getOperatorList - ignoring beginMarkedContentProps: ",
  "getOperatorList - ignoring errors during ", "buildFontPaths - ignoring ", "getContentStream - ignoring sub-stream "].map(text => "Warning: " + text);
// The render being drawn; only counts are kept, so a page cannot grow the heap with warnings.
let drawing = null;
// pdfjs.AnnotationMode, once pdfjs is loaded.
let AnnotationMode = null;
console.warn = (...args) => {
  const seen = drawing;
  if (!seen) return;
  const message = args.map(String).join(" ");
  if (LEFT_OUT.some(prefix => message.startsWith(prefix))) seen.dropped++;
  else if (!seen.failed && CONTENT_ERRORS.some(prefix => message.startsWith(prefix))) {
    seen.failed = true;
    // Its picture is discarded: stop drawing it, outside PDF.js's own call but before its next step (PDF.js and its
    // in-process worker advance by microtasks, so a setImmediate would wait for the whole page). The worker itself
    // stops when the reading is reset.
    queueMicrotask(() => { if (!seen.done && seen.task) seen.task.cancel(); });
  }
};
// One render of the drawing reading: { canvas, dropped } or { failed, annotated } on a content error.
async function draw(graphics, pdf, number, options, annotationMode) {
  const seen = { dropped: 0, failed: false, done: false, task: null };
  let page = null;
  try {
    drawing = seen;
    page = await pdf.getPage(number);
    const original = page.getViewport({ scale: 1 });
    let viewport, width, height;
    const crop = options.crop ? {
      x0: Math.max(0, Math.min(original.width, options.crop.x0)), y0: Math.max(0, Math.min(original.height, options.crop.y0)),
      x1: Math.max(0, Math.min(original.width, options.crop.x1)), y1: Math.max(0, Math.min(original.height, options.crop.y1)),
    } : null;
    if (crop && crop.x1 - crop.x0 > 0 && crop.y1 - crop.y0 > 0) {
      // The viewport's offset moves the crop's top left corner (page space, after /Rotate) to the canvas origin.
      const scale = Math.min(options.maxScale || 1, options.maxEdgePx / Math.max(crop.x1 - crop.x0, crop.y1 - crop.y0));
      viewport = page.getViewport({ scale, offsetX: -crop.x0 * scale, offsetY: -crop.y0 * scale });
      width = Math.round((crop.x1 - crop.x0) * scale);
      height = Math.round((crop.y1 - crop.y0) * scale);
    } else {
      viewport = page.getViewport({ scale: Math.min(1, options.maxEdgePx / Math.max(original.width, original.height)) });
      width = Math.ceil(viewport.width);
      height = Math.ceil(viewport.height);
    }
    const canvas = graphics.createCanvas(Math.max(1, width), Math.max(1, height));
    seen.task = page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport, annotationMode });
    try { await seen.task.promise; } catch (error) { if (!seen.failed) throw error; }
    seen.done = true;
    drawing = null;
    if (!seen.failed) return { canvas, dropped: seen.dropped };
    return { failed: true, annotated: annotationMode !== AnnotationMode.DISABLE && (await page.getAnnotations()).length > 0 };
  } finally { seen.done = true; drawing = null; if (page) page.cleanup(); }
}
async function renderImage(graphics, strictReading, drawingReading, number, options) {
  if (!graphics) return { issue: "canvas_unavailable" };
  try {
    let drawn = await draw(graphics, await drawingReading.open(), number, options, AnnotationMode.ENABLE);
    if (drawn.failed) {
      // Its work may still be running: a new reading keeps it away from the next render.
      await drawingReading.reset();
      // Under stopAtErrors PDF.js drops an annotation whose appearance fails and draws the page: the page is drawn
      // without its annotations, and fails only if that fails too.
      if (drawn.annotated) {
        drawn = await draw(graphics, await drawingReading.open(), number, options, AnnotationMode.DISABLE);
        // With nothing left out of it, the strict reading draws the page whole and drops only the broken annotation, as it
        // always did; a picture that lacks an image keeps no annotation, and droppedImages already marks it incomplete.
        if (!drawn.failed && drawn.dropped === 0) {
          const annotated = await draw(graphics, strictReading, number, options, AnnotationMode.ENABLE).catch(() => null);
          if (annotated && !annotated.failed) drawn = annotated;
        }
      }
      if (drawn.failed) { await drawingReading.reset(); return { issue: "render_failed" }; }
    }
    const { canvas, dropped } = drawn;
    // An empty sheet (nothing drawn, or only an image left out) is flagged.
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let sampled = 0, ink = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      sampled++;
      if (pixels[index] < 235 || pixels[index + 1] < 235 || pixels[index + 2] < 235) ink++;
    }
    const blank = sampled === 0 || ink / sampled < 0.0005;
    for (const quality of options.jpegQualities) {
      const jpeg = canvas.encodeSync("jpeg", quality);
      if (jpeg.length <= options.maxBytes) return { image: { mimeType: "image/jpeg", data: jpeg.toString("base64"), width: canvas.width, height: canvas.height, bytes: jpeg.length, blank }, droppedImages: dropped };
    }
    return { issue: "too_large" };
  } catch {
    await drawingReading.reset();
    return { issue: "render_failed" };
  }
}
async function run() {
  let graphics = null;
  if (input.canvasPath) { try { graphics = require(input.canvasPath); } catch {} }
  const pdfjs = await import(input.pdfUrl);
  AnnotationMode = pdfjs.AnnotationMode;
  // pdfjs takes ownership of the array it is given: each reading gets its own copy. verbosity 1 (warnings) feeds console.warn.
  const open = stopAtErrors => pdfjs.getDocument({ data: new Uint8Array(bytes),
    standardFontDataUrl: input.packageRoot + "/standard_fonts/",
    cMapUrl: input.packageRoot + "/cmaps/", cMapPacked: true,
    wasmUrl: input.packageRoot + "/wasm/", iccUrl: input.packageRoot + "/iccs/", useWorkerFetch: false, verbosity: 1,
    useSystemFonts: true, maxImageSize: input.maxEmbeddedImagePixels, stopAtErrors });
  const task = open(true);
  // The drawing reading opens at the first render; its opening warnings are no page's.
  let drawingTask = null;
  const drawingReading = {
    open: () => (drawingTask ??= open(false)).promise,
    reset: async () => { const current = drawingTask; drawingTask = null; if (current) await current.destroy().catch(() => {}); },
  };
  try {
    const pdf = await task.promise;
    send({ document: { pageCount: pdf.numPages, canvas: Boolean(graphics) } });
    let total = "";
    for (const number of input.pages) {
      if (number > pdf.numPages) { send({ missing: number }); continue; }
      if (input.maxTotalTextChars !== null && total.length >= input.maxTotalTextChars) break;
      const started = Date.now();
      let page = null;
      try {
        page = await pdf.getPage(number);
        const limit = input.maxTotalTextChars === null ? input.maxTextCharsPerPage : Math.min(input.maxTextCharsPerPage, input.maxTotalTextChars - total.length);
        const content = await page.getTextContent();
        let truncated = false;
        if (content.items.length > input.maxTextItemsPerPage) {
          if (input.textItemOverflow === "fail") throw new Error("PDF item budget");
          truncated = true;
        }
        let text = "";
        for (const item of content.items.slice(0, input.maxTextItemsPerPage)) {
          if (typeof item.str === "string") text += item.str.slice(0, 2000) + (item.hasEOL ? "\n" : " ");
          if (text.length >= limit) { if (text.length > limit) truncated = true; text = text.slice(0, limit); break; }
        }
        total += text;
        page.cleanup();
        const rendered = input.image && input.image.mode === "each" ? await renderImage(graphics, pdf, drawingReading, number, input.image) : { issue: "not_requested" };
        send({ page: { page: number, text, textTruncated: truncated, image: rendered.image || null, imageIssue: rendered.issue || null, droppedImages: rendered.droppedImages || 0, renderMs: Date.now() - started, failed: false } });
      } catch (error) {
        // Intake keeps its historical rule (the document stops); a triage reads the next pages.
        if (input.textItemOverflow === "fail") throw error;
        send({ page: { page: number, text: "", textTruncated: false, image: null, imageIssue: "render_failed", droppedImages: 0, renderMs: Date.now() - started, failed: true } });
      } finally { if (page) page.cleanup(); }
    }
    if (input.image && input.image.mode === "if_text_below" && total.trim().length < input.image.minTextChars && graphics && input.image.page <= pdf.numPages) {
      const rendered = await renderImage(graphics, pdf, drawingReading, input.image.page, input.image);
      send({ image: { page: input.image.page, image: rendered.image || null, imageIssue: rendered.issue || null, droppedImages: rendered.droppedImages || 0 } });
    }
    send({ done: true });
  } finally {
    await task.destroy();
    await drawingReading.reset();
  }
}
run().catch(() => send({ failed: true }));
`;

function resolveRuntime() {
  const requireFromProject = process
    .getBuiltinModule("node:module")
    .createRequire(join(process.cwd(), "package.json"));
  const packageRoot = join(process.cwd(), "node_modules/pdfjs-dist");
  const pdfUrl = pathToFileURL(requireFromProject.resolve(["pdfjs-dist", "legacy", "build", "pdf.mjs"].join("/"))).href;
  let canvasPath: string | null = null;
  try {
    canvasPath = requireFromProject.resolve("@napi-rs/canvas");
  } catch {
    /* Text extraction remains available. */
  }
  return { packageRoot, pdfUrl, canvasPath };
}

type ChildMessage = {
  document?: { pageCount: number; canvas: boolean };
  page?: PdfRenderedPage;
  missing?: number;
  image?: { page: number; image: PdfPageImage | null; imageIssue: PdfPageImageIssue | null; droppedImages: number };
  done?: true;
  failed?: true;
};

export async function renderPdfPages(bytes: ArrayBuffer | Uint8Array, options: PdfRenderOptions): Promise<PdfRenderResult> {
  const started = Date.now();
  const limits = { ...PDF_RENDER_DEFAULT_LIMITS, ...options.limits };
  const result: PdfRenderResult = {
    status: "failed", pageCount: null, pages: [], missingPages: [], timedOut: false, canvasAvailable: false, durationMs: 0,
  };
  const done = () => ({ ...result, durationMs: Date.now() - started });
  const pages = [...new Set(options.pages)].filter((page) => Number.isInteger(page) && page >= 1);
  if (!bytes.byteLength || bytes.byteLength > limits.maxInputBytes || pages.length === 0 || pages.length > limits.maxPages) return done();
  const image = options.image
    ? { ...PDF_THUMBNAIL_DEFAULTS, ...options.image, jpegQualities: options.image.jpegQualities?.length ? options.image.jpegQualities : [...PDF_THUMBNAIL_DEFAULTS.jpegQualities] }
    : null;
  const maxLineBytes = LINE_OVERHEAD_BYTES + Math.ceil(((image?.maxBytes ?? 0) * 4) / 3) + 8 * (options.maxTextCharsPerPage ?? PDF_TEXT_DEFAULTS.maxTextCharsPerPage);
  const maxOutputBytes = maxLineBytes * (pages.length + 2);
  try {
    const { spawn } = await import("node:child_process");
    const runtime = resolveRuntime();
    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${Math.max(64, Math.floor(limits.maxHeapMb))}`,
        "-e",
        CHILD_SCRIPT,
        JSON.stringify({
          ...runtime,
          pages,
          maxTextCharsPerPage: options.maxTextCharsPerPage ?? PDF_TEXT_DEFAULTS.maxTextCharsPerPage,
          maxTotalTextChars: options.maxTotalTextChars ?? null,
          maxTextItemsPerPage: options.maxTextItemsPerPage ?? PDF_TEXT_DEFAULTS.maxTextItemsPerPage,
          textItemOverflow: options.textItemOverflow ?? "truncate",
          maxEmbeddedImagePixels: limits.maxEmbeddedImagePixels,
          image,
        }),
      ],
      {
        stdio: ["pipe", "pipe", "ignore"],
        cwd: process.cwd(),
        // The document reader does not need API keys, tokens or server secrets.
        env: { PATH: process.env.PATH ?? "", NODE_ENV: process.env.NODE_ENV ?? "development" },
      },
    );
    return await new Promise<PdfRenderResult>((resolve) => {
      let pending = "";
      let outputBytes = 0;
      let settled = false;
      const decoder = new TextDecoder();
      const finish = (status?: PdfRenderResult["status"]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.kill("SIGKILL");
        result.status = status ?? (result.pages.length ? "partial" : "failed");
        resolve(done());
      };
      const timeout = setTimeout(() => {
        result.timedOut = true;
        finish();
      }, limits.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        if (settled) return;
        outputBytes += chunk.byteLength;
        if (outputBytes > maxOutputBytes) return finish();
        pending += decoder.decode(chunk, { stream: true });
        if (pending.length > maxLineBytes) return finish();
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (!line.startsWith(MARK)) continue;
          let message: ChildMessage;
          try {
            message = JSON.parse(line.slice(MARK.length)) as ChildMessage;
          } catch {
            return finish();
          }
          if (message.document) {
            result.pageCount = message.document.pageCount;
            result.canvasAvailable = message.document.canvas;
            if (options.maxDocumentPages !== undefined && message.document.pageCount > options.maxDocumentPages) return finish("failed");
          } else if (message.page) {
            result.pages.push(message.page);
          } else if (typeof message.missing === "number") {
            result.missingPages.push(message.missing);
          } else if (message.image) {
            const target = result.pages.find((page) => page.page === message.image!.page);
            if (target) Object.assign(target, { image: message.image.image, imageIssue: message.image.imageIssue, droppedImages: message.image.droppedImages });
          } else if (message.done) {
            return finish("complete");
          } else {
            return finish();
          }
        }
      });
      child.once("error", () => finish());
      child.once("close", () => finish());
      child.stdin.on("error", () => finish());
      child.stdout.on("error", () => finish());
      child.stdin.end(Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
    });
  } catch {
    return done();
  }
}
