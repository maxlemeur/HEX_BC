import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// Pagination faults are covered with the real SDK in read-all.test.ts.
vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));
const HOST_ID = "urn:uuid:55555555-5555-4555-8555-555555555555";
// The real local host check runs, against this host; the creator's plan is each test's provider.
vi.mock("@/lib/ai/chatgpt-local-store", () => ({ getChatGptHostId: vi.fn(), readChatGptStore: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-takeoff", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/chatgpt-takeoff")>(), resolveLocalTakeoffProvider: vi.fn(),
}));
// The vector reading's hook passes through to the real one; the routing test (TI-704) reads what a job gets.
vi.mock("@/lib/takeoff/vectors/worker-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/takeoff/vectors/worker-server")>();
  return { ...actual, readTakeoffVectorPages: vi.fn(actual.readTakeoffVectorPages),
    takeoffVectorLocalGroupsHook: vi.fn(actual.takeoffVectorLocalGroupsHook) };
});

// Lot 4: the reading against a list of items is its own module's (poste-reading-job-server.test.ts); the processor only
// hands a job of the second order to it. The order is read for real (no request: nothing read).
vi.mock("@/lib/takeoff/poste-reading-job-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/takeoff/poste-reading-job-server")>();
  return { ...actual, readTakeoffItemListOrder: vi.fn(actual.readTakeoffItemListOrder), processItemListLevelC: vi.fn() };
});

import { PDFDocument } from "pdf-lib";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getChatGptHostId } from "@/lib/ai/chatgpt-local-store";
import { resolveLocalTakeoffProvider, type LocalTakeoffProvider } from "@/lib/ai/chatgpt-takeoff";
import { readTakeoffVectorPages, takeoffVectorLocalGroupsHook } from "@/lib/takeoff/vectors/worker-server";
import { processItemListLevelC, readTakeoffItemListOrder } from "@/lib/takeoff/poste-reading-job-server";

import type { StructuredCall, StructuredCallResult } from "@/lib/ai/structured-call";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import {
  PLAN_SET_MAX_FILES,
  PLAN_SET_MAX_TOTAL_SIZE_BYTES,
} from "@/lib/takeoff/plans";
import {
  processLevelA,
  processLevelB,
  processLevelC,
} from "@/lib/takeoff/processor";
import type { TakeoffExchange } from "@/lib/takeoff/types";
import { processTakeoffJobAttempt } from "@/lib/takeoff/async-worker";
import { normalizeTakeoffWorkerJobRow } from "@/lib/takeoff/job-lifecycle";
import { confirmedPreparationFixture } from "@/lib/takeoff/preparation.test-utils";
import { TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS } from "@/lib/takeoff/hypothesis";

beforeEach(() => {
  for (const [name, value] of Object.entries({ MERGEONE_CHATGPT_LOCAL: "1", CI: "", VERCEL: "" })) vi.stubEnv(name, value);
  vi.mocked(getChatGptHostId).mockResolvedValue(HOST_ID);
  vi.mocked(resolveLocalTakeoffProvider).mockRejectedValue(new Error("Each test gives its provider."));
});

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
  execution_provider: "gemini" | "chatgpt_local";
  execution_host_id: string | null;
  plan_set_id?: string | null;
  preparation_snapshot?: unknown;
  processing_lease_token?: string | null;
  processing_lease_expires_at?: string | null;
  processing_strategy: string | null;
  provider_batch_id: string | null;
  provider_batch_state: string | null;
  provider_batch_updated_at: string | null;
  provider_reconcile_due_at: string | null;
  provider_reconcile_attempt_count: number;
  provider_reconcile_lease_token: string | null;
  provider_reconcile_lease_expires_at: string | null;
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
  is_excluded?: boolean;
  exclusion_reason?: string | null;
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

type SupabaseMockOptions = {
  job?: Partial<TakeoffJobRow>;
  /**
   * The attempt holds a paid call of unknown outcome: the failure writer ends the job without the retry the worker
   * asked and answers what it recorded (record_local_takeoff_failure, migration 20261121231238_takeoff_plan_dispatcher.sql).
   */
  heldUnknownCall?: boolean;
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
    file_size_bytes?: number;
    page_count: number | null;
    metadata: Record<string, unknown>;
  }>;
  planFile?: {
    id: string;
    file_path: string;
    file_size_bytes?: number;
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
  cancelBeforeResultCommit?: boolean;
  failCompletedJobUpdate?: boolean;
  failRunMetricsDeleteWhenNonEmpty?: boolean;
  failTakeoffItemsInsertOnce?: boolean;
};

type SupabaseMockState = {
  initialStatus: string;
  job: TakeoffJobRow;
  statusTransitions: string[];
  /** The Mac's slot each attempt gave back (release_takeoff_host_slot). */
  releasedSlots: Array<Record<string, unknown>>;
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
    file_size_bytes: number;
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
    file_size_bytes: number;
    page_count: number | null;
    metadata: Record<string, unknown>;
  } | null;
  auditLogs: AuditLogPayload[];
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

function buildProviderResult(
  exchange: TakeoffExchange,
  overrides: Partial<StructuredCallResult<TakeoffExchange>> = {}
): StructuredCallResult<TakeoffExchange> {
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
    costCents: overrides.costCents ?? 0,
    durationMs: overrides.durationMs ?? 1_800,
    model: overrides.model ?? PROVIDER_MODEL,
    promptVersion: overrides.promptVersion ?? "takeoff-a-v1",
  };
}

const PROVIDER_MODEL = "account-model";

