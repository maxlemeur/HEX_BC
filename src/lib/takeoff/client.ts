export type TakeoffLevel = "A" | "B" | "C";

export type TakeoffJobCreateResponse = {
  id: string;
  status: string;
  level: TakeoffLevel | string;
  source_file_name: string | null;
  estimate_version_id: string;
  created_at: string;
};

export type CreateTakeoffJobInput = {
  estimateVersionId: string;
  level: "A";
  file: File;
  idempotencyKey?: string;
  onUploadProgress?: (progressPercent: number) => void;
  signal?: AbortSignal;
};

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: {
    message?: string;
    code?: string;
    details?: unknown;
  };
};

type JsonRecord = Record<string, unknown>;

export class TakeoffApiError extends Error {
  readonly status: number;
  readonly details: unknown;
  readonly code: string | null;

  constructor(
    message: string,
    status: number,
    details: unknown,
    code: string | null
  ) {
    super(message);
    this.name = "TakeoffApiError";
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

export function isTakeoffApiError(error: unknown): error is TakeoffApiError {
  return error instanceof TakeoffApiError;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseJsonPayload(value: string): unknown {
  if (!value || value.trim().length === 0) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toErrorMessage(payload: unknown, fallbackMessage: string): string {
  if (isRecord(payload)) {
    if (isRecord(payload.error)) {
      const nested = toStringValue(payload.error.message);
      if (nested) return nested;
    }

    const rootMessage = toStringValue(payload.message);
    if (rootMessage) return rootMessage;
  }

  return fallbackMessage;
}

function extractErrorCode(payload: unknown): string | null {
  if (!isRecord(payload)) return null;

  if (isRecord(payload.error)) {
    return toStringValue(payload.error.code);
  }

  return toStringValue(payload.code);
}

function extractErrorDetails(payload: unknown): unknown {
  if (!isRecord(payload)) return null;

  if (isRecord(payload.error)) {
    if (Object.prototype.hasOwnProperty.call(payload.error, "details")) {
      return payload.error.details;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "details")) {
    return payload.details;
  }

  return null;
}

function unwrapSuccessfulEnvelopePayload(
  payload: unknown,
  fallbackMessage: string
): unknown {
  if (!isRecord(payload)) return payload;

  if (
    Object.prototype.hasOwnProperty.call(payload, "ok") &&
    payload.ok === false
  ) {
    throw new TakeoffApiError(
      toErrorMessage(payload, fallbackMessage),
      200,
      extractErrorDetails(payload),
      extractErrorCode(payload)
    );
  }

  if (Object.prototype.hasOwnProperty.call(payload, "data")) {
    return payload.data;
  }

  return payload;
}

function normalizeProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return Math.round(value);
}

export async function createTakeoffJob(
  input: CreateTakeoffJobInput
): Promise<TakeoffJobCreateResponse> {
  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("estimate_version_id", input.estimateVersionId);
  formData.append("level", input.level);

  return new Promise<TakeoffJobCreateResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const rejectOnce = (error: TakeoffApiError) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const resolveOnce = (value: TakeoffJobCreateResponse) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const cleanupAbortListener = (() => {
      if (!input.signal) {
        return () => undefined;
      }

      const handleAbort = () => {
        xhr.abort();
      };

      if (input.signal.aborted) {
        rejectOnce(new TakeoffApiError("Requete annulee.", 0, null, "ABORTED"));
        return () => undefined;
      }

      input.signal.addEventListener("abort", handleAbort, { once: true });

      return () => {
        input.signal?.removeEventListener("abort", handleAbort);
      };
    })();

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !input.onUploadProgress) return;
      const progress = normalizeProgress((event.loaded / event.total) * 100);
      input.onUploadProgress(progress);
    };

    xhr.onerror = () => {
      cleanupAbortListener();
      rejectOnce(
        new TakeoffApiError(
          "Erreur reseau pendant l'envoi du fichier.",
          xhr.status || 0,
          null,
          "NETWORK_ERROR"
        )
      );
    };

    xhr.onabort = () => {
      cleanupAbortListener();
      rejectOnce(new TakeoffApiError("Requete annulee.", 0, null, "ABORTED"));
    };

    xhr.onload = () => {
      cleanupAbortListener();

      const payload = parseJsonPayload(xhr.responseText) as
        | ApiEnvelope<TakeoffJobCreateResponse>
        | null;

      if (xhr.status < 200 || xhr.status >= 300) {
        rejectOnce(
          new TakeoffApiError(
            toErrorMessage(payload, "Impossible de creer le job takeoff."),
            xhr.status,
            extractErrorDetails(payload),
            extractErrorCode(payload)
          )
        );
        return;
      }

      try {
        const responsePayload = unwrapSuccessfulEnvelopePayload(
          payload,
          "Impossible de creer le job takeoff."
        ) as TakeoffJobCreateResponse;

        resolveOnce(responsePayload);
      } catch (error) {
        if (error instanceof TakeoffApiError) {
          rejectOnce(error);
          return;
        }

        rejectOnce(
          new TakeoffApiError(
            "Impossible de lire la reponse du serveur.",
            xhr.status,
            payload,
            null
          )
        );
      }
    };

    xhr.open("POST", "/api/takeoff/jobs");
    xhr.withCredentials = true;

    const idempotencyKey = input.idempotencyKey?.trim();
    if (idempotencyKey) {
      xhr.setRequestHeader("idempotency-key", idempotencyKey);
    }

    try {
      xhr.send(formData);
    } catch (error) {
      cleanupAbortListener();
      rejectOnce(
        new TakeoffApiError(
          "Impossible de demarrer l'upload du fichier.",
          0,
          error,
          "UPLOAD_INIT_FAILED"
        )
      );
    }
  });
}
