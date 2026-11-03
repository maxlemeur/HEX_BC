import "server-only";

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

// Server extraction of one PDF page's vectors (TI-662 step 1): the stroked
// paths, their style and layer, and the text with positions. pdfjs-dist legacy
// runs in a separate process that is killed at the deadline (15 s per page,
// native decoding included): a page past it fails explicitly, never measured
// from a partial reading. The process gets no environment but PATH and
// NODE_ENV, reads the PDF on stdin and writes one JSON line.
// pdfjs 6.4 semantics the walk relies on:
// - a path is OPS.constructPath [paintOp, [Float32Array | null], minMax]; the
//   buffer holds DrawOPS (not exported): 0 moveTo, 1 lineTo, 2 curveTo,
//   3 quadraticCurveTo, 4 closePath. Only stroke painting ops are measured
//   (stroke, closeStroke, fillStroke, eoFillStroke, closeFillStroke,
//   closeEOFillStroke), never fill-only paths nor endPath (clipping);
// - coordinates are in the current user space: the CTM follows save, restore,
//   transform and paintFormXObjectBegin (its matrix) / paintFormXObjectEnd,
//   then page.getViewport({ scale: 1 }).transform, which includes userUnit and
//   /Rotate. Page space is in points of the sheet (1/72 in), y down;
// - the line width and dash also come from setGState (LW, D); every colour
//   space reaches the list as setStrokeRGBColor with a hex string, a pattern as
//   setStrokeColorN (kept as « pattern »);
// - layers: beginMarkedContentProps is ["OC", { type, id }], ["OC", { type:
//   "OCMD" }] without id or ["OC", null]; the id is a key of
//   getOptionalContentConfig(). Every beginMarkedContent* pushes (OC or not),
//   endMarkedContent pops; a path belongs to the innermost OC with an id;
// - getOperatorList({ annotationMode: AnnotationMode.DISABLE }); no
//   disableWorker (removed in 6.x): the legacy build runs its fake worker in
//   the process.
// Curves are flattened (2 to 16 chords by size). Points are rounded to 0.01 pt.

export const VECTOR_EXTRACTION_VERSION = 1;
export const VECTOR_EXTRACTION_TIMEOUT_MS_PER_PAGE = 15_000;
/** V8 heap of the extraction process, measured on the heaviest plans of the bench (TI-662 load criterion). */
export const VECTOR_EXTRACTION_HEAP_MB = 1536;
/** Bounds of what one page may return: past them the page fails explicitly. */
export const VECTOR_EXTRACTION_LIMITS = {
  maxInputBytes: 64 * 1024 * 1024,
  maxPoints: 12_000_000,
  maxTexts: 50_000,
  maxOutputBytes: 200 * 1024 * 1024,
} as const;

const MARKER = "__VECTORS__";

