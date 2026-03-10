import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/estimates/server", () => ({
  getEstimateVersionDetails: vi.fn(),
}));

vi.mock("@/lib/takeoff/gemini-client", () => ({
  callGeminiStructured: vi.fn(),
}));

import { getEstimateDeltaExplanation, getEstimateLineExplanation } from "@/lib/estimates/explanations";
import { getEstimateVersionDetails } from "@/lib/estimates/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callGeminiStructured } from "@/lib/takeoff/gemini-client";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const LINE_ID = "22222222-2222-4222-8222-222222222222";
const COMPARE_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";
const PROJECT_ID = "66666666-6666-4666-8666-666666666666";
const ACTIVE_EXPLANATION_ID = "77777777-7777-4777-8777-777777777777";
const ACTIVE_SOURCE_ID = "88888888-8888-4888-8888-888888888888";

function buildVersionDetails(overrides?: Partial<Awaited<ReturnType<typeof getEstimateVersionDetails>>>) {
  const base = {
    version: {
      id: VERSION_ID,
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_number: 2,
      title: "Variante",
      margin_bp: 1200,
      margin_multiplier: 1.12,
      total_ht_cents: 9000,
      total_tax_cents: 1800,
      total_ttc_cents: 10800,
      estimate_projects: {
        id: PROJECT_ID,
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        name: "Projet Alpha",
        reference: "ALPHA",
        client_name: "Client",
        notes: null,
        is_archived: false,
      },
    },
    items: [
      {
        id: LINE_ID,
        item_type: "line",
        title: "Mur beton",
        pu_ht_cents: 4500,
        line_total_ht_cents: 9000,
        line_total_ttc_cents: 10800,
        source_job_id: null,
        source_file_name: "plans.pdf",
        source_page: 3,
        source_provider: "takeoff_gemini",
        source_metadata: null,
      },
    ],
    categories: [],
    supply_types: [],
    labor_roles: [],
    suggestion_rules: [],
    margin_tiers: [],
  };

  const result = {
    ...base,
    ...overrides,
    version: {
      ...base.version,
      ...overrides?.version,
    },
    items: overrides?.items ?? base.items,
  };

  const hasExplicitTotals =
    overrides?.version !== undefined &&
    ("total_ht_cents" in overrides.version ||
      "total_tax_cents" in overrides.version ||
      "total_ttc_cents" in overrides.version);

  if (!hasExplicitTotals) {
    const totals = result.items.reduce(
      (accumulator, item) => {
        if (item.item_type !== "line") {
          return accumulator;
        }

        return {
          totalHtCents:
            accumulator.totalHtCents + (item.line_total_ht_cents ?? 0),
          totalTtcCents:
            accumulator.totalTtcCents + (item.line_total_ttc_cents ?? 0),
        };
      },
      {
        totalHtCents: 0,
        totalTtcCents: 0,
      }
    );

    result.version.total_ht_cents = totals.totalHtCents;
    result.version.total_ttc_cents = totals.totalTtcCents;
    result.version.total_tax_cents = totals.totalTtcCents - totals.totalHtCents;
  }

  return result as Awaited<ReturnType<typeof getEstimateVersionDetails>>;
}

