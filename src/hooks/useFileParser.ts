"use client";

import { useCallback } from "react";

export type ParsedImportScalar = string | number | boolean | null;
export type ParsedImportRow = Record<string, ParsedImportScalar>;
export type ParserKind = "csv" | "xlsx";

type ParseWorkerRequest = {
  requestId: string;
  buffer: ArrayBuffer;
  headerRowNumber?: number | null;
};

type ParseWorkerSuccessResponse = {
  requestId: string;
  ok: true;
  rows: ParsedImportRow[];
  rowLineNumbers?: number[];
};

type ParseWorkerErrorResponse = {
  requestId: string;
  ok: false;
  error: string;
};

type ParseWorkerResponse = ParseWorkerSuccessResponse | ParseWorkerErrorResponse;

type ParseFileOptions = {
  headerRowNumber?: number | null;
};

export type FileParseResult = {
  mode: "worker";
  parser: ParserKind;
  rows: ParsedImportRow[];
  rowLineNumbers?: number[];
};

const CSV_EXTENSIONS = new Set(["csv"]);
const XLSX_EXTENSIONS = new Set(["xlsx", "xls"]);
const CSV_MIME_TYPES = new Set(["text/csv", "application/csv", "text/plain"]);
const XLSX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/excel",
]);
const WORKER_TIMEOUT_MS = 20000;

function getFileExtension(fileName: string): string | null {
  const extension = fileName.split(".").pop()?.trim().toLowerCase();
  return extension || null;
}

function resolveParserKind(file: File): ParserKind | null {
  const extension = getFileExtension(file.name);
  if (extension && CSV_EXTENSIONS.has(extension)) return "csv";
  if (extension && XLSX_EXTENSIONS.has(extension)) return "xlsx";

  const mimeType = file.type.toLowerCase();
  if (CSV_MIME_TYPES.has(mimeType)) return "csv";
  if (XLSX_MIME_TYPES.has(mimeType)) return "xlsx";

  return null;
}

function buildRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createParserWorker(parser: ParserKind): Worker {
  if (parser === "csv") {
    return new Worker(new URL("../workers/csv-parser.worker.ts", import.meta.url), {
      type: "module",
    });
  }

  return new Worker(new URL("../workers/xlsx-parser.worker.ts", import.meta.url), {
    type: "module",
  });
}

function runWorkerParser(
  parser: ParserKind,
  buffer: ArrayBuffer,
  options?: ParseFileOptions
): Promise<{ rows: ParsedImportRow[]; rowLineNumbers?: number[] }> {
  return new Promise((resolve, reject) => {
    const worker = createParserWorker(parser);
    const requestId = buildRequestId();
    const payload: ParseWorkerRequest = {
      requestId,
      buffer,
      headerRowNumber: options?.headerRowNumber ?? null,
    };
    const timeoutId = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("Le parsing local a depasse le delai autorise."));
    }, WORKER_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      worker.terminate();
    };

    worker.onmessage = (event: MessageEvent<ParseWorkerResponse>) => {
      const response = event.data;
      if (!response || response.requestId !== requestId) return;

      cleanup();

      if (response.ok) {
        resolve({
          rows: response.rows,
          rowLineNumbers: response.rowLineNumbers,
        });
        return;
      }

      reject(new Error(response.error || "Le worker n'a pas pu parser le fichier."));
    };

    worker.onerror = (event) => {
      cleanup();
      reject(
        new Error(
          event.message || "Une erreur inattendue est survenue pendant le parsing local."
        )
      );
    };

    worker.postMessage(payload, [buffer]);
  });
}

export function useFileParser() {
  const parseFile = useCallback(
    async (file: File, options?: ParseFileOptions): Promise<FileParseResult> => {
      if (typeof window === "undefined" || typeof Worker === "undefined") {
        throw new Error("Les workers ne sont pas disponibles dans cet environnement.");
      }

      const parser = resolveParserKind(file);
      if (!parser) {
        throw new Error("Format non supporte. Utilisez un fichier CSV ou XLSX.");
      }

      const buffer = await file.arrayBuffer();
      const { rows, rowLineNumbers } = await runWorkerParser(parser, buffer, options);

      return {
        mode: "worker",
        parser,
        rows,
        rowLineNumbers,
      };
    },
    []
  );

  return { parseFile };
}
