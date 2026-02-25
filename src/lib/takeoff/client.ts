import type {
  CreateTakeoffMappingRuleInput as SharedCreateTakeoffMappingRuleInput,
  TakeoffApiError as TakeoffApiErrorShape,
  TakeoffJobActionResponse as SharedTakeoffJobActionResponse,
  TakeoffJobCreateInput as SharedTakeoffJobCreateInput,
  TakeoffJobDetailResponse as SharedTakeoffJobDetailResponse,
  TakeoffJobResponse as SharedTakeoffJobResponse,
  TakeoffLevel as SharedTakeoffLevel,
  TakeoffMappingRule as SharedTakeoffMappingRule,
  TakeoffMappingRuleDeleteResponse as SharedTakeoffMappingRuleDeleteResponse,
  TakeoffMappingRuleMutationResponse as SharedTakeoffMappingRuleMutationResponse,
  TakeoffMappingRulesListResponse as SharedTakeoffMappingRulesListResponse,
  UpdateTakeoffMappingRuleInput as SharedUpdateTakeoffMappingRuleInput,
} from "@/lib/takeoff/types";

export type TakeoffLevel = SharedTakeoffLevel;
export type TakeoffJobCreateResponse = SharedTakeoffJobResponse;
export type TakeoffJobDetailResponse = SharedTakeoffJobDetailResponse;
export type TakeoffJobActionResponse = SharedTakeoffJobActionResponse;
export type CreateTakeoffJobInput = SharedTakeoffJobCreateInput;
export type TakeoffMappingRule = SharedTakeoffMappingRule;
export type CreateTakeoffMappingRuleInput = SharedCreateTakeoffMappingRuleInput;
export type UpdateTakeoffMappingRuleInput = SharedUpdateTakeoffMappingRuleInput;
export type TakeoffMappingRulesListResponse = SharedTakeoffMappingRulesListResponse;
export type TakeoffMappingRuleMutationResponse =
  SharedTakeoffMappingRuleMutationResponse;
export type TakeoffMappingRuleDeleteResponse =
  SharedTakeoffMappingRuleDeleteResponse;

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: {
    message?: string;
    code?: string;
    details?: unknown;
    retryable?: boolean;
    jobId?: string;
    level?: TakeoffLevel | string;
  };
};

type JsonRecord = Record<string, unknown>;
type TakeoffApiErrorMetadata = Pick<
  TakeoffApiErrorShape,
  "retryable" | "jobId" | "level"
>;

export class TakeoffApiError extends Error {
  readonly status: number;
  readonly details: unknown;
  readonly code: string | null;
  readonly retryable: boolean;
  readonly jobId: string | null;
  readonly level: TakeoffLevel | string | null;

  constructor(
    message: string,
    status: number,
    details: unknown,
    code: string | null,
    metadata: TakeoffApiErrorMetadata = {}
  ) {
    super(message);
    this.name = "TakeoffApiError";
    this.status = status;
    this.details = details;
    this.code = code;
    this.retryable = metadata.retryable ?? false;
    this.jobId = metadata.jobId ?? null;
    this.level = metadata.level ?? null;
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

function extractErrorRetryable(payload: unknown): boolean {
  if (!isRecord(payload)) return false;

  if (isRecord(payload.error) && typeof payload.error.retryable === "boolean") {
    return payload.error.retryable;
  }

  const details = extractErrorDetails(payload);
  if (isRecord(details) && typeof details.retryable === "boolean") {
    return details.retryable;
  }

  return false;
}

function extractErrorJobId(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;

  if (isRecord(payload.error)) {
    const nested = toStringValue(payload.error.jobId);
    if (nested) return nested;
  }

  const details = extractErrorDetails(payload);
  if (isRecord(details)) {
    const detailsJobId = toStringValue(details.jobId);
    if (detailsJobId) return detailsJobId;

    const detailsSnakeJobId = toStringValue(details.job_id);
    if (detailsSnakeJobId) return detailsSnakeJobId;
  }

  return undefined;
}

function extractErrorLevel(payload: unknown): TakeoffLevel | string | undefined {
  if (!isRecord(payload)) return undefined;

  if (isRecord(payload.error)) {
    const nested = toStringValue(payload.error.level);
    if (nested) return nested;
  }

  const details = extractErrorDetails(payload);
  if (isRecord(details)) {
    const detailsLevel = toStringValue(details.level);
    if (detailsLevel) return detailsLevel;
  }

  return undefined;
}

function buildErrorMetadata(payload: unknown): TakeoffApiErrorMetadata {
  return {
    retryable: extractErrorRetryable(payload),
    jobId: extractErrorJobId(payload),
    level: extractErrorLevel(payload),
  };
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
      extractErrorCode(payload),
      buildErrorMetadata(payload)
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

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestTakeoffJson<T>(
  path: string,
  init: RequestInit,
  fallbackMessage: string
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
  });
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new TakeoffApiError(
      toErrorMessage(payload, fallbackMessage),
      response.status,
      extractErrorDetails(payload),
      extractErrorCode(payload),
      buildErrorMetadata(payload)
    );
  }

