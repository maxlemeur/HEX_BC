import { createHash } from "node:crypto";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_PAGES = 200;
const TIMEOUT_MS = 15_000;

export type SourceReferencePdfErrorCode =
  | "PDF_EMPTY"
  | "PDF_TOO_LARGE"
  | "PDF_INVALID"
  | "PDF_ENCRYPTED"
  | "PDF_PAGE_LIMIT"
  | "PDF_TIMEOUT"
  | "PDF_ABORTED"
  | "PDF_WORKER_FAILURE"
  | "PDF_WORKER_PROTOCOL";

const MESSAGES: Record<SourceReferencePdfErrorCode, string> = {
  PDF_EMPTY: "Le fichier PDF est vide.",
  PDF_TOO_LARGE: "Le fichier PDF dépasse la limite de 50 Mio.",
  PDF_INVALID: "Le fichier ne peut pas être lu comme un PDF valide.",
  PDF_ENCRYPTED: "Le PDF est chiffré. Fournissez une copie non protégée.",
  PDF_PAGE_LIMIT: "Le PDF dépasse la limite de 200 pages.",
  PDF_TIMEOUT: "La vérification du PDF a dépassé le délai autorisé.",
  PDF_ABORTED: "La vérification du PDF a été interrompue.",
  PDF_WORKER_FAILURE: "La vérification du PDF est temporairement indisponible.",
  PDF_WORKER_PROTOCOL: "Le résultat de vérification du PDF est incohérent.",
};

export class SourceReferencePdfError extends Error {
  readonly code: SourceReferencePdfErrorCode;
  readonly requiresSourceRead: boolean;

  constructor(code: SourceReferencePdfErrorCode, requiresSourceRead: boolean) {
    super(MESSAGES[code]);
    this.name = "SourceReferencePdfError";
    this.code = code;
    this.requiresSourceRead = requiresSourceRead;
  }
}

export type InspectedSourceReferencePdf = {
  bytes: ArrayBuffer;
  byteSize: number;
  pageCount: number;
};

// The parser receives bytes, never a URL, credentials, or a user-selected module.
// Its bundled distribution has no dynamic dependency tree to trace for deployment.
const WORKER_SCRIPT = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { PDFDocument, EncryptedPDFError } = require(workerData.parserPath);