function createSupabaseMock(options?: {
  activeExplanationRows?: Array<Record<string, unknown> | null>;
  insertSingleResponses?: Array<{ data: Record<string, unknown> | null; error: unknown }>;
  sourceRowsByExplanationId?: Record<string, Array<Record<string, unknown>>>;
}) {
  let lastInsertedFingerprint: string | null = null;
  const sourceRowsByExplanationId = {
    ...(options?.sourceRowsByExplanationId ?? {}),
  };
  const activeExplanationQuery = {
    eq: vi.fn(),
    is: vi.fn(),
    maybeSingle: vi.fn(),
  };
  activeExplanationQuery.eq.mockReturnValue(activeExplanationQuery);
  activeExplanationQuery.is.mockReturnValue(activeExplanationQuery);
  const activeExplanationRows = [...(options?.activeExplanationRows ?? [null])];
  activeExplanationQuery.maybeSingle.mockImplementation(async () => {
    const nextRow =
      activeExplanationRows.length > 1
        ? activeExplanationRows.shift() ?? null
        : activeExplanationRows[0] ?? null;

    if (!nextRow) {
      return {
        data: null,
        error: null,
      };
    }

    return {
      data:
        nextRow.snapshot_fingerprint === "__LAST_INSERTED_FINGERPRINT__"
          ? {
              ...nextRow,
              snapshot_fingerprint: lastInsertedFingerprint,
            }
          : nextRow,
      error: null,
    };
  });

  const sourceSelectQuery = {
    eq: vi.fn(),
    order: vi.fn(),
  };
  sourceSelectQuery.eq.mockReturnValue(sourceSelectQuery);
  sourceSelectQuery.order.mockImplementation(async () => {
    const explanationIdCall =
      sourceSelectQuery.eq.mock.calls
        .slice()
        .reverse()
        .find(([column]) => column === "explanation_id") ?? null;
    const explanationId =
      explanationIdCall && typeof explanationIdCall[1] === "string"
        ? explanationIdCall[1]
        : ACTIVE_EXPLANATION_ID;

    return {
      data: sourceRowsByExplanationId[explanationId] ?? [],
      error: null,
    };
  });

  const explanationTable = {
    select: vi.fn(() => activeExplanationQuery),
    insert: vi.fn((payload: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockImplementation(async () => {
          lastInsertedFingerprint =
            typeof payload.snapshot_fingerprint === "string"
              ? payload.snapshot_fingerprint
              : null;
          const nextResponse = options?.insertSingleResponses?.length
            ? options.insertSingleResponses.shift()
            : null;
          if (nextResponse) {
            return nextResponse;
          }

          return {
            data: {
              id: ACTIVE_EXPLANATION_ID,
              created_at: "2026-03-07T10:00:00.000Z",
              updated_at: "2026-03-07T10:00:00.000Z",
              tenant_id: TENANT_ID,
              project_id: PROJECT_ID,
              version_id: payload.version_id,
              line_id: payload.line_id ?? null,
              compare_version_id: payload.compare_version_id ?? null,
              requested_by: USER_ID,
              explanation_kind: payload.explanation_kind,
              snapshot_fingerprint: payload.snapshot_fingerprint,
              summary_short: payload.summary_short,
              summary_detail: payload.summary_detail,
              confidence_label: payload.confidence_label,
              confidence_score: payload.confidence_score,
              used_fallback: payload.used_fallback,
              provider: payload.provider,
              model: payload.model,
              statements_json: payload.statements_json,
              risk_signals_json: payload.risk_signals_json,
              impact_summary_json: payload.impact_summary_json,
              metadata_json: payload.metadata_json,
              generated_at: payload.generated_at,
              superseded_at: null,
              superseded_by_explanation_id: null,
            },
            error: null,
          };
        }),
      })),
    })),
    update: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })),
  };

  const explanationSourcesTable = {
    select: vi.fn(() => sourceSelectQuery),
    insert: vi.fn().mockImplementation(async (payload: Record<string, unknown>[]) => {
      const rows = Array.isArray(payload) ? payload : [payload];
      rows.forEach((row) => {
        const explanationId =
          typeof row.explanation_id === "string"
            ? row.explanation_id
            : ACTIVE_EXPLANATION_ID;
        sourceRowsByExplanationId[explanationId] = [
          ...(sourceRowsByExplanationId[explanationId] ?? []),
          row,
        ];
      });

      return { error: null };
    }),
  };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: { id: USER_ID },
        },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "estimate_explanations") {
        return explanationTable;
      }
      if (table === "estimate_explanation_sources") {
        return explanationSourcesTable;
      }
      if (table === "takeoff_price_suggestions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        };
      }
      if (table === "estimate_line_evidences") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        };
      }
      if (table === "estimate_risk_alerts") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
    __spies: {
      explanationInsert: explanationTable.insert,
      explanationSourcesInsert: explanationSourcesTable.insert,
    },
  };
}

