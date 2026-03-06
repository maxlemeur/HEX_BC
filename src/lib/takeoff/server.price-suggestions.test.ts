import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  assertDraftStatus: vi.fn(),
  bulkUpdateEstimateItems: vi.fn(),
  getAuthenticatedContext: vi.fn(),
  insertAssemblyIntoVersion: vi.fn(),
  suggestEstimateCataloguePrices: vi.fn(),
  updateEstimateItem: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
  getTakeoffLowConfidenceThresholdForTenant: vi.fn(),
}));

vi.mock("@/lib/takeoff/version-links", () => ({
  listAccessibleTakeoffJobsForVersion: vi.fn(),
}));

import {
  getAuthenticatedContext,
  suggestEstimateCataloguePrices,
  updateEstimateItem,
} from "@/lib/estimates/server";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import {
  getTakeoffPriceSuggestion,
  requestTakeoffPriceSuggestion,
  reviewTakeoffPriceSuggestion,
} from "@/lib/takeoff/server";
import { listAccessibleTakeoffJobsForVersion } from "@/lib/takeoff/version-links";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "44444444-4444-4444-8444-444444444444";
const LINE_ID = "55555555-5555-4555-8555-555555555555";
const PROJECT_ID = "66666666-6666-4666-8666-666666666666";
const HISTORY_LINE_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_VERSION_ID = "88888888-8888-4888-8888-888888888888";

type EstimateItemRow = {
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
  unit: string | null;
  category_id: string | null;
  unit_price_ht_cents: number | null;
  updated_at: string;
};

type SuggestionRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  project_id: string;
  version_id: string;
  takeoff_job_id: string;
  estimate_item_id: string;
  requested_by: string | null;
  reviewed_by: string | null;
  snapshot_fingerprint: string;
  status: string;
  current_price_cents: number | null;
  low_cents: number;
  target_cents: number;
  high_cents: number;
  confidence_score: number | null;
  confidence_label: string;
  candidate_count: number;
  outlier_count: number;
  justification: string;
  factors_json: unknown;
  summary_json: unknown;
  selected_action: string | null;
  selected_price_cents: number | null;
  review_note: string | null;
  reviewed_at: string | null;
  superseded_at: string | null;
  superseded_by_suggestion_id: string | null;
};

type SuggestionSourceRow = {
  id: string;
  created_at: string;
  tenant_id: string;
  project_id: string;
  version_id: string;
  takeoff_job_id: string;
  estimate_item_id: string;
  suggestion_id: string;
  source_kind: string;
  kind: string;
  label: string;
  source_ref: string;
  price_cents: number;
  freshness_label: string | null;
  confidence_score: number | null;
  rank: number;
  is_outlier: boolean;
  source_record_table: string | null;
  source_record_id: string | null;
  metadata_json: Record<string, unknown>;
};

function buildThenableSelectBuilder<T>(getRows: () => T[]) {
  const filters: Record<string, string> = {};
  const inFilters: Record<string, string[]> = {};
  const nullFilters = new Map<string, unknown>();
  let limitValue: number | null = null;

  const builder = {
    eq: vi.fn((column: unknown, value: unknown) => {
      filters[String(column)] = String(value);
      return builder;
    }),
    in: vi.fn((column: unknown, values: unknown) => {
      inFilters[String(column)] = Array.isArray(values)
        ? values.map((value) => String(value))
        : [];
      return builder;
    }),
    is: vi.fn((column: unknown, value: unknown) => {
      nullFilters.set(String(column), value);
      return builder;
    }),
    order: vi.fn(() => builder),
    limit: vi.fn((value: number) => {
      limitValue = value;
      return builder;
    }),
    maybeSingle: vi.fn(async () => {
      let rows = getRows().filter((row) => {
        const record = row as Record<string, unknown>;
        for (const [column, value] of Object.entries(filters)) {
          if (String(record[column]) !== value) {
            return false;
          }
        }
        for (const [column, values] of Object.entries(inFilters)) {
          if (!values.includes(String(record[column]))) {
            return false;
          }
        }
        for (const [column, value] of nullFilters.entries()) {
          if (value === null && record[column] !== null) {
            return false;
          }
        }
        return true;
      });

      if (typeof limitValue === "number") {
        rows = rows.slice(0, limitValue);
      }

      return {
        data: rows[0] ?? null,
        error: null,
      };
    }),
    then: (
      resolve: (value: { data: T[]; error: null; count?: number | null }) => unknown
    ) => {
      let rows = getRows().filter((row) => {
        const record = row as Record<string, unknown>;
        for (const [column, value] of Object.entries(filters)) {
          if (String(record[column]) !== value) {
            return false;
          }
        }
        for (const [column, values] of Object.entries(inFilters)) {
          if (!values.includes(String(record[column]))) {
            return false;
          }
        }
        for (const [column, value] of nullFilters.entries()) {
          if (value === null && record[column] !== null) {
            return false;
          }
        }
        return true;
      });

      if (typeof limitValue === "number") {
        rows = rows.slice(0, limitValue);
      }

      return Promise.resolve(resolve({ data: rows, error: null, count: rows.length }));
    },
  };

  return builder;
}