/** The job's local provider, answering through `call`. */
function localProvider(call: unknown, model = PROVIDER_MODEL): () => Promise<LocalTakeoffProvider> {
  return async () => ({ model, call: call as StructuredCall, assertOwnerActive: vi.fn(),
    selection: { profileId: "profile", model, reasoningEffort: null } });
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
    rpc: (fn: string, args: Record<string, unknown>) => Promise<QueryResponse<string | null>> |
      Promise<QueryResponse<{ diagnostic_id: string | null } | null>> |
      { maybeSingle: () => Promise<QueryResponse<TakeoffJobRow | null>> };
    storage: {
      from: (
        bucket: string
      ) => {
        download: (
          path: string
        ) => Promise<
          QueryResponse<{
            type: string;
            size: number;
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
    execution_provider: "chatgpt_local",
    execution_host_id: HOST_ID,
    plan_set_id: null,
    processing_strategy: "sync",
    provider_batch_id: null,
    provider_batch_state: null,
    provider_batch_updated_at: null,
    provider_reconcile_due_at: null,
    provider_reconcile_attempt_count: 0,
    provider_reconcile_lease_token: null,
    provider_reconcile_lease_expires_at: null,
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
    releasedSlots: [],
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
          file_size_bytes: planFile.file_size_bytes ?? 1024,
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
            file_size_bytes: options.planFile.file_size_bytes ?? 1024,
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
            file_size_bytes: options.planFile.file_size_bytes ?? 1024,
            page_count: options.planFile.page_count,
            metadata: deepClone(options.planFile.metadata),
          }
        : null,
    auditLogs: [],
    downloadRequests: [],
  };

  const downloadFile =
    options.downloadFile ??
    ({
      bytes: toArrayBuffer("designation,quantity,unit\nTube PVC,12,ml\nCable U1000,8,m"),
      mimeType: "text/csv",
    } satisfies { bytes: ArrayBuffer; mimeType: string });
  const planFileDownloads = options.planFileDownloads ?? {};
  const cancelBeforeResultCommit = options.cancelBeforeResultCommit ?? false;
  const failCompletedJobUpdate = options.failCompletedJobUpdate ?? false;
  const failRunMetricsDeleteWhenNonEmpty =
    options.failRunMetricsDeleteWhenNonEmpty ?? false;
  let takeoffItemsInsertFailuresRemaining = options.failTakeoffItemsInsertOnce ? 1 : 0;

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
        id: string;
        file_path: string | null;
        file_name: string | null;
        file_type: string | null;
        file_size_bytes: number;
        page_count: number | null;
        metadata: Record<string, unknown>;
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
          id: planFile.id,
          file_path: planFile.file_path,
          file_name: planFile.file_name,
          file_type: planFile.file_type,
          file_size_bytes: planFile.file_size_bytes,
          page_count: planFile.page_count,
          metadata: planFile.metadata,
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
                size: number;
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
                    size: planDownload.bytes.byteLength,
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
                  size: downloadFile.bytes.byteLength,
                  arrayBuffer: async () => downloadFile.bytes,
                },
                error: null,
              };
            }
          ),
        };
      }),
    },
    // The worker RPCs as the migrations write them, under the job's processing lease.
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      if (fn === "record_local_takeoff_failure") {
        const job = state.job;
        if (job.id !== args.p_job_id || job.tenant_id !== args.p_tenant_id ||
            job.status !== "processing" || job.processing_lease_token !== args.p_lease_token) {
          return Promise.resolve({ data: null, error: null });
        }
        const scope = { tenant_id: job.tenant_id, job_id: job.id };
        let diagnosticId: string | null = null;
        // The diagnostic replaces the previous rows in its own subtransaction, or leaves them whole.
        if (args.p_diagnostic && !(failRunMetricsDeleteWhenNonEmpty && state.takeoffRunMetrics.length > 0)) {
          diagnosticId = nextResultId();
          state.takeoffRunMetrics = [];
          state.takeoffItems = [];
          state.takeoffResults = [{ ...deepClone(args.p_diagnostic as Omit<StoredTakeoffResultRow, "id" | "confidence">),
            confidence: null, ...scope, id: diagnosticId }];
        }
        state.takeoffRunMetrics.push(...(args.p_run_metrics as StoredTakeoffRunMetricRow[] ?? [])
          .map(metric => ({ ...deepClone(metric), ...scope, result_id: diagnosticId })));
        state.job = { ...job, ...deepClone(args.p_failure as Partial<TakeoffJobRow>), status: "failed",
          processing_lease_token: null, processing_lease_expires_at: null };
        if (options.heldUnknownCall && (args.p_failure as { next_retry_at?: unknown }).next_retry_at) {
          state.job = { ...state.job, error_code: "TAKEOFF_USAGE_UNRECORDED", error_message: "Consommation inconnue (fixture).",
            analysis_outcome: "failure", next_retry_at: null } as TakeoffJobRow;
        }
        state.statusTransitions.push("failed");
        const recorded = state.job as unknown as { error_code: string; error_message: string; next_retry_at: string | null };
        return Promise.resolve({ data: { diagnostic_id: diagnosticId, error_code: recorded.error_code,
          error_message: recorded.error_message, retry_scheduled: recorded.next_retry_at !== null }, error: null });
      }
      if (fn === "finalize_local_takeoff_result") {
        const job = state.job;
        if (job.id !== args.p_job_id || job.tenant_id !== args.p_tenant_id ||
            job.status !== "processing" || job.processing_lease_token !== args.p_lease_token) {
          return Promise.resolve({ data: null, error: null });
        }
        if (cancelBeforeResultCommit) {
          state.job = { ...job, status: "canceled", completed_at: FIXED_NOW.toISOString() };
          state.statusTransitions.push("canceled");
          return Promise.resolve({ data: null, error: null });
        }
        if (failCompletedJobUpdate || (failRunMetricsDeleteWhenNonEmpty && state.takeoffRunMetrics.length > 0) ||
            takeoffItemsInsertFailuresRemaining > 0) {
          takeoffItemsInsertFailuresRemaining = Math.max(0, takeoffItemsInsertFailuresRemaining - 1);
          return Promise.resolve({ data: null, error: { code: "PGRST301", message: "Simulated atomic completion failure" } });
        }
        const id = nextResultId();
        const { job_duration_ms, run_metrics, ...result } = args.p_result as Omit<StoredTakeoffResultRow, "id" | "raw_response"> & {
          job_duration_ms: number; run_metrics?: StoredTakeoffRunMetricRow[];
        };
        const scope = { tenant_id: job.tenant_id, job_id: job.id };
        state.takeoffResults = [{ id, raw_response: null, ...deepClone(result), ...scope }];
        state.takeoffItems = (args.p_items as StoredTakeoffItemRow[]).map(item => ({ ...deepClone(item), ...scope, result_id: id }));
        state.takeoffRunMetrics = (run_metrics ?? []).map(metric => ({ ...deepClone(metric), ...scope, result_id: id }));
        state.job = { ...job, status: "completed", completed_at: args.p_completed_at as string, duration_ms: job_duration_ms,
          token_count: result.token_count, cost_cents: result.cost_cents, model: args.p_model as string,
          prompt_version: args.p_prompt_version as string, error_code: null, error_message: null,
          processing_lease_token: null, processing_lease_expires_at: null };
        state.statusTransitions.push("completed");
        return Promise.resolve({ data: id, error: null });
      }
      // Before each paid call, the database's check of the job (module, payer rule, budget): it may pay.
      if (fn === "release_takeoff_host_slot") {
        state.releasedSlots.push(args);
        return Promise.resolve({ data: true, error: null }) as never;
      }
      if (fn === "takeoff_job_may_pay") {
        return Promise.resolve({ data: [{ reason: null, remaining_tokens: null, remaining_cost_cents: null }], error: null }) as never;
      }
      // claim_observed_local_takeoff_job: the job's own host, from the pending or failed state the caller observed.
      if (fn !== "claim_observed_local_takeoff_job") throw new Error(`Unexpected rpc: ${fn}`);
      return {
        maybeSingle: async (): Promise<QueryResponse<TakeoffJobRow | null>> => {
          const job = state.job;
          if (job.id !== args.p_job_id || job.tenant_id !== args.p_tenant_id || job.execution_provider !== "chatgpt_local"
            || job.execution_host_id !== args.p_host_id || !["pending", "failed"].includes(job.status)
            || job.status !== args.p_observed_status || job.retry_count !== args.p_observed_retry_count) {
            return { data: null, error: null };
          }
          state.job = { ...job, status: "processing", started_at: args.p_started_at as string, completed_at: null,
            error_code: null, error_message: null, processing_lease_token: args.p_lease_token as string,
            processing_lease_expires_at: args.p_lease_expires_at as string, model: args.p_model as string, thinking_level: null,
            prompt_version: args.p_prompt_version as string, processing_strategy: "sync",
            retry_count: job.retry_count + (job.status === "failed" ? 1 : 0) };
          state.statusTransitions.push("processing");
          return { data: deepClone(state.job), error: null };
        },
      };
    }),
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

  vi.mocked(createServiceRoleClient).mockReturnValue(supabase as never);
  return { supabase, state };
}