  return unwrapSuccessfulEnvelopePayload(payload, fallbackMessage) as T;
}

export async function fetchTakeoffMappingRules(): Promise<TakeoffMappingRule[]> {
  const response = await requestTakeoffJson<TakeoffMappingRulesListResponse>(
    "/api/takeoff/mapping-rules",
    {
      method: "GET",
    },
    "Impossible de recuperer les regles de mapping takeoff."
  );

  return response.mapping_rules;
}

export async function createTakeoffMappingRule(
  input: CreateTakeoffMappingRuleInput
): Promise<TakeoffMappingRule> {
  const response = await requestTakeoffJson<TakeoffMappingRuleMutationResponse>(
    "/api/takeoff/mapping-rules",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
    "Impossible de creer la regle de mapping takeoff."
  );

  return response.mapping_rule;
}

export async function updateTakeoffMappingRule(
  ruleId: string,
  input: UpdateTakeoffMappingRuleInput
): Promise<TakeoffMappingRule> {
  const response = await requestTakeoffJson<TakeoffMappingRuleMutationResponse>(
    `/api/takeoff/mapping-rules/${encodeURIComponent(ruleId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
    "Impossible de mettre a jour la regle de mapping takeoff."
  );

  return response.mapping_rule;
}

export async function deleteTakeoffMappingRule(
  ruleId: string
): Promise<TakeoffMappingRuleDeleteResponse> {
  return requestTakeoffJson<TakeoffMappingRuleDeleteResponse>(
    `/api/takeoff/mapping-rules/${encodeURIComponent(ruleId)}`,
    {
      method: "DELETE",
    },
    "Impossible de supprimer la regle de mapping takeoff."
  );
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
            extractErrorCode(payload),
            buildErrorMetadata(payload)
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

export async function fetchTakeoffJob(
  jobId: string,
  options?: { signal?: AbortSignal }
): Promise<TakeoffJobDetailResponse> {
  return requestTakeoffJson<TakeoffJobDetailResponse>(
    `/api/takeoff/jobs/${encodeURIComponent(jobId)}`,
    { method: "GET", signal: options?.signal },
    "Impossible de recuperer les details du job takeoff."
  );
}

export async function retryTakeoffJob(
  jobId: string
): Promise<TakeoffJobActionResponse> {
  return requestTakeoffJson<TakeoffJobActionResponse>(
    `/api/takeoff/jobs/${encodeURIComponent(jobId)}/retry`,
    { method: "POST" },
    "Impossible de relancer le job takeoff."
  );
}

export async function cancelTakeoffJob(
  jobId: string
): Promise<TakeoffJobActionResponse> {
  return requestTakeoffJson<TakeoffJobActionResponse>(
    `/api/takeoff/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST" },
    "Impossible d'annuler le job takeoff."
  );
}