describe("estimate explanations service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to a coherent delta narrative when Gemini contradicts a single-line decrease", async () => {
    const baseDetails = buildVersionDetails();
    const baseItem = baseDetails.items[0];

    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createSupabaseMock() as never
    );
    vi.mocked(getEstimateVersionDetails)
      .mockResolvedValueOnce(
        buildVersionDetails({
          version: {
            ...baseDetails.version,
            total_ht_cents: 342500,
            total_tax_cents: 68500,
            total_ttc_cents: 411000,
          },
          items: [
            {
              ...baseItem,
              quantity: 100,
              pu_ht_cents: 3425,
              line_total_ht_cents: 342500,
              line_total_ttc_cents: 411000,
              line_tax_cents: 68500,
            },
          ],
        }) as never
      )
      .mockResolvedValueOnce(
        buildVersionDetails({
          version: {
            ...baseDetails.version,
            id: COMPARE_VERSION_ID,
            version_number: 1,
            title: "Reference",
            total_ht_cents: 411000,
            total_tax_cents: 82200,
            total_ttc_cents: 493200,
          },
          items: [
            {
              ...baseItem,
              quantity: 120,
              pu_ht_cents: 3425,
              line_total_ht_cents: 411000,
              line_total_ttc_cents: 493200,
              line_tax_cents: 82200,
            },
          ],
        }) as never
      );
    vi.mocked(callGeminiStructured).mockResolvedValue({
      data: {
        summary_short: "V2 vs V1: hausse globale de 3 425,00 EUR HT.",
        summary_detail:
          "V2 vs V1: hausse globale de 3 425,00 EUR HT. D autres parametres globaux ont probablement augmente.",
      },
      tokenCount: 10,
      tokenUsage: {
        inputTokens: 5,
        outputTokens: 5,
        cachedInputTokens: 0,
        thoughtsTokens: 0,
      },
      costCents: 1,
      durationMs: 50,
      model: "gemini-3-pro-preview",
      promptVersion: "test",
      providerBatchId: null,
      providerBatchStateRaw: null,
    } as never);

    const explanation = await getEstimateDeltaExplanation({
      versionId: VERSION_ID,
      compareVersionId: COMPARE_VERSION_ID,
      includeDetail: true,
    });

    expect(explanation.kind).toBe("delta");
    expect(explanation.used_fallback).toBe(true);
    expect(explanation.provider).toBe("fallback");
    expect(explanation.summary_short).toContain("Baisse globale de 685,00");
    expect(explanation.summary_short).toContain(
      "Driver principal: Mur beton: -685,00"
    );
    expect(explanation.summary_detail).toContain(
      "Une seule ligne explique le delta: Mur beton"
    );
    expect(explanation.summary_detail).not.toContain("hausse globale");
    expect(explanation.impact_summary.delta_ht_cents).toBe(-68500);
    expect(explanation.impact_summary.delta_ttc_cents).toBe(-82200);
    expect(explanation.impact_summary.top_drivers[0]).toContain("Mur beton: -685,00");
  });

  it("persists a fallback line explanation when Gemini fails", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createSupabaseMock() as never
    );
    vi.mocked(getEstimateVersionDetails).mockResolvedValue(buildVersionDetails() as never);
    vi.mocked(callGeminiStructured).mockRejectedValue(new Error("Gemini down"));

    const explanation = await getEstimateLineExplanation({
      versionId: VERSION_ID,
      lineId: LINE_ID,
      includeDetail: true,
    });

    expect(explanation.kind).toBe("price");
    expect(explanation.used_fallback).toBe(true);
    expect(explanation.summary_short).toContain("Mur beton");
    expect(explanation.summary_detail).toContain("Faits");
    expect(vi.mocked(callGeminiStructured)).toHaveBeenCalledTimes(1);
  });

  it("rejects delta explanations across different projects", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createSupabaseMock() as never
    );
    vi.mocked(getEstimateVersionDetails)
      .mockResolvedValueOnce(buildVersionDetails() as never)
      .mockResolvedValueOnce(
        buildVersionDetails({
          version: {
            ...buildVersionDetails().version,
            id: COMPARE_VERSION_ID,
            project_id: "88888888-8888-4888-8888-888888888888",
          },
        }) as never
      );

    await expect(
      getEstimateDeltaExplanation({
        versionId: VERSION_ID,
        compareVersionId: COMPARE_VERSION_ID,
        includeDetail: false,
      })
    ).rejects.toMatchObject({
      message: "Version de comparaison introuvable.",
    });
  });

  it("regenerates delta explanations with a deterministic summary when the diff is a single-line decrease", async () => {
    const baseDetails = buildVersionDetails();
    const baseItem = baseDetails.items[0];
    const staleDeltaRow = {
      id: ACTIVE_EXPLANATION_ID,
      created_at: "2026-03-07T10:00:00.000Z",
      updated_at: "2026-03-07T10:00:00.000Z",
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_id: VERSION_ID,
      line_id: null,
      compare_version_id: COMPARE_VERSION_ID,
      requested_by: USER_ID,
      explanation_kind: "delta",
      snapshot_fingerprint: "legacy-delta-fingerprint",
      summary_short: "Hausse globale de 3 425,00 EUR HT.",
      summary_detail: "Ancien detail incoherent.",
      confidence_label: "medium",
      confidence_score: 0.66,
      used_fallback: false,
      provider: "gemini",
      model: "gemini-3-pro-preview",
      statements_json: {
        facts: [],
        hypotheses: [],
        inferences: [],
      },
      risk_signals_json: [],
      impact_summary_json: {
        delta_ht_cents: 342500,
        delta_ttc_cents: 411000,
        top_drivers: [],
      },
      metadata_json: {},
      generated_at: "2026-03-07T10:00:00.000Z",
      superseded_at: null,
      superseded_by_explanation_id: null,
    };

    const supabase = createSupabaseMock({
      activeExplanationRows: [staleDeltaRow],
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getEstimateVersionDetails)
      .mockResolvedValueOnce(
        buildVersionDetails({
          version: {
            ...baseDetails.version,
            id: VERSION_ID,
            version_number: 2,
            title: "Variante",
            total_ht_cents: 342500,
            total_tax_cents: 68500,
            total_ttc_cents: 411000,
          },
          items: [
            {
              ...baseItem,
              pu_ht_cents: 3425,
              line_total_ht_cents: 342500,
              line_total_ttc_cents: 411000,
              line_tax_cents: 68500,
            },
          ],
        }) as never
      )
      .mockResolvedValueOnce(
        buildVersionDetails({
          version: {
            ...baseDetails.version,
            id: COMPARE_VERSION_ID,
            version_number: 1,
            title: "Source",
            total_ht_cents: 411000,
            total_tax_cents: 82200,
            total_ttc_cents: 493200,
          },
          items: [
            {
              ...baseItem,
              pu_ht_cents: 4110,
              line_total_ht_cents: 411000,
              line_total_ttc_cents: 493200,
              line_tax_cents: 82200,
            },
          ],
        }) as never
      );

    const explanation = await getEstimateDeltaExplanation({
      versionId: VERSION_ID,
      compareVersionId: COMPARE_VERSION_ID,
      includeDetail: true,
    });

    expect(explanation.kind).toBe("delta");
    expect(explanation.used_fallback).toBe(true);
    expect(explanation.provider).toBe("fallback");
    expect(explanation.summary_short).toContain("V2 - Variante vs V1 - Source");
    expect(explanation.summary_short).toContain("Baisse globale de 685,00");
    expect(explanation.summary_detail).toContain(
      "Une seule ligne explique le delta: Mur beton: -685,00"
    );
    expect(explanation.impact_summary.delta_ht_cents).toBe(-68500);
    expect(explanation.impact_summary.top_drivers[0]).toContain("Mur beton: -685,00");
    expect(vi.mocked(callGeminiStructured)).not.toHaveBeenCalled();
    expect(supabase.__spies.explanationInsert).toHaveBeenCalledTimes(1);
  });

  it("reuses the winning active snapshot after a duplicate insert race", async () => {
    const concurrentRow = {
      id: ACTIVE_EXPLANATION_ID,
      created_at: "2026-03-07T10:00:01.000Z",
      updated_at: "2026-03-07T10:00:01.000Z",
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_id: VERSION_ID,
      line_id: LINE_ID,
      compare_version_id: null,
      requested_by: USER_ID,
      explanation_kind: "price",
      snapshot_fingerprint: "__LAST_INSERTED_FINGERPRINT__",
      summary_short: "Resume concurrent.",
      summary_detail: "Detail concurrent.",
      confidence_label: "high",
      confidence_score: 0.91,
      used_fallback: true,
      provider: "fallback",
      model: null,
      statements_json: {
        facts: [],
        hypotheses: [],
        inferences: [],
      },
      risk_signals_json: [],
      impact_summary_json: {
        current_amount_ht_cents: 9000,
        current_amount_ttc_cents: 10800,
        top_drivers: [],
      },
      metadata_json: {},
      generated_at: "2026-03-07T10:00:01.000Z",
      superseded_at: null,
      superseded_by_explanation_id: null,
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createSupabaseMock({
        activeExplanationRows: [null, concurrentRow],
        insertSingleResponses: [
          {
            data: null,
            error: {
              code: "23505",
              message: "duplicate key value violates unique constraint",
            },
          },
        ],
        sourceRowsByExplanationId: {
          [ACTIVE_EXPLANATION_ID]: [
            {
              id: ACTIVE_SOURCE_ID,
              explanation_id: ACTIVE_EXPLANATION_ID,
              source_kind: "estimate_item",
              label: "Ligne",
              source_ref: "V2",
              confidence_score: 1,
              rank: 0,
              source_record_table: "estimate_items",
              source_record_id: LINE_ID,
              metadata_json: {},
            },
          ],
        },
      }) as never
    );
    vi.mocked(getEstimateVersionDetails).mockResolvedValue(buildVersionDetails() as never);
    vi.mocked(callGeminiStructured).mockRejectedValue(new Error("Gemini down"));

    const explanation = await getEstimateLineExplanation({
      versionId: VERSION_ID,
      lineId: LINE_ID,
      includeDetail: true,
    });

    expect(explanation.explanation_id).toBe(ACTIVE_EXPLANATION_ID);
    expect(explanation.summary_short).toBe("Resume concurrent.");
    expect(explanation.provenance).toHaveLength(1);
  });

  it("rehydrates missing provenance on an active snapshot reuse", async () => {
    const fingerprintProbeSupabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      fingerprintProbeSupabase as never
    );
    vi.mocked(getEstimateVersionDetails).mockResolvedValue(buildVersionDetails() as never);
    vi.mocked(callGeminiStructured).mockRejectedValue(new Error("Gemini down"));

    await getEstimateLineExplanation({
      versionId: VERSION_ID,
      lineId: LINE_ID,
      includeDetail: true,
    });

    const fingerprint =
      fingerprintProbeSupabase.__spies.explanationInsert.mock.calls[0]?.[0]
        ?.snapshot_fingerprint;

    expect(typeof fingerprint).toBe("string");

    const activeRow = {
      id: ACTIVE_EXPLANATION_ID,
      created_at: "2026-03-07T10:00:01.000Z",
      updated_at: "2026-03-07T10:00:01.000Z",
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_id: VERSION_ID,
      line_id: LINE_ID,
      compare_version_id: null,
      requested_by: USER_ID,
      explanation_kind: "price",
      snapshot_fingerprint: fingerprint,
      summary_short: "Resume actif.",
      summary_detail: "Detail actif.",
      confidence_label: "high",
      confidence_score: 0.91,
      used_fallback: true,
      provider: "fallback",
      model: null,
      statements_json: {
        facts: [],
        hypotheses: [],
        inferences: [],
      },
      risk_signals_json: [],
      impact_summary_json: {
        current_amount_ht_cents: 9000,
        current_amount_ttc_cents: 10800,
        top_drivers: [],
      },
      metadata_json: {},
      generated_at: "2026-03-07T10:00:01.000Z",
      superseded_at: null,
      superseded_by_explanation_id: null,
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createSupabaseMock({
        activeExplanationRows: [activeRow],
        sourceRowsByExplanationId: {
          [ACTIVE_EXPLANATION_ID]: [],
        },
      }) as never
    );
    vi.mocked(getEstimateVersionDetails).mockResolvedValue(buildVersionDetails() as never);
    vi.mocked(callGeminiStructured).mockClear();

    const explanation = await getEstimateLineExplanation({
      versionId: VERSION_ID,
      lineId: LINE_ID,
      includeDetail: true,
    });

    expect(vi.mocked(callGeminiStructured)).not.toHaveBeenCalled();
    expect(explanation.explanation_id).toBe(ACTIVE_EXPLANATION_ID);
    expect(explanation.provenance).toHaveLength(1);
    expect(explanation.provenance[0]).toMatchObject({
      source_kind: "estimate_item",
      label: "Mur beton",
      source_ref: "V2 - Variante",
    });
  });
});
