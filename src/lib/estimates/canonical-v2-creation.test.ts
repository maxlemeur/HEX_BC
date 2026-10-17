import { beforeEach, describe, expect, it, vi } from "vitest";

const { serviceRoleRpc } = vi.hoisted(() => ({
  serviceRoleRpc: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(() => ({ rpc: serviceRoleRpc })),
}));

vi.mock("@/lib/estimates/version-totals", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/estimates/version-totals")
  >();
  return {
    ...actual,
    calculateEstimateSnapshotForItems: vi.fn(),
    calculateEstimateV3SnapshotForItems: vi.fn(),
  };
});

import {
  calculateEstimateSnapshotForItems,
  calculateEstimateV3SnapshotForItems,
} from "@/lib/estimates/version-totals";
import { createEstimateSchema } from "@/lib/estimates/schemas";

import {
  instantiateCanonicalEstimateV2FromTemplate,
  persistCanonicalEstimateV2,
} from "./canonical-v2-creation";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const IMPORT_ID = "55555555-5555-4555-8555-555555555555";

type CreationSource = Parameters<typeof persistCanonicalEstimateV2>[0]["source"];

/** Lot 2, sous-lot 2.5 (D3) : la création lit la politique de l'entreprise ; absente = moteur 2. */
function absentCalcPolicyBuilder(policyRow: Record<string, unknown> | null = null) {
  const builder = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: policyRow, error: null }) };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  return builder;
}

/** Revue 2.5 : politique 3 de l'entreprise, défauts 1,30 / 1,20, lue par le TS sans verrou. */
const POLICY_THREE = {
  tenant_id: TENANT_ID,
  new_estimate_calc_engine: 3,
  default_sale_coefficient_fo: 1.3,
  default_sale_coefficient_mo: 1.2,
  allowed_tax_rates_bp: [2000, 1000, 550, 210],
};

