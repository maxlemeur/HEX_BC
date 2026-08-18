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
  };
});

import { calculateEstimateSnapshotForItems } from "@/lib/estimates/version-totals";

import {
  instantiateCanonicalEstimateV2FromTemplate,
  persistCanonicalEstimateV2,
} from "./canonical-v2-creation";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const IMPORT_ID = "55555555-5555-4555-8555-555555555555";

function createSupabaseStub() {
  return {
    from: vi.fn((table: string) => {
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
