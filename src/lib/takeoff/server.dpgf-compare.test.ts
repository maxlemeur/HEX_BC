import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getAuthenticatedContext: vi.fn(),
  assertDraftStatus: vi.fn(),
  bulkUpdateEstimateItems: vi.fn(),
  insertAssemblyIntoVersion: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
  getTakeoffLowConfidenceThresholdForTenant: vi.fn(),
}));

vi.mock("@/lib/takeoff/version-links", () => ({
  listAccessibleTakeoffJobsForVersion: vi.fn(),
}));

import { getAuthenticatedContext } from "@/lib/estimates/server";
import { buildTakeoffDpgfReviewReference } from "@/lib/takeoff/dpgf-compare";
import { TakeoffErrorCode } from "@/lib/takeoff/errors";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import {
  fetchDpgfTakeoffComparison,
  fetchTakeoffLineEvidencePanel,
  fetchTakeoffDpgfSummaryForHub,
  parseTakeoffDpgfComparisonQuery,
  saveTakeoffDpgfManualLink,
  saveTakeoffReviewDecision,
} from "@/lib/takeoff/server";
import { listAccessibleTakeoffJobsForVersion } from "@/lib/takeoff/version-links";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_VERSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_ID = "44444444-4444-4444-8444-444444444444";
const ESTIMATE_ITEM_ID = "55555555-5555-4555-8555-555555555555";
const TAKEOFF_ITEM_ID = "66666666-6666-4666-8666-666666666666";
const TAKEOFF_ITEM_ID_2 = "77777777-7777-4777-8777-777777777777";

