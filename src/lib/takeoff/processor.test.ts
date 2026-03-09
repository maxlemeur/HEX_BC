import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

import type { CallGeminiStructuredResult } from "@/lib/takeoff/gemini-client";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { processLevelA, processLevelB, processLevelC } from "@/lib/takeoff/processor";
import type { TakeoffExchange } from "@/lib/takeoff/types";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const ESTIMATE_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "44444444-4444-4444-8444-444444444444";
const FIXED_NOW = new Date("2026-02-25T10:00:00.000Z");
const DEFAULT_SOURCE_PATH =
  `${TENANT_ID}/${JOB_ID}/${"a".repeat(64)}-niveau-a.csv`;
const DEFAULT_SOURCE_PATH_B =
  `${TENANT_ID}/${JOB_ID}/${"b".repeat(64)}-niveau-b.pdf`;
const DEFAULT_SOURCE_PATH_C =
  `${TENANT_ID}/${JOB_ID}/${"c".repeat(64)}-niveau-c.pdf`;

type SupabaseError = {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
};

type QueryResponse<T> = {
  data: T;
  error: SupabaseError | null;
};

type QueryThen<T> = Promise<QueryResponse<T>>["then"];

type TakeoffJobRow = {
  id: string;
  tenant_id: string;
  estimate_version_id: string;
  level: string;
  status: string;
  plan_set_id?: string | null;
  processing_strategy: string | null;
  provider_batch_id: string | null;
  provider_batch_state: string | null;
  provider_batch_updated_at: string | null;
  source_file_name: string | null;
  source_file_path: string | null;
  source_file_type: string | null;
  prompt_version: string | null;
  schema_version: string | null;
  model: string | null;
  thinking_level: string | null;
  retry_count: number;
  created_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  token_count: number | null;
  cost_cents: number | null;
  duration_ms: number | null;
};

type StoredTakeoffResultRow = {
  id: string;
  tenant_id: string;
  job_id: string;
  extracted_json: unknown;
  warnings: unknown[];
  tables: unknown[];
  provider_meta: Record<string, unknown>;
  raw_response: unknown;
  confidence: number | null;
  token_count: number;
  cost_cents: number;
  duration_ms: number;
};

type StoredTakeoffItemRow = {
  tenant_id: string;
  job_id: string;
  result_id: string;
  designation: string;
  quantity: number;
  unit: string;
  confidence: number | null;
  evidence: string | null;
  source_file_name: string | null;
  source_page: number | null;
  metadata: Record<string, unknown>;
};

type StoredTakeoffRunMetricRow = {
  tenant_id: string;
  job_id: string;
  result_id: string | null;
  level: string;
  provider: string;
  model: string;
  chunk_index: number;
  chunk_start_page: number;
  chunk_end_page: number;
  input_tokens: number;
  reasoning_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_cents: number;
  duration_ms: number;
  timed_out: boolean;
  budget_exceeded: boolean;
  metadata: Record<string, unknown>;
};

type AuditLogPayload = {
  action: string;
  after_data: Record<string, unknown>;
  [key: string]: unknown;
};

type ProviderEventPayload = {
  tenant_id: string;
  takeoff_job_id: string;
  estimate_version_id: string;
  provider: string;
  processing_strategy: string;
  provider_batch_id: string | null;
  provider_batch_state: string | null;
  provider_state_raw: string | null;
  message: string | null;
  metadata: Record<string, unknown>;
};

type SupabaseMockOptions = {
  job?: Partial<TakeoffJobRow>;
  existingResults?: StoredTakeoffResultRow[];
  existingItems?: StoredTakeoffItemRow[];
  existingRunMetrics?: StoredTakeoffRunMetricRow[];
  featureFlags?: Record<string, string | null>;
  planFiles?: Array<{
    id: string;
    plan_set_id?: string | null;
    file_path: string;
    file_name?: string | null;
    file_type?: string | null;
    page_count: number | null;
    metadata: Record<string, unknown>;
  }>;
  planFile?: {
    id: string;
    file_path: string;
    page_count: number | null;
    metadata: Record<string, unknown>;
  } | null;
  planFileDownloads?: Record<
    string,
    {
      bytes: ArrayBuffer;
      mimeType: string;
    }
  >;
  downloadFile?: {
    bytes: ArrayBuffer;
    mimeType: string;
  };
  cancelOnResultInsert?: boolean;
  failCompletedJobUpdate?: boolean;
  failRunMetricsDeleteWhenNonEmpty?: boolean;
  failTakeoffItemsInsertOnce?: boolean;
};

type SupabaseMockState = {
  initialStatus: string;
  job: TakeoffJobRow;
  statusTransitions: string[];
  takeoffResults: StoredTakeoffResultRow[];
  takeoffItems: StoredTakeoffItemRow[];
  takeoffRunMetrics: StoredTakeoffRunMetricRow[];
  featureFlags: Record<string, string | null>;
  planFiles: Array<{
    id: string;
    tenant_id: string;
    plan_set_id: string | null;
    file_path: string;
    file_name: string | null;
    file_type: string | null;
    page_count: number | null;
    metadata: Record<string, unknown>;
  }>;
  planFile: {
    id: string;
    tenant_id: string;
    plan_set_id: string | null;
    file_path: string;
    file_name: string | null;
    file_type: string | null;
    page_count: number | null;
    metadata: Record<string, unknown>;
  } | null;
  auditLogs: AuditLogPayload[];
  providerEvents: ProviderEventPayload[];
  downloadRequests: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toArrayBuffer(value: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function viewToArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

async function createPdfArrayBuffer(pageCount: number): Promise<ArrayBuffer> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    pdf.addPage([595, 842]);
  }
  const bytes = await pdf.save();
  return viewToArrayBuffer(bytes);
}

function buildTakeoffExchange(
  items: TakeoffExchange["items"],
  warnings: TakeoffExchange["warnings"] = [],
  metadataOverrides: Partial<TakeoffExchange["metadata"]> = {}
): TakeoffExchange {
  return {
    items,
    warnings,
    tables: [
      {
        page: 1,
        title: "Feuille 1",
        headers: ["designation", "quantity", "unit"],
        rows: [
          {
            row_index: 0,
            cells: ["dummy", "1", "u"],
          },
        ],
      },
    ],
    metadata: {
      level: "A",
      prompt_version: "takeoff-a-v1",
      file_type: "text/csv",
      schema_version: "v1",
      ...metadataOverrides,
    },
    confidence: 0.92,
  };
}

function buildGeminiResult(
  exchange: TakeoffExchange,
  overrides: Partial<CallGeminiStructuredResult<TakeoffExchange>> = {}
): CallGeminiStructuredResult<TakeoffExchange> {
  const tokenCount = overrides.tokenCount ?? 1_400;
  return {
    data: exchange,
    tokenCount,
    tokenUsage: overrides.tokenUsage ?? {
      inputTokens: tokenCount,
      reasoningTokens: 0,
      outputTokens: 0,
      totalTokens: tokenCount,
    },
    costCents: overrides.costCents ?? 42,
    durationMs: overrides.durationMs ?? 1_800,
    model: overrides.model ?? "gemini-3-flash-preview",
    promptVersion: overrides.promptVersion ?? "takeoff-a-v1",
    providerBatchId: overrides.providerBatchId ?? null,
    providerBatchStateRaw: overrides.providerBatchStateRaw ?? null,
  };
}

function getAuditMetadata(
  logs: AuditLogPayload[],
  action: string
): Record<string, unknown> {
  const event = logs.find((entry) => entry.action === action);
  if (!event) {
    throw new Error(`Audit action not found: ${action}`);
  }

  const afterData = event.after_data;
  if (!isRecord(afterData)) {
    throw new Error(`Invalid after_data for action: ${action}`);
  }

  const metadata = afterData.metadata;
  if (!isRecord(metadata)) {
    throw new Error(`Invalid metadata for action: ${action}`);
  }

  return metadata;
}