describe("processLevelA", () => {
  it("keeps the job's private ChatGPT selection out of the snapshot it stores in the result", async () => {
    const bytes = toArrayBuffer("designation,quantity,unit\nTube fictif,3,u");
    const hash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    const snapshot = confirmedPreparationFixture();
    snapshot.preparation.sources[0] = {
      ...snapshot.preparation.sources[0], document_id: `upload:${hash}`, source_version: hash, content_hash: hash, document_name: "niveau-a.csv",
    };
    const pinned = { ...snapshot, execution_selection: { profileId: "profil-opaque", model: "modele-fictif", reasoningEffort: null, hostId: "urn:uuid:55555555-5555-4555-8555-555555555555" } };
    const mock = createTakeoffProcessorSupabaseMock({ job: { preparation_snapshot: pinned }, downloadFile: { bytes, mimeType: "text/csv" } });
    const callProvider = vi.fn().mockResolvedValue(buildProviderResult(buildTakeoffExchange([
      { designation: "Tube fictif", quantity: 3, unit: "u", source_page: 1, confidence: 0.9, evidence: "Ligne 2" },
    ])));
    await processLevelA(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW, resolveProvider: localProvider(callProvider) });
    expect(mock.state.takeoffResults[0].provider_meta.preparation_snapshot).toEqual(snapshot);
    expect(mock.state.takeoffResults[0].provider_meta.preparation_snapshot).not.toHaveProperty("execution_selection");
  });

  // The provider is resolved before the claim: a launch request's job records each paid call's usage under the lease the
  // claim then took, never the one of the row it was read from (a stale lease stops the job after its first call).
  it("gives the provider the lease the claim took, read at each paid call", async () => {
    const bytes = toArrayBuffer("designation,quantity,unit\nTube fictif,3,u");
    const hash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    const snapshot = confirmedPreparationFixture();
    snapshot.preparation.sources[0] = {
      ...snapshot.preparation.sources[0], document_id: `upload:${hash}`, source_version: hash, content_hash: hash, document_name: "niveau-a.csv",
    };
    const mock = createTakeoffProcessorSupabaseMock({ job: { preparation_snapshot: snapshot, processing_lease_token: null },
      downloadFile: { bytes, mimeType: "text/csv" } });
    const leasesSeen: Array<string | null | undefined> = [];
    const callProvider = vi.fn().mockResolvedValue(buildProviderResult(buildTakeoffExchange([
      { designation: "Tube fictif", quantity: 3, unit: "u", source_page: 1, confidence: 0.9, evidence: "Ligne 2" },
    ])));
    const resolveProvider = async (_supabase: unknown, _job: unknown, hooks?: { lease?: () => string | null }) => ({
      model: PROVIDER_MODEL, assertOwnerActive: vi.fn(), selection: { profileId: "profile", model: PROVIDER_MODEL, reasoningEffort: null },
      call: (async (options: unknown) => { leasesSeen.push(hooks?.lease?.()); return callProvider(options); }) as StructuredCall,
    });
    const result = await processLevelA(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW,
      resolveProvider: resolveProvider as never });
    expect(result.status).toBe("completed");
    const claim = vi.mocked(mock.supabase.rpc).mock.calls.find(([fn]) => fn === "claim_observed_local_takeoff_job");
    expect(claim?.[1].p_lease_token).toEqual(expect.any(String));
    expect(leasesSeen).toEqual([claim?.[1].p_lease_token]);
  });

  it("passes confirmed exclusions and conventions to the provider and retains the snapshot in the result", async () => {
    const bytes = toArrayBuffer("designation,quantity,unit\nTube fictif,3,u");
    const hash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    const snapshot = confirmedPreparationFixture();
    snapshot.preparation.scope.levels = ["R+1"];
    snapshot.preparation.scope.exclusions = ["RDC", "Zone 2"];
    snapshot.preparation.sources[0] = {
      ...snapshot.preparation.sources[0], document_id: `upload:${hash}`, source_version: hash, content_hash: hash,
      document_name: "niveau-a.csv",
    };
    const mock = createTakeoffProcessorSupabaseMock({ job: { preparation_snapshot: snapshot }, downloadFile: { bytes, mimeType: "text/csv" } });
    const callProvider = vi.fn().mockResolvedValue(buildProviderResult(buildTakeoffExchange([
      { designation: "Tube fictif R+1", quantity: 3, unit: "u", source_page: 1, confidence: 0.9, evidence: "Ligne 2" },
    ])));
    const result = await processLevelA(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW, resolveProvider: localProvider(callProvider) });
    expect(result.status).toBe("completed");
    const sent = callProvider.mock.calls[0][0];
    expect(sent.prompt).toContain('"exclusions":["RDC","Zone 2"]');
    expect(sent.prompt).toContain('"levels":["R+1"]');
    expect(sent.prompt).toContain('"unit":"u"');
    expect(mock.state.takeoffResults[0].provider_meta.preparation_snapshot).toEqual(snapshot);
    expect(mock.state.takeoffItems[0].metadata).toMatchObject({ preparation_revision: 1, quantity_nature: "proposed" });
  });

  // M1b : le fichier téléversé nomme la source ; une feuille citée par le fournisseur dans
  // source_file n'est pas un fichier et reste une preuve brute.
  it("keeps the uploaded file over a sheet name given as source_file", async () => {
    const mock = createTakeoffProcessorSupabaseMock();
    const callProvider = vi.fn().mockResolvedValue(
      buildProviderResult(
        buildTakeoffExchange([
          { designation: "Tableau secours", quantity: 3, unit: "u", source_page: 1,
            source_file: "Feuil1", confidence: 0.93, evidence: "Ligne 2" },
        ]),
        { model: PROVIDER_MODEL, promptVersion: "takeoff-a-v1" }
      )
    );

    const result = await processLevelA(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      resolveProvider: localProvider(callProvider),
    });

    expect(result.status).toBe("completed");
    expect(mock.state.takeoffItems).toEqual([
      expect.objectContaining({
        source_file_name: "niveau-a.csv",
        metadata: expect.objectContaining({
          source_document: { kind: "job_upload", job_id: JOB_ID },
          provider_source_file: "Feuil1",
        }),
      }),
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs a local job with its creator's plan and records the plan's model on the job and its result", async () => {
    const mock = createTakeoffProcessorSupabaseMock();
    const call = vi.fn().mockResolvedValue(buildProviderResult(buildTakeoffExchange([
      { designation: "Tube cuivre", quantity: 12, unit: "m" },
    ])));
    vi.mocked(resolveLocalTakeoffProvider).mockImplementationOnce(localProvider(call));
    const result = await processLevelA(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, now: () => FIXED_NOW });
    expect(result.status).toBe("completed");
    expect(resolveLocalTakeoffProvider).toHaveBeenCalledWith(mock.supabase, expect.objectContaining({ id: JOB_ID, execution_provider: "chatgpt_local" }),
      { lease: expect.any(Function), ledger: expect.objectContaining({ beforePaidCall: expect.any(Function) }) });
    expect(call).toHaveBeenCalledTimes(1);
    expect(mock.state.job).toMatchObject({ model: PROVIDER_MODEL, thinking_level: null, processing_strategy: "sync", cost_cents: 0 });
    expect(mock.state.takeoffResults[0].provider_meta).toMatchObject({ provider: "chatgpt", model: PROVIDER_MODEL });
    expect(mock.state.takeoffItems[0]).toMatchObject({ designation: "Tube cuivre", quantity: 12, unit: "m" });
  });

  it("refuses a job of a former provider before claiming it or reading any provider", async () => {
    const mock = createTakeoffProcessorSupabaseMock({ job: { execution_provider: "gemini", execution_host_id: null } });
    const call = vi.fn();
    await expect(processLevelA(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, now: () => FIXED_NOW, resolveProvider: localProvider(call) }))
      .rejects.toMatchObject({ code: TakeoffErrorCode.AI_PROVIDER, status: 422, retryable: false, message: expect.stringContaining("Cet ancien métré") });
    expect(mock.supabase.rpc).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    expect(mock.state.statusTransitions).toEqual([]);
    expect(mock.state.job).toMatchObject({ status: "pending", error_code: null, model: null });
    expect(mock.state.takeoffResults).toEqual([]);
  });

  it("fails the job once, without another provider call, when the plan rejects the extraction", async () => {
    const mock = createTakeoffProcessorSupabaseMock();
    const call = vi.fn().mockRejectedValue(new TakeoffError({ code: TakeoffErrorCode.AI_SCHEMA, message: "Plan rejected", retryable: false }));
    await expect(processLevelA(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, now: () => FIXED_NOW, resolveProvider: localProvider(call) }))
      .rejects.toMatchObject({ code: "AI_SCHEMA", retryable: false });
    expect(call).toHaveBeenCalledTimes(1);
    expect(mock.state.job.status).toBe("failed");
  });

  it("persists a terminal failure when local plan preflight rejects the job", async () => {
    const mock = createTakeoffProcessorSupabaseMock();
    vi.mocked(resolveLocalTakeoffProvider).mockRejectedValueOnce(new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, message: "Choose a model", retryable: false }));
    await expect(processLevelA(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, now: () => FIXED_NOW })).rejects.toMatchObject({ code: "AI_PROVIDER", retryable: false });
    // The plan could not be read: the claim records only the provider.
    expect(mock.state.job).toMatchObject({ status: "failed", error_code: "AI_PROVIDER", error_message: "Choose a model", model: "chatgpt" });
  });

  it("does not call the provider or persist when the synchronous lease is lost", async () => {
    const mock = createTakeoffProcessorSupabaseMock();
    const call = vi.fn();

    await expect(processLevelA(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      now: () => FIXED_NOW,
      resolveProvider: localProvider(call),
      renewLease: vi.fn().mockRejectedValue(new TakeoffError({ code: TakeoffErrorCode.CONFLICT, message: "lease lost", retryable: false })),
    })).rejects.toMatchObject({ code: TakeoffErrorCode.CONFLICT });

    expect(call).not.toHaveBeenCalled();
    expect(mock.state.takeoffResults).toHaveLength(0);
    expect(mock.state.job.status).toBe("processing");
  });

  it("marks the job as failed when source parsing fails", async () => {
    const mock = createTakeoffProcessorSupabaseMock({
      downloadFile: {
        bytes: toArrayBuffer("   "),
        mimeType: "text/csv",
      },
    });
    const callProvider = vi.fn();

    await expect(
      processLevelA(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        resolveProvider: localProvider(callProvider),
      })
    ).rejects.toMatchObject({
      code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
      message: "Le fichier ne contient aucune feuille exploitable.",
      retryable: false,
    });

    expect(callProvider).not.toHaveBeenCalled();
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

  it("keeps the previous Level A result when the atomic completion transaction fails", async () => {
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
    const callProvider = vi.fn().mockResolvedValue(
      buildProviderResult(
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
        resolveProvider: localProvider(callProvider),
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
      cancelBeforeResultCommit: true,
    });
    const callProvider = vi.fn().mockResolvedValue(
      buildProviderResult(
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
        resolveProvider: localProvider(callProvider),
      })
    ).rejects.toMatchObject({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Le job a été annulé pendant le traitement.",
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
  it("sends only selected PDF pages, restores their original page and does not rewrite confirmed plan metadata", async () => {
    const bytes = await createPdfArrayBuffer(3);
    const hash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    const snapshot = confirmedPreparationFixture();
    snapshot.preparation.objective = "count";
    snapshot.preparation.sources[0] = {
      ...snapshot.preparation.sources[0], document_id: `upload:${hash}`, source_version: hash, content_hash: hash,
      kind: "plan", pages: [2], page_count: 3, document_name: "selection.pdf",
    };
    const mock = createTakeoffProcessorSupabaseMock({ job: {
      level: "B", preparation_snapshot: snapshot, source_file_name: "selection.pdf",
      source_file_path: DEFAULT_SOURCE_PATH_B, source_file_type: "application/pdf",
    }, downloadFile: { bytes, mimeType: "application/pdf" } });
    const exchange = buildTakeoffExchange([
      { designation: "Symbole R+1", quantity: 3, unit: "u", source_page: 1, confidence: 0.9, evidence: "Plan retenu" },
    ], [], { level: "B", prompt_version: "takeoff-b-v1", file_type: "application/pdf" });
    const callProvider = vi.fn().mockImplementation(async (input) => {
      const sentPdf = await PDFDocument.load(Buffer.from(input.files[0].data, "base64"));
      expect(sentPdf.getPageCount()).toBe(1);
      return buildProviderResult(exchange, { model: PROVIDER_MODEL, promptVersion: "takeoff-b-v1" });
    });
    const result = await processLevelB(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW, resolveProvider: localProvider(callProvider) });
    expect(result.status).toBe("completed");
    expect(mock.state.takeoffItems[0].source_page).toBe(2);
    expect(vi.mocked(mock.supabase.from).mock.calls.filter(([table]) => table === "plan_files")).toEqual([]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts PDF MIME types with parameters in level B input", async () => {
    const pdfBytes = await createPdfArrayBuffer(1);
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        source_file_name: "mime-params.pdf",
        source_file_path: `${TENANT_ID}/${JOB_ID}/${"b".repeat(64)}-mime-params.pdf`,
        source_file_type: "application/pdf; charset=utf-8",
      },
      downloadFile: {
        bytes: pdfBytes,
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
    const callProvider = vi.fn().mockResolvedValue(
      buildProviderResult(exchange, {
        model: PROVIDER_MODEL,
        promptVersion: "takeoff-b-v1",
      })
    );

    const result = await processLevelB(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      resolveProvider: localProvider(callProvider),
    });

    expect(result.status).toBe("completed");
    expect(callProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [expect.objectContaining({ mimeType: "application/pdf" })],
      })
    );
    expect(mock.state.takeoffResults[0]?.provider_meta).toMatchObject({
      file_type: "application/pdf",
      source_file_name: "mime-params.pdf",
      processing_mode: "pdf_vision",
    });
  });

  // M1b : le libellé d'origine du job (et non le reste du chemin <empreinte>-<uuid>-<nom nettoyé>)
  // nomme la source dans le prompt, les items et le résultat ; la référence durable est le
  // fichier téléversé du job, et le source_file du fournisseur reste une preuve brute.
  it("carries the original label and the upload reference to the prompt, the items and the result", async () => {
    const uploadUuid = "0f0e0d0c-0b0a-4908-8706-050403020100";
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        source_file_name: "Plan R+1.pdf",
        source_file_path: `${TENANT_ID}/${JOB_ID}/${"c".repeat(64)}-${uploadUuid}-Plan-R-1.pdf`,
        source_file_type: "application/pdf",
      },
      downloadFile: {
        bytes: await createPdfArrayBuffer(1),
        mimeType: "application/pdf",
      },
    });
    const exchange = buildTakeoffExchange(
      [
        {
          designation: "Tube cuivre 22",
          quantity: 12.5,
          unit: "m",
          source_page: 1,
          source_file: `${uploadUuid}-Plan-R-1.pdf`,
          confidence: 0.9,
          evidence: "Plan R+1",
        },
        {
          designation: "Coude cuivre",
          quantity: 4,
          unit: "u",
          source_page: 1,
          confidence: 0.9,
          evidence: "Plan R+1",
        },
      ],
      [],
      { level: "B", prompt_version: "takeoff-b-v1", file_type: "application/pdf" }
    );
    const callProvider = vi.fn().mockResolvedValue(
      buildProviderResult(exchange, { model: PROVIDER_MODEL, promptVersion: "takeoff-b-v1" })
    );

    const result = await processLevelB(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      resolveProvider: localProvider(callProvider),
    });

    expect(result.status).toBe("completed");
    const prompt = String(callProvider.mock.calls[0]?.[0]?.prompt);
    expect(prompt).toContain("- source: Plan R+1.pdf");
    expect(prompt).not.toContain(uploadUuid);
    expect(mock.state.takeoffItems).toEqual([
      expect.objectContaining({
        designation: "Tube cuivre 22",
        source_file_name: "Plan R+1.pdf",
        metadata: expect.objectContaining({
          source_file: "Plan R+1.pdf",
          source_document: { kind: "job_upload", job_id: JOB_ID },
          provider_source_file: `${uploadUuid}-Plan-R-1.pdf`,
        }),
      }),
      expect.objectContaining({
        designation: "Coude cuivre",
        source_file_name: "Plan R+1.pdf",
        metadata: expect.objectContaining({
          source_document: { kind: "job_upload", job_id: JOB_ID },
        }),
      }),
    ]);
    expect(mock.state.takeoffItems[1]?.metadata).not.toHaveProperty("provider_source_file");
    expect(mock.state.takeoffResults[0]?.provider_meta).toMatchObject({
      source_file_name: "Plan R+1.pdf",
    });
  });

  it("fails explicitly when the source PDF is corrupted before the provider is called", async () => {
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        source_file_name: "corrompu.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_B,
        source_file_type: "application/pdf",
      },
      downloadFile: {
        bytes: toArrayBuffer("not-a-valid-pdf"),
        mimeType: "application/pdf",
      },
    });
    const callProvider = vi.fn();

    await expect(
      processLevelB(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        resolveProvider: localProvider(callProvider),
      })
    ).rejects.toMatchObject({
      code: TakeoffErrorCode.TAKEOFF_PDF_CORRUPTED,
      retryable: false,
    });

    expect(callProvider).not.toHaveBeenCalled();
    expect(mock.state.job.status).toBe("failed");
    expect(mock.state.job.error_code).toBe(TakeoffErrorCode.TAKEOFF_PDF_CORRUPTED);
  });

  it("rejects an over-cardinality plan set before any Storage download", async () => {
    const planSetId = "55555555-5555-4555-8555-555555555555";
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        plan_set_id: planSetId,
        source_file_name: "plan-1.pdf",
        source_file_path: null,
        source_file_type: "application/pdf",
      },
      planFiles: Array.from({ length: PLAN_SET_MAX_FILES + 1 }, (_, index) => ({
        id: `88888888-8888-4888-8888-${String(index + 1).padStart(12, "0")}`,
        plan_set_id: planSetId,
        file_path: `${TENANT_ID}/${planSetId}/plan-${index + 1}.pdf`,
        file_name: `plan-${index + 1}.pdf`,
        file_type: "application/pdf",
        file_size_bytes: 1024,
        page_count: 1,
        metadata: {},
      })),
    });
    const callProvider = vi.fn();

    await expect(
      processLevelB(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        resolveProvider: localProvider(callProvider),
      })
    ).rejects.toMatchObject({
      code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
      details: expect.objectContaining({
        phase: "metadata",
        violation: "file_count",
      }),
    });

    expect(mock.state.downloadRequests).toEqual([]);
    expect(callProvider).not.toHaveBeenCalled();
  });

  it("rejects aggregate declared bytes before any Storage download", async () => {
    const planSetId = "55555555-5555-4555-8555-555555555555";
    const perFileSize = Math.floor(PLAN_SET_MAX_TOTAL_SIZE_BYTES / 3) + 1;
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        plan_set_id: planSetId,
        source_file_name: "plan-1.pdf",
        source_file_path: null,
        source_file_type: "application/pdf",
      },
      planFiles: Array.from({ length: 3 }, (_, index) => ({
        id: `77777777-7777-4777-8777-${String(index + 1).padStart(12, "0")}`,
        plan_set_id: planSetId,
        file_path: `${TENANT_ID}/${planSetId}/volume-${index + 1}.pdf`,
        file_name: `volume-${index + 1}.pdf`,
        file_type: "application/pdf",
        file_size_bytes: perFileSize,
        page_count: 1,
        metadata: {},
      })),
    });
    const callProvider = vi.fn();

    await expect(
      processLevelB(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        resolveProvider: localProvider(callProvider),
      })
    ).rejects.toMatchObject({
      code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
      details: expect.objectContaining({
        phase: "metadata",
        violation: "total_size",
      }),
    });

    expect(mock.state.downloadRequests).toEqual([]);
    expect(callProvider).not.toHaveBeenCalled();
  });

  it("rechecks real aggregate PDF pages before copying the merged document", async () => {
    const planSetId = "55555555-5555-4555-8555-555555555555";
    const firstPlanPath = `${TENANT_ID}/${planSetId}/mutated-a.pdf`;
    const secondPlanPath = `${TENANT_ID}/${planSetId}/mutated-b.pdf`;
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        plan_set_id: planSetId,
        source_file_name: "mutated-a.pdf",
        source_file_path: null,
        source_file_type: "application/pdf",
      },
      featureFlags: {
        TAKEOFF_C_MAX_PDF_PAGES: "3",
      },
      planFiles: [
        {
          id: "66666666-6666-4666-8666-666666666661",
          plan_set_id: planSetId,
          file_path: firstPlanPath,
          file_name: "mutated-a.pdf",
          file_type: "application/pdf",
          file_size_bytes: 1024,
          page_count: 1,
          metadata: {},
        },
        {
          id: "66666666-6666-4666-8666-666666666662",
          plan_set_id: planSetId,
          file_path: secondPlanPath,
          file_name: "mutated-b.pdf",
          file_type: "application/pdf",
          file_size_bytes: 1024,
          page_count: 1,
          metadata: {},
        },
      ],
      planFileDownloads: {
        [firstPlanPath]: {
          bytes: await createPdfArrayBuffer(2),
          mimeType: "application/pdf",
        },
        [secondPlanPath]: {
          bytes: await createPdfArrayBuffer(2),
          mimeType: "application/pdf",
        },
      },
    });
    const callProvider = vi.fn();

    await expect(
      processLevelB(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        resolveProvider: localProvider(callProvider),
      })
    ).rejects.toMatchObject({
      code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
      details: expect.objectContaining({
        phase: "pdf",
        violation: "total_pages",
        known_page_count: 4,
      }),
    });

    expect(mock.state.downloadRequests).toEqual([
      firstPlanPath,
      secondPlanPath,
    ]);
    expect(callProvider).not.toHaveBeenCalled();
  });

  // M1b : dans un jeu multi-fichiers, le fichier de chaque page (libellé d'origine et référence)
  // l'emporte sur le source_file du fournisseur, qui ne voit que le PDF fusionné.
  it("keeps the page's plan file over the provider's source_file in a multi-PDF plan set", async () => {
    const planSetId = "55555555-5555-4555-8555-555555555555";
    const upperPath = `${TENANT_ID}/${planSetId}/f1/Plan-R-1.pdf`;
    const lowerPath = `${TENANT_ID}/${planSetId}/f2/Plan-R-1.pdf`;
    const upperId = "88888888-8888-4888-8888-888888888881";
    const lowerId = "88888888-8888-4888-8888-888888888882";
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        plan_set_id: planSetId,
        source_file_name: "Plan R+1.pdf",
        source_file_path: null,
        source_file_type: "application/pdf",
      },
      featureFlags: { TAKEOFF_C_MAX_PDF_PAGES: "3" },
      planFiles: [
        { id: upperId, plan_set_id: planSetId, file_path: upperPath, file_name: "Plan-R-1.pdf",
          file_type: "application/pdf", page_count: 1, metadata: { original_file_name: "Plan R+1.pdf" } },
        { id: lowerId, plan_set_id: planSetId, file_path: lowerPath, file_name: "Plan-R-1.pdf",
          file_type: "application/pdf", page_count: 1, metadata: { original_file_name: "Plan R-1.pdf" } },
      ],
      planFileDownloads: {
        [upperPath]: { bytes: await createPdfArrayBuffer(1), mimeType: "application/pdf" },
        [lowerPath]: { bytes: await createPdfArrayBuffer(1), mimeType: "application/pdf" },
      },
    });
    const exchange = buildTakeoffExchange(
      [
        { designation: "Réseau R+1", quantity: 10, unit: "m", source_page: 1,
          source_file: `plan-set-${planSetId}.pdf`, confidence: 0.9, evidence: "Page 1" },
        { designation: "Réseau R-1", quantity: 8, unit: "m", source_page: 2,
          source_file: `plan-set-${planSetId}.pdf`, confidence: 0.9, evidence: "Page 2" },
        { designation: "Nourrice", quantity: 1, unit: "u",
          source_file: `plan-set-${planSetId}.pdf`, confidence: 0.9, evidence: "Sans page" },
        { designation: "Vanne", quantity: 2, unit: "u", source_page: 3,
          source_file: `plan-set-${planSetId}.pdf`, confidence: 0.9, evidence: "Page 3" },
      ],
      [],
      { level: "B", prompt_version: "takeoff-b-v1", file_type: "application/pdf" }
    );
    const callProvider = vi.fn().mockResolvedValue(
      buildProviderResult(exchange, { model: PROVIDER_MODEL, promptVersion: "takeoff-b-v1" })
    );

    await processLevelB(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      resolveProvider: localProvider(callProvider),
    });

    expect(mock.state.takeoffItems).toEqual([
      expect.objectContaining({
        designation: "Réseau R+1",
        source_file_name: "Plan R+1.pdf",
        metadata: expect.objectContaining({
          source_document: { kind: "plan_file", plan_file_id: upperId },
          provider_source_file: `plan-set-${planSetId}.pdf`,
        }),
      }),
      expect.objectContaining({
        designation: "Réseau R-1",
        source_file_name: "Plan R-1.pdf",
        metadata: expect.objectContaining({
          source_document: { kind: "plan_file", plan_file_id: lowerId },
          provider_source_file: `plan-set-${planSetId}.pdf`,
        }),
      }),
      // Sans page, aucun fichier du jeu n'est désigné : ni le premier, ni le PDF fusionné.
      expect.objectContaining({
        designation: "Nourrice",
        source_file_name: null,
        metadata: expect.objectContaining({ provider_source_file: `plan-set-${planSetId}.pdf` }),
      }),
      // Une page hors du PDF fusionné ne désigne aucun fichier, et le dit.
      expect.objectContaining({ designation: "Vanne", source_file_name: null, source_page: 3 }),
    ]);
    expect(mock.state.takeoffItems[2]?.metadata).not.toHaveProperty("source_document");
    expect(mock.state.takeoffItems[3]?.metadata).not.toHaveProperty("source_document");
    expect(mock.state.takeoffResults[0]?.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "SOURCE_PAGE_OUT_OF_RANGE", item_index: 3 })])
    );
  });

  it("preserves per-file source names and page counts across a multi-PDF rerun", async () => {
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
      featureFlags: {
        TAKEOFF_C_MAX_PDF_PAGES: "3",
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

    const callProvider = vi.fn().mockResolvedValue(
      buildProviderResult(exchange, {
        model: PROVIDER_MODEL,
        promptVersion: "takeoff-b-v1",
      })
    );

    await processLevelB(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      resolveProvider: localProvider(callProvider),
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
    expect(
      mock.state.planFiles.map((planFile) => planFile.page_count)
    ).toEqual([1, 2]);

    const retryMock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        plan_set_id: planSetId,
        source_file_name: "plan-a.pdf",
        source_file_path: null,
        source_file_type: "application/pdf",
      },
      featureFlags: {
        TAKEOFF_C_MAX_PDF_PAGES: "3",
      },
      planFiles: mock.state.planFiles.map((planFile) => ({
        ...planFile,
        metadata: deepClone(planFile.metadata),
      })),
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
    const retryCallProvider = vi.fn().mockResolvedValue(
      buildProviderResult(exchange, {
        model: PROVIDER_MODEL,
        promptVersion: "takeoff-b-v1",
      })
    );

    await processLevelB(JOB_ID, {
      supabase: retryMock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      resolveProvider: localProvider(retryCallProvider),
    });

    expect(retryMock.state.job.status).toBe("completed");
    expect(
      retryMock.state.planFiles.map((planFile) => planFile.page_count)
    ).toEqual([1, 2]);
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

    const callProvider = vi
      .fn()
      .mockResolvedValueOnce(
        buildProviderResult(chunk1, {
          tokenCount: 400,
          costCents: 20,
          durationMs: 900,
          model: PROVIDER_MODEL,
          promptVersion: "takeoff-b-v1",
        })
      )
      .mockResolvedValueOnce(
        buildProviderResult(chunk2, {
          tokenCount: 450,
          costCents: 23,
          durationMs: 1_000,
          model: PROVIDER_MODEL,
          promptVersion: "takeoff-b-v1",
        })
      )
      .mockResolvedValueOnce(
        buildProviderResult(chunk3, {
          tokenCount: 500,
          costCents: 26,
          durationMs: 1_100,
          model: PROVIDER_MODEL,
          promptVersion: "takeoff-b-v1",
        })
      );

    const result = await processLevelB(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      resolveProvider: localProvider(callProvider),
    });

    expect(result.status).toBe("completed");
    expect(result.tablesCount).toBe(3);
    expect(result.tokenCount).toBe(1_350);
    expect(result.costCents).toBe(69);
    expect(result.durationMs).toBe(3_000);
    expect(callProvider).toHaveBeenCalledTimes(3);
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

    const callProvider = vi
      .fn()
      .mockResolvedValueOnce(
        buildProviderResult(chunkWithoutTables, {
          tokenCount: 300,
          costCents: 15,
          durationMs: 700,
          model: PROVIDER_MODEL,
          promptVersion: "takeoff-b-v1",
        })
      )
      .mockResolvedValueOnce(
        buildProviderResult(chunkWithTables, {
          tokenCount: 420,
          costCents: 20,
          durationMs: 850,
          model: PROVIDER_MODEL,
          promptVersion: "takeoff-b-v1",
        })
      );

    const result = await processLevelB(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      resolveProvider: localProvider(callProvider),
    });

    expect(result.status).toBe("completed");
    expect(result.tablesCount).toBe(1);
    expect(callProvider).toHaveBeenCalledTimes(2);
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

    const callProvider = vi
      .fn()
      .mockResolvedValueOnce(
        buildProviderResult(chunk1, {
          tokenCount: 500,
          costCents: 25,
          durationMs: 900,
          model: PROVIDER_MODEL,
          promptVersion: "takeoff-b-v1",
        })
      )
      .mockResolvedValueOnce(
        buildProviderResult(chunk2, {
          tokenCount: 520,
          costCents: 26,
          durationMs: 950,
          model: PROVIDER_MODEL,
          promptVersion: "takeoff-b-v1",
        })
      );

    const result = await processLevelB(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      resolveProvider: localProvider(callProvider),
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

  it("fails explicitly when the PDF is readable but no exploitable table is detected", async () => {
    const pdfBytes = await createPdfArrayBuffer(1);
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "B",
        source_file_name: "scan-image-only.pdf",
        source_file_path: DEFAULT_SOURCE_PATH_B,
        source_file_type: "application/pdf",
      },
      downloadFile: {
        bytes: pdfBytes,
        mimeType: "application/pdf",
      },
    });

    const emptyExchange: TakeoffExchange = {
      items: [],
      warnings: [],
      tables: [
        {
          page: 1,
          title: "Scan sans lignes exploitables",
          headers: ["designation", "quantite", "unite"],
          rows: [
            {
              row_index: 0,
              cells: ["-", "-", "-"],
            },
          ],
        },
      ],
      metadata: {
        level: "B",
        prompt_version: "takeoff-b-v1",
        file_type: "application/pdf",
        schema_version: "v1",
      },
      confidence: 0.52,
    };

    const callProvider = vi.fn().mockResolvedValue(
      buildProviderResult(emptyExchange, {
        model: PROVIDER_MODEL,
        promptVersion: "takeoff-b-v1",
      })
    );

    await expect(
      processLevelB(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        resolveProvider: localProvider(callProvider),
      })
    ).rejects.toMatchObject({
      code: TakeoffErrorCode.TAKEOFF_PDF_NOT_INTERPRETABLE,
      retryable: false,
    });

    expect(mock.state.job.status).toBe("failed");
    expect(mock.state.job.error_code).toBe(
      TakeoffErrorCode.TAKEOFF_PDF_NOT_INTERPRETABLE
    );
  });

});

