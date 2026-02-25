import type {
  CreatePlanSetInput as SharedCreatePlanSetInput,
  CreateTakeoffMappingRuleInput as SharedCreateTakeoffMappingRuleInput,
  PlanFileCreateResponse as SharedPlanFileCreateResponse,
  PlanFileDeleteResponse as SharedPlanFileDeleteResponse,
  PlanFilesListResponse as SharedPlanFilesListResponse,
  PlanSetDeleteResponse as SharedPlanSetDeleteResponse,
  PlanSetListItem as SharedPlanSetListItem,
  PlanSetMutationResponse as SharedPlanSetMutationResponse,
  PlanSetsListResponse as SharedPlanSetsListResponse,
  RegisterPlanFileInput as SharedRegisterPlanFileInput,
  TakeoffApiError as TakeoffApiErrorShape,
  TakeoffApplyRequest as SharedTakeoffApplyRequest,
  TakeoffApplyResponse as SharedTakeoffApplyResponse,
  TakeoffItemBatchPatchRequest as SharedTakeoffItemBatchPatchRequest,
  TakeoffItemBatchPatchResponse as SharedTakeoffItemBatchPatchResponse,
  TakeoffJobCompareResponse as SharedTakeoffJobCompareResponse,
  TakeoffJobActionResponse as SharedTakeoffJobActionResponse,
  TakeoffJobCreateInput as SharedTakeoffJobCreateInput,
  TakeoffJobDetailResponse as SharedTakeoffJobDetailResponse,
  TakeoffJobListQuery as SharedTakeoffJobListQuery,
  TakeoffJobListResponse as SharedTakeoffJobListResponse,
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
export type TakeoffJobListQuery = SharedTakeoffJobListQuery;
export type TakeoffJobListResponse = SharedTakeoffJobListResponse;
export type TakeoffJobActionResponse = SharedTakeoffJobActionResponse;
export type TakeoffJobCompareResponse = SharedTakeoffJobCompareResponse;
export type TakeoffApplyRequest = SharedTakeoffApplyRequest;
export type TakeoffApplyResponse = SharedTakeoffApplyResponse;
export type CreateTakeoffJobInput = SharedTakeoffJobCreateInput;
export type TakeoffItemBatchPatchRequest = SharedTakeoffItemBatchPatchRequest;
export type TakeoffItemBatchPatchResponse = SharedTakeoffItemBatchPatchResponse;
export type TakeoffMappingRule = SharedTakeoffMappingRule;
export type CreateTakeoffMappingRuleInput = SharedCreateTakeoffMappingRuleInput;
export type UpdateTakeoffMappingRuleInput = SharedUpdateTakeoffMappingRuleInput;
export type TakeoffMappingRulesListResponse = SharedTakeoffMappingRulesListResponse;
export type TakeoffMappingRuleMutationResponse =
  SharedTakeoffMappingRuleMutationResponse;
export type TakeoffMappingRuleDeleteResponse =
  SharedTakeoffMappingRuleDeleteResponse;

export type CreatePlanSetInput = SharedCreatePlanSetInput;
export type RegisterPlanFileInput = SharedRegisterPlanFileInput;
export type PlanSetListItem = SharedPlanSetListItem;
export type PlanSetsListResponse = SharedPlanSetsListResponse;
export type PlanFilesListResponse = SharedPlanFilesListResponse;
export type PlanSetMutationResponse = SharedPlanSetMutationResponse;
export type PlanSetDeleteResponse = SharedPlanSetDeleteResponse;
export type PlanFileCreateResponse = SharedPlanFileCreateResponse;
export type PlanFileDeleteResponse = SharedPlanFileDeleteResponse;

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
  options?: { signal?: AbortSignal; itemsLimit?: number; itemsOffset?: number }
): Promise<TakeoffJobDetailResponse> {
  const searchParams = new URLSearchParams();
  if (typeof options?.itemsLimit === "number") {
    searchParams.set("items_limit", String(options.itemsLimit));
  }
  if (typeof options?.itemsOffset === "number") {
    searchParams.set("items_offset", String(options.itemsOffset));
  }
  const query = searchParams.toString();

  return requestTakeoffJson<TakeoffJobDetailResponse>(
    `/api/takeoff/jobs/${encodeURIComponent(jobId)}${query ? `?${query}` : ""}`,
    { method: "GET", signal: options?.signal },
    "Impossible de recuperer les details du job takeoff."
  );
}

export async function fetchTakeoffJobCompare(
  jobId: string,
  input: {
    withJobId: string;
    threshold?: number;
    signal?: AbortSignal;
  }
): Promise<TakeoffJobCompareResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set("with", input.withJobId);

  if (typeof input.threshold === "number" && Number.isFinite(input.threshold)) {
    searchParams.set("threshold", String(input.threshold));
  }

  return requestTakeoffJson<TakeoffJobCompareResponse>(
    `/api/takeoff/jobs/${encodeURIComponent(jobId)}/compare?${searchParams.toString()}`,
    { method: "GET", signal: input.signal },
    "Impossible de comparer les jobs takeoff."
  );
}

