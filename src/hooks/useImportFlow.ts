"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useFileParser, type ParsedImportRow } from "@/hooks/useFileParser";

type RefreshOptions = {
  silent?: boolean;
};

export type ImportExecutionMode = "worker" | "server" | "unknown";

export type ImportListItem = {
  id: string;
  fileName: string;
  status: string;
  rowsCount: number | null;
  createdAt: string | null;
  mode: ImportExecutionMode;
};

const CLIENT_PARSE_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const POLLING_INTERVAL_MS = 3000;
const ACTIVE_IMPORT_STATUSES = new Set(["pending", "parsing", "processing"]);

function coerceString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeStatus(value: unknown): string {
  const status = coerceString(value);
  return status ? status.toLowerCase() : "unknown";
}

function normalizeMode(value: unknown): ImportExecutionMode {
  const raw = coerceString(value)?.toLowerCase();
  if (!raw) return "unknown";

  if (raw.includes("worker")) return "worker";
  if (raw.includes("server") || raw.includes("multipart")) return "server";
  return "unknown";
}

function pickListPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;

  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const candidates = [record.imports, record.items, record.data, record.results];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function normalizeImportItem(rawItem: unknown, index: number): ImportListItem {
  const fallbackId = `import-${index}-${Date.now()}`;

  if (!rawItem || typeof rawItem !== "object") {
    return {
      id: fallbackId,
      fileName: "Fichier inconnu",
      status: "unknown",
      rowsCount: null,
      createdAt: null,
      mode: "unknown",
    };
  }

  const item = rawItem as Record<string, unknown>;
  const id =
    coerceString(item.id) ??
    coerceString(item.import_id) ??
    coerceString(item.uuid) ??
    fallbackId;

  const fileName =
    coerceString(item.file_name) ??
    coerceString(item.fileName) ??
    coerceString(item.filename) ??
    coerceString(item.original_filename) ??
    "Fichier inconnu";

  const rowsCount =
    coerceNumber(item.rows_count) ??
    coerceNumber(item.rowsCount) ??
    coerceNumber(item.row_count) ??
    coerceNumber(item.line_count) ??
    coerceNumber(item.lines_count) ??
    coerceNumber(item.parsed_rows);

  const createdAt =
    coerceString(item.created_at) ??
    coerceString(item.createdAt) ??
    coerceString(item.updated_at) ??
    null;

  const status = normalizeStatus(item.status);
  const mode = normalizeMode(
    item.mode ?? item.parse_mode ?? item.parseMode ?? item.source
  );

  return {
    id,
    fileName,
    status,
    rowsCount,
    createdAt,
    mode,
  };
}

function normalizeImportList(payload: unknown): ImportListItem[] {
  const rawList = pickListPayload(payload);
  return rawList.map((item, index) => normalizeImportItem(item, index));
}

async function extractErrorMessage(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = null;
  }

  if (responseBody && typeof responseBody === "object") {
    const record = responseBody as Record<string, unknown>;
    const detailedMessage =
      coerceString(record.error) ??
      coerceString(record.message) ??
      coerceString(record.detail);
    if (detailedMessage) return detailedMessage;
  }

  return `${fallbackMessage} (HTTP ${response.status})`;
}

async function fetchImportsList(): Promise<ImportListItem[]> {
  const response = await fetch("/api/imports", {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Impossible de charger les imports."));
  }

  if (response.status === 204) return [];

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = [];
  }

  return normalizeImportList(payload);
}

async function postWorkerImport(
  file: File,
  rows: ParsedImportRow[],
  parser: "csv" | "xlsx"
): Promise<void> {
  const response = await fetch("/api/imports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "worker",
      parseMode: "worker",
      parser,
      filename: file.name,
      sourceFormat: parser,
      mimeType: file.type || null,
      fileSizeBytes: file.size,
      rows,
    }),
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Creation de l'import impossible."));
  }
}

async function postServerFallback(
  file: File,
  reason: "worker_error" | "file_too_large"
): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("mode", "server");
  formData.append("parseMode", "server");
  formData.append("fallbackReason", reason);

  const response = await fetch("/api/imports", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Creation de l'import impossible."));
  }
}

export function useImportFlow() {
  const { parseFile } = useFileParser();

  const [imports, setImports] = useState<ImportListItem[]>([]);
  const [isLoadingImports, setIsLoadingImports] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [modeMessage, setModeMessage] = useState<string | null>(null);
  const [lastMode, setLastMode] = useState<ImportExecutionMode | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const refreshImports = useCallback(
    async (options?: RefreshOptions) => {
      const silent = options?.silent ?? false;
      const shouldShowLoader = !hasLoadedOnce;

      if (shouldShowLoader) setIsLoadingImports(true);
      if (!shouldShowLoader && !silent) setIsRefreshing(true);

      try {
        const nextImports = await fetchImportsList();
        setImports(nextImports);
        if (!silent) setLoadError(null);
      } catch (error) {
        if (!silent) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Impossible de charger la liste des imports."
          );
        }
      } finally {
        setHasLoadedOnce(true);
        setIsLoadingImports(false);
        if (!silent) setIsRefreshing(false);
      }
    },
    [hasLoadedOnce]
  );

  const importFile = useCallback(
    async (file: File): Promise<boolean> => {
      setIsSubmitting(true);
      setSubmitError(null);
      setWorkerError(null);
      setModeMessage(null);
      setLastMode(null);

      try {
        const shouldTryWorker = file.size <= CLIENT_PARSE_MAX_SIZE_BYTES;

        if (shouldTryWorker) {
          try {
            const parsed = await parseFile(file);
            await postWorkerImport(file, parsed.rows, parsed.parser);
            setModeMessage(
              "Mode worker: parsing local termine, envoi JSON declenche."
            );
            setLastMode("worker");
          } catch (workerFailure) {
            const workerFailureMessage =
              workerFailure instanceof Error
                ? workerFailure.message
                : "Le parsing local a echoue.";
            setWorkerError(workerFailureMessage);
            await postServerFallback(file, "worker_error");
            setModeMessage(
              "Mode serveur: fallback multipart active apres echec du worker."
            );
            setLastMode("server");
          }
        } else {
          await postServerFallback(file, "file_too_large");
          setModeMessage(
            "Mode serveur: fichier volumineux, envoi multipart direct."
          );
          setLastMode("server");
        }

        await refreshImports({ silent: true });
        return true;
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : "Impossible de lancer l'import."
        );
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [parseFile, refreshImports]
  );

  useEffect(() => {
    void refreshImports();
  }, [refreshImports]);

  const isPolling = useMemo(
    () => imports.some((item) => ACTIVE_IMPORT_STATUSES.has(item.status)),
    [imports]
  );

  useEffect(() => {
    if (!isPolling) return;

    const intervalId = window.setInterval(() => {
      void refreshImports({ silent: true });
    }, POLLING_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isPolling, refreshImports]);

  const refreshNow = useCallback(async () => {
    await refreshImports();
  }, [refreshImports]);

  return {
    imports,
    isLoadingImports,
    isRefreshing,
    isSubmitting,
    isPolling,
    loadError,
    submitError,
    workerError,
    modeMessage,
    lastMode,
    maxClientParseSizeBytes: CLIENT_PARSE_MAX_SIZE_BYTES,
    importFile,
    refreshImports: refreshNow,
  };
}