describe("processLevelC", () => {
  beforeEach(() => {
    vi.stubEnv("MERGEONE_TAKEOFF_VECTORS", "0");
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["keeps documentary review warnings when every quantity remains unknown", "Page 1 : Conduite visible, aucune cote lisible.", true],
    ["refuses a warning-only answer without a usable model-reported page", "Conduite visible, aucune cote lisible.", false],
    ["refuses a warning-only answer with an out-of-fragment page", "Page 2 : Conduite visible, aucune cote lisible.", false],
    ["refuses a warning-only answer whose located warning observes nothing", "Page 1 :", false],
    ["keeps a located warning of a file whose name reads like an undetermined page", "Page 1 : Conduite visible, aucune cote lisible.", true, "Plan · page indéterminée (fragment 1).pdf"],
  ])("%s", async (_name, message, hasUsablePage, fileName = "plan-fictif.pdf") => {
    const bytes = await createPdfArrayBuffer(3);
    const hash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    const snapshot = confirmedPreparationFixture();
    snapshot.preparation.objective = "measure_all";
    snapshot.preparation.provenance = { kind: "dossier", rule_version: 1, converted_from_legacy: false, plan_set_id: "jeu-fictif", brief_context: { buildings: [], lots: [], zones: [] } };
    snapshot.preparation.conventions = { unit: null, unit_mode: "per_item", measurement_basis: "documentary_evidence", calibration: null, purchase: null, confirmed: false };
    snapshot.preparation.sources[0] = {
      ...snapshot.preparation.sources[0], document_id: `upload:${hash}`, source_version: hash, content_hash: hash,
      kind: "plan", pages: [2], page_count: 3, document_name: fileName,
    };
    const mock = createTakeoffProcessorSupabaseMock({ job: {
      level: "C", preparation_snapshot: snapshot, source_file_name: fileName, source_file_path: DEFAULT_SOURCE_PATH_C, source_file_type: "application/pdf",
    }, downloadFile: { bytes, mimeType: "application/pdf" } });
    const warning = { code: "QUANTITE_A_VERIFIER", severity: "warning" as const, message };
    const callProvider = vi.fn().mockResolvedValue(buildProviderResult({
      ...buildTakeoffExchange([], [warning], { level: "C", file_type: "application/pdf" }), tables: [], confidence: 0.2,
    }));
    const processing = processLevelC(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW, resolveProvider: localProvider(callProvider) });
    if (!hasUsablePage) {
      await expect(processing).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_PDF_NOT_INTERPRETABLE });
      expect(mock.state.job.status).toBe("failed");
      expect(mock.state.takeoffResults[0].warnings).toEqual([
        expect.objectContaining({ code: "PROCESSING_FAILED", severity: "error" }),
      ]);
      expect(mock.state.takeoffItems).toEqual([]);
      return;
    }
    const result = await processing;
    expect(result.status).toBe("completed");
    expect(mock.state.takeoffItems).toEqual([]);
    expect(mock.state.takeoffResults[0].warnings).toEqual([{ ...warning, message: `${fileName} · page 2 — Conduite visible, aucune cote lisible.` }]);
  });

  // TI-704 option B: with Decisions configured too, a job's vector groups are read by its creator's plan, never by
  // Decisions (a server key and its spending).
  it("reads a job's vector groups with its creator's plan, never Decisions", async () => {
    for (const [name, value] of Object.entries({ MERGEONE_TAKEOFF_VECTORS: "1", MERGEONE_TAKEOFF_DECISIONS: "1", MERGEONE_OPENAI_DECISIONS: "1",
      OPENAI_DECISIONS_API_KEY: "fictional-key", MERGEONE_CHATGPT_LOCAL: "1", CI: "", VERCEL: "" })) vi.stubEnv(name, value);
    try {
      const planSetId = "55555555-5555-4555-8555-555555555555";
      const planPath = `${TENANT_ID}/${planSetId}/f1/Plan-R-1.pdf`;
      const mock = createTakeoffProcessorSupabaseMock({
        job: { level: "C", plan_set_id: planSetId, source_file_name: "Plan R+1.pdf", source_file_path: null, source_file_type: "application/pdf" },
        planFiles: [{ id: "88888888-8888-4888-8888-888888888881", plan_set_id: planSetId, file_path: planPath, file_name: "Plan-R-1.pdf",
          file_type: "application/pdf", page_count: 1, metadata: { original_file_name: "Plan R+1.pdf" } }],
        planFileDownloads: { [planPath]: { bytes: await createPdfArrayBuffer(1), mimeType: "application/pdf" } },
      });
      const exchange = buildTakeoffExchange([{ designation: "Tube cuivre", quantity: 12, unit: "m" }]);
      const call = vi.fn().mockResolvedValue(buildProviderResult(exchange));
      vi.mocked(readTakeoffVectorPages).mockResolvedValueOnce([]);
      await processLevelC(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW, resolveProvider: localProvider(call) });
      expect(call).toHaveBeenCalled();
      expect(takeoffVectorLocalGroupsHook).toHaveBeenCalledTimes(1);
      expect(vi.mocked(readTakeoffVectorPages).mock.calls[0]?.[1]?.decisions).toMatchObject({ owner: { tenantId: TENANT_ID, userId: USER_ID },
        local: { selection: { profileId: "profile", model: PROVIDER_MODEL, reasoningEffort: null } } });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // M1b : chaque morceau d'un jeu de plans d'un seul fichier est annoncé sous le libellé d'origine ;
  // l'écho « <libellé> | chunk i/n | pages a-b » du fournisseur reste une preuve brute.
  it("names every chunk of a single-file plan set by its original label and file reference", async () => {
    const planSetId = "55555555-5555-4555-8555-555555555555";
    const planFileId = "88888888-8888-4888-8888-888888888881";
    const planPath = `${TENANT_ID}/${planSetId}/f1/Plan-R-1.pdf`;
    const mock = createTakeoffProcessorSupabaseMock({
      job: {
        level: "C",
        plan_set_id: planSetId,
        source_file_name: "Plan R+1.pdf",
        source_file_path: null,
        source_file_type: "application/pdf",
      },
      planFiles: [
        { id: planFileId, plan_set_id: planSetId, file_path: planPath, file_name: "Plan-R-1.pdf",
          file_type: "application/pdf", page_count: 24, metadata: { original_file_name: "Plan R+1.pdf" } },
      ],
      planFileDownloads: {
        [planPath]: { bytes: await createPdfArrayBuffer(24), mimeType: "application/pdf" },
      },
    });
    const chunkExchange = (index: number): TakeoffExchange => ({
      items: [
        { designation: `Réseau ${index}`, quantity: index, unit: "m", source_page: 1,
          source_file: `Plan R+1.pdf | chunk ${index}/3`, confidence: 0.9, evidence: `Chunk ${index}` },
      ],
      warnings: [],
      metadata: { level: "C", prompt_version: "takeoff-c-v1", file_type: "application/pdf", schema_version: "v1" },
      confidence: 0.9,
    });
    const callProvider = vi.fn();
    for (const index of [1, 2, 3]) {
      callProvider.mockResolvedValueOnce(
        buildProviderResult(chunkExchange(index), { model: PROVIDER_MODEL, promptVersion: "takeoff-c-v1" })
      );
    }

    const result = await processLevelC(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      resolveProvider: localProvider(callProvider),
    });

    expect(result).toMatchObject({ status: "completed", chunksCount: 3 });
    const prompts = callProvider.mock.calls.map((call) => String(call[0]?.prompt));
    expect(prompts.map((prompt) => /- source: (.*)/.exec(prompt)?.[1])).toEqual([
      expect.stringMatching(/^Plan R\+1\.pdf \| chunk 1\/3 \| pages /),
      expect.stringMatching(/^Plan R\+1\.pdf \| chunk 2\/3 \| pages /),
      expect.stringMatching(/^Plan R\+1\.pdf \| chunk 3\/3 \| pages /),
    ]);
    expect(mock.state.takeoffItems).toHaveLength(3);
    for (const [index, item] of mock.state.takeoffItems.entries()) {
      expect(item).toMatchObject({
        source_file_name: "Plan R+1.pdf",
        metadata: {
          source_document: { kind: "plan_file", plan_file_id: planFileId },
          provider_source_file: `Plan R+1.pdf | chunk ${index + 1}/3`,
        },
      });
    }
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

    const callProvider = vi
      .fn()
      .mockResolvedValueOnce(
        buildProviderResult(chunk1, {
          tokenCount: 600,
          costCents: 30,
          durationMs: 1_000,
          model: PROVIDER_MODEL,
          promptVersion: "takeoff-c-v1",
        })
      )
      .mockResolvedValueOnce(
        buildProviderResult(chunk2, {
          tokenCount: 700,
          costCents: 35,
          durationMs: 1_100,
          model: PROVIDER_MODEL,
          promptVersion: "takeoff-c-v1",
        })
      )
      .mockResolvedValueOnce(
        buildProviderResult(chunk3, {
          tokenCount: 500,
          costCents: 20,
          durationMs: 900,
          model: PROVIDER_MODEL,
          promptVersion: "takeoff-c-v1",
        })
      );

    const result = await processLevelC(JOB_ID, {
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      now: () => FIXED_NOW,
      resolveProvider: localProvider(callProvider),
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
    expect(callProvider).toHaveBeenCalledTimes(3);
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

  it("keeps a single set of chunk metrics on the failure diagnostic when the completion transaction fails", async () => {
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

    const callProvider = vi.fn().mockResolvedValue(
      buildProviderResult(validExchange, {
        tokenCount: 900,
        costCents: 40,
        durationMs: 900,
        model: PROVIDER_MODEL,
        promptVersion: "takeoff-c-v1",
      })
    );

    await expect(
      processLevelC(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        resolveProvider: localProvider(callProvider),
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
    const callProvider = vi.fn();

    await expect(
      processLevelC(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        resolveProvider: localProvider(callProvider),
      })
    ).rejects.toMatchObject({
      code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
      status: 413,
      details: expect.objectContaining({
        page_count: 6,
        max_pdf_pages: 5,
      }),
    });

    expect(callProvider).not.toHaveBeenCalled();
    expect(mock.state.job.status).toBe("failed");
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

    const callProvider = vi.fn().mockResolvedValue(
      buildProviderResult(validExchange, {
        tokenCount: 1_200,
        costCents: 40,
        durationMs: 900,
        model: PROVIDER_MODEL,
        promptVersion: "takeoff-c-v1",
      })
    );

    await expect(
      processLevelC(JOB_ID, {
        supabase: mock.supabase as never,
        tenantId: TENANT_ID,
        userId: USER_ID,
        now: () => FIXED_NOW,
        resolveProvider: localProvider(callProvider),
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

// TI-682 lot B (D11): an hypothesis is never preselected. The worker writes it excluded, with its reason; a line the
// plan shows keeps its preselection.
describe("hypothesis preselection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes every line of a takeoff asked for an estimate excluded, as an hypothesis to include", async () => {
    const bytes = toArrayBuffer("designation,quantity,unit\nTube fictif,3,u");
    const hash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    const snapshot = confirmedPreparationFixture();
    snapshot.preparation.objective = "estimate";
    snapshot.preparation.sources[0] = {
      ...snapshot.preparation.sources[0], document_id: `upload:${hash}`, source_version: hash, content_hash: hash,
      document_name: "niveau-a.csv",
    };
    const mock = createTakeoffProcessorSupabaseMock({ job: { preparation_snapshot: snapshot }, downloadFile: { bytes, mimeType: "text/csv" } });
    const callProvider = vi.fn().mockResolvedValue(buildProviderResult(buildTakeoffExchange([
      { designation: "Tube fictif R+1", quantity: 3, unit: "u", source_page: 1, confidence: 0.9, evidence: "Ligne 2" },
    ])));
    const result = await processLevelA(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW, resolveProvider: localProvider(callProvider) });
    expect(result.status).toBe("completed");
    expect(mock.state.takeoffItems).toHaveLength(1);
    expect(mock.state.takeoffItems[0]).toMatchObject({
      metadata: { quantity_nature: "estimated" }, is_excluded: true,
      exclusion_reason: TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.estimated,
    });
  });

  it("writes a quantity a plan cannot show excluded, and leaves the count beside it preselected", async () => {
    vi.stubEnv("MERGEONE_TAKEOFF_RULES", "1");
    const bytes = await createPdfArrayBuffer(1);
    const mock = createTakeoffProcessorSupabaseMock({ job: {
      level: "B", source_file_name: "plan.pdf", source_file_path: DEFAULT_SOURCE_PATH_B, source_file_type: "application/pdf",
    }, downloadFile: { bytes, mimeType: "application/pdf" } });
    const exchange = buildTakeoffExchange([
      { designation: "Soudures inox", quantity: 48, unit: "u", source_page: 1, confidence: 0.95, evidence: "Supposées" },
      { designation: "Vanne DN 20", quantity: 4, unit: "u", source_page: 1, confidence: 0.95, evidence: "Repères V1 à V4" },
    ], [], { level: "B", prompt_version: "takeoff-b-v1", file_type: "application/pdf" });
    const callProvider = vi.fn().mockResolvedValue(buildProviderResult(exchange, { model: PROVIDER_MODEL, promptVersion: "takeoff-b-v1" }));
    const result = await processLevelB(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW, resolveProvider: localProvider(callProvider) });
    expect(result.status).toBe("completed");
    const [weld, valve] = mock.state.takeoffItems;
    expect(weld).toMatchObject({ designation: "Soudures inox", metadata: { rule_inputs: { non_observable: "weld" } },
      is_excluded: true, exclusion_reason: TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.non_observable });
    expect(valve).toMatchObject({ designation: "Vanne DN 20", metadata: { rule_inputs: { non_observable: null } } });
    expect(valve).toMatchObject({ is_excluded: false, exclusion_reason: null });
    // One bulk insert: every row carries the same columns (the API refuses rows whose keys differ).
    expect(Object.keys(valve).sort()).toEqual(Object.keys(weld).sort());
  });

  it("reads no quantity as non observable when the fixed rules are off: the line stays preselected", async () => {
    vi.stubEnv("MERGEONE_TAKEOFF_RULES", "0");
    const bytes = await createPdfArrayBuffer(1);
    const mock = createTakeoffProcessorSupabaseMock({ job: {
      level: "B", source_file_name: "plan.pdf", source_file_path: DEFAULT_SOURCE_PATH_B, source_file_type: "application/pdf",
    }, downloadFile: { bytes, mimeType: "application/pdf" } });
    const exchange = buildTakeoffExchange([
      { designation: "Soudures inox", quantity: 48, unit: "u", source_page: 1, confidence: 0.95, evidence: "Supposées" },
    ], [], { level: "B", prompt_version: "takeoff-b-v1", file_type: "application/pdf" });
    const callProvider = vi.fn().mockResolvedValue(buildProviderResult(exchange, { model: PROVIDER_MODEL, promptVersion: "takeoff-b-v1" }));
    await processLevelB(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW, resolveProvider: localProvider(callProvider) });
    expect(mock.state.takeoffItems[0]).toMatchObject({ designation: "Soudures inox", is_excluded: false, exclusion_reason: null });
    expect(mock.state.takeoffItems[0].metadata.rule_inputs).toBeUndefined();
  });
});

// A worker stopped at a named point while another one runs: the deployed
// pre-activation database lets any claim and any failure write through, so the
// worker's own requests must carry what it observed and its lease.
describe("concurrent local workers", () => {
  function stop() {
    let reached!: () => void;
    let release!: () => void;
    const atStop = new Promise<void>((resolve) => { reached = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    return { atStop, release, wait: () => { reached(); return released; } };
  }
  const success = (designation: string) => vi.fn().mockResolvedValue(buildProviderResult(buildTakeoffExchange([
    { designation, quantity: 2, unit: "u", source_page: 1, confidence: 0.95, evidence: "Ligne 1" },
  ])));
  const failure = (retryable: boolean) => vi.fn().mockRejectedValue(new TakeoffError({
    code: retryable ? TakeoffErrorCode.AI_TIMEOUT : TakeoffErrorCode.AI_PROVIDER,
    message: "fixture provider failure", retryable, details: { cause: { provider: "fixture answer" } },
  }));

  it("a callback stopped between its read and its claim starts no provider call after a definitive failure", async () => {
    const mock = createTakeoffProcessorSupabaseMock();
    const late = stop();
    const lateCall = success("Appel non demandé");
    const lateProvider = localProvider(lateCall);
    const lateWorker = processLevelA(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, now: () => FIXED_NOW,
      resolveProvider: async () => { await late.wait(); return lateProvider(); } });
    void lateWorker.catch(() => undefined);
    await late.atStop;
    const firstCall = failure(false);
    await expect(processLevelA(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, now: () => FIXED_NOW,
      resolveProvider: localProvider(firstCall) })).rejects.toMatchObject({ code: TakeoffErrorCode.AI_PROVIDER });
    expect(mock.state.job).toMatchObject({ status: "failed", retry_count: 0 });
    late.release();
    await expect(lateWorker).rejects.toMatchObject({ code: TakeoffErrorCode.CONFLICT });
    expect(firstCall).toHaveBeenCalledTimes(1);
    expect(lateCall).not.toHaveBeenCalled();
    expect(mock.state.job).toMatchObject({ status: "failed", retry_count: 0, error_code: TakeoffErrorCode.AI_PROVIDER });
  });

  it("a due retry callback stopped before its processor cannot consume the next scheduled retry early", async () => {
    const mock = createTakeoffProcessorSupabaseMock({ job: { status: "failed", retry_count: 0,
      error_code: TakeoffErrorCode.AI_TIMEOUT, error_message: "fixture earlier timeout" } });
    Object.assign(mock.state.job, { next_retry_at: new Date(FIXED_NOW.getTime() - 1_000).toISOString(), last_error_at: FIXED_NOW.toISOString() });
    const repository = {
      getJobById: vi.fn(async () => normalizeTakeoffWorkerJobRow(deepClone(mock.state.job))),
      isTenantActive: vi.fn(async () => true),
      markUnsupportedLevelAsFailed: vi.fn(),
      clearRetrySchedule: vi.fn(),
      renewLease: vi.fn(async () => undefined),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const attempt = (call: ReturnType<typeof vi.fn>, before?: () => Promise<void>) => processTakeoffJobAttempt(JOB_ID, {
      trigger: "retry", correlationId: JOB_ID, now: () => FIXED_NOW, repository, logger,
      processLevelAFn: async (id, options) => {
        await before?.();
        return processLevelA(id, { ...options, resolveProvider: localProvider(call) });
      },
    });
    const late = stop();
    const lateCall = success("Reprise anticipée");
    const lateWorker = attempt(lateCall, late.wait);
    await late.atStop;
    const dueCall = failure(true);
    expect(await attempt(dueCall)).toMatchObject({ status: "failed_retryable", retry_count: 1 });
    const scheduled = deepClone(mock.state.job) as TakeoffJobRow & { next_retry_at: string };
    expect(Date.parse(scheduled.next_retry_at)).toBeGreaterThan(FIXED_NOW.getTime());
    late.release();
    expect(await lateWorker).toMatchObject({ status: "failed_retryable", should_requeue: true, next_run_at: scheduled.next_retry_at });
    expect(dueCall).toHaveBeenCalledTimes(1);
    expect(lateCall).not.toHaveBeenCalled();
    expect(mock.state.job).toMatchObject({ status: "failed", retry_count: 1, next_retry_at: scheduled.next_retry_at });
  });

  it("a worker stopped after its failure renewal cannot erase the lines of a later successful analysis", async () => {
    const mock = createTakeoffProcessorSupabaseMock();
    const paused = stop();
    let failed = false;
    let renewalsAfterFailure = 0;
    const firstCall = vi.fn(async () => {
      failed = true;
      throw new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, message: "fixture provider failure", retryable: false,
        details: { cause: { provider: "fixture answer" } } });
    });
    const stale = processLevelA(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, now: () => FIXED_NOW,
      resolveProvider: localProvider(firstCall),
      // The provider wrapper renews once more as the call ends; the failure path then renews before it writes.
      renewLease: async () => { if (failed && ++renewalsAfterFailure === 2) await paused.wait(); },
    });
    void stale.catch(() => undefined);
    await paused.atStop;
    // The recovery closes the expired worker, then the ordinary relaunch of the previous application succeeds.
    mock.state.job = { ...mock.state.job, status: "failed", error_code: "TAKEOFF_WORKER_OUTCOME_UNKNOWN",
      processing_lease_token: null, processing_lease_expires_at: null, completed_at: FIXED_NOW.toISOString() };
    mock.state.job = { ...mock.state.job, status: "pending", retry_count: mock.state.job.retry_count + 1,
      error_code: null, error_message: null, completed_at: null };
    const laterCall = success("Ligne de la relance");
    expect(await processLevelA(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, now: () => FIXED_NOW,
      resolveProvider: localProvider(laterCall) })).toMatchObject({ status: "completed" });
    const completed = deepClone({ job: mock.state.job, results: mock.state.takeoffResults, items: mock.state.takeoffItems });
    paused.release();
    await expect(stale).rejects.toMatchObject({ code: TakeoffErrorCode.CONFLICT });
    expect(mock.state.job).toEqual(completed.job);
    expect(mock.state.takeoffResults).toEqual(completed.results);
    expect(mock.state.takeoffItems).toEqual(completed.items);
    expect(mock.state.takeoffItems.map(({ designation }) => designation)).toEqual(["Ligne de la relance"]);
  });
});

// Migration A: an attempt that holds a paid call of unknown outcome is not retried on its own; the audit tells the end the
// database recorded, never the retry the worker asked.
describe("a failure after a paid call of unknown outcome", () => {
  it("audits the end the database recorded, not the retry the worker asked", async () => {
    const mock = createTakeoffProcessorSupabaseMock({ heldUnknownCall: true });
    const call = vi.fn().mockRejectedValue(new TakeoffError({ code: TakeoffErrorCode.AI_TIMEOUT, message: "fixture timeout", retryable: true }));
    await expect(processLevelA(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW,
      resolveProvider: localProvider(call) })).rejects.toMatchObject({ code: TakeoffErrorCode.AI_TIMEOUT });
    expect(mock.state.job).toMatchObject({ status: "failed", next_retry_at: null, error_code: "TAKEOFF_USAGE_UNRECORDED" });
    expect(getAuditMetadata(mock.state.auditLogs, "takeoff.job.failed")).toMatchObject({
      error_code: "TAKEOFF_USAGE_UNRECORDED", error_message: "Consommation inconnue (fixture).", retryable: false });
  });

  it("audits the worker's own failure when the database kept its retry", async () => {
    const mock = createTakeoffProcessorSupabaseMock();
    const call = vi.fn().mockRejectedValue(new TakeoffError({ code: TakeoffErrorCode.AI_TIMEOUT, message: "fixture timeout", retryable: true }));
    await expect(processLevelA(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW,
      resolveProvider: localProvider(call) })).rejects.toMatchObject({ code: TakeoffErrorCode.AI_TIMEOUT });
    expect(getAuditMetadata(mock.state.auditLogs, "takeoff.job.failed")).toMatchObject({
      error_code: TakeoffErrorCode.AI_TIMEOUT, retryable: true });
  });
});

// Lot 3: a plan of one analysis per plan is read only under the Mac's slot (migration 20261121231238).
describe("an attempt of a plan of one analysis per plan", () => {
  const REQUEST = "77777777-7777-4777-8777-777777777777";
  const planUnit = { launch_request_id: REQUEST, preparation_snapshot: { launch_unit: { request_id: REQUEST,
    key: "plan:88888888-8888-4888-8888-888888888888", ordinal: 1, vector_pages: 0 } } } as unknown as Partial<TakeoffJobRow>;
  const claimedLease = (mock: ReturnType<typeof createTakeoffProcessorSupabaseMock>) => (vi.mocked(mock.supabase.rpc).mock.calls
    .find(([fn]) => fn === "claim_observed_local_takeoff_job")?.[1] as { p_lease_token?: string } | undefined)?.p_lease_token;

  it("gives the Mac back when it ends, whatever ended the job, with the lease it claimed", async () => {
    const mock = createTakeoffProcessorSupabaseMock();
    const call = vi.fn().mockRejectedValue(new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, message: "fixture failure", retryable: false }));
    await expect(processLevelA(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW,
      resolveProvider: localProvider(call) })).rejects.toMatchObject({ code: TakeoffErrorCode.AI_PROVIDER });
    expect(mock.state.releasedSlots).toEqual([{ p_host_id: expect.stringMatching(/^urn:uuid:/), p_lease_token: claimedLease(mock) }]);
  });

  it("ends at once, recorded under its lease, when its source changed after its admission", async () => {
    const mock = createTakeoffProcessorSupabaseMock({ job: planUnit });
    const changed = async (): Promise<LocalTakeoffProvider> => {
      throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
        message: "Le contenu du plan « Plan RDC » ne correspond plus au fichier confirmé.", details: { reason: "PREPARATION_SOURCE_CHANGED" } });
    };
    await expect(processLevelA(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW,
      resolveProvider: changed })).rejects.toMatchObject({ code: "TAKEOFF_PREPARATION_SOURCE_CHANGED", retryable: false });
    expect(mock.state.job).toMatchObject({ status: "failed", error_code: "TAKEOFF_PREPARATION_SOURCE_CHANGED", next_retry_at: null,
      analysis_outcome: "failure" });
    expect(mock.state.releasedSlots).toHaveLength(1);
  });

  it("leaves the source change of a grouped analysis as lot 2 handles it", async () => {
    const mock = createTakeoffProcessorSupabaseMock();
    const changed = async (): Promise<LocalTakeoffProvider> => {
      throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false, message: "Source changée (fixture).",
        details: { reason: "PREPARATION_SOURCE_CHANGED" } });
    };
    await expect(processLevelA(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW,
      resolveProvider: changed })).rejects.toMatchObject({ code: TakeoffErrorCode.CONFLICT });
    expect(mock.state.job).toMatchObject({ status: "processing" });
  });
});

