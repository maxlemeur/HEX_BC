"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useFileParser, type ParsedImportRow } from "@/hooks/useFileParser";

type RefreshOptions = {
  silent?: boolean;
};

export type ImportFileOptions = {
  headerRowNumber?: number | null;
};

export type UseImportFlowOptions = {
  projectId?: string | null;
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

async function extractCreatedImportId(response: Response): Promise<string | null> {
  if (response.status === 204) return null;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  const pickId = (value: unknown): string | null => {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    return (
      coerceString(record.id) ??
      coerceString(record.import_id) ??
      coerceString(record.uuid) ??
      null
    );
  };

  if (Array.isArray(payload)) {
    return pickId(payload[0] ?? null);
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  return (
    pickId(record.data) ??
    pickId(record.import) ??
    pickId(record.result) ??
    pickId(record) ??
    null
  );
}

async function postWorkerImport(
  file: File,
  rows: ParsedImportRow[],
  parser: "csv" | "xlsx",
  headerRowNumber?: number | null,
  projectId?: string | null
): Promise<string | null> {
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
      headerRowNumber: headerRowNumber ?? null,
      projectId: projectId ?? null,
      rows,
    }),
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Creation de l'import impossible."));
  }

  return extractCreatedImportId(response);
}

type UploadProgressCallback = (progress: number) => void;

async function postServerFallback(
  file: File,
  reason: "worker_error" | "file_too_large",
  headerRowNumber?: number | null,
  projectId?: string | null,
  onProgress?: UploadProgressCallback
): Promise<string | null> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("mode", "server");
  formData.append("parseMode", "server");
  formData.append("fallbackReason", reason);
  if (typeof headerRowNumber === "number" && Number.isInteger(headerRowNumber)) {
    formData.append("headerRowNumber", String(headerRowNumber));
  }
  if (typeof projectId === "string" && projectId.trim().length > 0) {
    formData.append("projectId", projectId.trim());
  }

  // UX-6: Use XHR for upload progress on large files
  if (onProgress && typeof XMLHttpRequest !== "undefined") {
    return new Promise<string | null>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/imports");

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && e.total > 0) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      xhr.addEventListener("load", async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100);
          try {
            const payload = JSON.parse(xhr.responseText) as unknown;
            // Mimic extractCreatedImportId inline
            const pickId = (value: unknown): string | null => {
              if (!value || typeof value !== "object") return null;
              const record = value as Record<string, unknown>;
              return coerceString(record.id) ?? coerceString(record.import_id) ?? coerceString(record.uuid) ?? null;
            };
            if (Array.isArray(payload)) {
              resolve(pickId(payload[0] ?? null));
            } else if (payload && typeof payload === "object") {
              const record = payload as Record<string, unknown>;
              resolve(pickId(record.data) ?? pickId(record.import) ?? pickId(record.result) ?? pickId(record) ?? null);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        } else {
          let message = `Creation de l'import impossible. (HTTP ${xhr.status})`;
          try {
            const body = JSON.parse(xhr.responseText) as Record<string, unknown>;
            message = coerceString(body.error) ?? coerceString(body.message) ?? coerceString(body.detail) ?? message;
          } catch { /* keep default */ }
          reject(new Error(message));
        }
      });

      xhr.addEventListener("error", () => reject(new Error("Erreur reseau lors de l'envoi du fichier.")));
      xhr.addEventListener("abort", () => reject(new Error("Envoi du fichier annule.")));

      xhr.send(formData);
    });
  }

  const response = await fetch("/api/imports", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Creation de l'import impossible."));
  }

  return extractCreatedImportId(response);
}

export function useImportFlow(options?: UseImportFlowOptions) {
  const { parseFile } = useFileParser();
  const projectId = options?.projectId ?? null;

  const [imports, setImports] = useState<ImportListItem[]>([]);
  const [isLoadingImports, setIsLoadingImports] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [modeMessage, setModeMessage] = useState<string | null>(null);
  const [lastMode, setLastMode] = useState<ImportExecutionMode | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const refreshImports = useCallback(
    async (options?: RefreshOptions) => {
      const silent = options?.silent ?? false;
      const shouldShowLoader = !hasLoadedOnceRef.current;

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
        hasLoadedOnceRef.current = true;
        setIsLoadingImports(false);
        if (!silent) setIsRefreshing(false);
      }
    },
    []
  );

  const [lastImportId, setLastImportId] = useState<string | null>(null);

  const importFile = useCallback(
    async (file: File, options?: ImportFileOptions): Promise<boolean> => {
      setIsSubmitting(true);
      setUploadProgress(null);
      setSubmitError(null);
      setWorkerError(null);
      setModeMessage(null);
      setLastMode(null);
      setLastImportId(null);

      try {
        const headerRowNumber = options?.headerRowNumber ?? null;
        const shouldTryWorker = file.size <= CLIENT_PARSE_MAX_SIZE_BYTES;
        let createdImportId: string | null = null;

        if (shouldTryWorker) {
          try {
            const parsed = await parseFile(file, { headerRowNumber });
            createdImportId = await postWorkerImport(
              file,
              parsed.rows,
              parsed.parser,
              headerRowNumber,
              projectId
            );
            setModeMessage(
              "Fichier traite dans votre navigateur, envoi termine."
            );
            setLastMode("worker");
          } catch (workerFailure) {
            const workerFailureMessage =
              workerFailure instanceof Error
                ? workerFailure.message
                : "Le parsing local a echoue.";
            setWorkerError(workerFailureMessage);
            createdImportId = await postServerFallback(
              file,
              "worker_error",
              headerRowNumber,
              projectId,
              setUploadProgress
            );
            setModeMessage(
              "Fichier envoye au serveur pour traitement."
            );
            setLastMode("server");
          }
        } else {
          createdImportId = await postServerFallback(
            file,
            "file_too_large",
            headerRowNumber,
            projectId,
            setUploadProgress
          );
          setModeMessage(
            "Fichier volumineux, envoye au serveur pour traitement."
          );
          setLastMode("server");
        }

        if (createdImportId) {
          setLastImportId(createdImportId);
        }

        try {
          const nextImports = await fetchImportsList();
          setImports(nextImports);
          if (!createdImportId && nextImports.length > 0) {
            setLastImportId(nextImports[0].id);
          }
          setLoadError(null);
        } catch (refreshError) {
          setLoadError(
            refreshError instanceof Error
              ? refreshError.message
              : "Impossible de charger la liste des imports."
          );
        }

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
    [parseFile, projectId]
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
    uploadProgress,
    isPolling,
    loadError,
    submitError,
    workerError,
    modeMessage,
    lastMode,
    lastImportId,
    maxClientParseSizeBytes: CLIENT_PARSE_MAX_SIZE_BYTES,
    importFile,
    refreshImports: refreshNow,
  };
}
