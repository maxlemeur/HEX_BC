import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiKeyError } from "@/lib/ai/access/api-key-errors";
import { formatEUR } from "@/lib/money";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/estimates/version-read-server", () => ({
  getEstimateVersionDetails: vi.fn(),
}));

vi.mock("@/lib/ai/structured-ai", () => ({
  callStructuredAi: vi.fn(),
}));

vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn() }));
vi.mock("@/lib/ai/request-settings-server", () => ({
  readAiRequestOptions: vi.fn(),
  resolveAiRequest: vi.fn(),
}));
vi.mock("@/lib/ai/access/openai-api", () => ({ openAiApiKeyAccess: vi.fn() }));

import { GET, POST } from "@/app/api/estimates/[versionId]/lines/[lineId]/explanation/route";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { openAiApiKeyAccess } from "@/lib/ai/access/openai-api";
import { readAiRequestOptions, resolveAiRequest } from "@/lib/ai/request-settings-server";
import { callStructuredAi } from "@/lib/ai/structured-ai";
import { generateEstimateLineExplanation, getEstimateDeltaExplanation, getEstimateLineExplanation } from "@/lib/estimates/explanations";
import { getEstimateVersionDetails } from "@/lib/estimates/version-read-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  evidenceRows?: Array<Record<string, unknown>>;
  riskAlertRows?: Array<Record<string, unknown>>;
  insertedId?: string;
}) {
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
      data: nextRow,
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
          const nextResponse = options?.insertSingleResponses?.length
            ? options.insertSingleResponses.shift()
            : null;
          if (nextResponse) {
            return nextResponse;
          }

          return {
            data: {
              id: options?.insertedId ?? ACTIVE_EXPLANATION_ID,
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
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: ACTIVE_EXPLANATION_ID }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
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
        // Read through readAllRows: ordered pages with an exact count.
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn().mockImplementation(async () => ({
              data: options?.evidenceRows ?? [], count: options?.evidenceRows?.length ?? 0, error: null,
            })),
          })),
        };
      }
      if (table === "estimate_risk_alerts") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve({ data: options?.riskAlertRows ?? [], error: null }).then(resolve),
          })),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
    __spies: {
      explanationInsert: explanationTable.insert,
      explanationUpdate: explanationTable.update,
      explanationSourcesInsert: explanationSourcesTable.insert,
    },
  };
}

function buildLegacyPriceFingerprint() {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: "price",
        version_id: VERSION_ID,
        line_id: LINE_ID,
        compare_version_id: null,
        summary_context: {
          line_label: "Mur beton",
          version_label: "V2 - Variante",
        },
        statements: {
          facts: [
            {
              label: `Prix unitaire actuel ${formatEUR(4500)} HT`,
              source_label: "Mur beton",
              confidence_score: 1,
            },
            {
              label: `Montant ligne ${formatEUR(9000)} HT / ${formatEUR(10800)} TTC`,
              source_label: "Mur beton",
              confidence_score: 1,
            },
            {
              label: "Marge configuree 12%",
              source_label: "V2 - Variante",
              confidence_score: 1,
            },
            {
              label: "Origine document plans.pdf · page 3",
              source_label: "takeoff_gemini",
              confidence_score: 0.9,
            },
          ],
          hypotheses: [],
          inferences: [],
        },
        provenance: [
          {
            source_kind: "estimate_item",
            label: "Mur beton",
            source_ref: "V2 - Variante",
            confidence_score: 1,
            source_record_table: "estimate_items",
            source_record_id: LINE_ID,
            metadata_json: {
              item_type: "line",
            },
            rank: 0,
          },
        ],
        risk_signals: [],
        impact_summary: {
          current_amount_ht_cents: 9000,
          current_amount_ttc_cents: 10800,
          current_margin_bp: 1200,
          current_margin_multiplier: 1.12,
          top_drivers: [],
        },
        confidence_label: "high",
        confidence_score: 0.88,
      })
    )
    .digest("hex");
}