const VECTOR_EXTRACTION_SCRIPT = String.raw`
const input = JSON.parse(process.argv[1]);
const write = (message) => process.stdout.write("${MARKER}" + JSON.stringify(message) + "\n");
async function main() {
  const bytes = require("node:fs").readFileSync(0);
  const pdfjs = await import(input.pdfUrl);
  const { OPS, Util, AnnotationMode } = pdfjs;
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: input.packageRoot + "/standard_fonts/",
    cMapUrl: input.packageRoot + "/cmaps/", cMapPacked: true, wasmUrl: input.packageRoot + "/wasm/", iccUrl: input.packageRoot + "/iccs/",
    useWorkerFetch: false, isEvalSupported: false, enableScripting: false, useSystemFonts: false, verbosity: 0 });
  try {
    const pdf = await task.promise;
    if (input.page < 1 || input.page > pdf.numPages) throw new Error("page " + input.page + " out of 1.." + pdf.numPages);
    const page = await pdf.getPage(input.page);
    const viewport = page.getViewport({ scale: 1 });
    const config = await pdf.getOptionalContentConfig();
    const layers = [];
    for (const [id, group] of config) layers.push({ id: String(id), name: String(group.name ?? ""), visible: group.visible !== false });
    const t0 = performance.now();
    const ops = await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
    const t1 = performance.now();
    const STROKE = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
    const FILL = new Set([OPS.fill, OPS.eoFill]);
    const IMAGE = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject]);
    const vt = viewport.transform;
    let state = { ctm: [1, 0, 0, 1, 0, 0], color: "#000000", pattern: false, width: 1, dash: null };
    const stack = [];
    const marked = [];
    const groupIndex = new Map();
    const groups = [];
    const paths = [];
    let points = new Float32Array(1 << 16);
    let used = 0;
    const counts = { operators: ops.fnArray.length, strokePaths: 0, fillPaths: 0, clipPaths: 0, images: 0 };
    let imageArea = 0;
    const push = (x, y) => {
      if (used + 2 > points.length) {
        if (points.length >= input.maxPoints * 2) throw new Error("point budget");
        const next = new Float32Array(Math.min(points.length * 2, input.maxPoints * 2));
        next.set(points); points = next;
      }
      points[used++] = Math.round(x * 100) / 100; points[used++] = Math.round(y * 100) / 100;
    };
    const dashOf = (array, phase) => (array && array.length ? Array.from(array).map((v) => Math.round(v * 100) / 100).join(",") + "@" + Math.round((phase || 0) * 100) / 100 : null);
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], args = ops.argsArray[i];
      switch (fn) {
        case OPS.save: stack.push({ ...state }); break;
        case OPS.restore: if (stack.length) state = stack.pop(); break;
        case OPS.transform: state.ctm = Util.transform(state.ctm, args); break;
        case OPS.paintFormXObjectBegin: stack.push({ ...state }); if (args[0]) state.ctm = Util.transform(state.ctm, args[0]); break;
        case OPS.paintFormXObjectEnd: if (stack.length) state = stack.pop(); break;
        case OPS.setLineWidth: state.width = args[0]; break;
        case OPS.setDash: state.dash = dashOf(args[0], args[1]); break;
        case OPS.setGState:
          for (const [key, value] of args[0]) {
            if (key === "LW") state.width = value;
            else if (key === "D") state.dash = dashOf(value[0], value[1]);
          }
          break;
        case OPS.setStrokeRGBColor: state.color = String(args[0]).toLowerCase(); state.pattern = false; break;
        case OPS.setStrokeColorN: state.pattern = true; break;
        case OPS.beginMarkedContent: marked.push(undefined); break;
        case OPS.beginMarkedContentProps:
          marked.push(args[0] === "OC" ? (args[1] && args[1].id !== undefined && args[1].id !== null ? String(args[1].id) : null) : undefined);
          break;
        case OPS.endMarkedContent: marked.pop(); break;
        case OPS.constructPath: {
          const paint = args[0];
          if (paint === OPS.endPath) { counts.clipPaths++; break; }
          if (FILL.has(paint)) { counts.fillPaths++; break; }
          if (!STROKE.has(paint)) break;
          const buffer = args[1] && args[1][0];
          if (!buffer) break;
          counts.strokePaths++;
          const m = Util.transform(vt, state.ctm);
          const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
          let layer = null;
          for (let k = marked.length - 1; k >= 0; k--) if (marked[k] !== undefined) { layer = marked[k]; if (layer !== null) break; }
          const width = Math.round(state.width * scale * 100) / 100;
          const color = state.pattern ? "pattern" : state.color;
          const key = JSON.stringify([layer, color, width, state.dash]);
          let group = groupIndex.get(key);
          if (group === undefined) { group = groups.length; groupIndex.set(key, group); groups.push({ layer, color, width, dash: state.dash }); }
          const tx = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
          let start = -1, cx = 0, cy = 0, sx = 0, sy = 0;
          const close = (closed) => { if (start >= 0 && used / 2 - start >= 2) paths.push(group, start, used / 2 - start, closed ? 1 : 0); start = -1; };
          for (let j = 0; j < buffer.length;) {
            const op = buffer[j++];
            if (op === 0) {
              close(false);
              [cx, cy] = tx(buffer[j++], buffer[j++]); sx = cx; sy = cy; start = used / 2; push(cx, cy);
            } else if (op === 1) {
              if (start < 0) { start = used / 2; push(cx, cy); }
              [cx, cy] = tx(buffer[j++], buffer[j++]); push(cx, cy);
            } else if (op === 2 || op === 3) {
              if (start < 0) { start = used / 2; push(cx, cy); }
              const p1 = tx(buffer[j++], buffer[j++]);
              const p2 = tx(buffer[j++], buffer[j++]);
              const p3 = op === 2 ? tx(buffer[j++], buffer[j++]) : null;
              const end = p3 || p2;
              const hull = Math.hypot(p1[0] - cx, p1[1] - cy) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + (p3 ? Math.hypot(p3[0] - p2[0], p3[1] - p2[1]) : 0);
              const steps = Math.max(2, Math.min(16, Math.ceil(hull / 2)));
              for (let s = 1; s <= steps; s++) {
                const t = s / steps, u = 1 - t;
                const x = p3 ? u * u * u * cx + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0] : u * u * cx + 2 * u * t * p1[0] + t * t * p2[0];
                const y = p3 ? u * u * u * cy + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1] : u * u * cy + 2 * u * t * p1[1] + t * t * p2[1];
                push(x, y);
              }
              cx = end[0]; cy = end[1];
            } else if (op === 4) {
              if (start >= 0) { push(sx, sy); cx = sx; cy = sy; close(true); }
            } else {
              throw new Error("DrawOPS " + op);
            }
          }
          close(false);
          break;
        }
        default:
          if (IMAGE.has(fn)) {
            counts.images++;
            const m = Util.transform(vt, state.ctm);
            imageArea += Math.abs(m[0] * m[3] - m[1] * m[2]);
          }
      }
    }
    const t2 = performance.now();
    const content = await page.getTextContent();
    const texts = [];
    const lin = [vt[0], vt[1], vt[2], vt[3]];
    for (const item of content.items) {
      if (typeof item.str !== "string" || !item.str.trim()) continue;
      if (texts.length >= input.maxTexts) throw new Error("text budget");
      const tr = item.transform;
      const x = vt[0] * tr[4] + vt[2] * tr[5] + vt[4], y = vt[1] * tr[4] + vt[3] * tr[5] + vt[5];
      const dx = lin[0] * tr[0] + lin[2] * tr[1], dy = lin[1] * tr[0] + lin[3] * tr[1];
      const ux = lin[0] * tr[2] + lin[2] * tr[3], uy = lin[1] * tr[2] + lin[3] * tr[3];
      const along = Math.hypot(dx, dy) || 1;
      const pageScale = Math.sqrt(Math.abs(vt[0] * vt[3] - vt[1] * vt[2]));
      texts.push({ str: item.str.slice(0, 500), x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100,
        width: Math.round(item.width * pageScale * 100) / 100, height: Math.round(Math.hypot(ux, uy) * 100) / 100,
        angle: Math.round(Math.atan2(dy, dx) * 10000) / 10000 });
    }
    const t3 = performance.now();
    const view = Array.from(page.view);
    write({ ok: true, version: input.version, page: input.page, pages: pdf.numPages,
      width: viewport.width, height: viewport.height, userUnit: page.userUnit, rotate: page.rotate, view,
      layers, groups, texts, paths, points: Buffer.from(points.buffer, 0, used * 4).toString("base64"),
      counts: { ...counts, imageCoverage: Math.min(1, imageArea / (viewport.width * viewport.height)) },
      timings: { operators_ms: Math.round(t1 - t0), walk_ms: Math.round(t2 - t1), text_ms: Math.round(t3 - t2) },
      memory: { max_rss_kb: process.resourceUsage().maxRSS, heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1048576) } });
  } finally {
    await task.destroy();
  }
}
main().catch((error) => write({ ok: false, error: String(error && error.message || error).slice(0, 300) }));
`;