type StoredJob = {
  id: string;
  tenant_id: string;
  estimate_version_id: string;
  status: string;
  level: string;
  source_file_name: string | null;
  source_file_type: string | null;
  source_file_size_bytes: number | null;
  source_file_path: string | null;
  prompt_version: string | null;
  schema_version: string | null;
  model: string | null;
  thinking_level: string | null;
  media_resolution: string | null;
  retry_count: number;
  next_retry_at: string | null;
  last_error_at: string | null;
  token_count: number | null;
  cost_cents: number | null;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

type StoredTakeoffItem = {
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

type StoredEstimateItem = {
  id: string;
  tenant_id: string;
  version_id: string;
  position: number;
  title: string;
  description: string | null;
  quantity: number | null;
  selected_supplier_price_id: string | null;
  source_file_name: string | null;
  source_page: number | null;
  source_provider: string | null;
  item_type: "section" | "line";
  updated_at: string;
};

type StoredEvidence = {
  id: string;
  created_at: string;
  tenant_id: string;
  project_id: string;
  version_id: string;
  takeoff_job_id: string;
  estimate_item_id: string;
  fingerprint: string;
  evidence_type: "dpgf" | "takeoff" | "plan_zone" | "formula" | "price_source" | "comment";
  evidence_kind: "fact" | "hypothesis" | "inference";
  label: string;
  source_label: string;
  source_file_name: string | null;
  source_page: number | null;
  confidence_score: number | null;
  note: string | null;
  source_record_table: string | null;
  source_record_id: string | null;
  payload: Record<string, unknown>;
  author_user_id: string | null;
  invalidated_at: string | null;
  invalidated_by: string | null;
  invalidation_reason: string | null;
  supersedes_evidence_id: string | null;
};

type StoredLink = {
  id: string;
  tenant_id: string;
  version_id: string;
  takeoff_job_id: string;
  estimate_item_id: string;
  takeoff_item_id: string;
  created_at: string;
  updated_at: string;
  linked_by: string | null;
};

type StoredDecision = {
  id: string;
  tenant_id: string;
  version_id: string;
  takeoff_job_id: string;
  estimate_item_id: string;
  review_reference: string;
  line_label: string;
  line_position: number;
  source_file_name: string | null;
  source_page: number | null;
  carried_over_from_version_id: string | null;
  carried_over_at: string | null;
  decision: "keep_dpgf" | "keep_takeoff" | "manual_fix" | "out_of_scope";
  reason: string | null;
  decided_at: string;
  updated_at: string;
  decided_by: string | null;
};

function makeJob(): StoredJob {
  return {
    id: JOB_ID,
    tenant_id: TENANT_ID,
    estimate_version_id: VERSION_ID,
    status: "completed",
    level: "A",
    source_file_name: "plans.pdf",
    source_file_type: "application/pdf",
    source_file_size_bytes: 1200,
    source_file_path: `${TENANT_ID}/${JOB_ID}/plans.pdf`,
    prompt_version: "v1",
    schema_version: "v1",
    model: "gemini-3-flash-preview",
    thinking_level: "high",
    media_resolution: null,
    retry_count: 0,
    next_retry_at: null,
    last_error_at: null,
    token_count: 10,
    cost_cents: 1,
    duration_ms: 1200,
    started_at: "2026-03-06T10:00:00.000Z",
    completed_at: "2026-03-06T10:01:00.000Z",
    error_code: null,
    error_message: null,
    created_at: "2026-03-06T09:59:00.000Z",
    updated_at: "2026-03-06T10:01:00.000Z",
    created_by: USER_ID,
  };
}

function buildThenableSelectBuilder<T>(getRows: () => T[]) {
  const builder = {
    eq: vi.fn((...args: unknown[]) => {
      void args;
      return builder;
    }),
    in: vi.fn((...args: unknown[]) => {
      void args;
      return builder;
    }),
    is: vi.fn((...args: unknown[]) => {
      void args;
      return builder;
    }),
    order: vi.fn((...args: unknown[]) => {
      void args;
      return builder;
    }),
    limit: vi.fn((...args: unknown[]) => {
      void args;
      return builder;
    }),
    range: vi.fn(async (start: number, end: number) => {
      const rows = getRows();
      return {
        data: rows.slice(start, end + 1),
        count: rows.length,
        error: null,
      };
    }),
    maybeSingle: vi.fn(async () => ({
      data: getRows()[0] ?? null,
      error: null,
    })),
    single: vi.fn(async () => ({
      data: getRows()[0] ?? null,
      error: null,
    })),
    then: (
      resolve: (value: { data: T[]; error: null; count?: number | null }) => unknown
    ) => {
      const rows = getRows();
      return Promise.resolve(resolve({ data: rows, error: null, count: rows.length }));
    },
  };

  return builder;
}

function createSupabaseMock() {
  const state: {
    job: StoredJob;
    takeoffItems: StoredTakeoffItem[];
    estimateItems: StoredEstimateItem[];
    estimateItemSelects: string[];
    links: StoredLink[];
    reviewDecisions: StoredDecision[];
    evidences: StoredEvidence[];
    importId: string;
    manualLinkRpcError: {
      code: string;
      message: string;
      details: string;
      hint: string | null;
    } | null;
  } = {
    job: makeJob(),
    takeoffItems: [
      {
        id: TAKEOFF_ITEM_ID,
        tenant_id: TENANT_ID,
        job_id: JOB_ID,
        designation: "Faux plafond acoustique",
        quantity: 80,
        unit: "m2",
        confidence: 0.95,
        evidence: "Page 5, zone plafonds",
        source_file_name: "plans.pdf",
        source_page: 5,
        metadata: {},
        is_excluded: false,
        exclusion_reason: null,
        is_verified: false,
        verified_at: null,
        verified_by: null,
        created_at: "2026-03-06T10:01:00.000Z",
        updated_at: "2026-03-06T10:01:00.000Z",
      },
      {
        id: TAKEOFF_ITEM_ID_2,
        tenant_id: TENANT_ID,
        job_id: JOB_ID,
        designation: "Reserve plafonds",
        quantity: 20,
        unit: "m2",
        confidence: 0.72,
        evidence: "Page 8, reserve plafond",
        source_file_name: "plans.pdf",
        source_page: 8,
        metadata: {},
        is_excluded: false,
        exclusion_reason: null,
        is_verified: false,
        verified_at: null,
        verified_by: null,
        created_at: "2026-03-06T10:02:00.000Z",
        updated_at: "2026-03-06T10:02:00.000Z",
      },
    ],
    estimateItems: [
      {
        id: ESTIMATE_ITEM_ID,
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        position: 1,
        title: "Faux plafond acoustique",
        description: null,
        quantity: 100,
        selected_supplier_price_id: null,
        source_file_name: "dpgf.xlsx",
        source_page: 12,
        source_provider: "dpgf",
        item_type: "line",
        updated_at: "2026-03-06T09:00:00.000Z",
      },
    ],
    estimateItemSelects: [],
    links: [],
    reviewDecisions: [],
    evidences: [],
    importId: "99999999-9999-4999-8999-999999999999",
    manualLinkRpcError: null,
  };

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "takeoff_jobs") {
        const filters: Record<string, string> = {};
        const builder = {
          eq: vi.fn((column: string, value: string) => {
            filters[column] = value;
            return builder;
          }),
          maybeSingle: vi.fn(async () => ({
            data:
              (!filters.id || state.job.id === filters.id) &&
              (!filters.tenant_id || state.job.tenant_id === filters.tenant_id)
                ? state.job
                : null,
            error: null,
          })),
        };
        return {
          select: vi.fn(() => builder),
        };
      }

      if (table === "takeoff_items") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const inFilters: Record<string, string[]> = {};
            const getRows = () =>
              state.takeoffItems.filter((item) => {
                if (filters.tenant_id && item.tenant_id !== filters.tenant_id) return false;
                if (filters.job_id && item.job_id !== filters.job_id) return false;
                if (filters.id && item.id !== filters.id) return false;
                if (inFilters.id && !inFilters.id.includes(item.id)) return false;
                return true;
              });
            const builder = buildThenableSelectBuilder(getRows);
            builder.eq.mockImplementation((column: unknown, value: unknown) => {
              filters[String(column)] = String(value);
              return builder;
            });
            builder.in.mockImplementation((column: unknown, values: unknown) => {
              inFilters[String(column)] = Array.isArray(values)
                ? values.map((value) => String(value))
                : [];
              return builder;
            });
            return builder;
          }),
        };
      }

      if (table === "estimate_versions") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const inFilters: Record<string, string[]> = {};
            const getRows = () => {
              const allRows = [
                {
                  id: VERSION_ID,
                  project_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                  version_number: 3,
                },
                {
                  id: SOURCE_VERSION_ID,
                  project_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                  version_number: 2,
                },
              ];

              return allRows.filter((row) => {
                if (filters.tenant_id && filters.tenant_id !== TENANT_ID) return false;
                if (filters.id && row.id !== filters.id) return false;
                if (inFilters.id && !inFilters.id.includes(row.id)) return false;
                return true;
              });
            };

            const builder = buildThenableSelectBuilder(getRows);
            builder.eq.mockImplementation((column: unknown, value: unknown) => {
              filters[String(column)] = String(value);
              return builder;
            });
            builder.in.mockImplementation((column: unknown, values: unknown) => {
              inFilters[String(column)] = Array.isArray(values)
                ? values.map((value) => String(value))
                : [];
              return builder;
            });
            return builder;
          }),
        };
      }

      if (table === "estimate_items") {
        return {
          select: vi.fn((columns?: string) => {
            state.estimateItemSelects.push(columns ?? "");
            const filters: Record<string, string> = {};
            const getRows = () =>
              state.estimateItems.filter((item) => {
                if (filters.tenant_id && item.tenant_id !== filters.tenant_id) return false;
                if (filters.version_id && item.version_id !== filters.version_id) return false;
                if (filters.item_type && item.item_type !== filters.item_type) return false;
                if (filters.id && item.id !== filters.id) return false;
                return true;
              });
            const builder = buildThenableSelectBuilder(getRows);
            builder.eq.mockImplementation((column: unknown, value: unknown) => {
              filters[String(column)] = String(value);
              return builder;
            });
            return builder;
          }),
        };
      }

      if (table === "supplier_pricebook") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const inFilters: Record<string, string[]> = {};
            const rows = [
              {
                id: "abababab-abab-4bab-8bab-abababababab",
                tenant_id: TENANT_ID,
                supplier_sku: "SKU-PLAFOND",
                unit: "m2",
                unit_price_cents: 1899,
                currency: "EUR",
                valid_from: "2026-01-01",
                valid_to: null,
                notes: "Tarif accords cadre",
              },
            ];
            const getRows = () =>
              rows.filter((row) => {
                if (filters.tenant_id && row.tenant_id !== filters.tenant_id) return false;
                if (inFilters.id && !inFilters.id.includes(row.id)) return false;
                return true;
              });
            const builder = buildThenableSelectBuilder(getRows);
            builder.eq.mockImplementation((column: unknown, value: unknown) => {
              filters[String(column)] = String(value);
              return builder;
            });
            builder.in.mockImplementation((column: unknown, values: unknown) => {
              inFilters[String(column)] = Array.isArray(values)
                ? values.map((value) => String(value))
                : [];
              return builder;
            });
            return builder;
          }),
        };
      }

      if (table === "takeoff_dpgf_links") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const getRows = () =>
              state.links.filter((link) => {
                if (filters.tenant_id && link.tenant_id !== filters.tenant_id) return false;
                if (filters.version_id && link.version_id !== filters.version_id) return false;
                if (filters.takeoff_job_id && link.takeoff_job_id !== filters.takeoff_job_id) {
                  return false;
                }
                if (filters.estimate_item_id && link.estimate_item_id !== filters.estimate_item_id) {
                  return false;
                }
                if (filters.id && link.id !== filters.id) return false;
                return true;
              });
            const builder = buildThenableSelectBuilder(getRows);
            builder.eq.mockImplementation((column: unknown, value: unknown) => {
              filters[String(column)] = String(value);
              return builder;
            });
            return builder;
          }),
        };
      }

      if (table === "takeoff_dpgf_review_decisions") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const getRows = () =>
              state.reviewDecisions.filter((decision) => {
                if (filters.tenant_id && decision.tenant_id !== filters.tenant_id) return false;
                if (filters.version_id && decision.version_id !== filters.version_id) return false;
                if (filters.takeoff_job_id && decision.takeoff_job_id !== filters.takeoff_job_id) {
                  return false;
                }
                if (
                  filters.review_reference &&
                  decision.review_reference !== filters.review_reference
                ) {
                  return false;
                }
                if (
                  filters.estimate_item_id &&
                  decision.estimate_item_id !== filters.estimate_item_id
                ) {
                  return false;
                }
                return true;
              });
            const builder = buildThenableSelectBuilder(getRows);
            builder.eq.mockImplementation((column: unknown, value: unknown) => {
              filters[String(column)] = String(value);
              return builder;
            });
            return builder;
          }),
          upsert: vi.fn((payload: StoredDecision) => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => {
                const nextDecision: StoredDecision = {
                  ...payload,
                  id:
                    state.reviewDecisions.find(
                      (decision) =>
                        decision.version_id === payload.version_id &&
                        decision.takeoff_job_id === payload.takeoff_job_id &&
                        decision.estimate_item_id === payload.estimate_item_id
                    )?.id ?? "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                };

                state.reviewDecisions = [
                  ...state.reviewDecisions.filter(
                    (decision) =>
                      !(
                        decision.version_id === payload.version_id &&
                        decision.takeoff_job_id === payload.takeoff_job_id &&
                        decision.estimate_item_id === payload.estimate_item_id
                      )
                  ),
                  nextDecision,
                ];

                return {
                  data: nextDecision,
                  error: null,
                };
              }),
            })),
          })),
        };
      }

      if (table === "estimate_line_evidences") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const inFilters: Record<string, string[]> = {};
            const nullFilters = new Map<string, unknown>();
            const getRows = () =>
              state.evidences.filter((evidence) => {
                if (filters.tenant_id && evidence.tenant_id !== filters.tenant_id) return false;
                if (filters.version_id && evidence.version_id !== filters.version_id) return false;
                if (filters.takeoff_job_id && evidence.takeoff_job_id !== filters.takeoff_job_id) {
                  return false;
                }
                if (filters.estimate_item_id && evidence.estimate_item_id !== filters.estimate_item_id) {
                  return false;
                }
                if (inFilters.estimate_item_id && !inFilters.estimate_item_id.includes(evidence.estimate_item_id)) {
                  return false;
                }
                if (inFilters.id && !inFilters.id.includes(evidence.id)) return false;
                if (nullFilters.has("invalidated_at")) {
                  const expected = nullFilters.get("invalidated_at");
                  if (expected === null && evidence.invalidated_at !== null) return false;
                }
                return true;
              });
            const builder = buildThenableSelectBuilder(getRows);
            builder.eq.mockImplementation((column: unknown, value: unknown) => {
              filters[String(column)] = String(value);
              return builder;
            });
            builder.in.mockImplementation((column: unknown, values: unknown) => {
              inFilters[String(column)] = Array.isArray(values)
                ? values.map((value) => String(value))
                : [];
              return builder;
            });
            builder.is.mockImplementation((column: unknown, value: unknown) => {
              nullFilters.set(String(column), value);
              return builder;
            });
            return builder;
          }),
          update: vi.fn((payload: Partial<StoredEvidence>) => {
            const filters: Record<string, string> = {};
            const inFilters: Record<string, string[]> = {};
            const builder = {
              eq: vi.fn((column: string, value: string) => {
                filters[column] = value;
                return builder;
              }),
              in: vi.fn(async (column: string, values: string[]) => {
                inFilters[column] = values;
                state.evidences = state.evidences.map((evidence) => {
                  if (filters.tenant_id && evidence.tenant_id !== filters.tenant_id) {
                    return evidence;
                  }
                  if (inFilters.id && !inFilters.id.includes(evidence.id)) {
                    return evidence;
                  }

                  return {
                    ...evidence,
                    ...payload,
                  };
                });

                return { error: null };
              }),
            };

            return builder;
          }),
          insert: vi.fn(async (payload: Partial<StoredEvidence>[]) => {
            state.evidences.push(
              ...payload.map((entry, index) => ({
                id:
                  typeof entry.id === "string"
                    ? entry.id
                    : `f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0${index}`,
                created_at: String(entry.created_at),
                tenant_id: String(entry.tenant_id),
                project_id: String(entry.project_id),
                version_id: String(entry.version_id),
                takeoff_job_id: String(entry.takeoff_job_id),
                estimate_item_id: String(entry.estimate_item_id),
                fingerprint: String(entry.fingerprint),
                evidence_type: entry.evidence_type as StoredEvidence["evidence_type"],
                evidence_kind: entry.evidence_kind as StoredEvidence["evidence_kind"],
                label: String(entry.label),
                source_label: String(entry.source_label),
                source_file_name:
                  entry.source_file_name === null || entry.source_file_name === undefined
                    ? null
                    : String(entry.source_file_name),
                source_page:
                  typeof entry.source_page === "number" ? entry.source_page : null,
                confidence_score:
                  typeof entry.confidence_score === "number" ? entry.confidence_score : null,
                note:
                  entry.note === null || entry.note === undefined
                    ? null
                    : String(entry.note),
                source_record_table:
                  entry.source_record_table === null || entry.source_record_table === undefined
                    ? null
                    : String(entry.source_record_table),
                source_record_id:
                  entry.source_record_id === null || entry.source_record_id === undefined
                    ? null
                    : String(entry.source_record_id),
                payload:
                  entry.payload && typeof entry.payload === "object" && !Array.isArray(entry.payload)
                    ? (entry.payload as Record<string, unknown>)
                    : {},
                author_user_id:
                  entry.author_user_id === null || entry.author_user_id === undefined
                    ? null
                    : String(entry.author_user_id),
                invalidated_at: null,
                invalidated_by: null,
                invalidation_reason: null,
                supersedes_evidence_id:
                  entry.supersedes_evidence_id === null || entry.supersedes_evidence_id === undefined
                    ? null
                    : String(entry.supersedes_evidence_id),
              }))
            );

            return { error: null };
          }),
        };
      }

      if (table === "profiles") {
        return {
          select: vi.fn(() => {
            const inFilters: Record<string, string[]> = {};
            const rows = [
              {
                id: USER_ID,
                full_name: "Nadia Review",
              },
            ];
            const getRows = () =>
              rows.filter((row) => {
                if (inFilters.id && !inFilters.id.includes(row.id)) return false;
                return true;
              });
            const builder = buildThenableSelectBuilder(getRows);
            builder.in.mockImplementation((column: unknown, values: unknown) => {
              inFilters[String(column)] = Array.isArray(values)
                ? values.map((value) => String(value))
                : [];
              return builder;
            });
            return builder;
          }),
        };
      }

      if (table === "dpgf_imports") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const builder = {
              eq: vi.fn((column: string, value: string) => {
                filters[column] = value;
                return builder;
              }),
              order: vi.fn(() => builder),
              limit: vi.fn(() => builder),
              maybeSingle: vi.fn(async () => ({
                data:
                  (!filters.tenant_id || filters.tenant_id === TENANT_ID) &&
                  (!filters.project_id ||
                    filters.project_id === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
                    ? { id: state.importId }
                    : null,
                error: null,
              })),
            };
            return builder;
          }),
        };
      }

      if (table === "dpgf_rows_mapped") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const getRows = () =>
              filters.import_id === state.importId
                ? [
                    {
                      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                      payload: {
                        row_index: 12,
                        unit: "m2",
                      },
                    },
                  ]
                : [];
            const builder = buildThenableSelectBuilder(getRows);
            builder.eq.mockImplementation((column: unknown, value: unknown) => {
              filters[String(column)] = String(value);
              return builder;
            });
            return builder;
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn !== "save_takeoff_dpgf_manual_links") {
        throw new Error(`Unexpected rpc: ${fn}`);
      }

      if (state.manualLinkRpcError) {
        const error = state.manualLinkRpcError;
        state.manualLinkRpcError = null;
        return {
          data: null,
          error,
        };
      }

      const versionId = String(args.p_version_id);
      const takeoffJobId = String(args.p_takeoff_job_id);
      const estimateItemId = String(args.p_estimate_item_id);
      const takeoffItemIds = Array.isArray(args.p_takeoff_item_ids)
        ? args.p_takeoff_item_ids.map((itemId) => String(itemId))
        : [];
      const linkedBy =
        args.p_linked_by === null || args.p_linked_by === undefined
          ? null
          : String(args.p_linked_by);

      state.links = state.links.filter(
        (link) =>
          !(
            link.tenant_id === TENANT_ID &&
            link.version_id === versionId &&
            link.takeoff_job_id === takeoffJobId &&
            link.estimate_item_id === estimateItemId
          )
      );

      const now = "2026-03-06T11:00:00.000Z";
      const insertedLinks = takeoffItemIds.map((takeoffItemId, index) => ({
        id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index}`,
        tenant_id: TENANT_ID,
        version_id: versionId,
        takeoff_job_id: takeoffJobId,
        estimate_item_id: estimateItemId,
        takeoff_item_id: takeoffItemId,
        created_at: now,
        updated_at: now,
        linked_by: linkedBy,
      }));

      state.links.push(...insertedLinks);

      return {
        data: insertedLinks.map((link) => link.id),
        error: null,
      };
    }),
  };

  return {
    supabase: supabase as never,
    rpcMock: supabase.rpc,
    state,
  };
}

describe("takeoff DPGF comparison server helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
    vi.mocked(listAccessibleTakeoffJobsForVersion).mockResolvedValue([
      {
        id: JOB_ID,
        estimate_version_id: VERSION_ID,
        status: "completed",
        level: "A",
        source_file_name: "plans.pdf",
        source_file_type: "application/pdf",
        source_file_size_bytes: 1200,
        created_at: "2026-03-06T09:59:00.000Z",
        updated_at: "2026-03-06T10:01:00.000Z",
        linked_from_version_id: null,
        linked_from_version_number: null,
        is_linked: false,
      },
    ]);
  });

  it("parses DPGF comparison query including the server view", () => {
    const query = parseTakeoffDpgfComparisonQuery({
      version_id: VERSION_ID,
      cursor: "opaque",
      page_size: "25",
      threshold: "0.8",
      view: "exceptions_only",
    });

    expect(query).toEqual({
      version_id: VERSION_ID,
      cursor: "opaque",
      page_size: 25,
      threshold: 0.8,
      view: "exceptions_only",
    });
  });

  it("builds the DPGF comparison payload with proofs and explicit view", async () => {
    const mock = createSupabaseMock();
    mock.state.links = [
      {
        id: "88888888-8888-4888-8888-888888888888",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        takeoff_job_id: JOB_ID,
        estimate_item_id: ESTIMATE_ITEM_ID,
        takeoff_item_id: TAKEOFF_ITEM_ID,
        created_at: "2026-03-06T10:10:00.000Z",
        updated_at: "2026-03-06T10:10:00.000Z",
        linked_by: USER_ID,
      },
    ];
    mock.state.reviewDecisions = [
      {
        id: "99999999-9999-4999-8999-999999999999",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        takeoff_job_id: JOB_ID,
        estimate_item_id: ESTIMATE_ITEM_ID,
        review_reference: "dpgf xlsx row 12",
        line_label: "Faux plafond acoustique",
        line_position: 1,
        source_file_name: "dpgf.xlsx",
        source_page: 12,
        carried_over_from_version_id: null,
        carried_over_at: null,
        decision: "manual_fix",
        reason: "Verifier la reserve au plafond.",
        decided_at: "2026-03-06T10:10:00.000Z",
        updated_at: "2026-03-06T10:10:00.000Z",
        decided_by: USER_ID,
      },
    ];

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);

    const response = await fetchDpgfTakeoffComparison(
      JOB_ID,
      parseTakeoffDpgfComparisonQuery({
        version_id: VERSION_ID,
        view: "all",
      })
    );

    expect(response.view).toBe("all");
    expect(response.summary).toMatchObject({
      forced_manual: 1,
      total_lines: 1,
      unused_takeoff_items: 1,
    });
    expect(response.manual_link_candidates).toHaveLength(2);
    expect(response.rows[0]).toMatchObject({
      line_id: ESTIMATE_ITEM_ID,
      matched_by: "manual",
      manual_link_count: 1,
      applied_decision: expect.objectContaining({
        decision: "manual_fix",
        source: "current_version",
      }),
    });
    expect(response.rows[0]?.proofs.some((proof) => proof.kind === "fact")).toBe(true);
    expect(mock.state.evidences.some((evidence) => evidence.evidence_type === "takeoff")).toBe(true);
    expect(
      mock.state.estimateItemSelects.some((columns) => /(^|,\s*)unit(\s*,|$)/.test(columns))
    ).toBe(false);
  });

  it("reuses carried decisions by review reference when the job is linked from a source version", async () => {
    const mock = createSupabaseMock();
    mock.state.reviewDecisions = [
      {
        id: "99999999-9999-4999-8999-999999999999",
        tenant_id: TENANT_ID,
        version_id: SOURCE_VERSION_ID,
        takeoff_job_id: JOB_ID,
        estimate_item_id: ESTIMATE_ITEM_ID,
        review_reference: "dpgf xlsx row 12",
        line_label: "Faux plafond acoustique",
        line_position: 1,
        source_file_name: "dpgf.xlsx",
        source_page: 12,
        carried_over_from_version_id: null,
        carried_over_at: null,
        decision: "keep_dpgf",
        reason: "Decision issue de la version precedente.",
        decided_at: "2026-03-06T10:10:00.000Z",
        updated_at: "2026-03-06T10:10:00.000Z",
        decided_by: USER_ID,
      },
    ];

    vi.mocked(listAccessibleTakeoffJobsForVersion).mockResolvedValue([
      {
        id: JOB_ID,
        estimate_version_id: VERSION_ID,
        status: "completed",
        level: "A",
        source_file_name: "plans.pdf",
        source_file_type: "application/pdf",
        source_file_size_bytes: 1200,
        created_at: "2026-03-06T09:59:00.000Z",
        updated_at: "2026-03-06T10:01:00.000Z",
        linked_from_version_id: SOURCE_VERSION_ID,
        linked_from_version_number: 2,
        is_linked: true,
      },
    ]);
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);

    const response = await fetchDpgfTakeoffComparison(
      JOB_ID,
      parseTakeoffDpgfComparisonQuery({
        version_id: VERSION_ID,
        view: "exceptions_only",
      })
    );

    expect(response.view).toBe("exceptions_only");
    expect(response.rows[0]?.applied_decision).toMatchObject({
      decision: "keep_dpgf",
      source: "carried_over",
      carried_over_from_version_id: SOURCE_VERSION_ID,
      carried_over_from_version_number: 2,
    });
  });

  it("includes carried review decisions in the hub summary for linked versions", async () => {
    const mock = createSupabaseMock();
    mock.state.reviewDecisions = [
      {
        id: "99999999-9999-4999-8999-999999999999",
        tenant_id: TENANT_ID,
        version_id: SOURCE_VERSION_ID,
        takeoff_job_id: JOB_ID,
        estimate_item_id: ESTIMATE_ITEM_ID,
        review_reference: "dpgf xlsx row 12",
        line_label: "Faux plafond acoustique",
        line_position: 1,
        source_file_name: "dpgf.xlsx",
        source_page: 12,
        carried_over_from_version_id: null,
        carried_over_at: null,
        decision: "keep_dpgf",
        reason: "Decision issue de la version precedente.",
        decided_at: "2026-03-06T10:10:00.000Z",
        updated_at: "2026-03-06T10:10:00.000Z",
        decided_by: USER_ID,
      },
    ];

    vi.mocked(listAccessibleTakeoffJobsForVersion).mockResolvedValue([
      {
        id: JOB_ID,
        estimate_version_id: VERSION_ID,
        status: "completed",
        level: "A",
        source_file_name: "plans.pdf",
        source_file_type: "application/pdf",
        source_file_size_bytes: 1200,
        created_at: "2026-03-06T09:59:00.000Z",
        updated_at: "2026-03-06T10:01:00.000Z",
        linked_from_version_id: SOURCE_VERSION_ID,
        linked_from_version_number: 2,
        is_linked: true,
      },
    ]);

    const summary = await fetchTakeoffDpgfSummaryForHub({
      supabase: mock.supabase as never,
      tenantId: TENANT_ID,
      jobId: JOB_ID,
      versionId: VERSION_ID,
      projectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });

    expect(summary).toMatchObject({
      forced_manual: 1,
      total_lines: 1,
      unused_takeoff_items: 1,
    });
  });

  it("recomputes lines_without_proof from hydrated persisted evidence", async () => {
    const mock = createSupabaseMock();
    mock.state.takeoffItems = [];
    mock.state.estimateItems = [
      {
        ...mock.state.estimateItems[0]!,
        selected_supplier_price_id: "abababab-abab-4bab-8bab-abababababab",
      },
    ];
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);

    const response = await fetchDpgfTakeoffComparison(
      JOB_ID,
      parseTakeoffDpgfComparisonQuery({
        version_id: VERSION_ID,
        view: "all",
      })
    );

    expect(response.rows[0]?.proofs.some((proof) => proof.type === "price_source")).toBe(true);
    expect(response.summary.lines_without_proof).toBe(0);
  });

  it("replaces the manual links for a DPGF line via the multi-link RPC", async () => {
    const mock = createSupabaseMock();
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);

    const response = await saveTakeoffDpgfManualLink(JOB_ID, {
      version_id: VERSION_ID,
      estimate_item_id: ESTIMATE_ITEM_ID,
      takeoff_item_ids: [TAKEOFF_ITEM_ID, TAKEOFF_ITEM_ID_2],
    });

    expect(mock.rpcMock).toHaveBeenCalledWith("save_takeoff_dpgf_manual_links", {
      p_version_id: VERSION_ID,
      p_takeoff_job_id: JOB_ID,
      p_estimate_item_id: ESTIMATE_ITEM_ID,
      p_takeoff_item_ids: [TAKEOFF_ITEM_ID, TAKEOFF_ITEM_ID_2],
      p_linked_by: USER_ID,
    });
    expect(response.links).toHaveLength(2);
    expect(response.links.map((link) => link.takeoff_item_id)).toEqual([
      TAKEOFF_ITEM_ID,
      TAKEOFF_ITEM_ID_2,
    ]);
    expect(
      mock.state.evidences.some(
        (evidence) =>
          evidence.estimate_item_id === ESTIMATE_ITEM_ID &&
          evidence.evidence_type === "takeoff" &&
          evidence.invalidated_at === null
      )
    ).toBe(true);
  });

  it("persists an explicit human review decision while keeping carried-over provenance", async () => {
    const mock = createSupabaseMock();
    mock.state.reviewDecisions = [
      {
        id: "99999999-9999-4999-8999-999999999999",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        takeoff_job_id: JOB_ID,
        estimate_item_id: ESTIMATE_ITEM_ID,
        review_reference: "dpgf xlsx row 12",
        line_label: "Faux plafond acoustique",
        line_position: 1,
        source_file_name: "dpgf.xlsx",
        source_page: 12,
        carried_over_from_version_id: SOURCE_VERSION_ID,
        carried_over_at: "2026-03-06T09:55:00.000Z",
        decision: "keep_dpgf",
        reason: "Origine source.",
        decided_at: "2026-03-06T10:10:00.000Z",
        updated_at: "2026-03-06T10:10:00.000Z",
        decided_by: USER_ID,
      },
    ];
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);

    const response = await saveTakeoffReviewDecision(JOB_ID, {
      version_id: VERSION_ID,
      estimate_item_id: ESTIMATE_ITEM_ID,
      decision: "manual_fix",
      reason: "Mesure terrain a reprendre.",
    });

    expect(response.decision).toMatchObject({
      decision: "manual_fix",
      reason: "Mesure terrain a reprendre.",
      source: "carried_over",
      carried_over_from_version_id: SOURCE_VERSION_ID,
      carried_over_from_version_number: 2,
    });
    expect(mock.state.reviewDecisions[0]?.decision).toBe("manual_fix");
    expect(
      mock.state.evidences.some(
        (evidence) =>
          evidence.evidence_type === "comment" &&
          evidence.evidence_kind === "hypothesis" &&
          evidence.invalidated_at === null
      )
    ).toBe(true);
  });

  it("returns active evidences and history in the dedicated panel payload", async () => {
    const mock = createSupabaseMock();
    mock.state.links = [
      {
        id: "88888888-8888-4888-8888-888888888888",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        takeoff_job_id: JOB_ID,
        estimate_item_id: ESTIMATE_ITEM_ID,
        takeoff_item_id: TAKEOFF_ITEM_ID,
        created_at: "2026-03-06T10:10:00.000Z",
        updated_at: "2026-03-06T10:10:00.000Z",
        linked_by: USER_ID,
      },
    ];
    mock.state.evidences = [
      {
        id: "99999999-9999-4999-8999-999999999999",
        created_at: "2026-03-06T09:55:00.000Z",
        tenant_id: TENANT_ID,
        project_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        version_id: VERSION_ID,
        takeoff_job_id: JOB_ID,
        estimate_item_id: ESTIMATE_ITEM_ID,
        fingerprint: "old-comment",
        evidence_type: "comment",
        evidence_kind: "hypothesis",
        label: "Hypothese manuelle",
        source_label: "Decision de revue humaine",
        source_file_name: null,
        source_page: null,
        confidence_score: null,
        note: "Ancienne hypothese.",
        source_record_table: "takeoff_dpgf_review_decisions",
        source_record_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        payload: {},
        author_user_id: USER_ID,
        invalidated_at: "2026-03-06T10:05:00.000Z",
        invalidated_by: USER_ID,
        invalidation_reason: "snapshot_replaced",
        supersedes_evidence_id: null,
      },
    ];
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);

    const panel = await fetchTakeoffLineEvidencePanel(JOB_ID, {
      version_id: VERSION_ID,
      line_id: ESTIMATE_ITEM_ID,
    });

    expect(panel.line_id).toBe(ESTIMATE_ITEM_ID);
    expect(panel.evidences.some((evidence) => evidence.type === "takeoff")).toBe(true);
    expect(panel.history[0]).toMatchObject({
      evidence_id: "99999999-9999-4999-8999-999999999999",
      author_name: "Nadia Review",
      status: "invalidated",
    });
  });

  it("returns NOT_FOUND when the requested line is absent from the target version", async () => {
    const mock = createSupabaseMock();
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);

    await expect(
      fetchTakeoffLineEvidencePanel(JOB_ID, {
        version_id: VERSION_ID,
        line_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      })
    ).rejects.toMatchObject({
      code: TakeoffErrorCode.NOT_FOUND,
      status: 404,
    });
  });

  it("preserves supersession links when evidence snapshots are replaced", async () => {
    const mock = createSupabaseMock();
    mock.state.reviewDecisions = [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        takeoff_job_id: JOB_ID,
        estimate_item_id: ESTIMATE_ITEM_ID,
        review_reference: "dpgf xlsx row 12",
        line_label: "Faux plafond acoustique",
        line_position: 1,
        source_file_name: "dpgf.xlsx",
        source_page: 12,
        carried_over_from_version_id: null,
        carried_over_at: null,
        decision: "manual_fix",
        reason: "Hypothese mise a jour.",
        decided_at: "2026-03-06T10:10:00.000Z",
        updated_at: "2026-03-06T10:10:00.000Z",
        decided_by: USER_ID,
      },
    ];
    mock.state.evidences = [
      {
        id: "99999999-9999-4999-8999-999999999999",
        created_at: "2026-03-06T09:55:00.000Z",
        tenant_id: TENANT_ID,
        project_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        version_id: VERSION_ID,
        takeoff_job_id: JOB_ID,
        estimate_item_id: ESTIMATE_ITEM_ID,
        fingerprint: "stale-comment",
        evidence_type: "comment",
        evidence_kind: "hypothesis",
        label: "Hypothese manuelle",
        source_label: "Decision de revue humaine",
        source_file_name: null,
        source_page: null,
        confidence_score: null,
        note: "Ancienne hypothese.",
        source_record_table: "takeoff_dpgf_review_decisions",
        source_record_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        payload: {},
        author_user_id: USER_ID,
        invalidated_at: null,
        invalidated_by: null,
        invalidation_reason: null,
        supersedes_evidence_id: null,
      },
    ];
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);

    const panel = await fetchTakeoffLineEvidencePanel(JOB_ID, {
      version_id: VERSION_ID,
      line_id: ESTIMATE_ITEM_ID,
    });

    const activeComment = panel.evidences.find((evidence) => evidence.type === "comment");
    expect(activeComment).toMatchObject({
      note: "Hypothese mise a jour.",
      supersedes_evidence_id: "99999999-9999-4999-8999-999999999999",
    });
    expect(panel.history).toContainEqual(
      expect.objectContaining({
        evidence_id: "99999999-9999-4999-8999-999999999999",
        status: "replaced",
        replaced_by_evidence_id: activeComment?.evidence_id ?? null,
      })
    );
  });

  it("inherits carry-over provenance from the linked source decision on first save", async () => {
    const mock = createSupabaseMock();
    mock.state.reviewDecisions = [
      {
        id: "99999999-9999-4999-8999-999999999999",
        tenant_id: TENANT_ID,
        version_id: SOURCE_VERSION_ID,
        takeoff_job_id: JOB_ID,
        estimate_item_id: ESTIMATE_ITEM_ID,
        review_reference: buildTakeoffDpgfReviewReference({
          sourceFileName: "dpgf.xlsx",
          sourcePage: 12,
          position: 1,
          title: "Faux plafond acoustique",
          unit: "m2",
        }),
        line_label: "Faux plafond acoustique",
        line_position: 1,
        source_file_name: "dpgf.xlsx",
        source_page: 12,
        carried_over_from_version_id: null,
        carried_over_at: null,
        decision: "keep_dpgf",
        reason: "Decision issue de la version precedente.",
        decided_at: "2026-03-06T10:10:00.000Z",
        updated_at: "2026-03-06T10:10:00.000Z",
        decided_by: USER_ID,
      },
    ];

    vi.mocked(listAccessibleTakeoffJobsForVersion).mockResolvedValue([
      {
        id: JOB_ID,
        estimate_version_id: VERSION_ID,
        status: "completed",
        level: "A",
        source_file_name: "plans.pdf",
        source_file_type: "application/pdf",
        source_file_size_bytes: 1200,
        created_at: "2026-03-06T09:59:00.000Z",
        updated_at: "2026-03-06T10:01:00.000Z",
        linked_from_version_id: SOURCE_VERSION_ID,
        linked_from_version_number: 2,
        is_linked: true,
      },
    ]);
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);

    const response = await saveTakeoffReviewDecision(JOB_ID, {
      version_id: VERSION_ID,
      estimate_item_id: ESTIMATE_ITEM_ID,
      decision: "keep_takeoff",
      reason: "Application explicite sur la version courante.",
    });

    expect(response.decision).toMatchObject({
      decision: "keep_takeoff",
      source: "carried_over",
      carried_over_from_version_id: SOURCE_VERSION_ID,
      carried_over_from_version_number: 2,
    });
    expect(
      mock.state.reviewDecisions.find((decision) => decision.version_id === VERSION_ID)
    ).toMatchObject({
      carried_over_from_version_id: SOURCE_VERSION_ID,
    });
  });

  it("builds review carry-over references from the resolved DPGF unit", async () => {
    const mock = createSupabaseMock();
    mock.state.estimateItems = [
      {
        ...mock.state.estimateItems[0]!,
        source_file_name: null,
        description: "Description divergente",
      },
    ];
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);

    await saveTakeoffReviewDecision(JOB_ID, {
      version_id: VERSION_ID,
      estimate_item_id: ESTIMATE_ITEM_ID,
      decision: "keep_takeoff",
    });

    expect(mock.state.reviewDecisions[0]?.review_reference).toBe(
      buildTakeoffDpgfReviewReference({
        sourceFileName: null,
        sourcePage: 12,
        position: 1,
        title: "Faux plafond acoustique",
        unit: "m2",
      })
    );
  });
});