function createTakeoffProcessorSupabaseMock(
  options: SupabaseMockOptions = {}
): {
  supabase: {
    from: (table: string) => unknown;
    storage: {
      from: (
        bucket: string
      ) => {
        download: (
          path: string
        ) => Promise<
          QueryResponse<{
            type: string;
            arrayBuffer: () => Promise<ArrayBuffer>;
          } | null>
        >;
      };
    };
  };
  state: SupabaseMockState;
} {
  const defaultJob: TakeoffJobRow = {
    id: JOB_ID,
    tenant_id: TENANT_ID,
    estimate_version_id: ESTIMATE_VERSION_ID,
    level: "A",
    status: "pending",
    plan_set_id: null,
    processing_strategy: "sync",
    provider_batch_id: null,
    provider_batch_state: null,
    provider_batch_updated_at: null,
    source_file_name: "niveau-a.csv",
    source_file_path: DEFAULT_SOURCE_PATH,
    source_file_type: "text/csv",
    prompt_version: null,
    schema_version: "v1",
    model: null,
    thinking_level: null,
    retry_count: 0,
    created_by: USER_ID,
    started_at: null,
    completed_at: null,
    error_code: null,
    error_message: null,
    token_count: null,
    cost_cents: null,
    duration_ms: null,
  };

  const state: SupabaseMockState = {
    initialStatus: options.job?.status ?? defaultJob.status,
    job: {
      ...defaultJob,
      ...options.job,
    },
    statusTransitions: [],
    takeoffResults: options.existingResults
      ? deepClone(options.existingResults)
      : [],
    takeoffItems: options.existingItems ? deepClone(options.existingItems) : [],
    takeoffRunMetrics: options.existingRunMetrics
      ? deepClone(options.existingRunMetrics)
      : [],
    featureFlags: {
      TAKEOFF_C_CHUNK_THRESHOLD_PAGES: "15",
      TAKEOFF_C_CHUNK_SIZE_PAGES: "10",
      TAKEOFF_C_CHUNK_OVERLAP_PAGES: "2",
      TAKEOFF_C_MAX_PDF_PAGES: "200",
      TAKEOFF_C_TIMEOUT_MS: "120000",
      TAKEOFF_C_MAX_TOTAL_TOKENS: "250000",
      TAKEOFF_C_MAX_COST_CENTS: "2000",
      ...(options.featureFlags ?? {}),
    },
    planFiles: options.planFiles
      ? options.planFiles.map((planFile) => ({
          id: planFile.id,
          tenant_id: TENANT_ID,
          plan_set_id: planFile.plan_set_id ?? null,
          file_path: planFile.file_path,
          file_name: planFile.file_name ?? null,
          file_type: planFile.file_type ?? null,
          page_count: planFile.page_count,
          metadata: deepClone(planFile.metadata),
        }))
      : options.planFile
      ? [
          {
            id: options.planFile.id,
            tenant_id: TENANT_ID,
            plan_set_id: null,
            file_path: options.planFile.file_path,
            file_name: null,
            file_type: null,
            page_count: options.planFile.page_count,
            metadata: deepClone(options.planFile.metadata),
          },
        ]
      : [],
    planFile:
      options.planFile === null
        ? null
        : options.planFile
        ? {
            id: options.planFile.id,
            tenant_id: TENANT_ID,
            plan_set_id: null,
            file_path: options.planFile.file_path,
            file_name: null,
            file_type: null,
            page_count: options.planFile.page_count,
            metadata: deepClone(options.planFile.metadata),
          }
        : null,
    auditLogs: [],
    providerEvents: [],
    downloadRequests: [],
  };

  const downloadFile =
    options.downloadFile ??
    ({
      bytes: toArrayBuffer("designation,quantity,unit\nTube PVC,12,ml\nCable U1000,8,m"),
      mimeType: "text/csv",
    } satisfies { bytes: ArrayBuffer; mimeType: string });
  const planFileDownloads = options.planFileDownloads ?? {};
  const cancelOnResultInsert = options.cancelOnResultInsert ?? false;
  const failCompletedJobUpdate = options.failCompletedJobUpdate ?? false;
  const failRunMetricsDeleteWhenNonEmpty =
    options.failRunMetricsDeleteWhenNonEmpty ?? false;
  let takeoffItemsInsertFailuresRemaining = options.failTakeoffItemsInsertOnce ? 1 : 0;
  let cancellationApplied = false;

  let resultIdSequence = 0;

  function nextResultId() {
    resultIdSequence += 1;
    return `77777777-7777-4777-8777-${String(resultIdSequence).padStart(12, "0")}`;
  }

  function matchesJobFilters(
    filters: Record<string, string>,
    statusFilter: string[] | null = null
  ) {
    if (filters.id && filters.id !== state.job.id) {
      return false;
    }

    if (filters.tenant_id && filters.tenant_id !== state.job.tenant_id) {
      return false;
    }

    if (filters.status && filters.status !== state.job.status) {
      return false;
    }

    if (statusFilter && !statusFilter.includes(state.job.status)) {
      return false;
    }

    return true;
  }

  function createTakeoffJobsSelectBuilder() {
    const filters: Record<string, string> = {};

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        filters[column] = value;
        return builder;
      }),
      maybeSingle: vi.fn(
        async (): Promise<QueryResponse<TakeoffJobRow | null>> => {
          if (!matchesJobFilters(filters)) {
            return { data: null, error: null };
          }

          return { data: deepClone(state.job), error: null };
        }
      ),
    };

    return builder;
  }

  function createTakeoffJobsUpdateBuilder(payload: Partial<TakeoffJobRow>) {
    const filters: Record<string, string> = {};
    let statusFilter: string[] | null = null;
    let executed = false;

    function execute(withRow: boolean) {
      if (failCompletedJobUpdate && payload.status === "completed") {
        const simulatedError = {
          code: "PGRST301",
          message: "Simulated completion update failure",
        };

        if (withRow) {
          return {
            data: null,
            error: simulatedError,
          } as QueryResponse<TakeoffJobRow | null>;
        }

        return { data: null, error: simulatedError } as QueryResponse<null>;
      }

      const canUpdate = matchesJobFilters(filters, statusFilter);

      if (!executed && canUpdate) {
        state.job = {
          ...state.job,
          ...payload,
        };

        if (typeof payload.status === "string") {
          state.statusTransitions.push(payload.status);
        }
      }

      executed = true;

      if (!canUpdate) {
        if (withRow) {
          return { data: null, error: null } as QueryResponse<TakeoffJobRow | null>;
        }

        return { data: null, error: null } as QueryResponse<null>;
      }

      if (withRow) {
        return {
          data: deepClone(state.job),
          error: null,
        } as QueryResponse<TakeoffJobRow | null>;
      }

      return { data: null, error: null } as QueryResponse<null>;
    }

    const then: QueryThen<null> = (onfulfilled, onrejected) =>
      Promise.resolve(execute(false) as QueryResponse<null>).then(
        onfulfilled,
        onrejected
      );

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        filters[column] = value;
        return builder;
      }),
      in: vi.fn((column: string, values: string[]) => {
        if (column === "status") {
          statusFilter = [...values];
        }
        return builder;
      }),
      select: vi.fn(() => builder),
      maybeSingle: vi.fn(
        async (): Promise<QueryResponse<TakeoffJobRow | null>> =>
          execute(true) as QueryResponse<TakeoffJobRow | null>
      ),
      then,
    };

    return builder;
  }

  function createTakeoffItemsSelectBuilder() {
    const filters: Record<string, string> = {};

    const then: QueryThen<StoredTakeoffItemRow[]> = (onfulfilled, onrejected) => {
      const data = state.takeoffItems.filter((item) => {
        if (filters.tenant_id && item.tenant_id !== filters.tenant_id) {
          return false;
        }
        if (filters.job_id && item.job_id !== filters.job_id) {
          return false;
        }

        return true;
      });

      return Promise.resolve({
        data: deepClone(data),
        error: null,
      }).then(onfulfilled, onrejected);
    };

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        filters[column] = value;
        return builder;
      }),
      then,
    };

    return builder;
  }

  function createTakeoffResultsSelectBuilder() {
    const filters: Record<string, string> = {};

    const then: QueryThen<StoredTakeoffResultRow[]> = (onfulfilled, onrejected) => {
      const data = state.takeoffResults.filter((result) => {
        if (filters.tenant_id && result.tenant_id !== filters.tenant_id) {
          return false;
        }
        if (filters.job_id && result.job_id !== filters.job_id) {
          return false;
        }

        return true;
      });

      return Promise.resolve({
        data: deepClone(data),
        error: null,
      }).then(onfulfilled, onrejected);
    };

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        filters[column] = value;
        return builder;
      }),
      then,
    };

    return builder;
  }

  function createTakeoffRunMetricsSelectBuilder() {
    const filters: Record<string, string> = {};

    const then: QueryThen<StoredTakeoffRunMetricRow[]> = (onfulfilled, onrejected) => {
      const data = state.takeoffRunMetrics.filter((metric) => {
        if (filters.tenant_id && metric.tenant_id !== filters.tenant_id) {
          return false;
        }
        if (filters.job_id && metric.job_id !== filters.job_id) {
          return false;
        }

        return true;
      });

      return Promise.resolve({
        data: deepClone(data),
        error: null,
      }).then(onfulfilled, onrejected);
    };

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        filters[column] = value;
        return builder;
      }),
      then,
    };

    return builder;
  }

  function createTakeoffItemsDeleteBuilder() {
    const filters: Record<string, string> = {};

    const then: QueryThen<null> = (onfulfilled, onrejected) => {
      state.takeoffItems = state.takeoffItems.filter((item) => {
        if (filters.tenant_id && item.tenant_id !== filters.tenant_id) {
          return true;
        }
        if (filters.job_id && item.job_id !== filters.job_id) {
          return true;
        }

        return false;
      });

      return Promise.resolve({ data: null, error: null }).then(
        onfulfilled,
        onrejected
      );
    };

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        filters[column] = value;
        return builder;
      }),
      then,
    };

    return builder;
  }

  function createTakeoffResultsDeleteBuilder() {
    const filters: Record<string, string> = {};

    const then: QueryThen<null> = (onfulfilled, onrejected) => {
      state.takeoffResults = state.takeoffResults.filter((result) => {
        if (filters.tenant_id && result.tenant_id !== filters.tenant_id) {
          return true;
        }
        if (filters.job_id && result.job_id !== filters.job_id) {
          return true;
        }

        return false;
      });

      return Promise.resolve({ data: null, error: null }).then(
        onfulfilled,
        onrejected
      );
    };

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        filters[column] = value;
        return builder;
      }),
      then,
    };

    return builder;
  }

  function createTakeoffRunMetricsDeleteBuilder() {
    const filters: Record<string, string> = {};

    const then: QueryThen<null> = (onfulfilled, onrejected) => {
      if (failRunMetricsDeleteWhenNonEmpty && state.takeoffRunMetrics.length > 0) {
        return Promise.resolve({
          data: null,
          error: {
            code: "PGRST301",
            message: "Simulated run metrics delete failure",
          },
        }).then(onfulfilled, onrejected);
      }

      state.takeoffRunMetrics = state.takeoffRunMetrics.filter((metric) => {
        if (filters.tenant_id && metric.tenant_id !== filters.tenant_id) {
          return true;
        }
        if (filters.job_id && metric.job_id !== filters.job_id) {
          return true;
        }

        return false;
      });

      return Promise.resolve({ data: null, error: null }).then(
        onfulfilled,
        onrejected
      );
    };

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        filters[column] = value;
        return builder;
      }),
      then,
    };

    return builder;
  }

  function createTakeoffResultsInsertBuilder(payload: Omit<StoredTakeoffResultRow, "id">) {
    let insertedId: string | null = null;

    function ensureInserted() {
      if (insertedId) {
        return insertedId;
      }

      insertedId = nextResultId();
      state.takeoffResults.push({
        id: insertedId,
        ...payload,
      });

      if (cancelOnResultInsert && !cancellationApplied && state.job.status === "processing") {
        cancellationApplied = true;
        state.job = {
          ...state.job,
          status: "canceled",
          completed_at: FIXED_NOW.toISOString(),
          error_code: null,
          error_message: null,
        };
        state.statusTransitions.push("canceled");
      }
      return insertedId;
    }

    const then: QueryThen<null> = (onfulfilled, onrejected) => {
      ensureInserted();
      return Promise.resolve({ data: null, error: null }).then(
        onfulfilled,
        onrejected
      );
    };

    return {
      select: vi.fn(() => ({
        single: vi.fn(
          async (): Promise<QueryResponse<{ id: string } | null>> => ({
            data: {
              id: ensureInserted(),
            },
            error: null,
          })
        ),
      })),
      then,
    };
  }

  function createTakeoffRunMetricsInsertBuilder(payload: StoredTakeoffRunMetricRow[]) {
    const then: QueryThen<null> = (onfulfilled, onrejected) => {
      state.takeoffRunMetrics.push(...deepClone(payload));
      return Promise.resolve({ data: null, error: null }).then(
        onfulfilled,
        onrejected
      );
    };

    return {
      then,
    };
  }

  function createFeatureFlagsSelectBuilder() {
    const filters: Record<string, string> = {};

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        filters[column] = value;
        return builder;
      }),
      maybeSingle: vi.fn(
        async (): Promise<QueryResponse<{ enabled: boolean; value: string | null } | null>> => {
          if (filters.tenant_id && filters.tenant_id !== TENANT_ID) {
            return { data: null, error: null };
          }

          const flagKey = filters.flag_key;
          if (!flagKey || !(flagKey in state.featureFlags)) {
            return { data: null, error: null };
          }

          return {
            data: {
              enabled: true,
              value: state.featureFlags[flagKey] ?? null,
            },
            error: null,
          };
        }
      ),
    };

    return builder;
  }

  function createPlanFilesSelectBuilder() {
    const filters: Record<string, string> = {};

    const then: QueryThen<
      Array<{
        file_path: string | null;
        file_name: string | null;
        file_type: string | null;
      }>
    > = (onfulfilled, onrejected) => {
      const data = state.planFiles
        .filter((planFile) => {
          if (filters.tenant_id && filters.tenant_id !== planFile.tenant_id) {
            return false;
          }
          if (filters.plan_set_id && filters.plan_set_id !== planFile.plan_set_id) {
            return false;
          }
          if (filters.file_path && filters.file_path !== planFile.file_path) {
            return false;
          }
          return true;
        })
        .map((planFile) => ({
          file_path: planFile.file_path,
          file_name: planFile.file_name,
          file_type: planFile.file_type,
        }));

      return Promise.resolve({
        data: deepClone(data),
        error: null,
      }).then(onfulfilled, onrejected);
    };

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        filters[column] = value;
        return builder;
      }),
      order: vi.fn(() => {
        return builder;
      }),
      maybeSingle: vi.fn(
        async (): Promise<
          QueryResponse<{
            id: string;
            page_count: number | null;
            metadata: Record<string, unknown>;
          } | null>
        > => {
          const matchedPlanFile = state.planFiles.find((planFile) => {
            if (filters.tenant_id && filters.tenant_id !== planFile.tenant_id) {
              return false;
            }
            if (filters.file_path && filters.file_path !== planFile.file_path) {
              return false;
            }
            return true;
          });

          if (!matchedPlanFile) {
            return { data: null, error: null };
          }

          return {
            data: {
              id: matchedPlanFile.id,
              page_count: matchedPlanFile.page_count,
              metadata: deepClone(matchedPlanFile.metadata),
            },
            error: null,
          };
        }
      ),
      then,
    };

    return builder;
  }

  function createPlanFilesUpdateBuilder(payload: {
    page_count?: number;
    metadata?: Record<string, unknown>;
  }) {
    const filters: Record<string, string> = {};

    const then: QueryThen<null> = (onfulfilled, onrejected) => {
      state.planFiles = state.planFiles.map((planFile) => {
        if (filters.id && filters.id !== planFile.id) {
          return planFile;
        }
        if (filters.tenant_id && filters.tenant_id !== planFile.tenant_id) {
          return planFile;
        }

        const updatedPlanFile = {
          ...planFile,
          page_count:
            typeof payload.page_count === "number"
              ? payload.page_count
              : planFile.page_count,
          metadata:
            payload.metadata && isRecord(payload.metadata)
              ? deepClone(payload.metadata)
              : planFile.metadata,
        };

        if (state.planFile?.id === updatedPlanFile.id) {
          state.planFile = deepClone(updatedPlanFile);
        }

        return updatedPlanFile;
      });

      return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
    };

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        filters[column] = value;
        return builder;
      }),
      then,
    };

    return builder;
  }

  const supabase = {
    storage: {
      from: vi.fn((bucket: string) => {
        if (bucket !== "takeoff-files" && bucket !== "plan-files") {
          throw new Error(`Unexpected storage bucket: ${bucket}`);
        }

        return {
          download: vi.fn(
            async (
              path: string
            ): Promise<
              QueryResponse<{
                type: string;
                arrayBuffer: () => Promise<ArrayBuffer>;
              } | null>
            > => {
              state.downloadRequests.push(path);

              if (bucket === "plan-files") {
                const planDownload = planFileDownloads[path];
                if (!planDownload) {
                  return {
                    data: null,
                    error: {
                      code: "404",
                      message: "Not found",
                    },
                  };
                }

                return {
                  data: {
                    type: planDownload.mimeType,
                    arrayBuffer: async () => planDownload.bytes,
                  },
                  error: null,
                };
              }

              if (path !== state.job.source_file_path) {
                return {
                  data: null,
                  error: {
                    code: "404",
                    message: "Not found",
                  },
                };
              }

              return {
                data: {
                  type: downloadFile.mimeType,
                  arrayBuffer: async () => downloadFile.bytes,
                },
                error: null,
              };
            }
          ),
        };
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "takeoff_jobs") {
        return {
          select: vi.fn(() => createTakeoffJobsSelectBuilder()),
          update: vi.fn((payload: Partial<TakeoffJobRow>) =>
            createTakeoffJobsUpdateBuilder(payload)
          ),
        };
      }

      if (table === "takeoff_items") {
        return {
          select: vi.fn(() => createTakeoffItemsSelectBuilder()),
          delete: vi.fn(() => createTakeoffItemsDeleteBuilder()),
          insert: vi.fn(
            async (payload: StoredTakeoffItemRow[]): Promise<QueryResponse<null>> => {
              if (takeoffItemsInsertFailuresRemaining > 0) {
                takeoffItemsInsertFailuresRemaining -= 1;
                return {
                  data: null,
                  error: {
                    code: "PGRST301",
                    message: "Simulated takeoff_items insert failure",
                  },
                };
              }

              state.takeoffItems.push(...deepClone(payload));
              return { data: null, error: null };
            }
          ),
        };
      }

      if (table === "takeoff_results") {
        return {
          select: vi.fn(() => createTakeoffResultsSelectBuilder()),
          delete: vi.fn(() => createTakeoffResultsDeleteBuilder()),
          insert: vi.fn((payload: Omit<StoredTakeoffResultRow, "id">) =>
            createTakeoffResultsInsertBuilder(deepClone(payload))
          ),
        };
      }

      if (table === "takeoff_run_metrics") {
        return {
          select: vi.fn(() => createTakeoffRunMetricsSelectBuilder()),
          delete: vi.fn(() => createTakeoffRunMetricsDeleteBuilder()),
          insert: vi.fn((payload: StoredTakeoffRunMetricRow[]) =>
            createTakeoffRunMetricsInsertBuilder(deepClone(payload))
          ),
        };
      }

      if (table === "audit_logs") {
        return {
          insert: vi.fn(
            async (payload: AuditLogPayload): Promise<QueryResponse<null>> => {
              state.auditLogs.push(deepClone(payload));
              return { data: null, error: null };
            }
          ),
        };
      }

      if (table === "takeoff_job_provider_events") {
        return {
          insert: vi.fn(
            async (payload: ProviderEventPayload): Promise<QueryResponse<null>> => {
              state.providerEvents.push(deepClone(payload));
              return { data: null, error: null };
            }
          ),
        };
      }

      if (table === "feature_flags") {
        return {
          select: vi.fn(() => createFeatureFlagsSelectBuilder()),
        };
      }

      if (table === "plan_files") {
        return {
          select: vi.fn(() => createPlanFilesSelectBuilder()),
          update: vi.fn((payload: { page_count?: number; metadata?: Record<string, unknown> }) =>
            createPlanFilesUpdateBuilder(payload)
          ),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { supabase, state };
}

describe("processLevelA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes pending jobs and persists result, items, and metrics", async () => {
    const mock = createTakeoffProcessorSupabaseMock();
    const callGemini = vi.fn().mockResolvedValue(
      buildGeminiResult(
        buildTakeoffExchange([
          {
            designation: "Tube PVC",
            quantity: 12,
            unit: "ML",
            source_page: 1,
            source_file: "niveau-a.csv",
            confidence: 0.91,
            evidence: "Tableau principal",
          },
          {
            designation: "Cable U1000",
            quantity: 8,
            unit: "m",
            source_page: 1,
            source_file: "niveau-a.csv",
            confidence: 0.88,
            evidence: "Tableau principal",
          },
        ]),
        {
          tokenCount: 3_210,
          costCents: 87,
          durationMs: 2_500,
        }
      )
    );

    const result = await processLevelA(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      callGemini,
    });

    expect(result).toMatchObject({
      jobId: JOB_ID,
      status: "completed",
      itemsCount: 2,
      warningsCount: 0,
      tokenCount: 3_210,
      costCents: 87,
      durationMs: 2_500,
    });

    expect(result.resultId).toBe(mock.state.takeoffResults[0]?.id);
    expect([mock.state.initialStatus, ...mock.state.statusTransitions]).toEqual([
      "pending",
      "processing",
      "completed",
    ]);

    expect(mock.state.job.status).toBe("completed");
    expect(mock.state.job.token_count).toBe(3_210);
    expect(mock.state.job.cost_cents).toBe(87);
    expect(mock.state.job.duration_ms).toBe(2_500);
    expect(mock.state.job.error_message).toBeNull();

    expect(mock.state.takeoffResults).toHaveLength(1);
    expect(mock.state.takeoffResults[0]).toMatchObject({
      tenant_id: TENANT_ID,
      job_id: JOB_ID,
      token_count: 3_210,
      cost_cents: 87,
      duration_ms: 2_500,
    });
    expect(mock.state.takeoffItems).toHaveLength(2);
    expect(mock.state.takeoffItems[0]).toMatchObject({
      designation: "Tube PVC",
      unit: "ml",
      job_id: JOB_ID,
    });

    expect(getAuditMetadata(mock.state.auditLogs, "takeoff.job.processing")).toMatchObject({
      status: "processing",
      attempt: 1,
      reason: null,
    });
    expect(getAuditMetadata(mock.state.auditLogs, "takeoff.job.completed")).toMatchObject({
      status: "completed",
      items_total: 2,
      warnings_total: 0,
      duration_ms: 2_500,
    });
  });

  it("marks the job as failed when source parsing fails", async () => {
    const mock = createTakeoffProcessorSupabaseMock({
      downloadFile: {
        bytes: toArrayBuffer("   "),
        mimeType: "text/csv",
      },
    });
    const callGemini = vi.fn();

    await expect(
      processLevelA(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        callGemini,
      })
    ).rejects.toMatchObject({
      code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
      message: "Le fichier ne contient aucune feuille exploitable.",
      retryable: false,
    });

    expect(callGemini).not.toHaveBeenCalled();
    expect([mock.state.initialStatus, ...mock.state.statusTransitions]).toEqual([
      "pending",
      "processing",
      "failed",
    ]);
    expect(mock.state.job.status).toBe("failed");
    expect(mock.state.job.error_code).toBe(TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID);
    expect(mock.state.job.error_message).toBe(
      "Le fichier ne contient aucune feuille exploitable."
    );

    expect(getAuditMetadata(mock.state.auditLogs, "takeoff.job.failed")).toMatchObject({
      status: "failed",
      error_code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
      retryable: false,
    });

    expect(mock.state.takeoffResults).toHaveLength(1);
    const snapshotWarnings = mock.state.takeoffResults[0]?.warnings;
    expect(Array.isArray(snapshotWarnings)).toBe(true);
    expect(snapshotWarnings).toContainEqual(
      expect.objectContaining({
        code: "PROCESSING_FAILED",
        severity: "error",
      })
    );
  });

  it.each([
    {
      label: "retryable Gemini error",
      error: new TakeoffError({
        code: TakeoffErrorCode.AI_TIMEOUT,
        message: "Gemini timeout",
        retryable: true,
        details: {
          provider_details: {
            provider_status: 504,
            provider_code: "ETIMEDOUT",
          },
        },
      }),
      expectedSeverity: "warning",
      expectedRetryable: true,
    },
    {
      label: "non-retryable Gemini error",
      error: new TakeoffError({
        code: TakeoffErrorCode.AI_SCHEMA,
        message: "Schema mismatch",
        retryable: false,
        details: {
          provider_details: {
            provider_status: 200,
            provider_code: "AI_SCHEMA",
          },
        },
      }),
      expectedSeverity: "error",
      expectedRetryable: false,
    },
  ])(
    "handles $label with failed status, audit metadata, and snapshot severity",
    async ({ error, expectedSeverity, expectedRetryable }) => {
      const mock = createTakeoffProcessorSupabaseMock();
      const callGemini = vi.fn().mockRejectedValue(error);

      await expect(
        processLevelA(JOB_ID, {
          supabase: mock.supabase as never,
          tenantId: TENANT_ID,
          userId: USER_ID,
          now: () => FIXED_NOW,
          callGemini,
        })
      ).rejects.toMatchObject({
        code: error.code,
        message: error.message,
        retryable: expectedRetryable,
        details: expect.objectContaining({
          retryable: expectedRetryable,
          jobId: JOB_ID,
          level: "A",
        }),
      });

      expect(mock.state.job.status).toBe("failed");
      expect(mock.state.job.error_code).toBe(error.code);
      expect(mock.state.job.error_message).toBe(error.message);

      expect(getAuditMetadata(mock.state.auditLogs, "takeoff.job.failed")).toMatchObject({
        status: "failed",
        error_code: error.code,
        error_message: error.message,
        retryable: expectedRetryable,
      });

      const snapshotWarnings = mock.state.takeoffResults[0]?.warnings;
      expect(Array.isArray(snapshotWarnings)).toBe(true);
      expect(snapshotWarnings).toContainEqual(
        expect.objectContaining({
          code: "PROCESSING_FAILED",
          severity: expectedSeverity,
        })
      );
    }
  );

  it("falls back from Flash-Lite to Flash when the primary structured response is invalid", async () => {
    const mock = createTakeoffProcessorSupabaseMock({
      featureFlags: {
        TAKEOFF_AI_ESCALATION_ENABLED: "true",
      },
    });
    const callGemini = vi
      .fn()
      .mockRejectedValueOnce(
        new TakeoffError({
          code: TakeoffErrorCode.AI_SCHEMA,
          message: "Schema mismatch",
          retryable: false,
          details: {
            provider_details: {
              provider_status: 200,
              provider_code: "AI_SCHEMA",
            },
          },
        })
      )
      .mockResolvedValueOnce(
        buildGeminiResult(
          buildTakeoffExchange([
            {
              designation: "Tableau secours",
              quantity: 3,
              unit: "u",
              source_page: 1,
              source_file: "niveau-a.csv",
              confidence: 0.93,
              evidence: "Fallback Flash",
            },
          ]),
          {
            model: "gemini-3-flash-preview",
            promptVersion: "takeoff-a-v1",
          }
        )
      );

    const result = await processLevelA(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      callGemini,
    });

    expect(result.status).toBe("completed");
    expect(callGemini).toHaveBeenCalledTimes(2);
    expect(callGemini).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        context: expect.objectContaining({
          level: "A",
          model: "gemini-3.1-flash-lite-preview",
          promptVersion: "takeoff-a-v1",
        }),
      })
    );
    expect(callGemini).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        context: expect.objectContaining({
          level: "A",
          model: "gemini-3-flash-preview",
          promptVersion: "takeoff-a-v1",
        }),
      })
    );
    expect(mock.state.takeoffResults[0]?.provider_meta).toMatchObject({
      model: "gemini-3-flash-preview",
      prompt_version: "takeoff-a-v1",
      thinking_level: "low",
      routing: {
        strategy: "single_model_with_fallback",
        primary_model: "gemini-3.1-flash-lite-preview",
        primary_thinking_level: "low",
        escalated: true,
        escalation_trigger: "primary_model_error",
        final_model: "gemini-3-flash-preview",
        final_thinking_level: "low",
      },
    });
  });

  it("passes batch delivery mode to Gemini when the tenant enables it", async () => {
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        processing_strategy: "batch",
      },
      featureFlags: {
        TAKEOFF_GEMINI_BATCH_MODE: "true",
      },
    });
    const callGemini = vi.fn().mockResolvedValue(
      buildGeminiResult(
        buildTakeoffExchange([
          {
            designation: "Tube PVC",
            quantity: 12,
            unit: "ml",
            source_page: 1,
            source_file: "niveau-a.csv",
          },
        ]),
        {
          model: "gemini-3.1-flash-lite-preview",
          promptVersion: "takeoff-a-v1",
        }
      )
    );

    await processLevelA(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      callGemini,
    });

    expect(callGemini).toHaveBeenCalledTimes(1);
    expect(callGemini.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        deliveryMode: "batch",
      })
    );
    expect(mock.state.job.processing_strategy).toBe("batch");
  });

  it("persists batch provider snapshot and events during Gemini batch lifecycle", async () => {
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        processing_strategy: "batch",
      },
      featureFlags: {
        TAKEOFF_GEMINI_BATCH_MODE: "true",
      },
    });
    const callGemini = vi.fn().mockImplementation(async (options) => {
      await options.onBatchLifecycleEvent?.({
        provider: "gemini",
        providerBatchId: "batches/test-1",
        providerBatchStateRaw: "JOB_STATE_SUBMITTED",
        observedAt: "2026-02-25T10:00:01.000Z",
        isTerminal: false,
        message: "submitted",
      });
      await options.onBatchLifecycleEvent?.({
        provider: "gemini",
        providerBatchId: "batches/test-1",
        providerBatchStateRaw: "JOB_STATE_RUNNING",
        observedAt: "2026-02-25T10:00:03.000Z",
        isTerminal: false,
        message: "running",
      });
      await options.onBatchLifecycleEvent?.({
        provider: "gemini",
        providerBatchId: "batches/test-1",
        providerBatchStateRaw: "JOB_STATE_SUCCEEDED",
        observedAt: "2026-02-25T10:00:05.000Z",
        isTerminal: true,
        message: "succeeded",
      });

      return buildGeminiResult(
        buildTakeoffExchange([
          {
            designation: "Tube PVC",
            quantity: 12,
            unit: "ml",
            source_page: 1,
            source_file: "niveau-a.csv",
          },
        ]),
        {
          model: "gemini-3.1-flash-lite-preview",
          promptVersion: "takeoff-a-v1",
          providerBatchId: "batches/test-1",
          providerBatchStateRaw: "JOB_STATE_SUCCEEDED",
        }
      );
    });

    await processLevelA(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      callGemini,
    });

    expect(mock.state.job.provider_batch_id).toBe("batches/test-1");
    expect(mock.state.job.provider_batch_state).toBe("succeeded");
    expect(mock.state.job.provider_batch_updated_at).toBe(
      "2026-02-25T10:00:05.000Z"
    );
    expect(
      mock.state.providerEvents.map((event) => event.provider_batch_state)
    ).toEqual(["submitted", "running", "succeeded"]);
  });

  it("clears stale batch metadata when retrying a failed job in sync mode", async () => {
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        status: "failed",
        retry_count: 1,
        processing_strategy: "sync",
        provider_batch_id: "batches/old-attempt",
        provider_batch_state: "failed",
        provider_batch_updated_at: "2026-02-24T08:00:00.000Z",
        error_code: TakeoffErrorCode.AI_TIMEOUT,
        error_message: "Previous timeout",
      },
    });
    const callGemini = vi.fn().mockResolvedValue(
      buildGeminiResult(
        buildTakeoffExchange([
          {
            designation: "Tube PVC",
            quantity: 6,
            unit: "ml",
            source_page: 1,
            source_file: "niveau-a.csv",
          },
        ])
      )
    );

    await processLevelA(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      callGemini,
    });

    expect(mock.state.job.processing_strategy).toBe("sync");
    expect(mock.state.job.provider_batch_id).toBeNull();
    expect(mock.state.job.provider_batch_state).toBeNull();
    expect(mock.state.job.provider_batch_updated_at).toBeNull();
  });

  it("replaces existing result/items on rerun without duplicates", async () => {
    const previousResultId = "66666666-6666-4666-8666-666666666666";
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        status: "failed",
        retry_count: 1,
        error_code: TakeoffErrorCode.AI_TIMEOUT,
        error_message: "Previous timeout",
      },
      existingResults: [
        {
          id: previousResultId,
          tenant_id: TENANT_ID,
          job_id: JOB_ID,
          extracted_json: {
            legacy: true,
          },
          warnings: [],
          tables: [],
          provider_meta: {
            status: "failed",
          },
          raw_response: {
            previous: true,
          },
          confidence: null,
          token_count: 0,
          cost_cents: 0,
          duration_ms: 10,
        },
      ],
      existingItems: [
        {
          tenant_id: TENANT_ID,
          job_id: JOB_ID,
          result_id: previousResultId,
          designation: "Ancien poste",
          quantity: 1,
          unit: "u",
          confidence: null,
          evidence: null,
          source_file_name: "old.csv",
          source_page: 1,
          metadata: {
            legacy: true,
          },
        },
      ],
    });

    const callGemini = vi.fn().mockResolvedValue(
      buildGeminiResult(
        buildTakeoffExchange([
          {
            designation: "Nouveau poste",
            quantity: 4,
            unit: "m",
            source_page: 1,
            source_file: "niveau-a.csv",
            confidence: 0.95,
            evidence: "Relance",
          },
        ])
      )
    );

    const result = await processLevelA(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      callGemini,
    });

    expect(result.status).toBe("completed");
    expect(result.itemsCount).toBe(1);
    expect([mock.state.initialStatus, ...mock.state.statusTransitions]).toEqual([
      "failed",
      "processing",
      "completed",
    ]);
    expect(mock.state.job.retry_count).toBe(2);

    expect(mock.state.takeoffResults).toHaveLength(1);
    expect(mock.state.takeoffResults[0]?.id).not.toBe(previousResultId);
    expect(mock.state.takeoffItems).toHaveLength(1);
    expect(mock.state.takeoffItems[0]).toMatchObject({
      designation: "Nouveau poste",
      job_id: JOB_ID,
      result_id: mock.state.takeoffResults[0]?.id,
    });
  });

  it("restores previous Level A persistence snapshot when persisting new items fails", async () => {
    const previousResultId = "66666666-6666-4666-8666-666666666666";
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        status: "failed",
        retry_count: 1,
        error_code: TakeoffErrorCode.AI_TIMEOUT,
        error_message: "Previous timeout",
      },
      existingResults: [
        {
          id: previousResultId,
          tenant_id: TENANT_ID,
          job_id: JOB_ID,
          extracted_json: {
            legacy: true,
          },
          warnings: [],
          tables: [],
          provider_meta: {
            status: "failed",
          },
          raw_response: {
            previous: true,
          },
          confidence: null,
          token_count: 0,
          cost_cents: 0,
          duration_ms: 10,
        },
      ],
      existingItems: [
        {
          tenant_id: TENANT_ID,
          job_id: JOB_ID,
          result_id: previousResultId,
          designation: "Ancien poste",
          quantity: 1,
          unit: "u",
          confidence: null,
          evidence: null,
          source_file_name: "old.csv",
          source_page: 1,
          metadata: {
            legacy: true,
          },
        },
      ],
      failTakeoffItemsInsertOnce: true,
    });
    const callGemini = vi.fn().mockResolvedValue(
      buildGeminiResult(
        buildTakeoffExchange([
          {
            designation: "Nouveau poste",
            quantity: 4,
            unit: "m",
            source_page: 1,
            source_file: "niveau-a.csv",
            confidence: 0.95,
            evidence: "Relance",
          },
        ])
      )
    );

    await expect(
      processLevelA(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        callGemini,
      })
    ).rejects.toBeInstanceOf(TakeoffError);

    expect(mock.state.job.status).toBe("failed");
    expect(mock.state.takeoffResults).toHaveLength(1);
    expect(mock.state.takeoffResults[0]?.id).toBe(previousResultId);
    expect(mock.state.takeoffResults[0]?.warnings).toEqual([]);
    expect(mock.state.takeoffItems).toHaveLength(1);
    expect(mock.state.takeoffItems[0]).toMatchObject({
      designation: "Ancien poste",
      result_id: previousResultId,
    });
  });

  it("stops persistence and preserves canceled status when cancellation happens mid-processing", async () => {
    const mock = createTakeoffProcessorSupabaseMock({
      cancelOnResultInsert: true,
    });
    const callGemini = vi.fn().mockResolvedValue(
      buildGeminiResult(
        buildTakeoffExchange([
          {
            designation: "Tube PVC",
            quantity: 12,
            unit: "ml",
            source_page: 1,
            source_file: "niveau-a.csv",
            confidence: 0.91,
            evidence: "Tableau principal",
          },
        ])
      )
    );

    await expect(
      processLevelA(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        callGemini,
      })
    ).rejects.toMatchObject({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Le job a ete annule pendant le traitement.",
      details: expect.objectContaining({
        current_status: "canceled",
        expected_status: "processing",
      }),
    });

    expect([mock.state.initialStatus, ...mock.state.statusTransitions]).toEqual([
      "pending",
      "processing",
      "canceled",
    ]);
    expect(mock.state.job.status).toBe("canceled");
    expect(mock.state.takeoffResults).toHaveLength(0);
    expect(mock.state.takeoffItems).toHaveLength(0);
    expect(
      mock.state.auditLogs.some((entry) => entry.action === "takeoff.job.failed")
    ).toBe(false);
    expect(
      mock.state.auditLogs.some((entry) => entry.action === "takeoff.job.completed")
    ).toBe(false);
  });
});