async function inspect() {
  const bytes = workerData.bytes;
  let result;
  try {
    const document = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: workerData.strictObjectValidation,
      updateMetadata: false,
    });
    if (document.isEncrypted) {
      result = { ok: false, code: "PDF_ENCRYPTED" };
    } else {
      const pageCount = document.getPageCount();
      result = !Number.isSafeInteger(pageCount) || pageCount < 1
        ? { ok: false, code: "PDF_INVALID" }
        : pageCount > workerData.maxPages
          ? { ok: false, code: "PDF_PAGE_LIMIT" }
          : { ok: true, bytes, byteSize: bytes.byteLength, pageCount };
    }
  } catch (error) {
    result = {
      ok: false,
      code: error instanceof EncryptedPDFError ? "PDF_ENCRYPTED" : "PDF_INVALID",
    };
  }
  parentPort.postMessage(result, result.ok ? [bytes] : []);
}
inspect();
`;

function createSourceReferencePdfWorker(
  bytes: ArrayBuffer,
  maxPages = MAX_PAGES,
  strictObjectValidation = true
): Worker {
  // This direct dependency is explicitly included in the route output traces.
  // Resolve from the application root without Webpack's createRequire rewrite.
  const parserPath = join(process.cwd(), "node_modules", "pdf-lib", "dist", "pdf-lib.min.js");
  const worker = new Worker(WORKER_SCRIPT, {
    eval: true,
    workerData: { bytes, parserPath, maxPages, strictObjectValidation },
    transferList: [bytes],
    resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 },
    // Do not inherit host credentials or flags overriding the V8 limit.
    env: {},
    execArgv: [],
    stdout: true,
    stderr: true,
  });
  worker.stdout.resume();
  worker.stderr.resume();
  return worker;
}

function hash(bytes: ArrayBuffer): string {
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

function parseWorkerResult(
  value: unknown,
  expectedSize: number,
  expectedHash: string,
  maxPages: number
): InspectedSourceReferencePdf {
  const invalid = () => new SourceReferencePdfError("PDF_WORKER_PROTOCOL", true);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid();
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (record.ok === false && keys === "code,ok") {
    if (
      record.code === "PDF_INVALID" ||
      record.code === "PDF_ENCRYPTED" ||
      record.code === "PDF_PAGE_LIMIT"
    ) {
      throw new SourceReferencePdfError(record.code, true);
    }
    throw invalid();
  }
  if (
    record.ok !== true || keys !== "byteSize,bytes,ok,pageCount" ||
    !(record.bytes instanceof ArrayBuffer) ||
    record.bytes.byteLength !== expectedSize || record.byteSize !== expectedSize ||
    typeof record.pageCount !== "number" || !Number.isSafeInteger(record.pageCount) ||
    record.pageCount < 1 || record.pageCount > maxPages ||
    hash(record.bytes) !== expectedHash
  ) {
    throw invalid();
  }
  return { bytes: record.bytes, byteSize: expectedSize, pageCount: record.pageCount };
}

type WorkerOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
  maxPages?: number;
  strictObjectValidation?: boolean;
  createWorker?: (bytes: ArrayBuffer, maxPages: number, strictObjectValidation: boolean) => Worker;
};

async function runSourceReferencePdfWorker(
  bytes: ArrayBuffer,
  {
    timeoutMs,
    signal,
    maxPages = MAX_PAGES,
    strictObjectValidation = true,
    createWorker = createSourceReferencePdfWorker,
  }: WorkerOptions
): Promise<InspectedSourceReferencePdf> {
  const startedAt = performance.now();
  if (!(bytes instanceof ArrayBuffer)) {
    throw new SourceReferencePdfError("PDF_INVALID", false);
  }
  if (bytes.byteLength === 0) throw new SourceReferencePdfError("PDF_EMPTY", false);
  if (bytes.byteLength > MAX_BYTES) throw new SourceReferencePdfError("PDF_TOO_LARGE", false);
  if (signal?.aborted) throw new SourceReferencePdfError("PDF_ABORTED", false);
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new RangeError("maxPages must be a positive safe integer.");
  }

  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.min(TIMEOUT_MS, timeoutMs)
    : TIMEOUT_MS;
  const deadline = startedAt + duration;
  const byteSize = bytes.byteLength;
  const digest = hash(bytes);
  let worker: Worker;
  try {
    worker = createWorker(bytes, maxPages, strictObjectValidation);
  } catch {
    throw new SourceReferencePdfError("PDF_WORKER_FAILURE", bytes.byteLength === 0);
  }

  return new Promise((resolve, reject) => {
    let finishing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (error?: SourceReferencePdfError, result?: InspectedSourceReferencePdf) => {
      if (finishing) return;
      finishing = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      // terminate() resolves after the real exit event, even for a blocked parser.
      void worker.terminate().then(() => {
        if (error) reject(error);
        else if (result) resolve(result);
        else reject(new SourceReferencePdfError("PDF_WORKER_FAILURE", true));
      }, () => {
        reject(new SourceReferencePdfError("PDF_WORKER_FAILURE", true));
      });
    };
    const onAbort = () => finish(new SourceReferencePdfError("PDF_ABORTED", true));

    worker.once("error", () => finish(new SourceReferencePdfError("PDF_WORKER_FAILURE", true)));
    worker.once("messageerror", () => finish(new SourceReferencePdfError("PDF_WORKER_PROTOCOL", true)));
    worker.once("exit", () => finish(new SourceReferencePdfError("PDF_WORKER_FAILURE", true)));
    worker.once("message", (message: unknown) => {
      if (finishing) return;
      try {
        const result = parseWorkerResult(message, byteSize, digest, maxPages);
        if (performance.now() >= deadline) {
          finish(new SourceReferencePdfError("PDF_TIMEOUT", true));
        } else {
          finish(undefined, result);
        }
      } catch (error) {
        finish(error instanceof SourceReferencePdfError
          ? error
          : new SourceReferencePdfError("PDF_WORKER_PROTOCOL", true));
      }
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else {
      timer = setTimeout(
        () => finish(new SourceReferencePdfError("PDF_TIMEOUT", true)),
        Math.max(0, deadline - performance.now())
      );
    }
  });
}

/** Consumes an exclusively owned buffer; after transfer, failed attempts need a new read. */
export function inspectSourceReferencePdf(
  bytes: ArrayBuffer,
  options: { signal?: AbortSignal; maxPages?: number; strictObjectValidation?: boolean } = {}
): Promise<InspectedSourceReferencePdf> {
  return runSourceReferencePdfWorker(bytes, {
    timeoutMs: TIMEOUT_MS,
    signal: options.signal,
    maxPages: options.maxPages,
    strictObjectValidation: options.strictObjectValidation,
  });
}

export const __testing__ = {
  runSourceReferencePdfWorker,
  createSourceReferencePdfWorker,
};