const LayerSchema = z.object({ id: z.string(), name: z.string(), visible: z.boolean() }).strict();
const GroupKeySchema = z.object({
  layer: z.string().nullable(), color: z.string().max(16), width: z.number().finite().nonnegative(), dash: z.string().max(200).nullable(),
}).strict();
const TextSchema = z.object({
  str: z.string().max(500), x: z.number().finite(), y: z.number().finite(), width: z.number().finite(),
  height: z.number().finite().nonnegative(), angle: z.number().finite(),
}).strict();
const OutputSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true), version: z.literal(VECTOR_EXTRACTION_VERSION), page: z.number().int().positive(), pages: z.number().int().positive(),
    width: z.number().positive(), height: z.number().positive(), userUnit: z.number().positive(), rotate: z.number().int(),
    view: z.array(z.number()).length(4), layers: z.array(LayerSchema), groups: z.array(GroupKeySchema),
    texts: z.array(TextSchema), paths: z.array(z.number().int().nonnegative()), points: z.string(),
    counts: z.object({
      operators: z.number().int(), strokePaths: z.number().int(), fillPaths: z.number().int(), clipPaths: z.number().int(),
      images: z.number().int(), imageCoverage: z.number().min(0).max(1),
    }).strict(),
    timings: z.object({ operators_ms: z.number(), walk_ms: z.number(), text_ms: z.number() }).strict(),
    memory: z.object({ max_rss_kb: z.number().nonnegative(), heap_used_mb: z.number().nonnegative() }).strict(),
  }).strict(),
  z.object({ ok: z.literal(false), error: z.string() }).strict(),
]);