describe("processLevelB", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes a PDF job and persists tables metadata and metrics", async () => {
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        source_file_name: "niveau-b.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_B,
        source_file_type: "application/pdf",
      },
      downloadFile: {
        bytes: toArrayBuffer("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj"),
        mimeType: "application/pdf",
      },
    });

    const exchange = buildTakeoffExchange(
      [
        {
          designation: "Canalisation cuivre",
          quantity: 16,
          unit: "ml",
          source_page: 2,
          source_file: "niveau-b.pdf",
          confidence: 0.9,
          evidence: "Tableau plomberie",
        },
      ],
      [],
      {
        level: "B",
        prompt_version: "takeoff-b-v1",
        file_type: "application/pdf",
      }
    );
    const callGemini = vi.fn().mockResolvedValue(
      buildGeminiResult(exchange, {
        tokenCount: 5_200,
        costCents: 154,
        durationMs: 3_800,
        model: "gemini-3-flash-preview",
        promptVersion: "takeoff-b-v1",
      })
    );

    const result = await processLevelB(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      callGemini,
    });

    expect(result).toMatchObject({
      jobId: JOB_ID,
      status: "completed",
      itemsCount: 1,
      warningsCount: 0,
      tablesCount: 1,
      tokenCount: 5_200,
      costCents: 154,
      durationMs: 3_800,
    });

    expect(callGemini).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [expect.objectContaining({ mimeType: "application/pdf" })],
        context: expect.objectContaining({
          level: "B",
          model: "gemini-3-flash-preview",
          promptVersion: "takeoff-b-v1",
        }),
      })
    );

    expect(mock.state.job.status).toBe("completed");
    expect(mock.state.job.token_count).toBe(5_200);
    expect(mock.state.job.cost_cents).toBe(154);
    expect(mock.state.job.duration_ms).toBe(3_800);

    expect(mock.state.takeoffResults).toHaveLength(1);
    expect(mock.state.takeoffResults[0]).toMatchObject({
      token_count: 5_200,
      cost_cents: 154,
      duration_ms: 3_800,
    });
    expect(mock.state.takeoffResults[0]?.provider_meta).toMatchObject({
      file_type: "application/pdf",
      source_file_name: "niveau-b.pdf",
      processing_mode: "pdf_vision",
      tables_count: 1,
      model: "gemini-3-flash-preview",
      prompt_version: "takeoff-b-v1",
      routing: expect.objectContaining({
        strategy: "primary_then_escalation",
        primary_model: "gemini-3-flash-preview",
        escalated: false,
        final_model: "gemini-3-flash-preview",
      }),
    });
    expect(mock.state.takeoffResults[0]?.tables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          page: 1,
          headers: ["designation", "quantity", "unit"],
        }),
      ])
    );
  });

  it("accepts PDF MIME types with parameters in level B input", async () => {
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        source_file_name: "mime-params.pdf",
        source_file_path: `${TENANT_ID}/${JOB_ID}/${"b".repeat(64)}-mime-params.pdf`,
        source_file_type: "application/pdf; charset=utf-8",
      },
      downloadFile: {
        bytes: toArrayBuffer("%PDF-1.7\nmime-params"),
        mimeType: "application/pdf; charset=utf-8",
      },
    });

    const exchange = buildTakeoffExchange(
      [
        {
          designation: "Goulotte",
          quantity: 12,
          unit: "m",
          source_page: 1,
          source_file: "mime-params.pdf",
          confidence: 0.9,
          evidence: "Plan principal",
        },
      ],
      [],
      {
        level: "B",
        prompt_version: "takeoff-b-v1",
        file_type: "application/pdf",
      }
    );
    const callGemini = vi.fn().mockResolvedValue(
      buildGeminiResult(exchange, {
        model: "gemini-3-flash-preview",
        promptVersion: "takeoff-b-v1",
      })
    );

    const result = await processLevelB(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      callGemini,
    });

    expect(result.status).toBe("completed");
    expect(callGemini).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [expect.objectContaining({ mimeType: "application/pdf" })],
      })
    );
    expect(mock.state.takeoffResults[0]?.provider_meta).toMatchObject({
      file_type: "application/pdf; charset=utf-8",
      source_file_name: "mime-params.pdf",
      processing_mode: "pdf_vision",
    });
  });

  it("supports multi-page table extraction and keeps source page metadata", async () => {
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        source_file_name: "planning.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_B,
        source_file_type: "application/pdf",
      },
      downloadFile: {
        bytes: toArrayBuffer("%PDF-1.7\nmulti-page"),
        mimeType: "application/pdf",
      },
    });

    const exchange = buildTakeoffExchange(
      [
        {
          designation: "Cheminement principal",
          quantity: 10,
          unit: "m",
          source_page: 1,
          source_file: "planning.pdf",
          confidence: 0.87,
          evidence: "Schedule R+1",
        },
        {
          designation: "Support mural",
          quantity: 24,
          unit: "u",
          source_page: 4,
          source_file: "planning.pdf",
          confidence: 0.84,
          evidence: "Schedule sous-sol",
        },
      ],
      [
        {
          code: "TABLE_PARTIAL",
          message: "Tableau tronque sur la page 4.",
          severity: "warning",
          table_index: 1,
        },
      ],
      {
        level: "B",
        prompt_version: "takeoff-b-v1",
        file_type: "application/pdf",
      }
    );
    exchange.tables = [
      {
        page: 1,
        title: "Schedule R+1",
        headers: ["designation", "quantity", "unit"],
        rows: [
          { row_index: 0, cells: ["Cheminement principal", "10", "m"] },
          { row_index: 1, cells: ["Cheminement secondaire", "6", "m"] },
        ],
      },
      {
        page: 4,
        title: "Schedule Sous-sol",
        headers: ["designation", "quantity", "unit"],
        rows: [{ row_index: 0, cells: ["Support mural", "24", "u"] }],
      },
    ];

    const callGemini = vi.fn().mockResolvedValue(
      buildGeminiResult(exchange, {
        model: "gemini-3-flash-preview",
        promptVersion: "takeoff-b-v1",
      })
    );

    const result = await processLevelB(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      callGemini,
    });

    expect(result.tablesCount).toBe(2);
    expect(result.warningsCount).toBe(1);
    expect(mock.state.takeoffResults[0]?.provider_meta).toMatchObject({
      tables_count: 2,
    });
    expect(mock.state.takeoffResults[0]?.tables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ page: 1, title: "Schedule R+1" }),
        expect.objectContaining({ page: 4, title: "Schedule Sous-sol" }),
      ])
    );
    expect(mock.state.takeoffItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ designation: "Cheminement principal", source_page: 1 }),
        expect.objectContaining({ designation: "Support mural", source_page: 4 }),
      ])
    );
  });

  it("preserves per-file source names when a plan set is merged into one PDF", async () => {
    const planSetId = "55555555-5555-4555-8555-555555555555";
    const firstPlanPath = `${TENANT_ID}/${planSetId}/plan-a.pdf`;
    const secondPlanPath = `${TENANT_ID}/${planSetId}/plan-b.pdf`;
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        plan_set_id: planSetId,
        source_file_name: "plan-a.pdf",
        source_file_path: null,
        source_file_type: "application/pdf",
      },
      planFiles: [
        {
          id: "88888888-8888-4888-8888-888888888881",
          plan_set_id: planSetId,
          file_path: firstPlanPath,
          file_name: "plan-a.pdf",
          file_type: "application/pdf",
          page_count: 1,
          metadata: {},
        },
        {
          id: "88888888-8888-4888-8888-888888888882",
          plan_set_id: planSetId,
          file_path: secondPlanPath,
          file_name: "plan-b.pdf",
          file_type: "application/pdf",
          page_count: 2,
          metadata: {},
        },
      ],
      planFileDownloads: {
        [firstPlanPath]: {
          bytes: await createPdfArrayBuffer(1),
          mimeType: "application/pdf",
        },
        [secondPlanPath]: {
          bytes: await createPdfArrayBuffer(2),
          mimeType: "application/pdf",
        },
      },
    });

    const exchange = buildTakeoffExchange(
      [
        {
          designation: "Cheminement principal",
          quantity: 10,
          unit: "m",
          source_page: 1,
          confidence: 0.87,
          evidence: "Plan A",
        },
        {
          designation: "Support mural",
          quantity: 24,
          unit: "u",
          source_page: 3,
          confidence: 0.84,
          evidence: "Plan B",
        },
      ],
      [],
      {
        level: "B",
        prompt_version: "takeoff-b-v1",
        file_type: "application/pdf",
      }
    );
    exchange.tables = [
      {
        page: 1,
        title: "Plan A",
        headers: ["designation", "quantity", "unit"],
        rows: [{ row_index: 0, cells: ["Cheminement principal", "10", "m"] }],
      },
      {
        page: 3,
        title: "Plan B",
        headers: ["designation", "quantity", "unit"],
        rows: [{ row_index: 0, cells: ["Support mural", "24", "u"] }],
      },
    ];

    const callGemini = vi.fn().mockResolvedValue(
      buildGeminiResult(exchange, {
        model: "gemini-3-flash-preview",
        promptVersion: "takeoff-b-v1",
      })
    );

    await processLevelB(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      callGemini,
    });

    expect(mock.state.takeoffItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          designation: "Cheminement principal",
          source_page: 1,
          source_file_name: "plan-a.pdf",
          metadata: expect.objectContaining({
            source_file: "plan-a.pdf",
          }),
        }),
        expect.objectContaining({
          designation: "Support mural",
          source_page: 3,
          source_file_name: "plan-b.pdf",
          metadata: expect.objectContaining({
            source_file: "plan-b.pdf",
          }),
        }),
      ])
    );
  });

  it("chunks Level B PDF extraction using tenant page/chunk configuration", async () => {
    const pdfBytes = await createPdfArrayBuffer(6);
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        source_file_name: "niveau-b-chunked.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_B,
        source_file_type: "application/pdf",
      },
      featureFlags: {
        TAKEOFF_C_CHUNK_THRESHOLD_PAGES: "1",
        TAKEOFF_C_CHUNK_SIZE_PAGES: "2",
        TAKEOFF_C_CHUNK_OVERLAP_PAGES: "0",
        TAKEOFF_C_MAX_PDF_PAGES: "50",
      },
      downloadFile: {
        bytes: pdfBytes,
        mimeType: "application/pdf",
      },
    });

    const chunk1 = buildTakeoffExchange(
      [
        {
          designation: "Cheminement principal",
          quantity: 10,
          unit: "m",
          source_page: 1,
          source_file: "niveau-b-chunked.pdf",
          confidence: 0.87,
          evidence: "Chunk 1",
        },
      ],
      [],
      {
        level: "B",
        prompt_version: "takeoff-b-v1",
        file_type: "application/pdf",
      }
    );
    const chunk2 = buildTakeoffExchange(
      [
        {
          designation: "Support mural",
          quantity: 8,
          unit: "u",
          source_page: 1,
          source_file: "niveau-b-chunked.pdf",
          confidence: 0.84,
          evidence: "Chunk 2",
        },
      ],
      [],
      {
        level: "B",
        prompt_version: "takeoff-b-v1",
        file_type: "application/pdf",
      }
    );
    const chunk3 = buildTakeoffExchange(
      [
        {
          designation: "Ancrage",
          quantity: 4,
          unit: "u",
          source_page: 2,
          source_file: "niveau-b-chunked.pdf",
          confidence: 0.83,
          evidence: "Chunk 3",
        },
      ],
      [],
      {
        level: "B",
        prompt_version: "takeoff-b-v1",
        file_type: "application/pdf",
      }
    );

    const callGemini = vi
      .fn()
      .mockResolvedValueOnce(
        buildGeminiResult(chunk1, {
          tokenCount: 400,
          costCents: 20,
          durationMs: 900,
          model: "gemini-3-flash-preview",
          promptVersion: "takeoff-b-v1",
        })
      )
      .mockResolvedValueOnce(
        buildGeminiResult(chunk2, {
          tokenCount: 450,
          costCents: 23,
          durationMs: 1_000,
          model: "gemini-3-flash-preview",
          promptVersion: "takeoff-b-v1",
        })
      )
      .mockResolvedValueOnce(
        buildGeminiResult(chunk3, {
          tokenCount: 500,
          costCents: 26,
          durationMs: 1_100,
          model: "gemini-3-flash-preview",
          promptVersion: "takeoff-b-v1",
        })
      );

    const result = await processLevelB(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      callGemini,
    });

    expect(result.status).toBe("completed");
    expect(result.tablesCount).toBe(3);
    expect(result.tokenCount).toBe(1_350);
    expect(result.costCents).toBe(69);
    expect(result.durationMs).toBe(3_000);
    expect(callGemini).toHaveBeenCalledTimes(3);
    expect(mock.state.takeoffResults[0]?.provider_meta).toMatchObject({
      processing_mode: "pdf_vision_chunked",
      page_count: 6,
      chunks_count: 3,
      chunking_config: {
        threshold_pages: 1,
        chunk_size_pages: 2,
        chunk_overlap_pages: 0,
        max_pdf_pages: 50,
      },
    });
    expect(mock.state.takeoffItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ designation: "Cheminement principal", source_page: 1 }),
        expect.objectContaining({ designation: "Support mural", source_page: 3 }),
        expect.objectContaining({ designation: "Ancrage", source_page: 6 }),
      ])
    );
  });

  it("accepts table-less intermediate Level B chunks and validates merged output", async () => {
    const pdfBytes = await createPdfArrayBuffer(3);
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        source_file_name: "niveau-b-intermediate-empty.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_B,
        source_file_type: "application/pdf",
      },
      featureFlags: {
        TAKEOFF_C_CHUNK_THRESHOLD_PAGES: "1",
        TAKEOFF_C_CHUNK_SIZE_PAGES: "2",
        TAKEOFF_C_CHUNK_OVERLAP_PAGES: "0",
        TAKEOFF_C_MAX_PDF_PAGES: "50",
      },
      downloadFile: {
        bytes: pdfBytes,
        mimeType: "application/pdf",
      },
    });

    const chunkWithoutTables: TakeoffExchange = {
      items: [],
      warnings: [],
      metadata: {
        level: "B",
        prompt_version: "takeoff-b-v1",
        file_type: "application/pdf",
        schema_version: "v1",
      },
      confidence: 0.7,
    };
    const chunkWithTables = buildTakeoffExchange(
      [
        {
          designation: "Support mural",
          quantity: 8,
          unit: "u",
          source_page: 1,
          source_file: "niveau-b-intermediate-empty.pdf",
          confidence: 0.84,
          evidence: "Chunk with tables",
        },
      ],
      [],
      {
        level: "B",
        prompt_version: "takeoff-b-v1",
        file_type: "application/pdf",
      }
    );

    const callGemini = vi
      .fn()
      .mockResolvedValueOnce(
        buildGeminiResult(chunkWithoutTables, {
          tokenCount: 300,
          costCents: 15,
          durationMs: 700,
          model: "gemini-3-flash-preview",
          promptVersion: "takeoff-b-v1",
        })
      )
      .mockResolvedValueOnce(
        buildGeminiResult(chunkWithTables, {
          tokenCount: 420,
          costCents: 20,
          durationMs: 850,
          model: "gemini-3-flash-preview",
          promptVersion: "takeoff-b-v1",
        })
      );

    const result = await processLevelB(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      callGemini,
    });

    expect(result.status).toBe("completed");
    expect(result.tablesCount).toBe(1);
    expect(callGemini).toHaveBeenCalledTimes(2);
    expect(mock.state.takeoffResults[0]?.tables).toHaveLength(1);
    expect(mock.state.takeoffItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ designation: "Support mural", source_page: 3 }),
      ])
    );
  });

  it("deduplicates overlapping Level B tables before normalization", async () => {
    const pdfBytes = await createPdfArrayBuffer(6);
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        source_file_name: "niveau-b-overlap.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_B,
        source_file_type: "application/pdf",
      },
      featureFlags: {
        TAKEOFF_C_CHUNK_THRESHOLD_PAGES: "1",
        TAKEOFF_C_CHUNK_SIZE_PAGES: "4",
        TAKEOFF_C_CHUNK_OVERLAP_PAGES: "2",
        TAKEOFF_C_MAX_PDF_PAGES: "50",
      },
      downloadFile: {
        bytes: pdfBytes,
        mimeType: "application/pdf",
      },
    });

    const chunk1 = buildTakeoffExchange(
      [
        {
          designation: "Cheminement principal",
          quantity: 10,
          unit: "m",
          source_page: 4,
          source_file: "niveau-b-overlap.pdf",
          confidence: 0.9,
          evidence: "Chunk 1",
        },
      ],
      [],
      {
        level: "B",
        prompt_version: "takeoff-b-v1",
        file_type: "application/pdf",
      }
    );
    chunk1.tables = [
      {
        page: 4,
        title: "Zone de recouvrement",
        headers: ["designation", "quantity", "unit"],
        rows: [{ row_index: 0, cells: ["Cheminement principal", "10", "m"] }],
      },
    ];

    const chunk2 = buildTakeoffExchange(
      [
        {
          designation: "Cheminement principal",
          quantity: 10,
          unit: "m",
          source_page: 2,
          source_file: "niveau-b-overlap.pdf",
          confidence: 0.88,
          evidence: "Chunk 2",
        },
      ],
      [],
      {
        level: "B",
        prompt_version: "takeoff-b-v1",
        file_type: "application/pdf",
      }
    );
    chunk2.tables = [
      {
        page: 2,
        title: "Zone de recouvrement",
        headers: ["designation", "quantity", "unit"],
        rows: [{ row_index: 0, cells: ["Cheminement principal", "10", "m"] }],
      },
    ];

    const callGemini = vi
      .fn()
      .mockResolvedValueOnce(
        buildGeminiResult(chunk1, {
          tokenCount: 500,
          costCents: 25,
          durationMs: 900,
          model: "gemini-3-flash-preview",
          promptVersion: "takeoff-b-v1",
        })
      )
      .mockResolvedValueOnce(
        buildGeminiResult(chunk2, {
          tokenCount: 520,
          costCents: 26,
          durationMs: 950,
          model: "gemini-3-flash-preview",
          promptVersion: "takeoff-b-v1",
        })
      );

    const result = await processLevelB(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      callGemini,
    });

    expect(result.status).toBe("completed");
    expect(result.tablesCount).toBe(1);
    expect(mock.state.takeoffResults[0]?.tables).toHaveLength(1);
    expect(mock.state.takeoffResults[0]?.tables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          page: 4,
          title: "Zone de recouvrement",
        }),
      ])
    );
  });

  it("fails with snapshot when Gemini response is invalid for level B schema", async () => {
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        source_file_name: "invalid.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_B,
        source_file_type: "application/pdf",
      },
      downloadFile: {
        bytes: toArrayBuffer("%PDF-1.7\ninvalid"),
        mimeType: "application/pdf",
      },
    });

    const invalidPayload = {
      items: [
        {
          designation: "Poste incomplet",
          quantity: 1,
          unit: "u",
        },
      ],
      warnings: [],
      metadata: {
        level: "B",
        prompt_version: "takeoff-b-v1",
        file_type: "application/pdf",
        schema_version: "v1",
      },
      confidence: 0.61,
    } as unknown as TakeoffExchange;

    const callGemini = vi.fn().mockResolvedValue(
      buildGeminiResult(invalidPayload, {
        model: "gemini-3-flash-preview",
        promptVersion: "takeoff-b-v1",
      })
    );

    await expect(
      processLevelB(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        callGemini,
      })
    ).rejects.toMatchObject({
      code: TakeoffErrorCode.VALIDATION_ERROR,
      retryable: false,
      details: expect.objectContaining({
        level: "B",
      }),
    });

    expect([mock.state.initialStatus, ...mock.state.statusTransitions]).toEqual([
      "pending",
      "processing",
      "failed",
    ]);
    expect(mock.state.job.status).toBe("failed");
    expect(mock.state.job.error_code).toBe(TakeoffErrorCode.VALIDATION_ERROR);
    expect(mock.state.job.error_message).toBe("Payload invalide.");
    expect(mock.state.takeoffResults).toHaveLength(1);
    expect(mock.state.takeoffResults[0]?.raw_response).toEqual(
      expect.objectContaining({
        issues: expect.any(Array),
      })
    );
  });

  it("escalates Level B from Flash to Pro when the extracted structure is empty", async () => {
    const mock = createTakeoffProcessorSupabaseMock({
      featureFlags: {
        TAKEOFF_AI_ESCALATION_ENABLED: "true",
        TAKEOFF_AI_ESCALATION_MIN_CONFIDENCE: "0.75",
        TAKEOFF_AI_ESCALATION_MAX_COST_CENTS: "500",
      },
      job: {
        level: "B",
        source_file_name: "niveau-b-empty.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_B,
        source_file_type: "application/pdf",
      },
      downloadFile: {
        bytes: toArrayBuffer("%PDF-1.7\nempty"),
        mimeType: "application/pdf",
      },
    });

    const weakExchange: TakeoffExchange = {
      items: [],
      warnings: [],
      tables: [
        {
          page: 1,
          title: "Extraction incomplète",
          headers: ["designation", "quantity", "unit"],
          rows: [{ row_index: 0, cells: ["Support mural", "8", "u"] }],
        },
      ],
      metadata: {
        level: "B",
        prompt_version: "takeoff-b-v1",
        file_type: "application/pdf",
        schema_version: "v1",
      },
      confidence: 0.42,
    };
    const escalatedExchange = buildTakeoffExchange(
      [
        {
          designation: "Support mural",
          quantity: 8,
          unit: "u",
          source_page: 1,
          source_file: "niveau-b-empty.pdf",
          confidence: 0.86,
          evidence: "Escalade Pro",
        },
      ],
      [],
      {
        level: "B",
        prompt_version: "takeoff-b-v1",
        file_type: "application/pdf",
      }
    );

    const callGemini = vi
      .fn()
      .mockResolvedValueOnce(
        buildGeminiResult(weakExchange, {
          tokenCount: 120_000,
          costCents: 11,
          durationMs: 1_200,
          model: "gemini-3-flash-preview",
          promptVersion: "takeoff-b-v1",
          tokenUsage: {
            inputTokens: 100_000,
            reasoningTokens: 0,
            outputTokens: 20_000,
            totalTokens: 120_000,
          },
        })
      )
      .mockResolvedValueOnce(
        buildGeminiResult(escalatedExchange, {
          tokenCount: 120_000,
          costCents: 44,
          durationMs: 2_400,
          model: "gemini-3.1-pro-preview",
          promptVersion: "takeoff-b-v1",
          tokenUsage: {
            inputTokens: 100_000,
            reasoningTokens: 0,
            outputTokens: 20_000,
            totalTokens: 120_000,
          },
        })
      );

    const result = await processLevelB(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      callGemini,
    });

    expect(result.status).toBe("completed");
    expect(result.itemsCount).toBe(1);
    expect(result.tokenCount).toBe(240_000);
    expect(result.costCents).toBe(55);
    expect(result.durationMs).toBe(3_600);
    expect(callGemini).toHaveBeenCalledTimes(2);
    expect(callGemini).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        context: expect.objectContaining({
          level: "B",
          model: "gemini-3-flash-preview",
        }),
      })
    );
    expect(callGemini).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        context: expect.objectContaining({
          level: "B",
          model: "gemini-3.1-pro-preview",
        }),
      })
    );
    expect(mock.state.takeoffResults[0]?.provider_meta).toMatchObject({
      model: "gemini-3.1-pro-preview",
      prompt_version: "takeoff-b-v1",
      thinking_level: "medium",
      routing: {
        strategy: "primary_then_escalation",
        primary_model: "gemini-3-flash-preview",
        primary_thinking_level: "medium",
        escalated: true,
        escalation_trigger: "weak_level_b_result",
        final_model: "gemini-3.1-pro-preview",
        final_thinking_level: "medium",
        budget: {
          decision: "allow",
          reason: "within_budget",
          observed_cost_cents: 11,
          estimated_escalation_cost_cents: 44,
          projected_total_cost_cents: 55,
          max_allowed_cost_cents: 500,
        },
      },
    });
    expect(mock.state.takeoffResults[0]?.token_count).toBe(240_000);
    expect(mock.state.takeoffResults[0]?.cost_cents).toBe(55);
    expect(mock.state.job.token_count).toBe(240_000);
    expect(mock.state.job.cost_cents).toBe(55);
  });

  it("keeps the primary Level B result and traces budget_blocked when projected escalation cost exceeds the ceiling", async () => {
    const mock = createTakeoffProcessorSupabaseMock({
      featureFlags: {
        TAKEOFF_AI_ESCALATION_ENABLED: "true",
        TAKEOFF_AI_ESCALATION_MIN_CONFIDENCE: "0.75",
        TAKEOFF_AI_ESCALATION_MAX_COST_CENTS: "50",
      },
      job: {
        level: "B",
        source_file_name: "niveau-b-budget.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_B,
        source_file_type: "application/pdf",
      },
      downloadFile: {
        bytes: toArrayBuffer("%PDF-1.7\nbudget"),
        mimeType: "application/pdf",
      },
    });

    const weakExchange: TakeoffExchange = {
      items: [],
      warnings: [],
      tables: [
        {
          page: 1,
          title: "Extraction incomplète",
          headers: ["designation", "quantity", "unit"],
          rows: [{ row_index: 0, cells: ["Support mural", "8", "u"] }],
        },
      ],
      metadata: {
        level: "B",
        prompt_version: "takeoff-b-v1",
        file_type: "application/pdf",
        schema_version: "v1",
      },
      confidence: 0.42,
    };

    const callGemini = vi.fn().mockResolvedValueOnce(
      buildGeminiResult(weakExchange, {
        costCents: 11,
        model: "gemini-3-flash-preview",
        promptVersion: "takeoff-b-v1",
        tokenUsage: {
          inputTokens: 100_000,
          reasoningTokens: 0,
          outputTokens: 20_000,
          totalTokens: 120_000,
        },
      })
    );

    const result = await processLevelB(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      callGemini,
    });

    expect(result.status).toBe("completed");
    expect(result.itemsCount).toBe(0);
    expect(callGemini).toHaveBeenCalledTimes(1);
    expect(mock.state.takeoffResults[0]?.provider_meta).toMatchObject({
      model: "gemini-3-flash-preview",
      routing: {
        strategy: "primary_then_escalation",
        escalation_candidate: true,
        escalated: false,
        escalation_trigger: "weak_level_b_result",
        escalation_block_reason: "budget_blocked",
        final_model: "gemini-3-flash-preview",
        budget: {
          decision: "block",
          reason: "budget_blocked",
          observed_cost_cents: 11,
          estimated_escalation_cost_cents: 44,
          projected_total_cost_cents: 55,
          max_allowed_cost_cents: 50,
        },
      },
    });
  });

  it("blocks escalation when the dossier is already too expensive before the premium rerun", async () => {
    const mock = createTakeoffProcessorSupabaseMock({
      featureFlags: {
        TAKEOFF_AI_ESCALATION_ENABLED: "true",
        TAKEOFF_AI_ESCALATION_MIN_CONFIDENCE: "0.75",
        TAKEOFF_AI_ESCALATION_MAX_COST_CENTS: "80",
      },
      job: {
        level: "B",
        source_file_name: "niveau-b-deja-cher.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_B,
        source_file_type: "application/pdf",
      },
      downloadFile: {
        bytes: toArrayBuffer("%PDF-1.7\ndeja-cher"),
        mimeType: "application/pdf",
      },
    });

    const expensivePrimaryExchange = buildTakeoffExchange(
      [
        {
          designation: "Support mural",
          quantity: 8,
          unit: "u",
          source_page: 1,
          source_file: "niveau-b-deja-cher.pdf",
          confidence: 0.42,
          evidence: "Flash",
        },
      ],
      [],
      {
        level: "B",
        prompt_version: "takeoff-b-v1",
        file_type: "application/pdf",
      }
    );
    expensivePrimaryExchange.confidence = 0.42;

    const callGemini = vi.fn().mockResolvedValueOnce(
      buildGeminiResult(expensivePrimaryExchange, {
        costCents: 70,
        model: "gemini-3-flash-preview",
        promptVersion: "takeoff-b-v1",
        tokenUsage: {
          inputTokens: 100_000,
          reasoningTokens: 0,
          outputTokens: 20_000,
          totalTokens: 120_000,
        },
      })
    );

    const result = await processLevelB(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      callGemini,
    });

    expect(result.status).toBe("completed");
    expect(result.itemsCount).toBe(1);
    expect(callGemini).toHaveBeenCalledTimes(1);
    expect(mock.state.takeoffResults[0]?.provider_meta).toMatchObject({
      model: "gemini-3-flash-preview",
      routing: {
        strategy: "primary_then_escalation",
        escalation_candidate: true,
        escalated: false,
        escalation_trigger: "weak_level_b_result",
        escalation_block_reason: "budget_blocked",
        final_model: "gemini-3-flash-preview",
        budget: {
          decision: "block",
          reason: "budget_blocked",
          observed_cost_cents: 70,
          estimated_escalation_cost_cents: 44,
          projected_total_cost_cents: 114,
          max_allowed_cost_cents: 80,
        },
      },
    });
  });

  it("stores raw Gemini timeout details and marks the job as retryable failure", async () => {
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        source_file_name: "timeout.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_B,
        source_file_type: "application/pdf",
      },
      downloadFile: {
        bytes: toArrayBuffer("%PDF-1.7\ntimeout"),
        mimeType: "application/pdf",
      },
    });

    const timeoutError = new TakeoffError({
      code: TakeoffErrorCode.AI_TIMEOUT,
      message: "Gemini timeout",
      retryable: true,
      details: {
        provider_details: {
          provider_status: 504,
          provider_code: "ETIMEDOUT",
        },
      },
      level: "B",
      jobId: JOB_ID,
    });
    const callGemini = vi.fn().mockRejectedValue(timeoutError);

    await expect(
      processLevelB(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        callGemini,
      })
    ).rejects.toMatchObject({
      code: TakeoffErrorCode.AI_TIMEOUT,
      retryable: true,
      details: expect.objectContaining({
        level: "B",
      }),
    });

    expect(mock.state.job.status).toBe("failed");
    expect(mock.state.job.error_code).toBe(TakeoffErrorCode.AI_TIMEOUT);
    expect(mock.state.takeoffResults).toHaveLength(1);
    expect(mock.state.takeoffResults[0]?.raw_response).toEqual({
      provider_status: 504,
      provider_code: "ETIMEDOUT",
    });
    expect(mock.state.takeoffResults[0]?.warnings).toContainEqual(
      expect.objectContaining({
        code: "PROCESSING_FAILED",
        severity: "warning",
      })
    );
  });
});