function createSupabaseMock() {
  const state: {
    estimateItems: EstimateItemRow[];
    suggestions: SuggestionRow[];
    suggestionSources: SuggestionSourceRow[];
  } = {
    estimateItems: [
      {
        id: LINE_ID,
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        position: 1,
        title: "Faux plafond acoustique",
        description: "Zone reservee",
        quantity: 100,
        selected_supplier_price_id: null,
        source_file_name: "dpgf.xlsx",
        source_page: 12,
        source_provider: "dpgf",
        item_type: "line",
        unit: "m2",
        category_id: "99999999-9999-4999-8999-999999999999",
        unit_price_ht_cents: 1200,
        updated_at: "2026-03-06T10:00:00.000Z",
      },
      {
        id: HISTORY_LINE_ID,
        tenant_id: TENANT_ID,
        version_id: OTHER_VERSION_ID,
        position: 2,
        title: "Faux plafond acoustique",
        description: "Historique chantier similaire",
        quantity: 95,
        selected_supplier_price_id: null,
        source_file_name: null,
        source_page: null,
        source_provider: "manual",
        item_type: "line",
        unit: "m2",
        category_id: "99999999-9999-4999-8999-999999999999",
        unit_price_ht_cents: 1230,
        updated_at: "2026-02-10T10:00:00.000Z",
      },
    ],
    suggestions: [],
    suggestionSources: [],
  };

  let suggestionSequence = 0;
  let sourceSequence = 0;

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "estimate_items") {
        return {
          select: vi.fn(() =>
            buildThenableSelectBuilder(() =>
              state.estimateItems.slice().sort((left, right) => {
                return right.updated_at.localeCompare(left.updated_at);
              })
            )
          ),
        };
      }

      if (table === "estimate_versions") {
        return {
          select: vi.fn(() =>
            buildThenableSelectBuilder(() => [
              {
                id: VERSION_ID,
                project_id: PROJECT_ID,
                version_number: 3,
                tenant_id: TENANT_ID,
              },
              {
                id: OTHER_VERSION_ID,
                project_id: PROJECT_ID,
                version_number: 2,
                tenant_id: TENANT_ID,
              },
            ])
          ),
        };
      }

      if (table === "takeoff_price_suggestions") {
        return {
          select: vi.fn(() =>
            buildThenableSelectBuilder(() => state.suggestions.slice())
          ),
          insert: vi.fn((payload: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => {
                suggestionSequence += 1;
                const now = `2026-03-06T10:0${suggestionSequence}:00.000Z`;
                const row: SuggestionRow = {
                  id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${suggestionSequence}`,
                  created_at: now,
                  updated_at: now,
                  tenant_id: String(payload.tenant_id),
                  project_id: String(payload.project_id),
                  version_id: String(payload.version_id),
                  takeoff_job_id: String(payload.takeoff_job_id),
                  estimate_item_id: String(payload.estimate_item_id),
                  requested_by:
                    typeof payload.requested_by === "string"
                      ? payload.requested_by
                      : null,
                  reviewed_by: null,
                  snapshot_fingerprint: String(payload.snapshot_fingerprint),
                  status: String(payload.status),
                  current_price_cents:
                    typeof payload.current_price_cents === "number"
                      ? payload.current_price_cents
                      : null,
                  low_cents: Number(payload.low_cents),
                  target_cents: Number(payload.target_cents),
                  high_cents: Number(payload.high_cents),
                  confidence_score:
                    typeof payload.confidence_score === "number"
                      ? payload.confidence_score
                      : null,
                  confidence_label: String(payload.confidence_label),
                  candidate_count: Number(payload.candidate_count),
                  outlier_count: Number(payload.outlier_count),
                  justification: String(payload.justification),
                  factors_json: payload.factors_json ?? [],
                  summary_json: payload.summary_json ?? {},
                  selected_action: null,
                  selected_price_cents: null,
                  review_note: null,
                  reviewed_at: null,
                  superseded_at: null,
                  superseded_by_suggestion_id: null,
                };
                state.suggestions.push(row);

                return {
                  data: row,
                  error: null,
                };
              }),
            })),
          })),
          update: vi.fn((payload: Record<string, unknown>) => {
            const filters: Record<string, string> = {};
            const builder = {
              eq: vi.fn((column: unknown, value: unknown) => {
                filters[String(column)] = String(value);
                return builder;
              }),
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  const row = state.suggestions.find((entry) => {
                    return Object.entries(filters).every(([column, value]) => {
                      return String((entry as Record<string, unknown>)[column]) === value;
                    });
                  });
                  if (!row) {
                    return {
                      data: null,
                      error: null,
                    };
                  }

                  Object.assign(row, payload, {
                    updated_at: "2026-03-06T10:05:00.000Z",
                  });

                  return {
                    data: row,
                    error: null,
                  };
                }),
              })),
              then: (
                resolve: (value: { data: SuggestionRow[]; error: null }) => unknown
              ) => {
                state.suggestions = state.suggestions.map((entry) => {
                  const matches = Object.entries(filters).every(([column, value]) => {
                    return String((entry as Record<string, unknown>)[column]) === value;
                  });
                  if (!matches) return entry;
                  return {
                    ...entry,
                    ...payload,
                    updated_at: "2026-03-06T10:04:00.000Z",
                  };
                });
                return Promise.resolve(resolve({ data: state.suggestions, error: null }));
              },
            };

            return builder;
          }),
        };
      }

      if (table === "takeoff_price_suggestion_sources") {
        return {
          select: vi.fn(() =>
            buildThenableSelectBuilder(() =>
              state.suggestionSources.slice().sort((left, right) => left.rank - right.rank)
            )
          ),
          insert: vi.fn(async (payload: Array<Record<string, unknown>>) => {
            state.suggestionSources.push(
              ...payload.map((entry) => {
                sourceSequence += 1;
                const parentSuggestion = state.suggestions.find(
                  (suggestion) => suggestion.id === entry.suggestion_id
                );

                return {
                  id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${sourceSequence}`,
                  created_at: `2026-03-06T10:0${sourceSequence}:30.000Z`,
                  tenant_id: parentSuggestion?.tenant_id ?? TENANT_ID,
                  project_id: parentSuggestion?.project_id ?? PROJECT_ID,
                  version_id: parentSuggestion?.version_id ?? VERSION_ID,
                  takeoff_job_id: parentSuggestion?.takeoff_job_id ?? JOB_ID,
                  estimate_item_id: parentSuggestion?.estimate_item_id ?? LINE_ID,
                  suggestion_id: String(entry.suggestion_id),
                  source_kind: String(entry.source_kind),
                  kind: String(entry.kind),
                  label: String(entry.label),
                  source_ref: String(entry.source_ref),
                  price_cents: Number(entry.price_cents),
                  freshness_label:
                    typeof entry.freshness_label === "string"
                      ? entry.freshness_label
                      : null,
                  confidence_score:
                    typeof entry.confidence_score === "number"
                      ? entry.confidence_score
                      : null,
                  rank: Number(entry.rank),
                  is_outlier: Boolean(entry.is_outlier),
                  source_record_table:
                    typeof entry.source_record_table === "string"
                      ? entry.source_record_table
                      : null,
                  source_record_id:
                    typeof entry.source_record_id === "string"
                      ? entry.source_record_id
                      : null,
                  metadata_json:
                    entry.metadata_json &&
                    typeof entry.metadata_json === "object" &&
                    !Array.isArray(entry.metadata_json)
                      ? (entry.metadata_json as Record<string, unknown>)
                      : {},
                } satisfies SuggestionSourceRow;
              })
            );

            return { error: null };
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    state,
    supabase: supabase as never,
  };
}

