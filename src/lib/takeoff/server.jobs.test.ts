import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

// The resume check is reduced to its refusal of a former provider's job; chatgpt-takeoff.test.ts covers the real one.
vi.mock("@/lib/ai/chatgpt-takeoff", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/chatgpt-takeoff")>(), assertLocalTakeoffResumeReady: vi.fn(),
}));

// The request runs on the local Mac that launched the jobs (the resume policy compares the two); CI disables the real one.
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ host: "127.0.0.1:3000" })) }));
vi.mock("@/lib/ai/chatgpt-local-auth", () => ({
  isLocalChatGptEnabled: vi.fn(() => true), assertLocalChatGptHost: vi.fn(),
  hasLocalChatGptPlanAccess: vi.fn((profile: { accessToken?: string }) => Boolean(profile.accessToken)),
}));
// The signed-in member's ChatGPT connection on this Mac: connected, with a model, unless a test says otherwise.
vi.mock("@/lib/ai/chatgpt-local-store", () => ({
  getChatGptHostId: vi.fn(async () => "urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
  readChatGptStore: vi.fn(async () => ({ selectedId: "profile-1", profiles: [{ id: "profile-1", accessToken: "fixture", model: "fixture-model" }] })),
}));

import { assertLocalTakeoffResumeReady } from "@/lib/ai/chatgpt-takeoff";
import { readChatGptStore } from "@/lib/ai/chatgpt-local-store";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { assertTakeoffJobUsesLocalProvider, TakeoffError } from "@/lib/takeoff/errors";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  cancelTakeoffJob,
  getTakeoffJobDetails,
  listTakeoffJobs,
  resubmitTakeoffJob,
} from "@/lib/takeoff/server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT_ID = "99999999-9999-4999-8999-999999999999";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VERSION_ID = "44444444-4444-4444-8444-444444444444";
const JOB_ID = "55555555-5555-4555-8555-555555555555";
const JOB_ID_2 = "66666666-6666-4666-8666-666666666666";
const PROJECT_ID = "88888888-8888-4888-8888-888888888888";
const THIS_MAC = "urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ESTIMATE_VERSIONS_ROW_CAP = 1000;