describe("processLevelC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("chunks large PDFs, merges duplicates, and persists chunk metrics", async () => {
    const pdfBytes = await createPdfArrayBuffer(24);
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "C",
        source_file_name: "niveau-c.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_C,
        source_file_type: "application/pdf",
      },
      planFile: {
        id: "99999999-9999-4999-8999-999999999999",
        file_path: DEFAULT_SOURCE_PATH_C,
        page_count: null,
        metadata: {},
      },
      downloadFile: {
        bytes: pdfBytes,
        mimeType: "application/pdf",
      },
    });

    const chunk1: TakeoffExchange = {
      items: [
        {
          designation: "Canalisation cuivre",
          quantity: 10,
          unit: "ML",
          source_page: 9,
          source_file: "niveau-c.pdf",
          confidence: 0.62,
          evidence: "Chunk 1",
        },
      ],
      warnings: [
        {
          code: "CHUNK_WARNING",
          message: "Lecture partielle.",
          severity: "warning",
        },
      ],
      metadata: {
        level: "C",
        prompt_version: "takeoff-c-v1",
        file_type: "application/pdf",
        schema_version: "v1",
      },
      confidence: 0.7,
    };
    const chunk2: TakeoffExchange = {
      items: [
        {
          designation: "Canalisation cuivre",
          quantity: 12,
          unit: "ml",
          source_page: 1,
          source_file: "niveau-c.pdf",
          confidence: 0.91,
          evidence: "Chunk 2",
        },
        {
          designation: "Support mural",
          quantity: 8,
          unit: "u",
          source_page: 9,
          source_file: "niveau-c.pdf",
          confidence: 0.84,
          evidence: "Chunk 2",
        },
      ],
      warnings: [
        {
          code: "CHUNK_WARNING",
          message: "Lecture partielle.",
          severity: "warning",
        },
      ],
      metadata: {
        level: "C",
        prompt_version: "takeoff-c-v1",
        file_type: "application/pdf",
        schema_version: "v1",
      },
      confidence: 0.92,
    };
    const chunk3: TakeoffExchange = {
      items: [
        {
          designation: "Ancrage",
          quantity: 4,
          unit: "u",
          source_page: 7,
          source_file: "niveau-c.pdf",
          confidence: 0.8,
          evidence: "Chunk 3",
        },
      ],
      warnings: [],
      metadata: {
        level: "C",
        prompt_version: "takeoff-c-v1",
        file_type: "application/pdf",
        schema_version: "v1",
      },
      confidence: 0.75,
    };

    const callGemini = vi
      .fn()
      .mockResolvedValueOnce(
        buildGeminiResult(chunk1, {
          tokenCount: 600,
          costCents: 30,
          durationMs: 1_000,
          model: "gemini-3.1-pro-preview",
          promptVersion: "takeoff-c-v1",
        })
      )
      .mockResolvedValueOnce(
        buildGeminiResult(chunk2, {
          tokenCount: 700,
          costCents: 35,
          durationMs: 1_100,
          model: "gemini-3.1-pro-preview",
          promptVersion: "takeoff-c-v1",
        })
      )
      .mockResolvedValueOnce(
        buildGeminiResult(chunk3, {
          tokenCount: 500,
          costCents: 20,
          durationMs: 900,
          model: "gemini-3.1-pro-preview",
          promptVersion: "takeoff-c-v1",
        })
      );

    const result = await processLevelC(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      callGemini,
    });

    expect(result).toMatchObject({
      status: "completed",
      pageCount: 24,
      chunksCount: 3,
      tokenCount: 1_800,
      costCents: 85,
      durationMs: 3_000,
      metricsSummary: {
        inputTokens: 1_800,
        reasoningTokens: 0,
        outputTokens: 0,
        totalTokens: 1_800,
      },
    });
    expect(callGemini).toHaveBeenCalledTimes(3);
    expect(mock.state.takeoffItems).toHaveLength(3);
    expect(mock.state.takeoffItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          designation: "Canalisation cuivre",
          quantity: 12,
          confidence: 0.91,
          evidence: "Chunk 1 | Chunk 2",
        }),
      ])
    );
    expect(mock.state.takeoffResults[0]?.provider_meta).toMatchObject({
      processing_mode: "pdf_vision_chunked",
      page_count: 24,
      chunks_count: 3,
      deduplicated_items: 3,
      duplicate_items: 1,
    });
    expect(mock.state.planFile).toMatchObject({
      page_count: 24,
      metadata: expect.objectContaining({
        detected_page_count: 24,
      }),
    });
    expect(mock.state.takeoffRunMetrics).toHaveLength(3);
    expect(mock.state.takeoffRunMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenant_id: TENANT_ID,
          job_id: JOB_ID,
          level: "C",
          chunk_index: 0,
          input_tokens: 600,
          reasoning_tokens: 0,
          output_tokens: 0,
          total_tokens: 600,
          timed_out: false,
          budget_exceeded: false,
        }),
      ])
    );
  });

  it("does not duplicate chunk metrics when completion update fails after initial metric persist", async () => {
    const pdfBytes = await createPdfArrayBuffer(8);
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "C",
        source_file_name: "niveau-c-no-duplicate-metrics.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_C,
        source_file_type: "application/pdf",
      },
      downloadFile: {
        bytes: pdfBytes,
        mimeType: "application/pdf",
      },
      failCompletedJobUpdate: true,
      failRunMetricsDeleteWhenNonEmpty: true,
    });

    const validExchange: TakeoffExchange = {
      items: [
        {
          designation: "Support",
          quantity: 3,
          unit: "u",
          source_page: 1,
          source_file: "niveau-c-no-duplicate-metrics.pdf",
          confidence: 0.88,
          evidence: "Comptage visuel.",
        },
      ],
      warnings: [],
      metadata: {
        level: "C",
        prompt_version: "takeoff-c-v1",
        file_type: "application/pdf",
        schema_version: "v1",
      },
      confidence: 0.85,
    };

    const callGemini = vi.fn().mockResolvedValue(
      buildGeminiResult(validExchange, {
        tokenCount: 900,
        costCents: 40,
        durationMs: 900,
        model: "gemini-3.1-pro-preview",
        promptVersion: "takeoff-c-v1",
      })
    );

    await expect(
      processLevelC(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        callGemini,
      })
    ).rejects.toBeInstanceOf(TakeoffError);

    expect(mock.state.takeoffRunMetrics).toHaveLength(1);
    expect(mock.state.takeoffRunMetrics[0]).toMatchObject({
      chunk_index: 0,
      total_tokens: 900,
      result_id: mock.state.takeoffResults[0]?.id,
    });
    expect(
      mock.state.takeoffRunMetrics.filter((metric) => metric.result_id === null)
    ).toHaveLength(0);
  });

  it("fails when PDF page count exceeds the tenant max limit", async () => {
    const pdfBytes = await createPdfArrayBuffer(6);
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "C",
        source_file_name: "niveau-c-limit.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_C,
        source_file_type: "application/pdf",
      },
      featureFlags: {
        TAKEOFF_C_MAX_PDF_PAGES: "5",
      },
      downloadFile: {
        bytes: pdfBytes,
        mimeType: "application/pdf",
      },
    });
    const callGemini = vi.fn();

    await expect(
      processLevelC(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        callGemini,
      })
    ).rejects.toMatchObject({
      code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
      status: 413,
      details: expect.objectContaining({
        page_count: 6,
        max_pdf_pages: 5,
      }),
    });

    expect(callGemini).not.toHaveBeenCalled();
    expect(mock.state.job.status).toBe("failed");
  });

  it("fails with TAKEOFF_LEVEL_C_INVALID_SCHEMA when Gemini payload is invalid", async () => {
    const pdfBytes = await createPdfArrayBuffer(8);
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "C",
        source_file_name: "niveau-c-invalid.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_C,
        source_file_type: "application/pdf",
      },
      downloadFile: {
        bytes: pdfBytes,
        mimeType: "application/pdf",
      },
    });

    const invalidExchange = {
      items: [
        {
          designation: "Canalisation",
          quantity: 4,
          unit: "ml",
          source_page: 2,
          source_file: "niveau-c-invalid.pdf",
          confidence: 0.7,
        },
      ],
      warnings: [],
      metadata: {
        level: "C",
        prompt_version: "takeoff-c-v1",
        file_type: "application/pdf",
        schema_version: "v1",
      },
      confidence: 0.6,
    } as unknown as TakeoffExchange;

    const callGemini = vi.fn().mockResolvedValue(
      buildGeminiResult(invalidExchange, {
        tokenCount: 400,
        costCents: 25,
        durationMs: 900,
        model: "gemini-3.1-pro-preview",
        promptVersion: "takeoff-c-v1",
      })
    );

    await expect(
      processLevelC(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        callGemini,
      })
    ).rejects.toMatchObject({
      code: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
      retryable: false,
    });

    expect(mock.state.job.status).toBe("failed");
    expect(mock.state.job.error_code).toBe(TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA);
    expect(mock.state.takeoffRunMetrics).toHaveLength(1);
    expect(mock.state.takeoffRunMetrics[0]).toMatchObject({
      chunk_index: 0,
      timed_out: false,
      budget_exceeded: false,
    });
  });

  it("fails with TAKEOFF_LEVEL_C_TIMEOUT and stores timed_out chunk metric", async () => {
    const pdfBytes = await createPdfArrayBuffer(8);
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "C",
        source_file_name: "niveau-c-timeout.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_C,
        source_file_type: "application/pdf",
      },
      downloadFile: {
        bytes: pdfBytes,
        mimeType: "application/pdf",
      },
    });

    const callGemini = vi.fn().mockRejectedValue(
      new TakeoffError({
        code: TakeoffErrorCode.AI_TIMEOUT,
        message: "Gemini timeout",
        retryable: true,
        jobId: JOB_ID,
        level: "C",
      })
    );

    await expect(
      processLevelC(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        callGemini,
      })
    ).rejects.toMatchObject({
      code: TakeoffErrorCode.TAKEOFF_LEVEL_C_TIMEOUT,
    });

    expect(mock.state.job.status).toBe("failed");
    expect(mock.state.job.error_code).toBe(TakeoffErrorCode.TAKEOFF_LEVEL_C_TIMEOUT);
    expect(mock.state.takeoffRunMetrics).toHaveLength(1);
    expect(mock.state.takeoffRunMetrics[0]).toMatchObject({
      chunk_index: 0,
      timed_out: true,
      budget_exceeded: false,
    });
  });

  it("fails with TAKEOFF_LEVEL_C_BUDGET_EXCEEDED when token budget is exceeded", async () => {
    const pdfBytes = await createPdfArrayBuffer(8);
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "C",
        source_file_name: "niveau-c-budget.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_C,
        source_file_type: "application/pdf",
      },
      featureFlags: {
        TAKEOFF_C_MAX_TOTAL_TOKENS: "1000",
        TAKEOFF_C_MAX_COST_CENTS: "2000",
      },
      downloadFile: {
        bytes: pdfBytes,
        mimeType: "application/pdf",
      },
    });

    const validExchange: TakeoffExchange = {
      items: [
        {
          designation: "Support",
          quantity: 3,
          unit: "u",
          source_page: 1,
          source_file: "niveau-c-budget.pdf",
          confidence: 0.88,
          evidence: "Comptage visuel.",
        },
      ],
      warnings: [],
      metadata: {
        level: "C",
        prompt_version: "takeoff-c-v1",
        file_type: "application/pdf",
        schema_version: "v1",
      },
      confidence: 0.85,
    };

    const callGemini = vi.fn().mockResolvedValue(
      buildGeminiResult(validExchange, {
        tokenCount: 1_200,
        costCents: 40,
        durationMs: 900,
        model: "gemini-3.1-pro-preview",
        promptVersion: "takeoff-c-v1",
      })
    );

    await expect(
      processLevelC(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        callGemini,
      })
    ).rejects.toMatchObject({
      code: TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED,
      retryable: false,
    });

    expect(mock.state.job.status).toBe("failed");
    expect(mock.state.job.error_code).toBe(TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED);
    expect(mock.state.takeoffRunMetrics).toHaveLength(1);
    expect(mock.state.takeoffRunMetrics[0]).toMatchObject({
      chunk_index: 0,
      total_tokens: 1_200,
      budget_exceeded: true,
      timed_out: false,
    });
  });
});