function createSupabaseStub(policyRow: Record<string, unknown> | null = null) {
  return {
    from: vi.fn((table: string) => {
      if (table === "tenant_calc_policies") return absentCalcPolicyBuilder(policyRow);
      if (table === "labor_roles") {
        const builder = {
          select: vi.fn(),
          eq: vi.fn(),
          in: vi.fn(),
        };
        builder.select.mockReturnValue(builder);
        builder.eq.mockReturnValue(builder);
        builder.in.mockResolvedValue({ data: [], error: null });
        return builder;
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

function mockSingleLineSnapshot(input: {
  ht: number;
  tax: number;
  ttc: number;
}) {
  vi.mocked(calculateEstimateSnapshotForItems).mockImplementationOnce(
    async ({ lineItems }) => {
      const line = lineItems.find((item) => item.item_type === "line")!;
      return {
        context: {
          effective_margin_multiplier: 1.25,
          labor_split_enabled: false,
          labor_roles: [],
          margin_tiers: [],
        },
        breakdown: {
          lineById: new Map([
            [
              line.id,
              {
                saleNetHtCents: input.ht,
                taxCents: input.tax,
                foNetCents: input.ht,
                moNetCents: 0,
                moAtelierNetCents: 0,
                moChantierNetCents: 0,
              },
            ],
          ]),
          sectionById: new Map(),
          rootLineIds: [line.id],
          totals: {
            saleTotalCents: input.ht,
            adjustedTaxCents: input.tax,
            roundedTtcCents: input.ttc,
          },
          invariants: {
            matchesFooter: true,
            sumAllocatedHtCents: input.ht,
          },
        },
      } as never;
    }
  );
}

describe("persistCanonicalEstimateV2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceRoleRpc.mockResolvedValue({
      data: {
        project: { id: PROJECT_ID },
        version: {
          id: VERSION_ID,
          total_ht_cents: 1999,
          total_tax_cents: 401,
          total_ttc_cents: 2400,
        },
      },
      error: null,
    });
  });

  it("persists engine v2 footer exactly equal to projected line sums", async () => {
    mockSingleLineSnapshot({ ht: 1999, tax: 0, ttc: 1999 });

    await persistCanonicalEstimateV2({
      supabase: createSupabaseStub() as never,
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      project: {
        kind: "new",
        id: PROJECT_ID,
        name: "Affaire importée",
      },
      version: {
        rounding_mode: "nearest",
        rounding_step_cents: 5,
        contractor_role: "subcontractor",
      },
      source: {
        kind: "import",
        importId: IMPORT_ID,
        mappingId: null,
        filename: "dpgf.xlsx",
        items: [
          {
            item_type: "line",
            mapped_row_id: "mapped-1",
            row_index: 1,
            title: "Tube",
            description: "ml",
            notes: null,
            source_page: null,
            source_metadata: {},
            quantity: 1,
            unit_price_ht_cents: 1999,
            tax_rate_bp: 2000,
            k_fo: 1,
            h_mo: 0,
            h_mo_majoration: 1,
            k_mo: 1,
            pu_ht_cents: 1999,
            line_total_ht_cents: 1999,
            line_tax_cents: 400,
            line_total_ttc_cents: 2399,
          },
        ],
      },
    });

    const payload = serviceRoleRpc.mock.calls[0]?.[1] as {
      p_import_id: string;
      p_version_payload: Record<string, unknown>;
      p_items: Array<Record<string, unknown>>;
    };
    const line = payload.p_items.find((item) => item.item_type === "line")!;
    expect(payload.p_import_id).toBe(IMPORT_ID);
    expect(payload.p_version_payload).toMatchObject({
      calc_engine_version: 2,
      contractor_role: "subcontractor",
      total_ht_cents: 1999,
      total_tax_cents: 0,
      total_ttc_cents: 1999,
    });
    expect(payload.p_version_payload).not.toHaveProperty("calc_snapshot_context");
    expect(line).toMatchObject({
      line_total_ht_cents: 1999,
      line_tax_cents: 0,
      line_total_ttc_cents: 1999,
      source_provider: "dpgf",
      source_file_name: "dpgf.xlsx",
    });
    expect(
      payload.p_items
        .filter((item) => item.item_type === "line")
        .reduce((sum, item) => sum + Number(item.line_total_ttc_cents), 0)
    ).toBe(payload.p_version_payload.total_ttc_cents);
    expect(calculateEstimateSnapshotForItems).toHaveBeenCalledWith(
      expect.objectContaining({
        version: expect.objectContaining({
          contractor_role: "subcontractor",
        }),
      })
    );
  });

  it("clones a template hierarchy into an existing project through the same v2 contract", async () => {
    const template = {
      id: "66666666-6666-4666-8666-666666666666",
      validite_jours: 45,
      margin_multiplier: 1.25,
      margin_mode: "fixed",
      currency: "EUR",
      margin_bp: 0,
      discount_bp: 0,
      discount_mode: "simple",
      discount_steps: [],
      global_coefficient: 1,
      tax_rate_bp: 2000,
      rounding_mode: "none",
      rounding_step_cents: 1,
    };
    const sourceSectionId = "77777777-7777-4777-8777-777777777777";
    const sourceLineId = "88888888-8888-4888-8888-888888888888";
    const templateItems = [
      {
        id: sourceSectionId,
        parent_id: null,
        item_type: "section",
        position: 1,
        title: "Plomberie",
        description: null,
        quantity: null,
        unit_price_ht_cents: null,
        tax_rate_bp: null,
        k_fo: null,
        h_mo: null,
        h_mo_majoration: 1,
        k_mo: null,
        h_mo_atelier: null,
        k_mo_atelier: 1,
        labor_role_atelier_id: null,
        h_mo_chantier: null,
        k_mo_chantier: 1,
        labor_role_chantier_id: null,
        pu_ht_cents: null,
        labor_role_id: null,
        category_id: null,
        supply_type_id: null,
        line_total_ht_cents: null,
        line_tax_cents: null,
        line_total_ttc_cents: null,
      },
      {
        id: sourceLineId,
        parent_id: sourceSectionId,
        item_type: "line",
        position: 1,
        title: "Tube cuivre",
        description: "ml",
        quantity: 2,
        unit_price_ht_cents: 1000,
        tax_rate_bp: 2000,
        k_fo: 1,
        h_mo: 0,
        h_mo_majoration: 1,
        k_mo: 1,
        h_mo_atelier: null,
        k_mo_atelier: 1,
        labor_role_atelier_id: null,
        h_mo_chantier: null,
        k_mo_chantier: 1,
        labor_role_chantier_id: null,
        pu_ht_cents: 1250,
        labor_role_id: null,
        category_id: null,
        supply_type_id: null,
        line_total_ht_cents: 2500,
        line_tax_cents: 500,
        line_total_ttc_cents: 3000,
      },
    ];
    const templateBuilder = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: template, error: null }),
    };
    templateBuilder.select.mockReturnValue(templateBuilder);
    templateBuilder.eq.mockReturnValue(templateBuilder);
    const itemBuilder = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
    };
    itemBuilder.select.mockReturnValue(itemBuilder);
    itemBuilder.eq.mockReturnValue(itemBuilder);
    itemBuilder.order.mockImplementation(() =>
      itemBuilder.order.mock.calls.length === 1
        ? itemBuilder
        : Promise.resolve({ data: [templateItems[1], templateItems[0]], error: null })
    );
    const projectBuilder = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: PROJECT_ID, user_id: USER_ID },
        error: null,
      }),
    };
    projectBuilder.select.mockReturnValue(projectBuilder);
    projectBuilder.eq.mockReturnValue(projectBuilder);
    const latestVersionBuilder = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { contractor_role: "subcontractor" },
        error: null,
      }),
    };
    latestVersionBuilder.select.mockReturnValue(latestVersionBuilder);
    latestVersionBuilder.eq.mockReturnValue(latestVersionBuilder);
    latestVersionBuilder.order.mockReturnValue(latestVersionBuilder);
    latestVersionBuilder.limit.mockReturnValue(latestVersionBuilder);
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "estimate_templates") return templateBuilder;
        if (table === "estimate_template_items") return itemBuilder;
        if (table === "estimate_projects") return projectBuilder;
        if (table === "estimate_versions") return latestVersionBuilder;
        if (table === "tenant_calc_policies") return absentCalcPolicyBuilder();
        throw new Error(`Unexpected table: ${table}`);
      }),
    };
    mockSingleLineSnapshot({ ht: 2500, tax: 500, ttc: 3000 });

    await instantiateCanonicalEstimateV2FromTemplate({
      supabase: supabase as never,
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      templateId: template.id,
      project: { kind: "existing", id: PROJECT_ID },
      versionTitle: "Option B",
    });

    const payload = serviceRoleRpc.mock.calls[0]?.[1] as {
      p_project_id: string;
      p_project_payload: null;
      p_import_id: null;
      p_version_payload: Record<string, unknown>;
      p_items: Array<Record<string, unknown>>;
    };
    const section = payload.p_items.find((item) => item.item_type === "section")!;
    const line = payload.p_items.find((item) => item.item_type === "line")!;
    expect(payload.p_items.map((item) => item.item_type)).toEqual([
      "section",
      "line",
    ]);
    expect(payload).toMatchObject({
      p_project_id: PROJECT_ID,
      p_project_payload: null,
      p_import_id: null,
      p_version_payload: {
        title: "Option B",
        validite_jours: 45,
        margin_multiplier: 1.25,
        contractor_role: "subcontractor",
        calc_engine_version: 2,
        total_ht_cents: 2500,
        total_tax_cents: 500,
        total_ttc_cents: 3000,
      },
    });
    expect(section.id).not.toBe(sourceSectionId);
    expect(line.id).not.toBe(sourceLineId);
    expect(line.parent_id).toBe(section.id);
    expect(calculateEstimateSnapshotForItems).toHaveBeenCalledWith(
      expect.objectContaining({
        version: expect.objectContaining({
          contractor_role: "subcontractor",
        }),
      })
    );
  });
});