type TakeoffJobStoredRow = {
  id: string;
  project_id: string;
  execution_host_id: string | null;
  analysis_outcome: string | null;
  next_retry_at: string | null;
  estimate_version_id: string;
  tenant_id: string;
  status: string;
  level: string;
  processing_strategy?: string | null;
  provider_batch_id?: string | null;
  provider_batch_state?: string | null;
  provider_batch_updated_at?: string | null;
  provider_reconcile_due_at?: string | null;
  provider_reconcile_attempt_count?: number | null;
  provider_reconcile_lease_token?: string | null;
  provider_reconcile_lease_expires_at?: string | null;
  source_file_name: string | null;
  source_file_type: string | null;
  source_file_size_bytes: number | null;
  source_file_path: string | null;
  plan_set_id?: string | null;
  prompt_version: string | null;
  schema_version: string | null;
  model: string | null;
  thinking_level: string | null;
  execution_provider: "gemini" | "chatgpt_local";
  media_resolution: string | null;
  retry_count: number;
  token_count: number | null;
  cost_cents: number | null;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type TakeoffResultStoredRow = {
  id: string;
  tenant_id: string;
  job_id: string;
  extracted_json: unknown;
  warnings: unknown[];
  tables: unknown[];
  provider_meta: Record<string, unknown>;
  raw_response: unknown;
  confidence: number | null;
  token_count: number | null;
  cost_cents: number | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
};

type TakeoffItemStoredRow = {
  id: string;
  tenant_id: string;
  job_id: string;
  designation: string;
  quantity: number;
  unit: string;
  confidence: number | null;
  evidence: string | null;
  source_file_name: string | null;
  source_page: number | null;
  metadata: Record<string, unknown>;
  is_excluded: boolean;
  exclusion_reason: string | null;
  is_verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
};

type SupabaseMockOptions = {
  jobs?: TakeoffJobStoredRow[];
  /** The affaires of the tenant; by default the jobs' affaire, owned by the signed-in member. */
  projects?: Array<{ id: string; user_id: string; is_archived: boolean; tenant_id?: string }>;
  /** Another writer, after the command read the job and before it writes. */
  afterJobRead?: (row: TakeoffJobStoredRow) => Partial<TakeoffJobStoredRow> | void;
  /** Another writer, just before the conditional update is evaluated. */
  beforeJobUpdate?: (row: TakeoffJobStoredRow) => Partial<TakeoffJobStoredRow> | void;
  results?: TakeoffResultStoredRow[];
  items?: TakeoffItemStoredRow[];
  versions?: Array<{ id: string; version_number: number; project_id: string }>;
  auditInsertError?: {
    code: string;
    message: string;
    details?: string | null;
    hint?: string | null;
  } | null;
};

function baseJob(
  input: Partial<TakeoffJobStoredRow> = {}
): TakeoffJobStoredRow {
  const id = input.id ?? JOB_ID;
  const tenantId = input.tenant_id ?? TENANT_ID;

  return {
    id,
    project_id: input.project_id ?? PROJECT_ID,
    execution_host_id: input.execution_host_id === undefined ? THIS_MAC : input.execution_host_id,
    analysis_outcome: input.analysis_outcome ?? null,
    next_retry_at: input.next_retry_at ?? null,
    estimate_version_id: input.estimate_version_id ?? VERSION_ID,
    tenant_id: tenantId,
    status: input.status ?? "failed",
    level: input.level ?? "A",
    processing_strategy: input.processing_strategy ?? "sync",
    provider_batch_id: input.provider_batch_id ?? null,
    provider_batch_state: input.provider_batch_state ?? null,
    provider_batch_updated_at: input.provider_batch_updated_at ?? null,
    provider_reconcile_due_at: input.provider_reconcile_due_at ?? null,
    provider_reconcile_attempt_count:
      input.provider_reconcile_attempt_count ?? 0,
    provider_reconcile_lease_token: input.provider_reconcile_lease_token ?? null,
    provider_reconcile_lease_expires_at:
      input.provider_reconcile_lease_expires_at ?? null,
    source_file_name: input.source_file_name ?? "niveau-a.csv",
    source_file_type: input.source_file_type ?? "text/csv",
    source_file_size_bytes: input.source_file_size_bytes ?? 1024,
    source_file_path:
      input.source_file_path ??
      `${tenantId}/${id}/${"a".repeat(64)}-niveau-a.csv`,
    plan_set_id: input.plan_set_id ?? null,
    prompt_version: input.prompt_version ?? "takeoff-a-v1",
    schema_version: input.schema_version ?? "v1",
    model: input.model ?? "account-model",
    thinking_level: input.thinking_level ?? null,
    media_resolution: input.media_resolution ?? null,
    retry_count: input.retry_count ?? 0,
    token_count: input.token_count ?? 400,
    cost_cents: input.cost_cents ?? 12,
    duration_ms: input.duration_ms ?? 700,
    started_at: input.started_at ?? null,
    completed_at: input.completed_at ?? "2026-02-25T10:00:00.000Z",
    error_code: input.error_code ?? "AI_TIMEOUT",
    error_message: input.error_message ?? "Timed out",
    execution_provider: input.execution_provider ?? "chatgpt_local",
    created_by: input.created_by ?? USER_ID,
    created_at: input.created_at ?? "2026-02-25T09:55:00.000Z",
    updated_at: input.updated_at ?? "2026-02-25T10:00:00.000Z",
  };
}

function baseResult(
  input: Partial<TakeoffResultStoredRow> = {}
): TakeoffResultStoredRow {
  return {
    id: input.id ?? "77777777-7777-4777-8777-777777777777",
    tenant_id: input.tenant_id ?? TENANT_ID,
    job_id: input.job_id ?? JOB_ID,
    extracted_json: input.extracted_json ?? { items: [] },
    warnings: input.warnings ?? [],
    tables: input.tables ?? [],
    provider_meta: input.provider_meta ?? {},
    raw_response: input.raw_response ?? { provider: "gemini" },
    confidence: input.confidence ?? 0.91,
    token_count: input.token_count ?? 450,
    cost_cents: input.cost_cents ?? 13,
    duration_ms: input.duration_ms ?? 800,
    created_at: input.created_at ?? "2026-02-25T10:02:00.000Z",
    updated_at: input.updated_at ?? "2026-02-25T10:02:00.000Z",
  };
}

function baseItem(
  input: Partial<TakeoffItemStoredRow> = {}
): TakeoffItemStoredRow {
  return {
    id: input.id ?? "88888888-8888-4888-8888-888888888888",
    tenant_id: input.tenant_id ?? TENANT_ID,
    job_id: input.job_id ?? JOB_ID,
    designation: input.designation ?? "Tube cuivre",
    quantity: input.quantity ?? 4,
    unit: input.unit ?? "ml",
    confidence: input.confidence ?? 0.8,
    evidence: input.evidence ?? "Ligne 42",
    source_file_name: input.source_file_name ?? "niveau-a.csv",
    source_page: input.source_page ?? 1,
    metadata: input.metadata ?? {},
    is_excluded: input.is_excluded ?? false,
    exclusion_reason: input.exclusion_reason ?? null,
    is_verified: input.is_verified ?? false,
    verified_at: input.verified_at ?? null,
    verified_by: input.verified_by ?? null,
    created_at: input.created_at ?? "2026-02-25T10:02:10.000Z",
    updated_at: input.updated_at ?? "2026-02-25T10:02:10.000Z",
  };
}

function createSupabaseMock(options: SupabaseMockOptions = {}) {
  const jobs = options.jobs ?? [baseJob()];
  const results = options.results ?? [baseResult()];
  const items =
    options.items ??
    [
      baseItem({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        created_at: "2026-02-25T10:03:00.000Z",
      }),
      baseItem({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        designation: "Cable U1000",
        created_at: "2026-02-25T10:03:30.000Z",
      }),
    ];
  const versionsData = options.versions ?? [
    { id: VERSION_ID, version_number: 1, project_id: PROJECT_ID },
    { id: OTHER_VERSION_ID, version_number: 2, project_id: PROJECT_ID },
  ];
  const auditInsertError = options.auditInsertError ?? null;
  const projects = options.projects ?? [{ id: PROJECT_ID, user_id: USER_ID, is_archived: false }];

  const state = {
    jobsById: new Map(jobs.map((job) => [job.id, { ...job }])),
    resultsByJobId: new Map(
      results.map((result) => [result.job_id, { ...result }])
    ),
    itemsByJobId: new Map<string, TakeoffItemStoredRow[]>(
      Array.from(
        items.reduce((acc, item) => {
          const list = acc.get(item.job_id) ?? [];
          list.push({ ...item });
          acc.set(item.job_id, list);
          return acc;
        }, new Map<string, TakeoffItemStoredRow[]>())
      )
    ),
    auditLogs: [] as Array<Record<string, unknown>>,
    jobUpdates: 0,
    projectReads: 0,
    /** Reads of takeoff_items: « head » per-job counts, « rows » line rows. */
    itemSelects: [] as Array<"head" | "rows">,
    groupedCountReads: 0,
  };

  function applyRange<T>(rows: T[], start: number, end: number) {
    return rows.slice(start, end + 1);
  }

  function createTakeoffJobsSelectBuilder() {
    const filters: {
      id?: string;
      tenant_id?: string;
      estimate_version_id?: string;
      estimate_version_id_in?: string[];
      status?: string;
      level?: string;
      created_at_gte?: string;
    } = {};
    let range: { start: number; end: number } | null = null;

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (
          column === "id" ||
          column === "tenant_id" ||
          column === "estimate_version_id" ||
          column === "status" ||
          column === "level"
        ) {
          filters[column] = value;
        }
        return builder;
      }),
      in: vi.fn((column: string, values: string[]) => {
        if (column === "estimate_version_id") {
          filters.estimate_version_id_in = values;
        }
        return builder;
      }),
      gte: vi.fn((column: string, value: string) => {
        if (column === "created_at") {
          filters.created_at_gte = value;
        }
        return builder;
      }),
      order: vi.fn(() => builder),
      range: vi.fn((start: number, end: number) => {
        range = { start, end };
        return builder;
      }),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        const rows = [...state.jobsById.values()].filter((row) => {
          if (filters.id && row.id !== filters.id) return false;
          if (filters.tenant_id && row.tenant_id !== filters.tenant_id) return false;
          if (
            filters.estimate_version_id &&
            row.estimate_version_id !== filters.estimate_version_id
          ) {
            return false;
          }
          if (
            filters.estimate_version_id_in &&
            !filters.estimate_version_id_in.includes(row.estimate_version_id)
          ) {
            return false;
          }
          if (filters.status && row.status !== filters.status) return false;
          if (filters.level && row.level !== filters.level) return false;
          if (
            filters.created_at_gte &&
            row.created_at.localeCompare(filters.created_at_gte) < 0
          ) {
            return false;
          }
          return true;
        });

        const read = rows[0] ? { ...rows[0] } : null;
        const concurrent = read ? options.afterJobRead?.(read) : undefined;
        if (read && concurrent) state.jobsById.set(read.id, { ...read, ...concurrent });
        return { data: read, error: null };
      }),
      then: (
        onFulfilled?: (
          value: {
            data: TakeoffJobStoredRow[];
            count: number;
            error: null;
          }
        ) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => {
        const filtered = [...state.jobsById.values()]
          .filter((row) => {
            if (filters.id && row.id !== filters.id) return false;
            if (filters.tenant_id && row.tenant_id !== filters.tenant_id) return false;
            if (
              filters.estimate_version_id &&
              row.estimate_version_id !== filters.estimate_version_id
            ) {
              return false;
            }
            if (
              filters.estimate_version_id_in &&
              !filters.estimate_version_id_in.includes(row.estimate_version_id)
            ) {
              return false;
            }
            if (filters.status && row.status !== filters.status) return false;
            if (filters.level && row.level !== filters.level) return false;
            if (
              filters.created_at_gte &&
              row.created_at.localeCompare(filters.created_at_gte) < 0
            ) {
              return false;
            }
            return true;
          })
          .sort((a, b) => b.created_at.localeCompare(a.created_at));

        const data = range
          ? applyRange(filtered, range.start, range.end)
          : filtered;

        return Promise.resolve({
          data,
          count: filtered.length,
          error: null,
        }).then(onFulfilled, onRejected);
      },
    };

    return builder;
  }

  /** takeoff_jobs with the legacy count embed of their lines: one statement for a page of jobs. */
  function createGroupedCountBuilder() {
    const filters = new Map<string, unknown>();
    let ids: string[] | null = null;
    const builder = {
      eq: vi.fn((column: string, value: unknown) => { filters.set(column, value); return builder; }),
      in: vi.fn((column: string, values: string[]) => { if (column === "id") ids = values; return builder; }),
      then: (onFulfilled?: (value: { data: unknown[]; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) => {
        state.groupedCountReads += 1;
        const data = [...state.jobsById.values()]
          .filter((row) => (!ids || ids.includes(row.id)) && (!filters.has("tenant_id") || row.tenant_id === filters.get("tenant_id")))
          .map((row) => ({ id: row.id, items: [{ count: state.itemsByJobId.get(row.id)?.length ?? 0 }] }));
        return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  function createTakeoffJobsUpdateBuilder(payload: Partial<TakeoffJobStoredRow>) {
    const filters: { id?: string; tenant_id?: string; status?: string } = {};
    const equal = new Map<string, unknown>();
    let statuses: string[] | null = null;
    state.jobUpdates += 1;

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (column === "id" || column === "tenant_id" || column === "status") {
          filters[column] = value;
        } else {
          equal.set(column, value);
        }
        return builder;
      }),
      is: vi.fn((column: string, value: null) => {
        equal.set(column, value);
        return builder;
      }),
      in: vi.fn((column: string, values: string[]) => {
        if (column === "status") {
          statuses = values;
        }
        return builder;
      }),
      select: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        for (const row of state.jobsById.values()) {
          const concurrent = options.beforeJobUpdate?.(row);
          if (concurrent) state.jobsById.set(row.id, { ...row, ...concurrent });
        }
        const candidate = [...state.jobsById.values()].find((row) => {
          if (filters.id && row.id !== filters.id) return false;
          if (filters.tenant_id && row.tenant_id !== filters.tenant_id) return false;
          if (filters.status && row.status !== filters.status) return false;
          if (statuses && !statuses.includes(row.status)) return false;
          for (const [column, value] of equal) {
            if ((row as Record<string, unknown>)[column] !== value) return false;
          }
          return true;
        });

        if (!candidate) {
          return { data: null, error: null };
        }

        const updated: TakeoffJobStoredRow = {
          ...candidate,
          ...payload,
          updated_at: "2026-02-25T11:00:00.000Z",
        };
        state.jobsById.set(updated.id, updated);
        return { data: updated, error: null };
      }),
    };

    return builder;
  }

  function createTakeoffResultsSelectBuilder() {
    const filters: { tenant_id?: string; job_id?: string } = {};

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (column === "tenant_id" || column === "job_id") {
          filters[column] = value;
        }
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        const row = filters.job_id
          ? state.resultsByJobId.get(filters.job_id) ?? null
          : null;

        if (!row) {
          return { data: null, error: null };
        }

        if (filters.tenant_id && row.tenant_id !== filters.tenant_id) {
          return { data: null, error: null };
        }

        return { data: row, error: null };
      }),
    };

    return builder;
  }

  function createTakeoffItemsSelectBuilder() {
    const filters: { tenant_id?: string; job_id?: string } = {};
    let range: { start: number; end: number } | null = null;

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (column === "tenant_id" || column === "job_id") {
          filters[column] = value;
        }
        return builder;
      }),
      order: vi.fn(() => builder),
      range: vi.fn((start: number, end: number) => {
        range = { start, end };
        return builder;
      }),
      then: (
        onFulfilled?: (
          value: {
            data: TakeoffItemStoredRow[];
            count: number;
            error: null;
          }
        ) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => {
        const jobItems = filters.job_id
          ? state.itemsByJobId.get(filters.job_id) ?? []
          : [];
        const filtered = jobItems
          .filter((item) => !filters.tenant_id || item.tenant_id === filters.tenant_id)
          .sort((a, b) => a.created_at.localeCompare(b.created_at));

        const data = range
          ? applyRange(filtered, range.start, range.end)
          : filtered;

        return Promise.resolve({
          data,
          count: filtered.length,
          error: null,
        }).then(onFulfilled, onRejected);
      },
    };

    return builder;
  }

  const supabase = {
    __state: state,
    from: vi.fn((table: string) => {
      if (table === "takeoff_jobs") {
        return {
          select: vi.fn((columns?: string) => columns?.includes("(count)") ? createGroupedCountBuilder() : createTakeoffJobsSelectBuilder()),
          update: vi.fn((payload: Partial<TakeoffJobStoredRow>) =>
            createTakeoffJobsUpdateBuilder(payload)
          ),
        };
      }

      if (table === "takeoff_results") {
        return {
          select: vi.fn(() => createTakeoffResultsSelectBuilder()),
        };
      }

      if (table === "takeoff_items") {
        return {
          select: vi.fn((_columns?: string, options?: { head?: boolean }) => {
            state.itemSelects.push(options?.head ? "head" : "rows");
            return createTakeoffItemsSelectBuilder();
          }),
        };
      }

      if (table === "audit_logs") {
        return {
          insert: vi.fn(async (payload: Record<string, unknown>) => {
            if (auditInsertError) {
              return { data: null, error: auditInsertError };
            }

            state.auditLogs.push(payload);
            return { data: null, error: null };
          }),
        };
      }

      if (table === "estimate_projects") {
        const projectFilters = new Map<string, unknown>();
        let projectIds: unknown[] | null = null;
        const projectBuilder = {
          select: vi.fn(() => projectBuilder),
          eq: vi.fn((column: string, value: unknown) => { projectFilters.set(column, value); return projectBuilder; }),
          in: vi.fn((column: string, values: unknown[]) => { if (column === "id") projectIds = values; return projectBuilder; }),
          then: (onFulfilled?: (value: { data: typeof projects; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) => {
            state.projectReads += 1;
            const data = projects.filter((project) => (!projectIds || projectIds.includes(project.id))
              && (!projectFilters.has("tenant_id") || (project.tenant_id ?? TENANT_ID) === projectFilters.get("tenant_id")));
            return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
          },
        };
        return projectBuilder;
      }

      if (table === "estimate_versions") {
        const evFilters: { id?: string; project_id?: string; tenant_id?: string } = {};
        let evRange: { start: number; end: number } | null = null;
        const evBuilder = {
          select: vi.fn(() => evBuilder),
          eq: vi.fn((column: string, value: string) => {
            if (column === "id" || column === "project_id" || column === "tenant_id") {
              evFilters[column] = value;
            }
            return evBuilder;
          }),
          order: vi.fn(() => evBuilder),
          range: vi.fn((start: number, end: number) => {
            evRange = { start, end };
            return evBuilder;
          }),
          maybeSingle: vi.fn(async () => {
            const match = versionsData.find((v) => {
              if (evFilters.id && v.id !== evFilters.id) return false;
              if (evFilters.project_id && v.project_id !== evFilters.project_id) return false;
              return true;
            });
            return { data: match ? { id: match.id, version_number: match.version_number } : null, error: null };
          }),
          then: (
            onFulfilled?: (value: { data: Array<{ id: string; version_number: number }>; error: null }) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => {
            const filtered = versionsData.filter((v) => {
              if (evFilters.project_id && v.project_id !== evFilters.project_id) return false;
              if (evFilters.tenant_id) return true;
              return true;
            });

            const sorted = filtered.sort((left, right) => {
              if (left.version_number !== right.version_number) {
                return left.version_number - right.version_number;
              }

              return left.id.localeCompare(right.id);
            });
            const ranged = evRange
              ? applyRange(sorted, evRange.start, evRange.end)
              : sorted;
            const capped = ranged.slice(0, ESTIMATE_VERSIONS_ROW_CAP);

            return Promise.resolve({
              data: capped.map((v) => ({ id: v.id, version_number: v.version_number })),
              error: null,
            }).then(onFulfilled, onRejected);
          },
        };
        return evBuilder;
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  vi.mocked(createServiceRoleClient).mockReturnValue(supabase as never);
  return supabase;
}

describe("takeoff job server helpers (TKF-009)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
    vi.mocked(assertLocalTakeoffResumeReady).mockImplementation(async (_supabase, _tenantId, job) => {
      assertTakeoffJobUsesLocalProvider(job);
    });
  });

  it("filters jobs by status level and period while keeping status counters scoped by base filters", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-25T12:00:00.000Z"));

    const supabase = createSupabaseMock({
      jobs: [
        baseJob({
          id: JOB_ID,
          status: "failed",
          level: "A",
          created_at: "2026-02-24T10:00:00.000Z",
        }),
        baseJob({
          id: JOB_ID_2,
          status: "processing",
          level: "A",
          error_code: null,
          error_message: null,
          completed_at: null,
          created_at: "2026-02-22T10:00:00.000Z",
        }),
        baseJob({
          id: "77777777-7777-4777-8777-777777777771",
          status: "completed",
          level: "B",
          error_code: null,
          error_message: null,
          created_at: "2026-02-21T10:00:00.000Z",
        }),
        baseJob({
          id: "77777777-7777-4777-8777-777777777772",
          status: "canceled",
          level: "A",
          error_code: "USER_CANCELED",
          created_at: "2026-01-01T10:00:00.000Z",
        }),
      ],
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    const response = await listTakeoffJobs({
      status: "failed",
      level: "A",
      period: "30d",
      limit: 20,
      offset: 0,
    });

    expect(response.jobs).toHaveLength(1);
    expect(response.jobs[0]?.id).toBe(JOB_ID);
    expect(response.counters).toEqual({
      total: 2,
      processing: 1,
      completed: 0,
      failed: 1,
      canceled: 0,
    });
    expect(response.pagination.total).toBe(1);
  });

  it("blocks resubmit when max retries is reached", async () => {
    const supabase = createSupabaseMock({
      jobs: [
        baseJob({
          status: "failed",
          retry_count: 3,
          completed_at: "2026-02-25T08:00:00.000Z",
        }),
      ],
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    await expect(resubmitTakeoffJob(JOB_ID)).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
  });

  it("enforces resubmit backoff after a failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-25T10:00:10.000Z"));

    const supabase = createSupabaseMock({
      jobs: [
        baseJob({
          status: "failed",
          retry_count: 1,
          completed_at: "2026-02-25T10:00:00.000Z",
        }),
      ],
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    await expect(resubmitTakeoffJob(JOB_ID)).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
  });

  it("returns success when resubmit audit insert fails after status mutation", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = createSupabaseMock({
      jobs: [
        baseJob({
          status: "failed",
          retry_count: 1,
          completed_at: "2026-02-25T08:00:00.000Z",
        }),
      ],
      auditInsertError: {
        code: "23505",
        message: "duplicate key value violates unique constraint",
        details: null,
        hint: null,
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    const response = await resubmitTakeoffJob(JOB_ID);

    expect(response.job.status).toBe("pending");
    expect(response.job.retry_count).toBe(2);
    expect(supabase.__state.jobsById.get(JOB_ID)?.status).toBe("pending");
    expect(supabase.__state.auditLogs).toHaveLength(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Takeoff audit logging failed (non-blocking)",
      expect.objectContaining({
        action: "takeoff.job.resubmitted",
        tenantId: TENANT_ID,
        jobId: JOB_ID,
      })
    );

    consoleErrorSpy.mockRestore();
  });

  it("resubmits failed jobs with a full operator reset", async () => {
    const supabase = createSupabaseMock({
      jobs: [
        baseJob({
          status: "failed",
          retry_count: 1,
          completed_at: "2026-02-25T08:00:00.000Z",
        }),
      ],
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "engineer",
    } as never);

    const response = await resubmitTakeoffJob(JOB_ID);

    expect(response.command).toBe("resubmit");
    expect(response.outcome).toBe("applied");
    expect(response.job.status).toBe("pending");
    expect(response.job.retry_count).toBe(2);
    expect(response.job).toMatchObject({ error_code: null, error_message: null, completed_at: null });
    expect(supabase.__state.auditLogs.at(-1)?.action).toBe(
      "takeoff.job.resubmitted"
    );
  });

  // #415 let an administrator reset another member's failure; the retry of an existing job now runs only on the plan of
  // the member who launched it (an operator who did not launch it starts a new analysis on their own plan).
  it("refuses an administrator's retry of another member's job with the reason the list gave", async () => {
    const originalCreator = "ab000000-0000-4000-8000-000000000001";
    const job = baseJob({ status: "failed", completed_at: "2026-02-25T08:00:00.000Z", created_by: originalCreator });
    const supabase = createSupabaseMock({ jobs: [job] });
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase, userId: USER_ID, tenantId: TENANT_ID, tenantRole: "admin",
    } as never);

    const detail = await getTakeoffJobDetails(JOB_ID, {});
    expect(detail.job).toMatchObject({ can_resubmit: false, resume: { action: "new_analysis", reason: "launched_by_other" } });
    await expect(resubmitTakeoffJob(JOB_ID)).rejects.toMatchObject({
      status: 403, code: "FORBIDDEN", message: expect.stringContaining("Préparez une nouvelle analyse"),
      details: { resume: detail.job.resume },
    });
    expect(supabase.__state.jobsById.get(JOB_ID)).toEqual(job);
    expect(supabase.__state.jobUpdates).toBe(0);
    expect(supabase.__state.auditLogs).toEqual([]);
  });

  it("refuses an administrator's manual retry of another member's job", async () => {
    const job = baseJob({ status: "failed", created_by: "11111111-1111-4111-8111-111111111111", completed_at: "2026-02-25T08:00:00.000Z" });
    const supabase = createSupabaseMock({ jobs: [job] });
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase, userId: USER_ID, tenantId: TENANT_ID, tenantRole: "admin",
    } as never);

    await expect(resubmitTakeoffJob(JOB_ID)).rejects.toMatchObject({
      status: 403, message: expect.stringContaining("Préparez une nouvelle analyse"),
    });
    expect(supabase.__state.jobsById.get(JOB_ID)).toEqual(job);
    expect(supabase.__state.auditLogs).toEqual([]);
  });

  // A job runs on its creator's subscription: only they restart it, and the reset keeps them as its creator.
  it("lets an administrator reset their own legacy failure without changing its creator and audits them", async () => {
    const supabase = createSupabaseMock({ jobs: [baseJob({
      status: "failed", completed_at: "2026-02-25T08:00:00.000Z", created_by: USER_ID,
    })] });
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase, userId: USER_ID, tenantId: TENANT_ID, tenantRole: "admin",
    } as never);

    await resubmitTakeoffJob(JOB_ID);
    expect(supabase.__state.jobsById.get(JOB_ID)).toMatchObject({
      status: "pending", created_by: USER_ID,
    });
    expect(supabase.__state.auditLogs).toContainEqual(expect.objectContaining({
      action: "takeoff.job.resubmitted", record_id: JOB_ID, user_id: USER_ID,
    }));
  });

  it("refuses to resubmit a job of a former provider without changing it or auditing", async () => {
    const job = baseJob({ status: "failed", execution_provider: "gemini" });
    const supabase = createSupabaseMock({ jobs: [job] });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "engineer",
    } as never);

    await expect(resubmitTakeoffJob(JOB_ID)).rejects.toMatchObject({ status: 422, code: "AI_PROVIDER", retryable: false });
    expect(supabase.__state.jobsById.get(JOB_ID)).toEqual(job);
    expect(supabase.__state.auditLogs).toEqual([]);
  });

  it("blocks operator actions for viewer role", async () => {
    const job = baseJob({
      status: "failed",
      processing_strategy: "batch",
      provider_batch_id: "batch-123",
      provider_batch_state: "running",
      error_code: "AI_TIMEOUT",
    });
    const supabase = createSupabaseMock({ jobs: [job] });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "viewer",
    } as never);

    // The cancel refuses before any read. The retry reads the job and its affaire, as the list did, to give the same
    // decision and reason: a viewer may not act, and the former batch provider leaves nothing to resume.
    await expect(cancelTakeoffJob(JOB_ID)).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
    expect(supabase.from).not.toHaveBeenCalled();
    await expect(resubmitTakeoffJob(JOB_ID)).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      details: { resume: { action: "none", reason: "legacy_provider", available_at: null } },
    });
    expect(supabase.__state.jobUpdates).toBe(0);
    expect(supabase.__state.jobsById.get(JOB_ID)).toEqual(job);
    expect(supabase.__state.auditLogs).toEqual([]);
  });

  it.each([
    ["resubmit", resubmitTakeoffJob],
    ["cancel", cancelTakeoffJob],
  ] as const)("conceals another tenant's job from %s without changing it or auditing", async (_name, action) => {
    const job = baseJob({ tenant_id: OTHER_TENANT_ID });
    const supabase = createSupabaseMock({ jobs: [job] });
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    await expect(action(JOB_ID)).rejects.toMatchObject({ status: 404, code: "TAKEOFF_JOB_NOT_FOUND" });

    expect(supabase.__state.jobsById.get(JOB_ID)).toEqual(job);
    expect(supabase.__state.auditLogs).toEqual([]);
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("returns conflict when canceling a terminal job", async () => {
    const supabase = createSupabaseMock({
      jobs: [
        baseJob({
          status: "completed",
          retry_count: 1,
          error_code: null,
          error_message: null,
        }),
      ],
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    let thrown: unknown;
    try {
      await cancelTakeoffJob(JOB_ID);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TakeoffError);
    expect(thrown).toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
  });

  it("paginates project versions beyond row cap when filtering jobs by project_id", async () => {
    const versions = Array.from({ length: ESTIMATE_VERSIONS_ROW_CAP + 1 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      version_number: index + 1,
      project_id: PROJECT_ID,
    }));
    const latestVersion = versions.at(-1)!;

    const supabase = createSupabaseMock({
      jobs: [
        baseJob({
          id: JOB_ID,
          estimate_version_id: latestVersion.id,
          status: "completed",
          error_code: null,
          error_message: null,
          created_at: "2026-02-25T10:00:00.000Z",
        }),
      ],
      versions,
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    const response = await listTakeoffJobs({
      project_id: PROJECT_ID,
      limit: 20,
      offset: 0,
    });

    expect(response.jobs).toHaveLength(1);
    expect(response.jobs[0]?.estimate_version_id).toBe(latestVersion.id);
    expect(response.jobs[0]?.version_number).toBe(ESTIMATE_VERSIONS_ROW_CAP + 1);
    expect(response.counters.total).toBe(1);
  });
});

describe("one resume policy for the jobs list, the detail and the retry command", () => {
  const OTHER_MEMBER = "ab000000-0000-4000-8000-000000000002";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
    vi.mocked(assertLocalTakeoffResumeReady).mockImplementation(async (_supabase, _tenantId, job) => {
      assertTakeoffJobUsesLocalProvider(job);
    });
  });

  function signIn(supabase: ReturnType<typeof createSupabaseMock>, tenantRole: string, userId = USER_ID) {
    vi.mocked(getAuthenticatedContext).mockResolvedValue({ supabase, userId, tenantId: TENANT_ID, tenantRole } as never);
  }

  it.each<[string, Partial<TakeoffJobStoredRow>, string, string, number, string]>([
    ["a failure without a recorded end", {}, "retry_now", "retry_available", 200, ""],
    ["a recorded failure", { analysis_outcome: "failure" }, "new_analysis", "analysis_closed", 409, "CONFLICT"],
    ["a scheduled retry", { next_retry_at: "2026-02-25T10:00:05.000Z" }, "wait_retry", "retry_scheduled", 409, "CONFLICT"],
    ["a spent retry budget", { retry_count: 3 }, "new_analysis", "retry_limit", 409, "CONFLICT"],
    ["an exhausted detailed budget", { error_code: "TAKEOFF_LEVEL_C_BUDGET_EXCEEDED" }, "new_analysis", "budget_exhausted", 409, "CONFLICT"],
    ["a job of the former provider", { execution_provider: "gemini" }, "new_analysis", "legacy_provider", 422, "AI_PROVIDER"],
    ["a job of another Mac", { execution_host_id: "urn:uuid:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, "none", "other_mac", 422, "AI_PROVIDER"],
    ["another member's job", { created_by: OTHER_MEMBER }, "new_analysis", "launched_by_other", 403, "FORBIDDEN"],
    ["a running job", { status: "processing", completed_at: null }, "none", "not_stopped", 409, "CONFLICT"],
  ])("%s: the list, the detail and the command decide the same", async (_case, overrides, action, reason, status, code) => {
    const job = baseJob({ status: "failed", completed_at: "2026-02-25T10:00:00.000Z", ...overrides });
    const supabase = createSupabaseMock({ jobs: [job] });
    signIn(supabase, "engineer");

    const listed = (await listTakeoffJobs({ project_id: PROJECT_ID, limit: 20, offset: 0 })).jobs[0];
    const detail = (await getTakeoffJobDetails(JOB_ID, {})).job;
    expect(listed.resume).toEqual({ action, reason, available_at: reason === "retry_scheduled" ? job.next_retry_at : null });
    expect(detail.resume).toEqual(listed.resume);
    expect(detail.can_resubmit).toBe(action === "retry_now");
    expect(listed.can_resubmit).toBe(detail.can_resubmit);

    if (status === 200) {
      const response = await resubmitTakeoffJob(JOB_ID);
      expect(response.job).toMatchObject({ status: "pending", retry_count: 1, resume: { action: "none", reason: "not_stopped" } });
      return;
    }
    await expect(resubmitTakeoffJob(JOB_ID)).rejects.toMatchObject({ status, code, details: { resume: detail.resume } });
    expect(supabase.__state.jobsById.get(JOB_ID)).toEqual(job);
    expect(supabase.__state.jobUpdates).toBe(0);
    expect(supabase.__state.auditLogs).toEqual([]);
  });

  it("waits for the delay after a failure on the three surfaces, then lets the launcher retry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-25T10:00:02.000Z"));
    const supabase = createSupabaseMock({ jobs: [baseJob({ status: "failed", completed_at: "2026-02-25T10:00:00.000Z" })] });
    signIn(supabase, "engineer");

    const delayed = { action: "wait_retry", reason: "retry_delay", available_at: "2026-02-25T10:00:05.000Z" };
    expect((await listTakeoffJobs({ project_id: PROJECT_ID, limit: 20, offset: 0 })).jobs[0].resume).toEqual(delayed);
    expect((await getTakeoffJobDetails(JOB_ID, {})).job.resume).toEqual(delayed);
    await expect(resubmitTakeoffJob(JOB_ID)).rejects.toMatchObject({
      status: 409, details: { resume: delayed, retry_available_at: delayed.available_at, retry_backoff_ms: 5_000 },
    });

    vi.setSystemTime(new Date("2026-02-25T10:00:05.000Z"));
    expect((await getTakeoffJobDetails(JOB_ID, {})).job.resume).toMatchObject({ action: "retry_now" });
    await expect(resubmitTakeoffJob(JOB_ID)).resolves.toMatchObject({ job: { status: "pending" } });
  });

  it.each([
    ["the role", (supabase: ReturnType<typeof createSupabaseMock>) => signIn(supabase, "director")],
    ["the access to the affaire", (_supabase: ReturnType<typeof createSupabaseMock>, projects: Array<{ user_id: string }>) => {
      projects[0].user_id = OTHER_MEMBER;
    }],
    ["the affaire's archive", (_supabase: ReturnType<typeof createSupabaseMock>, projects: Array<{ is_archived: boolean }>) => {
      projects[0].is_archived = true;
    }],
  ] as const)("refuses a change of %s between the read and the click with the policy's reason", async (_change, change) => {
    const job = baseJob({ status: "failed", completed_at: "2026-02-25T10:00:00.000Z" });
    const projects = [{ id: PROJECT_ID, user_id: USER_ID, is_archived: false }];
    const supabase = createSupabaseMock({ jobs: [job], projects });
    signIn(supabase, "engineer");
    expect((await getTakeoffJobDetails(JOB_ID, {})).job.resume).toMatchObject({ action: "retry_now" });

    change(supabase, projects);
    await expect(resubmitTakeoffJob(JOB_ID)).rejects.toMatchObject({
      status: 403, code: "FORBIDDEN", message: "Ce profil ne peut pas relancer l’analyse. Contactez un ingénieur ou un administrateur.",
      details: { resume: { action: "none", reason: "read_only", available_at: null } },
    });
    expect(supabase.__state.jobsById.get(JOB_ID)).toEqual(job);
    expect(supabase.__state.jobUpdates).toBe(0);
    expect(supabase.__state.auditLogs).toEqual([]);
  });

  it.each<[string, Partial<TakeoffJobStoredRow>]>([
    ["a concurrent retry", { retry_count: 1 }],
    ["a scheduled retry", { next_retry_at: "2026-02-25T10:00:20.000Z" }],
    ["a recorded end", { analysis_outcome: "failure" }],
    ["a new status", { status: "pending" }],
  ])("leaves the job of %s written after the read unchanged", async (_change, concurrent) => {
    const supabase = createSupabaseMock({
      jobs: [baseJob({ status: "failed", completed_at: "2026-02-25T10:00:00.000Z" })],
      afterJobRead: () => concurrent,
    });
    signIn(supabase, "engineer");

    await expect(resubmitTakeoffJob(JOB_ID)).rejects.toMatchObject({
      status: 409, code: "CONFLICT", message: expect.stringContaining("Rechargez le suivi"),
    });
    expect(supabase.__state.jobsById.get(JOB_ID)).toMatchObject({ ...concurrent, error_code: "AI_TIMEOUT" });
    expect(supabase.__state.auditLogs).toEqual([]);
  });

  it("reads the affaires of a page of jobs once, whatever its number of failures", async () => {
    const supabase = createSupabaseMock({ jobs: [
      baseJob({ id: JOB_ID, status: "failed" }),
      baseJob({ id: JOB_ID_2, status: "failed", analysis_outcome: "failure" }),
      baseJob({ id: "99999999-9999-4999-8999-999999999998", status: "failed", execution_provider: "gemini" }),
    ] });
    signIn(supabase, "engineer");

    const { jobs } = await listTakeoffJobs({ project_id: PROJECT_ID, limit: 20, offset: 0 });
    expect(jobs.map((job) => job.resume?.reason).sort()).toEqual(["analysis_closed", "legacy_provider", "retry_available"]);
    expect(supabase.__state.projectReads).toBe(1);
  });
});