function storedPriceRow(overrides: Record<string, unknown> = {}) {
  return {
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
    snapshot_fingerprint: buildLegacyPriceFingerprint(),
    summary_short: "Resume historique.",
    summary_detail: "Detail historique.",
    confidence_label: "high",
    confidence_score: 0.88,
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
    ...overrides,
  };
}

const PRICE_LINE = { versionId: VERSION_ID, lineId: LINE_ID };
const PLAN = { source: "chatgpt_plan", model: "gpt-6.2-sol", reasoningEffort: "low" } as const;
const PLAN_ANSWER = {
  data: { summary_short: "Résumé simulé.", summary_detail: "Détail simulé." },
  provider: "chatgpt" as const, model: PLAN.model, tokenCount: 0, costCents: 0, durationMs: 0, promptVersion: "price",
  tokenUsage: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0, totalTokens: 0 },
};
const KEY = { source: "personal_api_key", model: "gpt-5-mini", reasoningEffort: "medium",
  connectionId: "99999999-9999-4999-8999-999999999999" } as const;
const APP = "http://localhost:3155";
const URL = `${APP}/api/estimates/${VERSION_ID}/lines/${LINE_ID}/explanation`;
const params = () => ({ params: Promise.resolve(PRICE_LINE) });
const post = (body: unknown, origin = APP) => POST(new Request(URL, {
  method: "POST", headers: { origin, host: "localhost:3155", "content-type": "application/json" },
  body: JSON.stringify(body),
}), params());
const read = () => GET(new Request(URL), params());
const owner = { userId: USER_ID, tenantId: TENANT_ID };

async function generatePriceForLine() {
  const { revision } = await getEstimateLineExplanation({ ...PRICE_LINE, includeDetail: false });
  return generateEstimateLineExplanation({ ...PRICE_LINE, includeDetail: true, settings: { ...PLAN, revision } });
}