/**
 * Revue du sous-lot 2.5 (docs/testing/estimate-engine-v3-2.5.md §10.5). Isolation justifiée :
 * - l'import DPGF et la création rapide sont des actions serveur sans route ; sous politique 3, leur refus
 *   doit être nommé et définitif (ESTIMATE_ENGINE_UNAVAILABLE, conversions en 2.8), jamais le 409
 *   CONTEXT_CHANGED « rechargez la page », qui boucle (aucune attente de moteur n'est envoyée) ;
 * - course politique ↔ création : la politique peut changer entre la lecture TS (sans verrou) et la RPC.
 *   Les coefficients que le client n'a pas fournis restent à la RPC, qui lit la politique FOR SHARE sous le
 *   verrou consultatif (pgTAP F25-05) ; le TS n'envoie jamais les défauts qu'il a lus. Course non
 *   reproductible en E2E.
 */
describe("persistCanonicalEstimateV2 under tenant policy 3 (review of 2.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceRoleRpc.mockResolvedValue({
      data: { project: { id: PROJECT_ID }, version: { id: VERSION_ID } },
      error: null,
    });
    vi.mocked(calculateEstimateV3SnapshotForItems).mockResolvedValue({
      breakdown: {
        totals: {
          total_ht_cents: 0,
          total_tax_cents: 0,
          total_ttc_cents: 0,
          gross_ht_cents: 0,
          discount_applied_cents: 0,
          commercial_rounding_cents: 0,
        },
      },
      projection: {},
    } as never);
  });

  it("refuses a DPGF import by name, never as a retryable CONTEXT_CHANGED, and writes nothing", async () => {
    await expect(
      persistCanonicalEstimateV2({
        supabase: createSupabaseStub(POLICY_THREE) as never,
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        project: { kind: "new", id: PROJECT_ID, name: "Affaire importée" },
        source: { kind: "import", importId: IMPORT_ID, mappingId: null, filename: "dpgf.xlsx", items: [] },
      })
    ).rejects.toMatchObject({ code: "ESTIMATE_ENGINE_UNAVAILABLE", status: 409 });
    expect(serviceRoleRpc).not.toHaveBeenCalled();
  });

  it("leaves the default sale coefficients to the RPC's locked policy read and keeps supplied ones", async () => {
    const blankV3 = (version: { sale_coefficient_fo?: number } = {}) =>
      persistCanonicalEstimateV2({
        supabase: createSupabaseStub(POLICY_THREE) as never,
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        project: { kind: "new", id: PROJECT_ID, name: "Affaire v3" },
        version,
        source: { kind: "blank" },
        expectedCalcEngineVersion: 3,
      });
    await blankV3();
    await blankV3({ sale_coefficient_fo: 1 });

    const [unsupplied, supplied] = serviceRoleRpc.mock.calls.map(
      (call) => (call[1] as { p_version_payload: Record<string, unknown> }).p_version_payload
    );
    expect(unsupplied).toMatchObject({ calc_engine_version: 3, gross_ht_cents: 0, total_ht_cents: 0 });
    expect(unsupplied).not.toHaveProperty("sale_coefficient_fo");
    expect(unsupplied).not.toHaveProperty("sale_coefficient_mo");
    expect(supplied).toMatchObject({ calc_engine_version: 3, sale_coefficient_fo: 1 });
    expect(supplied).not.toHaveProperty("sale_coefficient_mo");
  });
});

