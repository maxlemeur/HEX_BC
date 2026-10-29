import "server-only";

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { OpenAiDecisionImage } from "@/lib/ai/decisions";

export type IntakeDecisionEvidence = {
  text: string;
  images: OpenAiDecisionImage[];
  sampledPages: number[];
  pageCount?: number;
  issues: string[];
};

// Parsing and rasterization run in a separate process that can be killed even
// during native decoding. The V8 heap limit does not include buffers/native RSS.
// Input, output, page count and bitmap dimensions have separate bounds; no disk files.
const PDF_SAMPLE_SCRIPT = String.raw`
const workerData = { ...JSON.parse(process.argv[1]), bytes: require("node:fs").readFileSync(0) };
const send = message => process.stdout.write("__INTAKE_EVIDENCE__" + JSON.stringify(message) + "\n");
async function sample() {
  let graphics;
  try { graphics = require(workerData.canvasPath); } catch {}
  const pdfjs = await import(workerData.pdfUrl);
  const task = pdfjs.getDocument({ data: new Uint8Array(workerData.bytes),
    standardFontDataUrl: workerData.packageRoot + "/standard_fonts/",
    cMapUrl: workerData.packageRoot + "/cmaps/", cMapPacked: true,
    wasmUrl: workerData.packageRoot + "/wasm/", iccUrl: workerData.packageRoot + "/iccs/", useWorkerFetch: false, verbosity: 0,
    useSystemFonts: true, maxImageSize: 8000000, stopAtErrors: true });
  try {
    const pdf = await task.promise;
    const result = { text: "", images: [], sampledPages: [], pageCount: pdf.numPages, issues: [] };
    for (let number = 1; number <= Math.min(pdf.numPages, 2); number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      if (content.items.length > 20000) throw new Error("PDF item budget");
      for (const item of content.items) {
        if (typeof item.str === "string") result.text += item.str.slice(0, 2000) + (item.hasEOL ? "\n" : " ");
        if (result.text.length >= 12000) { result.text = result.text.slice(0,12000); break; }
      }
      result.sampledPages.push(number);
      send({ partial: result });
      page.cleanup();
      if (result.text.length >= 12000) break;
    }
    // A scanned PDF has little usable text: send an actual first-page image,
    // rather than pretending that the filename is document content.
    if (result.text.trim().length < 80 && graphics) {
      const page = await pdf.getPage(1);
      const original = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(1,1200 / Math.max(original.width,original.height)) });
      const canvas = graphics.createCanvas(Math.max(1,Math.ceil(viewport.width)),Math.max(1,Math.ceil(viewport.height)));
      await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport }).promise;
      const jpeg = canvas.encodeSync("jpeg", 75);
      if (jpeg.length <= 1500000) result.images.push({ mimeType: "image/jpeg", data: jpeg.toString("base64") });
      page.cleanup();
    }
    if (pdf.numPages > result.sampledPages.length) result.issues.push("Decisions consulte un échantillon des premières pages : catégorie à confirmer.");
    if (!result.text.trim() && !result.images.length) result.issues.push("Le PDF n’a pas fourni de contenu lisible : le classement reste à vérifier.");
    return result;
  } finally { await task.destroy(); }
}
sample().then(result => send({ result })).catch(() => send({ failed: true }));
`;

async function samplePdf(bytes: ArrayBuffer): Promise<IntakeDecisionEvidence> {
  const fallback: IntakeDecisionEvidence = {
    text: "",
    images: [],
    sampledPages: [],
    issues: [
      "Lecture locale du PDF incomplète. La catégorie reste à confirmer.",
    ],
  };
  try {
    const { spawn } = await import("node:child_process");
    const requireFromProject = process
      .getBuiltinModule("node:module")
      .createRequire(join(process.cwd(), "package.json"));
    const packageRoot = join(process.cwd(), "node_modules/pdfjs-dist");
    const pdfUrl = pathToFileURL(
      requireFromProject.resolve(
        ["pdfjs-dist", "legacy", "build", "pdf.mjs"].join("/"),
      ),
    ).href;
    let canvasPath: string | null = null;
    try {
      canvasPath = requireFromProject.resolve("@napi-rs/canvas");
    } catch {
      /* Text extraction remains available. */
    }
    if (!bytes.byteLength || bytes.byteLength > 50 * 1024 * 1024)
      return fallback;
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=192",
        "-e",
        PDF_SAMPLE_SCRIPT,
        JSON.stringify({ pdfUrl, packageRoot, canvasPath }),
      ],
      {
        stdio: ["pipe", "pipe", "ignore"],
        cwd: process.cwd(),
        // The document reader does not need API keys, tokens or server secrets.
        env: {
          PATH: process.env.PATH ?? "",
          NODE_ENV: process.env.NODE_ENV ?? "development",
        },
      },
    );
    return await new Promise((resolve) => {
      let partial = fallback;
      let pending = "";
      const decoder = new TextDecoder();
      let outputBytes = 0;
      let settled = false;
      const finish = (result: IntakeDecisionEvidence) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.kill("SIGKILL");
        resolve(result);
      };
      const timeout = setTimeout(
        () =>
          finish({
            ...partial,
            issues: [
              ...partial.issues,
              "Lecture PDF limitée dans le temps : vérifiez la proposition.",
            ],
          }),
        15_000,
      );
      child.stdout.on("data", (chunk: Buffer) => {
        if (settled) return;
        outputBytes += chunk.byteLength;
        if (outputBytes > 4 * 1024 * 1024) {
          finish(partial);
          return;
        }
        pending += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (!line.startsWith("__INTAKE_EVIDENCE__")) continue;
          try {
            const message = JSON.parse(
              line.slice("__INTAKE_EVIDENCE__".length),
            ) as {
              partial?: IntakeDecisionEvidence;
              result?: IntakeDecisionEvidence;
            };
            if (message.partial) partial = message.partial;
            else {
              finish(message.result ?? partial);
              return;
            }
          } catch {
            finish(partial);
            return;
          }
        }
      });
      child.once("error", () => finish(partial));
      child.once("close", () => finish(partial));
      child.stdin.on("error", () => finish(partial));
      child.stdout.on("error", () => finish(partial));
      child.stdin.end(Buffer.from(bytes));
    });
  } catch {
    return fallback;
  }
}

/** Receives spreadsheet/text snippets already bounded by the intake parser. */
export async function buildIntakeDecisionEvidence(input: {
  mimeType: string;
  bytes: ArrayBuffer;
  text?: string;
}): Promise<IntakeDecisionEvidence> {
  if (input.mimeType === "application/pdf") return samplePdf(input.bytes);
  const empty = {
    text: (input.text ?? "").slice(0, 12000),
    images: [] as OpenAiDecisionImage[],
    sampledPages: [] as number[],
    issues: [] as string[],
  };
  if (["image/png", "image/jpeg", "image/webp"].includes(input.mimeType)) {
    if (input.bytes.byteLength <= 1500000)
      empty.images.push({
        mimeType: input.mimeType as OpenAiDecisionImage["mimeType"],
        data: Buffer.from(input.bytes).toString("base64"),
      });
    else
      empty.issues.push(
        "Image trop volumineuse pour l’aperçu de classement. Vérifiez la catégorie proposée.",
      );
  }
  if (!empty.text.trim() && !empty.images.length)
    empty.issues.push(
      "Contenu non extrait localement : le nom seul reste un indice à vérifier.",
    );
  return empty;
}