describe("estimate explanations service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthenticatedContext).mockImplementation(async () => ({
      ...owner, supabase: await createSupabaseServerClient(),
    }) as Awaited<ReturnType<typeof getAuthenticatedContext>>);
    vi.mocked(getEstimateVersionDetails).mockResolvedValue(buildVersionDetails());
    vi.mocked(readAiRequestOptions).mockResolvedValue({ defaultSource: "chatgpt_plan", options: {} });
    vi.mocked(resolveAiRequest).mockResolvedValue({
      ok: true, source: "chatgpt_plan", connection: null,
      preferences: { model: PLAN.model, reasoningEffort: PLAN.reasoningEffort },
    });
    vi.mocked(callStructuredAi).mockResolvedValue(PLAN_ANSWER);
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
    expect(vi.mocked(callStructuredAi)).not.toHaveBeenCalled();
    expect(supabase.__spies.explanationInsert).toHaveBeenCalledTimes(1);
  });

  it("keeps TTC-only delta fallbacks directional when HT is stable", async () => {
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
            id: VERSION_ID,
            version_number: 2,
            title: "Variante",
            total_ht_cents: 9000,
            total_tax_cents: 1799,
            total_ttc_cents: 10799,
          },
          items: [
            {
              ...baseItem,
              line_total_ht_cents: 9000,
              line_tax_cents: 1799,
              line_total_ttc_cents: 10799,
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
            total_ht_cents: 9000,
            total_tax_cents: 1800,
            total_ttc_cents: 10800,
          },
          items: [
            {
              ...baseItem,
              line_total_ht_cents: 9000,
              line_tax_cents: 1800,
              line_total_ttc_cents: 10800,
            },
          ],
        }) as never
      );
    vi.mocked(callStructuredAi).mockRejectedValue(new Error("AI provider down"));

    const explanation = await getEstimateDeltaExplanation({
      versionId: VERSION_ID,
      compareVersionId: COMPARE_VERSION_ID,
      includeDetail: true,
    });

    expect(explanation.used_fallback).toBe(true);
    expect(explanation.summary_short).toContain(`HT stable a ${formatEUR(0)}`);
    expect(explanation.summary_short).toContain(`TTC en baisse de ${formatEUR(1)}`);
    expect(explanation.summary_short).not.toContain("Delta stable");
  });

  it("keeps HT and TTC signs independent in mixed-direction delta fallbacks", async () => {
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
            id: VERSION_ID,
            version_number: 2,
            title: "Variante",
            total_ht_cents: 9100,
            total_tax_cents: 1690,
            total_ttc_cents: 10790,
          },
          items: [
            {
              ...baseItem,
              line_total_ht_cents: 9100,
              line_tax_cents: 1690,
              line_total_ttc_cents: 10790,
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
            total_ht_cents: 9000,
            total_tax_cents: 1800,
            total_ttc_cents: 10800,
          },
          items: [
            {
              ...baseItem,
              line_total_ht_cents: 9000,
              line_tax_cents: 1800,
              line_total_ttc_cents: 10800,
            },
          ],
        }) as never
      );
    vi.mocked(callStructuredAi).mockRejectedValue(new Error("AI provider down"));

    const explanation = await getEstimateDeltaExplanation({
      versionId: VERSION_ID,
      compareVersionId: COMPARE_VERSION_ID,
      includeDetail: true,
    });

    expect(explanation.used_fallback).toBe(true);
    expect(explanation.summary_short).toContain(`HT en hausse de ${formatEUR(100)}`);
    expect(explanation.summary_short).toContain(`TTC en baisse de ${formatEUR(10)}`);
  });

  it.each([
    ["missing", null],
    ["stale", storedPriceRow({ snapshot_fingerprint: "outdated" })],
    ["ready", storedPriceRow()],
  ])("GET reports %s without contacting an AI provider or writing", async (status, row) => {
    const supabase = createSupabaseMock({ activeExplanationRows: [row] });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    const responses = await Promise.all([read(), read()]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      const { data } = await response.json();
      expect(data.status).toBe(status);
      expect(data.explanation?.summary_short ?? null).toBe(status === "ready" ? "Resume historique." : null);
    }
    expect(readAiRequestOptions).toHaveBeenCalledWith(expect.objectContaining(owner), expect.anything(), "cached");
    expect(resolveAiRequest).not.toHaveBeenCalled();
    expect(callStructuredAi).not.toHaveBeenCalled();
    expect(openAiApiKeyAccess).not.toHaveBeenCalled();
    expect(supabase.__spies.explanationInsert).not.toHaveBeenCalled();
    expect(supabase.__spies.explanationSourcesInsert).not.toHaveBeenCalled();
  });

  it("explicitly regenerates a valid explanation with the selected plan model and effort", async () => {
    const supabase = createSupabaseMock({
      activeExplanationRows: [storedPriceRow({ provider: "gemini", model: "ancien-modèle" })],
      insertedId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    const { data: { revision } } = await (await read()).json();
    const response = await post({ ...PLAN, revision });

    expect(response.status).toBe(200);
    expect(resolveAiRequest).toHaveBeenCalledWith(owner, expect.anything(), {
      source: PLAN.source, model: PLAN.model, effort: PLAN.reasoningEffort,
    });
    expect(callStructuredAi).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining("Mur beton") }), owner,
      { model: PLAN.model, reasoningEffort: PLAN.reasoningEffort },
    );
    expect(openAiApiKeyAccess).not.toHaveBeenCalled();
    expect(supabase.__spies.explanationInsert).toHaveBeenCalledWith(expect.objectContaining({
      requested_by: USER_ID, provider: "chatgpt", model: PLAN.model,
      metadata_json: expect.objectContaining({ ai_request: PLAN }),
    }));
    expect((await response.json()).data).toMatchObject({
      explanation: { ai_request: PLAN }, revision: expect.stringContaining("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    });
  });

  it("counts and generates a key request with the selected connection, effort and $0.10 allotment", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(resolveAiRequest).mockResolvedValue({
      ok: true, source: KEY.source, connection: { id: KEY.connectionId, version: 12 },
      preferences: { model: KEY.model, reasoningEffort: KEY.reasoningEffort },
    });
    const prepared = { reasoningEffort: KEY.reasoningEffort };
    const prepare = vi.fn().mockResolvedValue(prepared);
    const execute = vi.fn().mockResolvedValue({
      model: "gpt-5-mini-2025-08-07", costNanoUsd: 10_000_000,
      data: { summary_short: "Résumé API.", summary_detail: "Détail API." },
    });
    vi.mocked(openAiApiKeyAccess).mockReturnValue({ prepare, execute } as never);
    const { data: { revision } } = await (await read()).json();
    const response = await post({ ...KEY, revision });

    expect(response.status).toBe(200);
    expect(resolveAiRequest).toHaveBeenCalledWith(owner, expect.anything(), {
      source: KEY.source, model: KEY.model, effort: KEY.reasoningEffort, expectedConnectionId: KEY.connectionId,
    });
    expect(prepare).toHaveBeenCalledWith(owner, expect.objectContaining({
      expectedVersion: 12, model: KEY.model, reasoningEffort: KEY.reasoningEffort, allotmentNanoUsd: 100_000_000, files: [],
    }));
    expect(execute).toHaveBeenCalledWith(owner, prepared, expect.objectContaining({ timeoutMs: 60_000 }));
    expect(callStructuredAi).not.toHaveBeenCalled();
    const used = { source: KEY.source, model: "gpt-5-mini-2025-08-07", reasoningEffort: KEY.reasoningEffort };
    expect(supabase.__spies.explanationInsert).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai", model: used.model, metadata_json: expect.objectContaining({ ai_request: used }),
    }));
    expect((await response.json()).data.explanation.ai_request).toEqual(used);
  });

  it("refuses stale or cross-origin submissions and unavailable choices before generation", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    const { data: { revision } } = await (await read()).json();
    expect((await post({ ...KEY, revision }, "https://ailleurs.example")).status).toBe(403);
    expect((await post({ ...KEY, revision: "outdated" })).status).toBe(409);
    expect((await post({ ...KEY, revision, connectionId: null })).status).toBe(400);
    expect(resolveAiRequest).not.toHaveBeenCalled();

    vi.mocked(resolveAiRequest).mockResolvedValue({ ok: false, reason: "connection_changed", message: "Clé modifiée." });
    expect((await post({ ...KEY, revision })).status).toBe(409);
    expect(openAiApiKeyAccess).not.toHaveBeenCalled();
    expect(callStructuredAi).not.toHaveBeenCalled();
    expect(supabase.__spies.explanationInsert).not.toHaveBeenCalled();
  });

  it("refuses a competing post before a second adapter call", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    const { data: { revision } } = await (await read()).json();
    const command = { ...PLAN, revision };
    const answers = await Promise.all([post(command), post(command)]);
    expect(answers.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(callStructuredAi).toHaveBeenCalledTimes(1);
    expect(supabase.__spies.explanationInsert).toHaveBeenCalledTimes(1);
  });

  it.each(["unit price", "evidence"])("discards the answer when the %s changes during inference", async (change) => {
    const evidenceRows: Array<Record<string, unknown>> = [];
    const supabase = createSupabaseMock({ activeExplanationRows: [storedPriceRow()], evidenceRows });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    const item = {
      ...buildVersionDetails().items[0],
      source_job_id: "99999999-9999-4999-8999-999999999999",
    };
    vi.mocked(getEstimateVersionDetails).mockResolvedValue(buildVersionDetails({ items: [item] }));
    const started = Promise.withResolvers<void>();
    const answer = Promise.withResolvers<typeof PLAN_ANSWER>();
    vi.mocked(callStructuredAi).mockImplementationOnce(() => {
      started.resolve();
      return answer.promise;
    });
    const { data: { revision } } = await (await read()).json();
    const responsePending = post({ ...PLAN, revision });
    await started.promise;

    if (change === "unit price") {
      vi.mocked(getEstimateVersionDetails).mockResolvedValue(
        buildVersionDetails({ items: [{ ...item, pu_ht_cents: 4600 }] }),
      );
    } else {
      evidenceRows.push({
        id: ACTIVE_SOURCE_ID,
        evidence_type: "plan",
        evidence_kind: "fact",
        label: "Plan révisé",
        source_label: "Plan fictif",
        source_file_name: "plan-b.pdf",
        source_page: 2,
        confidence_score: 1,
        note: null,
        source_record_table: null,
        source_record_id: null,
      });
    }
    answer.resolve(PLAN_ANSWER);

    const response = await responsePending;
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("PRICE_EXPLANATION_STALE");
    expect(callStructuredAi).toHaveBeenCalledTimes(1);
    expect(supabase.__spies.explanationUpdate).not.toHaveBeenCalled();
    expect(supabase.__spies.explanationInsert).not.toHaveBeenCalled();
    expect(supabase.__spies.explanationSourcesInsert).not.toHaveBeenCalled();
  });

  it("reports a database insert race instead of returning another request's answer", async () => {
    const supabase = createSupabaseMock({
      insertSingleResponses: [{ data: null, error: { code: "23505", message: "duplicate key value" } }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    const { data: { revision } } = await (await read()).json();
    expect((await post({ ...PLAN, revision })).status).toBe(409);
    expect(supabase.__spies.explanationSourcesInsert).not.toHaveBeenCalled();
  });

  it("keeps the existing explanation when preparation refuses the ceiling", async () => {
    const supabase = createSupabaseMock({ activeExplanationRows: [storedPriceRow()] });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(resolveAiRequest).mockResolvedValue({
      ok: true, source: KEY.source, connection: { id: KEY.connectionId, version: 12 },
      preferences: { model: KEY.model, reasoningEffort: KEY.reasoningEffort },
    });
    const execute = vi.fn();
    vi.mocked(openAiApiKeyAccess).mockReturnValue({
      prepare: vi.fn().mockRejectedValue(new ApiKeyError("AI_KEY_CEILING")), execute,
    } as never);
    const { data: { revision } } = await (await read()).json();
    const response = await post({ ...KEY, revision });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("AI_KEY_CEILING");
    expect(execute).not.toHaveBeenCalled();
    expect(callStructuredAi).not.toHaveBeenCalled();
    expect(supabase.__spies.explanationUpdate).not.toHaveBeenCalled();
    expect(supabase.__spies.explanationInsert).not.toHaveBeenCalled();
  });

  it("explains a takeoff line carrying radar alerts with the severities the database stores", async () => {
    // estimate_risk_alerts.severity is checked in ('info', 'warning', 'critical').
    const supabase = createSupabaseMock({
      riskAlertRows: [
        { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", severity: "critical", cause_code: "dpgf_takeoff_gap", scope_label: "Mur beton", reason_labels: ["Écart DPGF de 40 %"], metadata: {} },
        { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", severity: "warning", cause_code: "missing_proof", scope_label: "Mur beton", reason_labels: null, metadata: {} },
        { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", severity: "info", cause_code: "missing_piece", scope_label: "Mur beton", reason_labels: [], metadata: {} },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    const details = buildVersionDetails();
    vi.mocked(getEstimateVersionDetails).mockResolvedValue(buildVersionDetails({
      items: details.items.map((item) => ({ ...item, source_job_id: "99999999-9999-4999-8999-999999999999" })),
    }) as never);
    const { explanation } = await generatePriceForLine();

    // The explanation's signals keep their own low/medium/high scale.
    expect(explanation.risk_signals.map((signal) => [signal.severity, signal.source_label])).toEqual([
      ["high", "Radar risque"], ["medium", "Radar risque"], ["low", "Radar risque"],
    ]);
    expect(explanation.provenance.filter((source) => source.source_kind === "estimate_risk_alert").map((source) => source.source_ref))
      .toEqual(["dpgf_takeoff_gap", "missing_proof", "missing_piece"]);
  });

  // TI-686 D10/D12: the internal explanation of a line the takeoff application marked says what its amount is.
  it.each([
    ["a forced line", { takeoff_item_id: "c3000000-0000-4000-8000-000000000301", forced: true, forced_reason: null, entry_category: null },
      "Ligne forcée à l’application du métré (provision interne)"],
    ["an entered hypothesis", { takeoff_item_id: "c3000000-0000-4000-8000-000000000303", forced: false, forced_reason: null,
      entry_category: "hypothesis" }, "Quantité saisie sur hypothèse au métré"],
    // TI-686 D10: a line forced as a priced hypothesis was not entered.
    ["a line forced as a priced hypothesis", { takeoff_item_id: "c3000000-0000-4000-8000-000000000301", forced: true,
      forced_reason: "priced_hypothesis", entry_category: null }, "Ligne forcée à l’application du métré comme hypothèse chiffrée"],
    // TI-682 lot C: an hypothesis included without entry, marked at application with why it is one.
    ["an estimate counted without entry", { takeoff_item_id: "c3000000-0000-4000-8000-000000000306", forced: false,
      forced_reason: null, entry_category: null, hypothesis_cause: "estimated" }, "Quantité estimée au métré, comptée sans saisie"],
    ["a quantity a plan cannot show counted without entry", { takeoff_item_id: "c3000000-0000-4000-8000-000000000307",
      forced: false, forced_reason: null, entry_category: null, hypothesis_cause: "non_observable" },
      "Quantité qu’un plan ne montre pas, comptée au métré sans saisie"],
  ])("lists %s of the takeoff among the line's hypotheses", async (_name, source, sentence) => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(createSupabaseMock() as never);
    const details = buildVersionDetails();
    vi.mocked(getEstimateVersionDetails).mockResolvedValue(buildVersionDetails({
      items: details.items.map((item) => ({ ...item, source_provider: "takeoff", source_metadata: {
        takeoff_item_id: source.takeoff_item_id,
        takeoff_provision: { version: 1, job_id: "c3000000-0000-4000-8000-000000000201", sources: [source] },
      } })),
    }) as never);
    const { explanation } = await generatePriceForLine();

    expect(explanation.hypotheses.map((statement) => statement.label)).toEqual([sentence]);
  });

  it("reconstructs missing provenance without writing on an active snapshot read", async () => {
    const activeRow = storedPriceRow();
    const supabase = createSupabaseMock({ activeExplanationRows: [activeRow] });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getEstimateVersionDetails).mockResolvedValue(buildVersionDetails() as never);
    vi.mocked(callStructuredAi).mockClear();

    const { explanation } = await getEstimateLineExplanation({
      versionId: VERSION_ID,
      lineId: LINE_ID,
      includeDetail: true,
    });

    expect(vi.mocked(callStructuredAi)).not.toHaveBeenCalled();
    expect(explanation?.explanation_id).toBe(ACTIVE_EXPLANATION_ID);
    expect(supabase.__spies.explanationSourcesInsert).not.toHaveBeenCalled();
    expect(explanation?.provenance).toHaveLength(1);
    expect(explanation?.provenance[0]).toMatchObject({
      source_kind: "estimate_item",
      label: "Mur beton",
      source_ref: "V2 - Variante",
    });
  });

  it("reuses legacy price fingerprints without regenerating the snapshot", async () => {
    const activeRow = storedPriceRow();

    const supabase = createSupabaseMock({
      activeExplanationRows: [activeRow],
      sourceRowsByExplanationId: {
        [ACTIVE_EXPLANATION_ID]: [
          {
            id: ACTIVE_SOURCE_ID,
            explanation_id: ACTIVE_EXPLANATION_ID,
            source_kind: "estimate_item",
            label: "Mur beton",
            source_ref: "V2 - Variante",
            confidence_score: 1,
            rank: 0,
            source_record_table: "estimate_items",
            source_record_id: LINE_ID,
            metadata_json: {},
          },
        ],
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getEstimateVersionDetails).mockResolvedValue(buildVersionDetails() as never);

    const { explanation } = await getEstimateLineExplanation({
      versionId: VERSION_ID,
      lineId: LINE_ID,
      includeDetail: true,
    });

    expect(vi.mocked(callStructuredAi)).not.toHaveBeenCalled();
    expect(supabase.__spies.explanationInsert).not.toHaveBeenCalled();
    expect(explanation?.explanation_id).toBe(ACTIVE_EXPLANATION_ID);
    expect(explanation?.summary_short).toBe("Resume historique.");
  });
});