export type VectorLayer = z.infer<typeof LayerSchema>;
export type VectorGroupKey = z.infer<typeof GroupKeySchema>;
export type VectorText = z.infer<typeof TextSchema>;
/** One stroked subpath: points[start .. start + count) of the page's point buffer, as x, y pairs. */
export type VectorPath = { group: number; start: number; count: number; closed: boolean };

export type VectorPageExtraction = {
  page: number;
  pages: number;
  /** Page space: sheet points (1/72 in) after /Rotate and userUnit, origin top left, y down. */
  width: number;
  height: number;
  userUnit: number;
  rotate: number;
  layers: VectorLayer[];
  groups: VectorGroupKey[];
  texts: VectorText[];
  paths: VectorPath[];
  /** x0, y0, x1, y1… in page space. */
  points: Float32Array;
  counts: { operators: number; strokePaths: number; fillPaths: number; clipPaths: number; images: number; imageCoverage: number };
  timings: { operators_ms: number; walk_ms: number; text_ms: number; total_ms: number };
  /** Peak resident memory of the extraction process (its own rusage), for the bounds of TI-662's load criterion. */
  memory: { max_rss_kb: number; heap_used_mb: number };
};

export class VectorExtractionError extends Error {
  constructor(readonly reason: "timeout" | "too_large" | "failed" | "invalid_output", message: string) {
    super(message);
    this.name = "VectorExtractionError";
  }
}

function decode(raw: z.infer<typeof OutputSchema> & { ok: true }, totalMs: number): VectorPageExtraction {
  const bytes = Buffer.from(raw.points, "base64");
  if (bytes.byteLength % 4 !== 0) throw new VectorExtractionError("invalid_output", "Tampon de points invalide.");
  const points = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (raw.paths.length % 4 !== 0) throw new VectorExtractionError("invalid_output", "Index des tracés invalide.");
  const paths: VectorPath[] = [];
  for (let index = 0; index < raw.paths.length; index += 4) {
    const [group, start, count, closed] = raw.paths.slice(index, index + 4);
    if (group >= raw.groups.length || (start + count) * 2 > points.length || count < 2) {
      throw new VectorExtractionError("invalid_output", "Tracé hors du tampon de points.");
    }
    paths.push({ group, start, count, closed: closed === 1 });
  }
  return {
    page: raw.page, pages: raw.pages, width: raw.width, height: raw.height, userUnit: raw.userUnit, rotate: raw.rotate,
    layers: raw.layers, groups: raw.groups, texts: raw.texts, paths, points, counts: raw.counts,
    timings: { ...raw.timings, total_ms: Math.round(totalMs) }, memory: raw.memory,
  };
}