export async function listTakeoffJobs(
  query: TakeoffJobListQuery = {},
  options?: { signal?: AbortSignal }
): Promise<TakeoffJobListResponse> {
  const searchParams = new URLSearchParams();
  const estimateVersionId = query.estimate_version_id?.trim();
  const status = query.status?.trim();
  const level = query.level?.trim();
  const period = query.period?.trim();

  if (estimateVersionId) searchParams.set("estimate_version_id", estimateVersionId);
  if (status) searchParams.set("status", status);
  if (level) searchParams.set("level", level);
  if (period) searchParams.set("period", period);
  if (typeof query.limit === "number") searchParams.set("limit", String(query.limit));
  if (typeof query.offset === "number") searchParams.set("offset", String(query.offset));

  const requestPath = searchParams.size
    ? `/api/takeoff/jobs?${searchParams.toString()}`
    : "/api/takeoff/jobs";

  return requestTakeoffJson<TakeoffJobListResponse>(
    requestPath,
    { method: "GET", signal: options?.signal },
    "Impossible de lister les jobs takeoff."
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

export async function applyTakeoffJob(
  jobId: string,
  payload: TakeoffApplyRequest
): Promise<TakeoffApplyResponse> {
  return requestTakeoffJson<TakeoffApplyResponse>(
    `/api/takeoff/jobs/${encodeURIComponent(jobId)}/apply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Impossible d'appliquer le job takeoff."
  );
}

export async function patchTakeoffItems(
  jobId: string,
  request: TakeoffItemBatchPatchRequest
): Promise<TakeoffItemBatchPatchResponse> {
  return requestTakeoffJson<TakeoffItemBatchPatchResponse>(
    `/api/takeoff/jobs/${encodeURIComponent(jobId)}/items`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    "Impossible de mettre a jour les items takeoff."
  );
}

/* ─── Plan Center API ─── */

export async function fetchPlanSets(
  versionId: string
): Promise<PlanSetListItem[]> {
  const response = await requestTakeoffJson<PlanSetsListResponse>(
    `/api/takeoff/plan-sets?estimate_version_id=${encodeURIComponent(versionId)}`,
    { method: "GET" },
    "Impossible de recuperer les jeux de plans."
  );
  return response.plan_sets;
}

export async function createPlanSet(
  input: CreatePlanSetInput
): Promise<PlanSetListItem> {
  const response = await requestTakeoffJson<PlanSetMutationResponse>(
    "/api/takeoff/plan-sets",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    "Impossible de creer le jeu de plans."
  );
  return { ...response.plan_set, file_count: response.plan_set.file_count ?? 0 };
}

export async function deletePlanSet(
  setId: string
): Promise<PlanSetDeleteResponse> {
  return requestTakeoffJson<PlanSetDeleteResponse>(
    `/api/takeoff/plan-sets/${encodeURIComponent(setId)}`,
    { method: "DELETE" },
    "Impossible de supprimer le jeu de plans."
  );
}

export async function fetchPlanFiles(
  setId: string
): Promise<SharedPlanFilesListResponse["plan_files"]> {
  const response = await requestTakeoffJson<PlanFilesListResponse>(
    `/api/takeoff/plan-sets/${encodeURIComponent(setId)}/files`,
    { method: "GET" },
    "Impossible de recuperer les fichiers de plan."
  );
  return response.plan_files;
}

export async function registerPlanFile(
  setId: string,
  input: RegisterPlanFileInput
): Promise<PlanFileCreateResponse> {
  return requestTakeoffJson<PlanFileCreateResponse>(
    `/api/takeoff/plan-sets/${encodeURIComponent(setId)}/files`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    "Impossible d'enregistrer le fichier de plan."
  );
}

export async function deletePlanFile(
  setId: string,
  fileId: string
): Promise<PlanFileDeleteResponse> {
  return requestTakeoffJson<PlanFileDeleteResponse>(
    `/api/takeoff/plan-sets/${encodeURIComponent(setId)}/files/${encodeURIComponent(fileId)}`,
    { method: "DELETE" },
    "Impossible de supprimer le fichier de plan."
  );
}

export function uploadFileToSignedUrl(
  file: File,
  url: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const rejectOnce = (error: TakeoffApiError) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const cleanupAbortListener = (() => {
      if (!signal) return () => undefined;

      const handleAbort = () => xhr.abort();

      if (signal.aborted) {
        rejectOnce(new TakeoffApiError("Upload annule.", 0, null, "ABORTED"));
        return () => undefined;
      }

      signal.addEventListener("abort", handleAbort, { once: true });
      return () => signal.removeEventListener("abort", handleAbort);
    })();

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      const progress = normalizeProgress((event.loaded / event.total) * 100);
      onProgress(progress);
    };

    xhr.onerror = () => {
      cleanupAbortListener();
      rejectOnce(
        new TakeoffApiError(
          "Erreur reseau pendant l'upload du fichier.",
          xhr.status || 0,
          null,
          "NETWORK_ERROR"
        )
      );
    };

    xhr.onabort = () => {
      cleanupAbortListener();
      rejectOnce(new TakeoffApiError("Upload annule.", 0, null, "ABORTED"));
    };

    xhr.onload = () => {
      cleanupAbortListener();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolveOnce();
      } else {
        rejectOnce(
          new TakeoffApiError(
            "Echec de l'upload vers le stockage.",
            xhr.status,
            null,
            "STORAGE_UPLOAD_FAILED"
          )
        );
      }
    };

    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/pdf");

    try {
      xhr.send(file);
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