describe("takeoff price suggestion server helpers", () => {
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
        linked_from_version_id: OTHER_VERSION_ID,
        linked_from_version_number: 2,
        is_linked: true,
      },
    ]);
    vi.mocked(suggestEstimateCataloguePrices).mockResolvedValue({
      query: "Faux plafond acoustique Zone reservee",
      stale_price_days: 90,
      suggestions: [
        {
          supplier_price_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          product_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          product_designation: "Faux plafond acoustique",
          product_reference: "FP-01",
          supplier_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          supplier_name: "Fournisseur A",
          supplier_reference: "SKU-PLAFOND",
          unit: "m2",
          unit_price_cents: 1180,
          adjusted_unit_price_cents: 1180,
          currency: "EUR",
          updated_at: "2026-02-20T10:00:00.000Z",
          is_stale: false,
          stale_days: 90,
          relevance_score: 0.82,
          has_material_index_adjustment: false,
          material_index_code: null,
          material_index_value: null,
          catalogue_url: null,
          alternatives: [],
        },
      ],
    } as never);
  });

  it("creates and then reuses the same active snapshot when the fingerprint is unchanged", async () => {
    const mock = createSupabaseMock();
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);

    const first = await requestTakeoffPriceSuggestion(JOB_ID, {
      version_id: VERSION_ID,
      estimate_item_id: LINE_ID,
    });
    const second = await requestTakeoffPriceSuggestion(JOB_ID, {
      version_id: VERSION_ID,
      estimate_item_id: LINE_ID,
    });

    expect(first.suggestion.line_id).toBe(LINE_ID);
    expect(first.suggestion.sources.length).toBeGreaterThan(0);
    expect(second.suggestion.suggestion_id).toBe(first.suggestion.suggestion_id);
    expect(mock.state.suggestions).toHaveLength(1);
  });

  it("returns the active snapshot with persisted sources", async () => {
    const mock = createSupabaseMock();
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);

    await requestTakeoffPriceSuggestion(JOB_ID, {
      version_id: VERSION_ID,
      estimate_item_id: LINE_ID,
    });

    const response = await getTakeoffPriceSuggestion(JOB_ID, {
      version_id: VERSION_ID,
      estimate_item_id: LINE_ID,
    });

    expect(response.suggestion.suggestion_id).toBe(mock.state.suggestions[0]?.id);
    expect(response.suggestion.sources.map((source) => source.source_kind)).toEqual(
      expect.arrayContaining(["pricebook", "history"])
    );
  });

  it("requires an explicit review note and applies the selected bound through estimate update", async () => {
    const mock = createSupabaseMock();
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);
    vi.mocked(updateEstimateItem).mockResolvedValue({
      item: {
        id: LINE_ID,
        unit_price_ht_cents: 1230,
        updated_at: "2026-03-06T10:05:00.000Z",
      },
    } as never);

    const created = await requestTakeoffPriceSuggestion(JOB_ID, {
      version_id: VERSION_ID,
      estimate_item_id: LINE_ID,
    });
    const reviewed = await reviewTakeoffPriceSuggestion(
      JOB_ID,
      created.suggestion.suggestion_id,
      {
        version_id: VERSION_ID,
        action: "apply_target",
        review_note: "Validation humaine explicite de la borne centrale.",
      }
    );

    expect(updateEstimateItem).toHaveBeenCalledWith(VERSION_ID, {
      id: LINE_ID,
      unit_price_ht_cents: created.suggestion.target_cents,
    });
    expect(reviewed.suggestion.status).toBe("applied");
    expect(reviewed.suggestion.selected_action).toBe("apply_target");
    expect(reviewed.suggestion.review_note).toBe(
      "Validation humaine explicite de la borne centrale."
    );
    expect(reviewed.applied_item?.unit_price_ht_cents).toBe(1230);
  });
});