function pdfjsLocation() {
  // Resolved through Node's own require: bundlers rewrite static imports of node:module.
  const requireFromProject = process.getBuiltinModule("node:module").createRequire(join(process.cwd(), "package.json"));
  return {
    pdfUrl: pathToFileURL(requireFromProject.resolve(["pdfjs-dist", "legacy", "build", "pdf.mjs"].join("/"))).href,
    packageRoot: join(process.cwd(), "node_modules/pdfjs-dist"),
  };
}

/** Extracts one page (1-based) in a child process killed at the deadline; throws VectorExtractionError, never a partial page. */
export async function extractVectorPage(bytes: Uint8Array, page: number, options: { timeoutMs?: number; clock?: () => number } = {}) {
  if (bytes.byteLength === 0 || bytes.byteLength > VECTOR_EXTRACTION_LIMITS.maxInputBytes) {
    throw new VectorExtractionError("too_large", "Le PDF est vide ou dépasse la taille lue par l’extraction vectorielle.");
  }
  const clock = options.clock ?? (() => performance.now());
  const timeoutMs = options.timeoutMs ?? VECTOR_EXTRACTION_TIMEOUT_MS_PER_PAGE;
  const { spawn } = await import("node:child_process");
  const startedAt = clock();
  const child = spawn(process.execPath, [
    `--max-old-space-size=${VECTOR_EXTRACTION_HEAP_MB}`, "-e", VECTOR_EXTRACTION_SCRIPT,
    JSON.stringify({ ...pdfjsLocation(), page, version: VECTOR_EXTRACTION_VERSION,
      maxPoints: VECTOR_EXTRACTION_LIMITS.maxPoints, maxTexts: VECTOR_EXTRACTION_LIMITS.maxTexts }),
  ], {
    stdio: ["pipe", "pipe", "ignore"],
    cwd: process.cwd(),
    // The reader needs no key, token or server secret.
    env: { PATH: process.env.PATH ?? "", NODE_ENV: process.env.NODE_ENV ?? "development" },
  });
  return new Promise<VectorPageExtraction>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (outcome: { value: VectorPageExtraction } | { error: VectorExtractionError }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      if ("value" in outcome) resolve(outcome.value);
      else reject(outcome.error);
    };
    const timer = setTimeout(() => finish({
      error: new VectorExtractionError("timeout", `Extraction vectorielle de la page ${page} interrompue après ${Math.round(timeoutMs / 1000)} s.`),
    }), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > VECTOR_EXTRACTION_LIMITS.maxOutputBytes) {
        finish({ error: new VectorExtractionError("too_large", `La page ${page} dépasse le volume de tracés lu par l’extraction.`) });
        return;
      }
      chunks.push(chunk);
    });
    child.once("close", () => {
      if (settled) return;
      const text = Buffer.concat(chunks).toString("utf8");
      const line = text.split("\n").find((entry) => entry.startsWith(MARKER));
      if (!line) {
        finish({ error: new VectorExtractionError("failed", `L’extraction vectorielle de la page ${page} s’est arrêtée sans résultat.`) });
        return;
      }
      let parsed: z.infer<typeof OutputSchema>;
      try {
        parsed = OutputSchema.parse(JSON.parse(line.slice(MARKER.length)));
      } catch {
        finish({ error: new VectorExtractionError("invalid_output", `Réponse invalide de l’extraction vectorielle (page ${page}).`) });
        return;
      }
      if (!parsed.ok) {
        const budget = /budget/.test(parsed.error);
        const what = /text budget/.test(parsed.error) ? "de textes" : "de tracés";
        finish({ error: new VectorExtractionError(budget ? "too_large" : "failed",
          budget ? `La page ${page} dépasse le volume ${what} lu par l’extraction.` : `Extraction vectorielle impossible (page ${page}) : ${parsed.error}`) });
        return;
      }
      try {
        finish({ value: decode(parsed, clock() - startedAt) });
      } catch (error) {
        finish({ error: error instanceof VectorExtractionError ? error : new VectorExtractionError("invalid_output", String(error)) });
      }
    });
    child.once("error", () => finish({ error: new VectorExtractionError("failed", "Le processus d’extraction vectorielle n’a pas démarré.") }));
    child.stdin.on("error", () => undefined);
    child.stdin.end(Buffer.from(bytes));
  });
}