/**
 * Revue Codex de la PR #33 (docs/testing/estimate-engine-v3-2.5.md §10.6), F4. Isolation justifiée : défaut de
 * charge utile entre le schéma de la route et la création canonique, que V3P01 ne voit pas (ses affaires n'ont
 * qu'une profondeur de sections, 3, la valeur par défaut) : `createEstimateVersionSchema` injectait
 * `max_section_depth: 3` quand le client l'omettait, et cette valeur remplaçait la profondeur de la dernière
 * version de l'affaire (1 ou 4), en v3 comme en v2 (même schéma, même étalement des réglages). Chaîne de
 * `POST /api/estimates` reproduite telle quelle : `createEstimateSchema.parse`, puis `createEstimate` retire
 * `expected_calc_engine_version` et transmet le reste comme réglages de version.
 */
describe("max_section_depth of a version created in an existing affaire (Codex review of PR #33)", () => {
  function existingProjectStub(policyRow: Record<string, unknown> | null, latestDepth: number) {
    const projectBuilder = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
      data: { id: PROJECT_ID, user_id: USER_ID }, error: null }) };
    projectBuilder.select.mockReturnValue(projectBuilder);
    projectBuilder.eq.mockReturnValue(projectBuilder);
    const latestVersionBuilder = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn()
      .mockResolvedValue({ data: { max_section_depth: latestDepth, tax_rate_bp: 2000, contractor_role: "principal" }, error: null }) };
    latestVersionBuilder.select.mockReturnValue(latestVersionBuilder);
    latestVersionBuilder.eq.mockReturnValue(latestVersionBuilder);
    latestVersionBuilder.order.mockReturnValue(latestVersionBuilder);
    latestVersionBuilder.limit.mockReturnValue(latestVersionBuilder);
    return {
      from: vi.fn((table: string) => {
        if (table === "estimate_projects") return projectBuilder;
        if (table === "estimate_versions") return latestVersionBuilder;
        if (table === "tenant_calc_policies") return absentCalcPolicyBuilder(policyRow);
        throw new Error(`Unexpected table: ${table}`);
      }),
    };
  }

  async function createThroughRoutePayload(policyRow: Record<string, unknown> | null, latestDepth: number,
    version: Record<string, unknown>, options: { creationMode?: "linked_dpgf_source"; source?: CreationSource } = {}) {
    const body = createEstimateSchema.parse({ project_id: PROJECT_ID, version,
      ...(options.creationMode ? { creation_mode: options.creationMode } : {}) });
    const { expected_calc_engine_version: expectedCalcEngineVersion, ...versionOverrides } = body.version ?? {};
    await persistCanonicalEstimateV2({
      supabase: existingProjectStub(policyRow, latestDepth) as never,
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      expectedCalcEngineVersion,
      project: { kind: "existing", id: PROJECT_ID },
      version: versionOverrides,
      source: options.source ?? { kind: "blank" },
    });
    const call = serviceRoleRpc.mock.calls.at(-1)?.[1] as { p_version_payload: Record<string, unknown> };
    return call.p_version_payload;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Une projection mise en file par un test qui refuse avant le calcul ne déborde pas sur le suivant.
    vi.mocked(calculateEstimateSnapshotForItems).mockReset();
    serviceRoleRpc.mockResolvedValue({
      data: { project: { id: PROJECT_ID }, version: { id: VERSION_ID } },
      error: null,
    });
    vi.mocked(calculateEstimateV3SnapshotForItems).mockResolvedValue({
      breakdown: { totals: { total_ht_cents: 0, total_tax_cents: 0, total_ttc_cents: 0, gross_ht_cents: 0,
        discount_applied_cents: 0, commercial_rounding_cents: 0 } },
      projection: {},
    } as never);
    vi.mocked(calculateEstimateSnapshotForItems).mockResolvedValue({
      context: { effective_margin_multiplier: 1, labor_split_enabled: false, labor_roles: [], margin_tiers: [] },
      breakdown: {
        lineById: new Map(), sectionById: new Map(), rootLineIds: [],
        totals: { saleTotalCents: 0, adjustedTaxCents: 0, roundedTtcCents: 0 },
        invariants: { matchesFooter: true, sumAllocatedHtCents: 0 },
      },
    } as never);
  });

  it("keeps the latest version's section depth for a blank v3 unless the caller supplies one", async () => {
    const inheritedShallow = await createThroughRoutePayload(POLICY_THREE, 1, { expected_calc_engine_version: 3 });
    const inheritedDeep = await createThroughRoutePayload(POLICY_THREE, 4, { expected_calc_engine_version: 3 });
    const supplied = await createThroughRoutePayload(POLICY_THREE, 1, { expected_calc_engine_version: 3, max_section_depth: 4 });

    expect([inheritedShallow, inheritedDeep, supplied].map((payload) =>
      [payload.calc_engine_version, payload.max_section_depth])).toEqual([[3, 1], [3, 4], [3, 4]]);
  });

  it("keeps the latest version's section depth for a v2 too (same schema default, same settings spread)", async () => {
    const inherited = await createThroughRoutePayload(null, 1, {});
    const supplied = await createThroughRoutePayload(null, 1, { max_section_depth: 2 });

    expect([inherited, supplied].map((payload) => [payload.calc_engine_version, payload.max_section_depth]))
      .toEqual([[2, 1], [2, 2]]);
  });

  /**
   * Revue de suivi de F4 (§10.6). Sans le défaut 3 du schéma, une version créée avec du contenu dans une affaire
   * existante hérite de la profondeur de la dernière version. Défaillances visées, non vues en E2E (aucun parcours ne
   * crée de version dans une affaire de profondeur 1 ou 2) :
   * 1. assistant « source DPGF liée » (`POST /api/estimates`, `creation_mode=linked_dpgf_source`, le client n'envoie
   *    jamais de profondeur) dans une affaire à 1 : la racine d'import (niveau 1) et ses sections (2, 3) dépassent 1,
   *    `validate_estimate_item_hierarchy_depth` refuse l'insertion et la création échoue, opaque
   *    (`ESTIMATE_CANONICAL_V2_PERSIST_FAILED`) ; elle réussissait à 3 avant `f9d5a0b5` ;
   * 2. même défaut, antérieur, pour l'import confirmé dans une affaire existante (`confirmUnifiedImportFlow`, réglages
   *    sans profondeur) et pour un modèle plus profond que la dernière version ;
   * 3. sur-correction : une affaire à 4 ramenée au besoin du contenu (3), ou un import sans section approfondi ;
   * 4. une profondeur fournie trop faible pour le contenu : refus nommé (400) avant toute écriture, jamais l'échec
   *    opaque de la RPC.
   */
  function dpgfImport(sectionLevels: Array<1 | 2>): CreationSource {
    return {
      kind: "import",
      importId: IMPORT_ID,
      mappingId: null,
      filename: "dpgf.xlsx",
      items: [
        ...sectionLevels.map((level, index) => ({
          item_type: "section" as const,
          mapped_row_id: `mapped-section-${index + 1}`,
          row_index: index + 1,
          title: `Section ${index + 1}`,
          section_level: level,
          source_page: null,
          source_metadata: {},
        })),
        {
          item_type: "line" as const,
          mapped_row_id: "mapped-line-1",
          row_index: sectionLevels.length + 1,
          title: "Tube",
          description: "ml",
          notes: null,
          source_page: null,
          source_metadata: {},
          quantity: 1,
          unit_price_ht_cents: 1000,
          tax_rate_bp: 2000,
          k_fo: 1,
          h_mo: 0,
          h_mo_majoration: 1,
          k_mo: 1,
          pu_ht_cents: 1000,
          line_total_ht_cents: 1000,
          line_tax_cents: 200,
          line_total_ttc_cents: 1200,
        },
      ],
    };
  }

  function templateItem(id: string, parentId: string | null, itemType: "section" | "line") {
    return {
      id, parent_id: parentId, item_type: itemType, position: 1, title: itemType === "line" ? "Tube" : `Section ${id}`,
      description: null, quantity: itemType === "line" ? 1 : null, unit_price_ht_cents: itemType === "line" ? 1000 : null,
      tax_rate_bp: itemType === "line" ? 2000 : null, k_fo: itemType === "line" ? 1 : null, h_mo: null,
      h_mo_majoration: 1, k_mo: null, h_mo_atelier: null, k_mo_atelier: 1, labor_role_atelier_id: null,
      h_mo_chantier: null, k_mo_chantier: 1, labor_role_chantier_id: null, pu_ht_cents: null, labor_role_id: null,
      category_id: null, supply_type_id: null, line_total_ht_cents: null, line_tax_cents: null, line_total_ttc_cents: null,
    };
  }

  it("gives an import into an existing affaire the depth its sections need, never less than the inherited depth", async () => {
    const wizard = (latestDepth: number, sectionLevels: Array<1 | 2>) => {
      mockSingleLineSnapshot({ ht: 1000, tax: 200, ttc: 1200 });
      return createThroughRoutePayload(null, latestDepth, { title: "Variante DPGF", validite_jours: 30 },
        { creationMode: "linked_dpgf_source", source: dpgfImport(sectionLevels) });
    };
    const twoLevels = await wizard(1, [1, 2]);
    const oneLevel = await wizard(1, [1]);
    const deeperAffaire = await wizard(4, [1, 2]);
    const rootLinesOnly = await wizard(1, []);
    // Import confirmé dans une affaire existante (`confirmUnifiedImportFlow`) : réglages sans profondeur, hors schéma.
    mockSingleLineSnapshot({ ht: 1000, tax: 200, ttc: 1200 });
    await persistCanonicalEstimateV2({
      supabase: existingProjectStub(null, 1) as never,
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      project: { kind: "existing", id: PROJECT_ID },
      version: { title: "Import DPGF" },
      source: dpgfImport([1, 2]),
    });
    const confirmedImport = (serviceRoleRpc.mock.calls.at(-1)?.[1] as { p_version_payload: Record<string, unknown> })
      .p_version_payload;

    expect([twoLevels, oneLevel, deeperAffaire, rootLinesOnly, confirmedImport].map((payload) =>
      [payload.calc_engine_version, payload.max_section_depth])).toEqual([[2, 3], [2, 2], [2, 4], [2, 1], [2, 3]]);
  });

  it("gives a template cloned into an existing affaire the depth of its hierarchy", async () => {
    mockSingleLineSnapshot({ ht: 1000, tax: 200, ttc: 1200 });
    await persistCanonicalEstimateV2({
      supabase: existingProjectStub(null, 1) as never,
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      project: { kind: "existing", id: PROJECT_ID },
      version: { title: "Option modèle" },
      source: { kind: "template", items: [templateItem("lot", null, "section"),
        templateItem("chapitre", "lot", "section"), templateItem("ligne", "chapitre", "line")] },
    });
    const payload = (serviceRoleRpc.mock.calls.at(-1)?.[1] as { p_version_payload: Record<string, unknown> })
      .p_version_payload;

    expect([payload.calc_engine_version, payload.max_section_depth]).toEqual([2, 2]);
  });

  it("refuses by name, before any write, a supplied depth too shallow for the imported sections", async () => {
    mockSingleLineSnapshot({ ht: 1000, tax: 200, ttc: 1200 });

    await expect(createThroughRoutePayload(null, 4, { title: "Variante DPGF", max_section_depth: 2 },
      { creationMode: "linked_dpgf_source", source: dpgfImport([1, 2]) })).rejects.toMatchObject({
      status: 400,
      code: "ESTIMATE_SECTION_DEPTH_TOO_SHALLOW",
      details: { max_section_depth: 2, required_section_depth: 3 },
    });
    expect(serviceRoleRpc).not.toHaveBeenCalled();
  });
});
