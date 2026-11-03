import "server-only";

import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Shared server-side PDF page reader: text (`getTextContent`) and a JPEG
 * thumbnail per page, rendered with PDF.js and the optional `@napi-rs/canvas`.
 *
 * Callers: intake classification (first pages), takeoff page triage (every
 * page), the takeoff bench. Parsing and rasterization run in a separate Node
 * process that is killed at the deadline, even during native decoding. The V8
 * heap limit does not bound native buffers; input size, page count, text,
 * bitmap size and stdout have their own bounds. No file is written to disk and
 * the child receives no secret (only PATH and NODE_ENV).
 *
 * The function never throws: a corrupt PDF, a missing canvas module or the
 * deadline yield `status` `partial`/`failed`, issues, and `image: null`.
 */

export type PdfPageImage = {
  mimeType: "image/jpeg";
  /** Raw base64, without data URL prefix. */
  data: string;
  width: number;
  height: number;
  bytes: number;
  /**
   * Almost no ink (under 0.05 % of sampled pixels darker than near-white),
   * typically an embedded raster above `maxEmbeddedImagePixels` that PDF.js
   * skipped. Callers relying on the picture must treat it as missing.
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
async function renderImage(graphics, page, options) {
  if (!graphics) return { issue: "canvas_unavailable" };
  try {
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1, options.maxEdgePx / Math.max(original.width, original.height)) });
    const canvas = graphics.createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
    const context = canvas.getContext("2d");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    // A skipped oversized embedded image leaves an empty white sheet: flag it.
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sampled = 0, ink = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      sampled++;
      if (pixels[index] < 235 || pixels[index + 1] < 235 || pixels[index + 2] < 235) ink++;
    }
    const blank = sampled === 0 || ink / sampled < 0.0005;
    for (const quality of options.jpegQualities) {
      const jpeg = canvas.encodeSync("jpeg", quality);
      if (jpeg.length <= options.maxBytes) return { image: { mimeType: "image/jpeg", data: jpeg.toString("base64"), width: canvas.width, height: canvas.height, bytes: jpeg.length, blank } };
    }
    return { issue: "too_large" };
  } catch { return { issue: "render_failed" }; }
}
async function run() {
  let graphics = null;
  if (input.canvasPath) { try { graphics = require(input.canvasPath); } catch {} }
  const pdfjs = await import(input.pdfUrl);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes),
    standardFontDataUrl: input.packageRoot + "/standard_fonts/",
    cMapUrl: input.packageRoot + "/cmaps/", cMapPacked: true,
    wasmUrl: input.packageRoot + "/wasm/", iccUrl: input.packageRoot + "/iccs/", useWorkerFetch: false, verbosity: 0,
    useSystemFonts: true, maxImageSize: input.maxEmbeddedImagePixels, stopAtErrors: true });
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
        const rendered = input.image && input.image.mode === "each" ? await renderImage(graphics, page, input.image) : { issue: "not_requested" };
        send({ page: { page: number, text, textTruncated: truncated, image: rendered.image || null, imageIssue: rendered.issue || null, renderMs: Date.now() - started, failed: false } });
      } catch (error) {
        // Intake keeps its historical rule (the document stops); a triage reads the next pages.
        if (input.textItemOverflow === "fail") throw error;
        send({ page: { page: number, text: "", textTruncated: false, image: null, imageIssue: "render_failed", renderMs: Date.now() - started, failed: true } });
      } finally { if (page) page.cleanup(); }
    }
    if (input.image && input.image.mode === "if_text_below" && total.trim().length < input.image.minTextChars && graphics && input.image.page <= pdf.numPages) {
      const page = await pdf.getPage(input.image.page);
      const rendered = await renderImage(graphics, page, input.image);
      send({ image: { page: input.image.page, image: rendered.image || null, imageIssue: rendered.issue || null } });
      page.cleanup();
    }
    send({ done: true });
  } finally { await task.destroy(); }
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
  image?: { page: number; image: PdfPageImage | null; imageIssue: PdfPageImageIssue | null };
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
            if (target) Object.assign(target, { image: message.image.image, imageIssue: message.image.imageIssue });
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