// Lot 4: a job whose request sealed the affaire's list of items reads its plan against that list; the free extraction
// reads as before (src/lib/takeoff/poste-reading-job-server.ts holds the reading itself).
describe("an attempt of the second measuring order", () => {
  const REQUEST = "77777777-7777-4777-8777-777777777777";
  const ORDER = { requestId: REQUEST, revisionId: "99999999-9999-4999-8999-999999999999", revision: 3, itemCount: 4,
    contentSha256: "e".repeat(64) };
  // Its unit (one plan) is checked by the reading itself, which these tests replace.
  const planUnit = { launch_request_id: REQUEST } as unknown as Partial<TakeoffJobRow>;
  beforeEach(() => vi.stubEnv("MERGEONE_TAKEOFF_VECTORS", "0"));
  afterEach(() => vi.unstubAllEnvs());

  async function levelCJob(job: Partial<TakeoffJobRow>) {
    return createTakeoffProcessorSupabaseMock({ job: { level: "C", source_file_name: "plan-fictif.pdf", source_file_path: DEFAULT_SOURCE_PATH_C,
      source_file_type: "application/pdf", ...job }, downloadFile: { bytes: await createPdfArrayBuffer(2), mimeType: "application/pdf" } });
  }

  it("hands the claimed job, its provider and its vector reading to the reading against the list, never the first format's", async () => {
    const mock = await levelCJob(planUnit);
    vi.mocked(readTakeoffItemListOrder).mockResolvedValueOnce(ORDER);
    vi.mocked(processItemListLevelC).mockResolvedValueOnce({ jobId: JOB_ID, resultId: "result-v2", status: "completed", itemsCount: 2,
      warningsCount: 0, tokenCount: 10, costCents: 0, durationMs: 5, tablesCount: 0, chunksCount: 1, pageCount: 2,
      metricsSummary: { inputTokens: 10, reasoningTokens: 0, outputTokens: 0, totalTokens: 10 } });
    const call = vi.fn();
    const result = await processLevelC(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW,
      resolveProvider: localProvider(call) });

    expect(result).toMatchObject({ resultId: "result-v2", status: "completed", itemsCount: 2, chunksCount: 1 });
    // The order is read before the claim: the claim records the prompt the job reads with.
    expect(mock.state.job.prompt_version).toBe("takeoff-c-postes-v1");
    const handed = vi.mocked(processItemListLevelC).mock.calls[0][0];
    expect(handed).toMatchObject({ order: ORDER, model: PROVIDER_MODEL, userId: USER_ID,
      job: expect.objectContaining({ id: JOB_ID, status: "processing", processing_lease_token: expect.any(String) }),
      sourceFile: expect.objectContaining({ mimeType: "application/pdf" }) });
    // Its calls go through the processor's provider wrapper (the tenant checked, the lease renewed), never the first format's.
    expect(call).not.toHaveBeenCalled();
    expect(mock.state.takeoffResults).toEqual([]);
    await expect(handed.readVectors()).resolves.toEqual([]);
  });

  it("records a refused reading against the list as the first format records a failure, with its calls' metrics", async () => {
    const mock = await levelCJob(planUnit);
    vi.mocked(readTakeoffItemListOrder).mockResolvedValueOnce(ORDER);
    const refused = Object.assign(new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA, retryable: false,
      message: "Lecture du plan contre la liste des postes refusée (fixture).", details: { reason: "MISSING_ANSWER" } }),
    { levelCChunkMetrics: [{ provider: "chatgpt", index: 0, start: 1, end: 2, input_tokens: 5, reasoning_tokens: 0, output_tokens: 0,
      token_count: 5, cost_cents: 0, duration_ms: 1, model: PROVIDER_MODEL, timed_out: false, budget_exceeded: false, status: "failed" }] });
    vi.mocked(processItemListLevelC).mockRejectedValueOnce(refused);
    await expect(processLevelC(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW,
      resolveProvider: localProvider(vi.fn()) })).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA });
    expect(mock.state.job).toMatchObject({ status: "failed", error_code: "TAKEOFF_LEVEL_C_INVALID_SCHEMA" });
    expect(mock.state.takeoffRunMetrics).toEqual([expect.objectContaining({ chunk_index: 0, total_tokens: 5 })]);
  });

  it("ends a job whose measuring order cannot be read once it is claimed, with that prompt unknown to it", async () => {
    const mock = await levelCJob(planUnit);
    vi.mocked(readTakeoffItemListOrder).mockRejectedValueOnce(new TakeoffError({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false,
      message: "La commande de mesure de cette analyse est invalide (fixture)." }));
    const call = vi.fn();
    await expect(processLevelC(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW,
      resolveProvider: localProvider(call) })).rejects.toMatchObject({ code: TakeoffErrorCode.INTERNAL_ERROR });
    expect(mock.state.job).toMatchObject({ status: "failed", error_code: "INTERNAL_ERROR", prompt_version: "takeoff-c-v1" });
    expect(call).not.toHaveBeenCalled();
    expect(processItemListLevelC).not.toHaveBeenCalled();
  });

  it("reads a job of the free extraction as before", async () => {
    const mock = await levelCJob({});
    const call = vi.fn().mockResolvedValue(buildProviderResult(buildTakeoffExchange([{ designation: "Tube cuivre", quantity: 12, unit: "m" }])));
    await expect(processLevelC(JOB_ID, { supabase: mock.supabase as never, tenantId: TENANT_ID, userId: USER_ID, now: () => FIXED_NOW,
      resolveProvider: localProvider(call) })).resolves.toMatchObject({ status: "completed" });
    expect(readTakeoffItemListOrder).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readTakeoffItemListOrder).mock.calls[0][1].launch_request_id ?? null).toBeNull();
    expect(processItemListLevelC).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalled();
    expect(mock.state.job.prompt_version).toBe("takeoff-c-v1");
  });
});