describe("fix round 1: every place speaks with the decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: "profile-1",
      profiles: [{ id: "profile-1", accessToken: "fixture", model: "fixture-model" }] } as never);
    vi.useRealTimers();
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
    vi.mocked(assertLocalTakeoffResumeReady).mockImplementation(async (_supabase, _tenantId, job) => {
      assertTakeoffJobUsesLocalProvider(job);
    });
  });

  function signIn(supabase: ReturnType<typeof createSupabaseMock>, tenantRole: string, userId = USER_ID) {
    vi.mocked(getAuthenticatedContext).mockResolvedValue({ supabase, userId, tenantId: TENANT_ID, tenantRole } as never);
  }

  // Point 2: the launcher's own ChatGPT connection and model are read once per request, before the click.
  it.each([
    ["disconnected", { selectedId: null, profiles: [] }, "plan_disconnected", /Reconnectez votre forfait ChatGPT dans Mon profil/],
    ["expired", { selectedId: "p", profiles: [{ id: "p", model: "m" }] }, "plan_disconnected", /Reconnectez votre forfait ChatGPT/],
    ["without a model", { selectedId: "p", profiles: [{ id: "p", accessToken: "t" }] }, "plan_model_missing",
      /Choisissez un modèle ChatGPT dans Mon profil/],
  ] as const)("tells a launcher whose ChatGPT plan is %s what to do before the click, and the click agrees", async (_case, store, reason, text) => {
    vi.mocked(readChatGptStore).mockResolvedValue(store as never);
    const job = baseJob({ status: "failed", completed_at: "2026-02-25T10:00:00.000Z" });
    const supabase = createSupabaseMock({ jobs: [job, baseJob({ id: JOB_ID_2, status: "failed" })] });
    signIn(supabase, "engineer");

    const listed = await listTakeoffJobs({ project_id: PROJECT_ID, limit: 20, offset: 0 });
    expect(readChatGptStore).toHaveBeenCalledTimes(1);
    const detail = (await getTakeoffJobDetails(JOB_ID, {})).job;
    expect(listed.jobs.find((row) => row.id === JOB_ID)?.resume).toEqual({ action: "none", reason, available_at: null });
    expect(detail.resume).toEqual({ action: "none", reason, available_at: null });
    await expect(resubmitTakeoffJob(JOB_ID)).rejects.toMatchObject({
      status: 422, code: "AI_PROVIDER", message: expect.stringMatching(text), details: { resume: detail.resume },
    });
    expect(assertLocalTakeoffResumeReady).not.toHaveBeenCalled();
    expect(supabase.__state.jobUpdates).toBe(0);
  });

  // Point 3: a click that loses the compare-and-set is answered with the decision now in force.
  it("answers a lost compare-and-set with the current decision", async () => {
    const supabase = createSupabaseMock({
      jobs: [baseJob({ status: "failed", completed_at: "2026-02-25T10:00:00.000Z" })],
      afterJobRead: () => ({ analysis_outcome: "failure" }),
    });
    signIn(supabase, "engineer");

    await expect(resubmitTakeoffJob(JOB_ID)).rejects.toMatchObject({
      status: 409, code: "CONFLICT", details: { resume: { action: "new_analysis", reason: "analysis_closed", available_at: null } },
    });
  });

  // Point 4: both commands write only while the member may still write the affaire.
  it("refuses to cancel once the affaire can no longer be written, and writes nothing", async () => {
    const job = baseJob({ status: "pending", completed_at: null, error_code: null, error_message: null });
    const supabase = createSupabaseMock({ jobs: [job], projects: [{ id: PROJECT_ID, user_id: USER_ID, is_archived: true }] });
    signIn(supabase, "engineer");

    await expect(cancelTakeoffJob(JOB_ID)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(supabase.__state.jobUpdates).toBe(0);
    expect(supabase.__state.jobsById.get(JOB_ID)).toEqual(job);
    expect(supabase.__state.auditLogs).toEqual([]);
  });

  it("reads the right to write the affaire again after the launch checks, just before the retry writes", async () => {
    const job = baseJob({ status: "failed", completed_at: "2026-02-25T10:00:00.000Z" });
    const projects = [{ id: PROJECT_ID, user_id: USER_ID, is_archived: false }];
    const supabase = createSupabaseMock({ jobs: [job], projects });
    signIn(supabase, "engineer");
    vi.mocked(assertLocalTakeoffResumeReady).mockImplementation(async () => { projects[0].is_archived = true; });

    await expect(resubmitTakeoffJob(JOB_ID)).rejects.toMatchObject({
      status: 403, code: "FORBIDDEN", details: { resume: { action: "none", reason: "read_only", available_at: null } },
    });
    expect(supabase.__state.jobUpdates).toBe(0);
    expect(supabase.__state.jobsById.get(JOB_ID)).toEqual(job);
  });

  it("holds the launcher in the statement that resets the job", async () => {
    const supabase = createSupabaseMock({
      jobs: [baseJob({ status: "failed", completed_at: "2026-02-25T10:00:00.000Z" })],
      afterJobRead: () => ({ created_by: "ab000000-0000-4000-8000-000000000009" }),
    });
    signIn(supabase, "engineer");

    await expect(resubmitTakeoffJob(JOB_ID)).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    expect(supabase.__state.jobsById.get(JOB_ID)).toMatchObject({ status: "failed", retry_count: 0 });
  });

  // Point 6: a page's line counts come from one statement, never from line rows read in pages.
  it("counts the lines of a page of jobs with one grouped read", async () => {
    const supabase = createSupabaseMock({ jobs: [baseJob({ id: JOB_ID, status: "completed" }), baseJob({ id: JOB_ID_2, status: "failed" })] });
    signIn(supabase, "engineer");

    const listed = await listTakeoffJobs({ project_id: PROJECT_ID, limit: 20, offset: 0 });
    expect(Object.fromEntries(listed.jobs.map((row) => [row.id, row.items_count]))).toEqual({ [JOB_ID]: 2, [JOB_ID_2]: 0 });
    expect(supabase.__state.groupedCountReads).toBe(1);
    expect(supabase.__state.itemSelects).toEqual([]);
  });

  // Point 7: French status names in the refusals of a cancel.
  it.each([
    ["an analysis that already ended", {}, undefined],
    ["an analysis that ended after the read", { status: "pending" }, { status: "completed" }],
  ] as const)("refuses to cancel %s in French", async (_case, stored, concurrent) => {
    const supabase = createSupabaseMock({
      jobs: [baseJob({ status: "completed", error_code: null, error_message: null, ...stored })],
      ...(concurrent ? { afterJobRead: () => concurrent } : {}),
    });
    signIn(supabase, "engineer");

    const refusal = await cancelTakeoffJob(JOB_ID).then(() => null, (error: unknown) => error as Error);
    expect(refusal).toMatchObject({ status: 409, code: "CONFLICT" });
    expect(refusal?.message).toMatch(/analyse/);
    expect(refusal?.message).not.toMatch(/pending|processing|canceled|failed|\bjob\b/);
  });

  // Fix round 2, point 2: a refusal's decision is computed from reads made after the refusal's cause.
  it("answers a refusal of the launch check with the decision read after it", async () => {
    const supabase = createSupabaseMock({ jobs: [baseJob({ status: "failed", completed_at: "2026-02-25T10:00:00.000Z" })] });
    signIn(supabase, "engineer");
    vi.mocked(assertLocalTakeoffResumeReady).mockImplementation(async () => {
      vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: null, profiles: [] } as never);
      throw new TakeoffError({ status: 422, code: "AI_PROVIDER", retryable: false,
        message: "Reconnectez votre forfait ChatGPT dans Mon profil avant de lancer ce métré." });
    });

    await expect(resubmitTakeoffJob(JOB_ID)).rejects.toMatchObject({
      status: 422, code: "AI_PROVIDER", details: { resume: { action: "none", reason: "plan_disconnected", available_at: null } },
    });
    expect(supabase.__state.jobUpdates).toBe(0);
  });

  it("answers a lost compare-and-set with the member's rights read after it", async () => {
    const projects = [{ id: PROJECT_ID, user_id: USER_ID, is_archived: false }];
    const supabase = createSupabaseMock({
      jobs: [baseJob({ status: "failed", completed_at: "2026-02-25T10:00:00.000Z" })],
      projects,
      beforeJobUpdate: (row) => {
        projects[0].is_archived = true;
        return row.retry_count === 0 ? { retry_count: 1 } : undefined;
      },
    });
    signIn(supabase, "engineer");

    await expect(resubmitTakeoffJob(JOB_ID)).rejects.toMatchObject({
      status: 409, code: "CONFLICT", details: { resume: { action: "none", reason: "read_only", available_at: null } },
    });
  });
});
