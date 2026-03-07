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

function buildVersionDetails(overrides?: Partial<Awaited<ReturnType<typeof getEstimateVersionDetails>>>) {
  return {
    version: {
      id: VERSION_ID,
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_number: 2,
      title: "Variante",
      margin_bp: 1200,
      margin_multiplier: 1.12,
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
    ...overrides,
  } as Awaited<ReturnType<typeof getEstimateVersionDetails>>;
}

function createSupabaseMock() {
  const activeExplanationQuery = {
    eq: vi.fn(),
    is: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: null,
      error: null,
    }),
  };
  activeExplanationQuery.eq.mockReturnValue(activeExplanationQuery);
  activeExplanationQuery.is.mockReturnValue(activeExplanationQuery);

  const sourceSelectQuery = {
    eq: vi.fn(),
    order: vi.fn().mockResolvedValue({
      data: [],
      error: null,
    }),
  };
  sourceSelectQuery.eq.mockReturnValue(sourceSelectQuery);

  const explanationTable = {
    select: vi.fn(() => activeExplanationQuery),
    insert: vi.fn((payload: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: "77777777-7777-4777-8777-777777777777",
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
        }),
      })),
    })),
    update: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })),
  };

  const explanationSourcesTable = {
    select: vi.fn(() => sourceSelectQuery),
    insert: vi.fn().mockResolvedValue({ error: null }),
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
  };
}

describe("estimate explanations service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
