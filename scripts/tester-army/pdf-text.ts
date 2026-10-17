import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

// Reads the text of a real PDF, typically the attachment the sentinel collector
// (offer-collector.mjs) archived for an emitted offer. Failure modes fixed in
// docs/testing/tester-army-calc-v3.md before this helper:
// - a non-PDF, truncated or empty attachment must fail, never read as "" and pass;
// - PDF.js without a worker cannot be preempted by a timer (AGENTS.md): parsing
//   runs in a worker thread that the timeout really terminates;
// - the bytes read must be the bytes the collector committed (receipt SHA-256);
// - no network: standard fonts come from the installed package, fetch is off.
const PDF_TEXT_WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const pdfjs = await import(workerData.moduleUrl);
  const loading = pdfjs.getDocument({ data: new Uint8Array(workerData.bytes),
    standardFontDataUrl: workerData.fonts, useWorkerFetch: false, isEvalSupported: false,
    useWasm: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: true });
  try {
    const document = await loading.promise;
    const pages = [];
    for (let page = 1; page <= document.numPages; page++) {
      const content = await (await document.getPage(page)).getTextContent({ disableNormalization: true });
      pages.push(content.items.filter((item) => typeof item.str === "string").map((item) => item.str).join(" "));
    }
    parentPort.postMessage({ pages });
  } finally { await loading.destroy(); }
})().catch((error) => parentPort.postMessage({ error: String(error && error.message ? error.message : error) }));
`;

export type PdfText = { sha256: string; bytes: number; pageCount: number; pages: string[]; characters: number };
export type CollectedPdfText = PdfText & { receiptId: string; receivedAt: string; receiptDirectory: string };

const normalized = (value: string) => value.replace(/\s+/g, " ").trim();
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Extracts the text of every page; refuses anything that is not a readable PDF with text. */
export async function extractPdfText(bytes: Uint8Array, options: { timeoutMs?: number; root?: string } = {}): Promise<PdfText> {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 8 || !buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("PDF_TEXT_NOT_A_PDF");
  const requireFromRoot = createRequire(path.join(path.resolve(options.root ?? process.cwd()), "package.json"));
  const modulePath = requireFromRoot.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  const fonts = `${path.resolve(path.dirname(modulePath), "../../standard_fonts").replaceAll("\\", "/")}/`;
  const worker = new Worker(PDF_TEXT_WORKER, { eval: true, workerData: {
    bytes: Uint8Array.from(buffer), moduleUrl: pathToFileURL(modulePath).href, fonts,
  } });
  const pages = await new Promise<string[]>((resolve, reject) => {
    const timeout = setTimeout(() => { void worker.terminate(); reject(new Error("PDF_TEXT_WORKER_TIMEOUT")); }, options.timeoutMs ?? 30_000);
    worker.once("error", (error) => { clearTimeout(timeout); void worker.terminate(); reject(error); });
    worker.once("message", (result: { pages?: string[]; error?: string }) => {
      clearTimeout(timeout); void worker.terminate();
      if (result.error || !Array.isArray(result.pages)) reject(new Error(`PDF_TEXT_UNREADABLE: ${result.error ?? "no pages"}`));
      else resolve(result.pages.map(normalized));
    });
    worker.once("exit", (code) => { if (code !== 0) { clearTimeout(timeout); reject(new Error(`PDF_TEXT_WORKER_EXIT_${code}`)); } });
  });
  const characters = pages.reduce((sum, page) => sum + page.length, 0);
  if (pages.length === 0 || characters === 0) throw new Error("PDF_TEXT_EMPTY");
  return { sha256: digest(buffer), bytes: buffer.length, pageCount: pages.length, pages, characters };
}

/**
 * Reads every attachment committed by the sentinel collector under
 * `<collector>/receipts/<sha-key>/{public/receipt.json,private/attachment.pdf}`.
 * The PDF must match its public receipt before its text is trusted.
 */
export async function extractCollectedPdfTexts(collectorDirectory: string, options: { timeoutMs?: number; root?: string } = {}): Promise<CollectedPdfText[]> {
  const receipts = path.join(path.resolve(collectorDirectory), "receipts");
  const names = (await readdir(receipts)).filter((name) => /^[a-f0-9]{64}$/.test(name)).sort();
  const texts: CollectedPdfText[] = [];
  for (const name of names) {
    const directory = path.join(receipts, name);
    const receipt = JSON.parse(await readFile(path.join(directory, "public", "receipt.json"), "utf8")) as
      { id?: unknown; receivedAt?: unknown; pdf?: { sha256?: unknown; bytes?: unknown } };
    const pdf = await readFile(path.join(directory, "private", "attachment.pdf"));
    if (typeof receipt.id !== "string" || typeof receipt.receivedAt !== "string" ||
      receipt.pdf?.sha256 !== digest(pdf) || receipt.pdf?.bytes !== pdf.length) {
      throw new Error("PDF_TEXT_RECEIPT_MISMATCH: the archived attachment differs from its collector receipt.");
    }
    texts.push({ ...await extractPdfText(pdf, options), receiptId: receipt.id, receivedAt: receipt.receivedAt, receiptDirectory: name });
  }
  return texts.sort((left, right) => left.receivedAt.localeCompare(right.receivedAt) || left.receiptId.localeCompare(right.receiptId));
}

// Manual reading of one archived PDF: node --import tsx scripts/tester-army/pdf-text.ts <file.pdf>
// No top-level await: tsx loads this module as CommonJS from run-tester-army-ci.ts.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3) throw new Error("Usage: node --import tsx scripts/tester-army/pdf-text.ts <file.pdf>");
  void readFile(file).then((bytes) => extractPdfText(bytes)).then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
