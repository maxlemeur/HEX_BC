import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock hoiste AVANT les imports : neutralise @/lib/feature-flags, qui importe
// createSupabaseServerClient (donc next/headers) au niveau module.
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: vi.fn(),
}));

import {
  ESTIMATE_CALC_CONTEXT_VERSION_COLUMNS,
  ESTIMATE_LABOR_SPLIT_FLAG_KEY,
  loadEstimateCalcContext,
} from "@/lib/estimates/calc-context";
import { isFeatureEnabled } from "@/lib/feature-flags";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";

type SupabaseErrorLike = { code: string; message: string } | null;

type QueryResult = {
  data: unknown;
  error: SupabaseErrorLike;
};

/** Terminal `single()` — table `estimate_versions`. */
function createSingleBuilder(result: QueryResult) {
  const builder = {
    eq: vi.fn(),
    single: vi.fn(),
  };
  builder.eq.mockReturnValue(builder);
  builder.single.mockResolvedValue(result);
  return builder;
}

/**
 * Terminal `order()` au N-ieme appel — copie de gating.test.ts:34-49.
 * `estimate_items` resout au 1er `order()`, `margin_tiers` au 2e.
 */
function createOrderBuilder(result: QueryResult, requiredOrders = 1) {
  let orderCallCount = 0;
  const builder = {
    eq: vi.fn(),
    order: vi.fn(),
  };
  builder.eq.mockReturnValue(builder);
  builder.order.mockImplementation(() => {
    orderCallCount += 1;
    if (orderCallCount >= requiredOrders) {
      return Promise.resolve(result);
    }
    return builder;
  });
  return builder;
}

/** Terminal `in()` — table `labor_roles`. */
function createInBuilder(result: QueryResult) {
  const builder = {
    eq: vi.fn(),
    in: vi.fn(),
  };
  builder.eq.mockReturnValue(builder);
  builder.in.mockResolvedValue(result);
  return builder;
}

type SupabaseMockInput = {
  version?: unknown;
  versionError?: SupabaseErrorLike;
  items?: unknown[];
  itemsError?: SupabaseErrorLike;
  marginTiers?: unknown[];
  marginTiersError?: SupabaseErrorLike;
  laborRoles?: unknown[];
  laborRolesError?: SupabaseErrorLike;
};

function makeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    version_number: 3,
    status: "draft",
    title: "Devis test",
    exclusions: null,
    date_devis: "2026-07-24",
    validite_jours: 30,
    currency: "EUR",
    margin_multiplier: 1.6,
    margin_mode: "fixed",
    discount_bp: 500,
    discount_mode: "simple",
    discount_steps: [],
    global_coefficient: 1,
    tax_rate_bp: 2_000,
    rounding_mode: "none",
    rounding_step_cents: 0,
    total_ht_cents: 100_000,
    total_tax_cents: 20_000,
    total_ttc_cents: 120_000,
    seal_hash: null,
    calc_engine_version: 1,
    ...overrides,
  };
}

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "line-1",
    item_type: "line",
    parent_id: "sec-1",
    position: 0,
    quantity: 1,
    unit_price_ht_cents: 10_000,
    labor_role_id: "role-1",
    labor_role_atelier_id: null,
    labor_role_chantier_id: null,
    ...overrides,
  };
}

function createCalcContextSupabaseMock(input: SupabaseMockInput = {}) {
  const builders = {
    estimate_versions: createSingleBuilder({
      data: input.versionError ? null : (input.version ?? makeVersion()),
      error: input.versionError ?? null,
    }),
    estimate_items: createOrderBuilder(
      {
        data: input.itemsError ? null : (input.items ?? []),
        error: input.itemsError ?? null,
      },
      1
    ),
    margin_tiers: createOrderBuilder(
      {
        data: input.marginTiersError ? null : (input.marginTiers ?? []),
        error: input.marginTiersError ?? null,
      },
      2
    ),
    labor_roles: createInBuilder({
      data: input.laborRolesError ? null : (input.laborRoles ?? []),
      error: input.laborRolesError ?? null,
    }),
  };

  const selects = {
    estimate_versions: vi.fn(() => builders.estimate_versions),
    estimate_items: vi.fn(() => builders.estimate_items),
    margin_tiers: vi.fn(() => builders.margin_tiers),
    labor_roles: vi.fn(() => builders.labor_roles),
  };

  const client = {
    from: vi.fn((table: string) => {
      if (table in selects) {
        return { select: selects[table as keyof typeof selects] };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { client, builders, selects };
}

function asSupabase(client: unknown) {
  return client as unknown as Parameters<typeof loadEstimateCalcContext>[0];
}

describe("loadEstimateCalcContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
  });

  it("charge la version, les items tries et les taux horaires", async () => {
    const { client } = createCalcContextSupabaseMock({
      items: [
        makeItem({ id: "sec-1", item_type: "section", parent_id: null, position: 0 }),
        makeItem({ id: "line-1", position: 1, labor_role_id: "role-1" }),
      ],
      laborRoles: [{ id: "role-1", hourly_rate_cents: 4_500 }],
    });

    const context = await loadEstimateCalcContext(asSupabase(client), VERSION_ID);

    expect(context.version.id).toBe(VERSION_ID);
    expect(context.version.tenant_id).toBe(TENANT_ID);
    // Superset : la section est conservee (computeAllSectionTotals en a besoin).
    expect(context.items.map((item) => item.id)).toEqual(["sec-1", "line-1"]);
    expect(context.laborRateById.get("role-1")).toBe(4_500);
    expect(context.isLaborSplitEnabled).toBe(false);
  });

  it("selectionne calc_engine_version sur estimate_versions", async () => {
    const { client, selects } = createCalcContextSupabaseMock();

    await loadEstimateCalcContext(asSupabase(client), VERSION_ID);

    expect(selects.estimate_versions).toHaveBeenCalledWith(
      ESTIMATE_CALC_CONTEXT_VERSION_COLUMNS
    );
    expect(ESTIMATE_CALC_CONTEXT_VERSION_COLUMNS).toContain("calc_engine_version");
  });

  // --- Assertion D.3 #1 -----------------------------------------------------
  it("filtre labor_roles sur tenant_id et JAMAIS sur user_id", async () => {
    const { client, builders } = createCalcContextSupabaseMock({
      items: [makeItem({ labor_role_id: "role-1" })],
      laborRoles: [{ id: "role-1", hourly_rate_cents: 4_500 }],
    });

    await loadEstimateCalcContext(asSupabase(client), VERSION_ID);

    expect(builders.labor_roles.eq).toHaveBeenCalledWith("tenant_id", TENANT_ID);
    // Verrouille la convergence tranchee en phase A : server.ts est aujourd'hui
    // le seul site a filtrer sur project.user_id ; le contexte unifie ne le
    // fait pas. L'ecart ne se materialise qu'a la phase B, au rebranchement.
    expect(builders.labor_roles.eq).not.toHaveBeenCalledWith(
      "user_id",
      expect.anything()
    );
    expect(builders.labor_roles.in).toHaveBeenCalledWith("id", ["role-1"]);
  });

  it("collecte les 3 colonnes de role et n'interroge pas labor_roles sans id", async () => {
    const withRoles = createCalcContextSupabaseMock({
      items: [
        makeItem({
          id: "line-1",
          labor_role_id: "role-1",
          labor_role_atelier_id: "role-atelier",
          labor_role_chantier_id: "role-chantier",
        }),
        makeItem({ id: "line-2", labor_role_id: "role-1" }),
      ],
      laborRoles: [
        { id: "role-1", hourly_rate_cents: 4_500 },
        { id: "role-atelier", hourly_rate_cents: 3_800 },
        { id: "role-chantier", hourly_rate_cents: 5_200 },
      ],
    });

    await loadEstimateCalcContext(asSupabase(withRoles.client), VERSION_ID);

    expect(withRoles.builders.labor_roles.in).toHaveBeenCalledWith("id", [
      "role-1",
      "role-atelier",
      "role-chantier",
    ]);

    const withoutRoles = createCalcContextSupabaseMock({
      items: [makeItem({ labor_role_id: null })],
    });

    const context = await loadEstimateCalcContext(
      asSupabase(withoutRoles.client),
      VERSION_ID
    );

    expect(withoutRoles.builders.labor_roles.in).not.toHaveBeenCalled();
    expect(context.laborRateById.size).toBe(0);
  });

  // --- Assertion D.3 #2 -----------------------------------------------------
  it("trie les items par position croissante et les borne au tenant et a la version", async () => {
    const { client, builders, selects } = createCalcContextSupabaseMock({
      items: [makeItem()],
    });

    await loadEstimateCalcContext(asSupabase(client), VERSION_ID);

    expect(selects.estimate_items).toHaveBeenCalledWith("*");
    expect(builders.estimate_items.order).toHaveBeenCalledWith("position", {
      ascending: true,
    });
    expect(builders.estimate_items.eq).toHaveBeenCalledWith("tenant_id", TENANT_ID);
    expect(builders.estimate_items.eq).toHaveBeenCalledWith("version_id", VERSION_ID);
  });

  // --- Assertion D.3 #3 -----------------------------------------------------
  it("lit le flag de split MO une seule fois, avec le client injecte", async () => {
    const { client } = createCalcContextSupabaseMock();
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);

    const context = await loadEstimateCalcContext(asSupabase(client), VERSION_ID);

    expect(isFeatureEnabled).toHaveBeenCalledTimes(1);
    expect(isFeatureEnabled).toHaveBeenCalledWith(
      TENANT_ID,
      ESTIMATE_LABOR_SPLIT_FLAG_KEY,
      { supabase: client }
    );
    expect(ESTIMATE_LABOR_SPLIT_FLAG_KEY).toBe("EST_031_LABOR_SPLIT");
    expect(context.isLaborSplitEnabled).toBe(true);
  });

  // --- Assertion D.3 #4 -----------------------------------------------------
  it("charge toujours le bareme de marge, meme en margin_mode fixed", async () => {
    const { client, builders, selects } = createCalcContextSupabaseMock({
      version: makeVersion({ margin_mode: "fixed" }),
      marginTiers: [
        { threshold_cents: 0, multiplier: 1.25 },
        { threshold_cents: 5_000_000, multiplier: 1.35 },
      ],
    });

    const context = await loadEstimateCalcContext(asSupabase(client), VERSION_ID);

    expect(selects.margin_tiers).toHaveBeenCalledWith("threshold_cents, multiplier");
    expect(builders.margin_tiers.eq).toHaveBeenCalledWith("tenant_id", TENANT_ID);
    expect(builders.margin_tiers.order).toHaveBeenNthCalledWith(1, "threshold_cents", {
      ascending: true,
    });
    expect(builders.margin_tiers.order).toHaveBeenNthCalledWith(2, "position", {
      ascending: true,
    });
    expect(context.marginTiers).toEqual([
      { threshold_cents: 0, multiplier: 1.25 },
      { threshold_cents: 5_000_000, multiplier: 1.35 },
    ]);
  });

  it("renvoie [] quand le tenant n'a pas de bareme, sans replier sur les defauts", async () => {
    const { client } = createCalcContextSupabaseMock({ marginTiers: [] });

    const context = await loadEstimateCalcContext(asSupabase(client), VERSION_ID);

    // Surtout PAS DEFAULT_MARGIN_TIERS (1.6 / 1.45 / 1.4) : le repli est fait
    // par computeEstimateTotals, et le masquer ici cacherait la divergence
    // "bareme tenant vs defauts" que la phase B doit corriger.
    expect(context.marginTiers).toEqual([]);
    expect(context.marginTiers.map((tier) => tier.multiplier)).not.toContain(1.6);
  });

  // --- Assertion D.3 #5 -----------------------------------------------------
  it("resout la version du moteur de calcul, avec repli sur 1 pour les valeurs aberrantes", async () => {
    const nominal = createCalcContextSupabaseMock({
      version: makeVersion({ calc_engine_version: 1 }),
    });
    await expect(
      loadEstimateCalcContext(asSupabase(nominal.client), VERSION_ID)
    ).resolves.toMatchObject({ calcEngineVersion: 1 });

    for (const aberrant of [0, 7, null]) {
      const mock = createCalcContextSupabaseMock({
        version: makeVersion({ calc_engine_version: aberrant }),
      });
      const context = await loadEstimateCalcContext(
        asSupabase(mock.client),
        VERSION_ID
      );
      expect(context.calcEngineVersion).toBe(1);
    }
  });

  // --- Assertion D.3 #6 -----------------------------------------------------
  it("alimente les 3 Map de taux depuis la meme colonne hourly_rate_cents", async () => {
    const { client } = createCalcContextSupabaseMock({
      items: [
        makeItem({
          labor_role_id: "role-1",
          labor_role_atelier_id: "role-atelier",
          labor_role_chantier_id: "role-chantier",
        }),
      ],
      laborRoles: [
        { id: "role-1", hourly_rate_cents: 4_500 },
        { id: "role-atelier", hourly_rate_cents: 3_800 },
        { id: "role-chantier", hourly_rate_cents: 5_200 },
      ],
    });

    const context = await loadEstimateCalcContext(asSupabase(client), VERSION_ID);

    // Fige le fait qu'aucune colonne hourly_rate_atelier_cents /
    // hourly_rate_chantier_cents n'existe en base aujourd'hui.
    expect(context.laborRateAtelierById.get("role-1")).toBe(
      context.laborRateById.get("role-1")
    );
    expect(context.laborRateChantierById.get("role-1")).toBe(
      context.laborRateById.get("role-1")
    );
    expect([...context.laborRateAtelierById.entries()]).toEqual([
      ...context.laborRateById.entries(),
    ]);
    expect([...context.laborRateChantierById.entries()]).toEqual([
      ...context.laborRateById.entries(),
    ]);
    // Trois instances distinctes : la phase B pourra les faire diverger sans
    // changer la signature du contexte.
    expect(context.laborRateAtelierById).not.toBe(context.laborRateById);
    expect(context.laborRateChantierById).not.toBe(context.laborRateById);
  });

  // --- Assertion D.3 #7 -----------------------------------------------------
  it("rejette quand expectedTenantId ne correspond pas au tenant de la version", async () => {
    const { client, builders } = createCalcContextSupabaseMock();

    await expect(
      loadEstimateCalcContext(asSupabase(client), VERSION_ID, {
        expectedTenantId: OTHER_TENANT_ID,
      })
    ).rejects.toThrow("Version de devis introuvable.");

    // Le pre-controle coupe avant toute autre requete.
    expect(builders.estimate_items.order).not.toHaveBeenCalled();
    expect(isFeatureEnabled).not.toHaveBeenCalled();
  });

  it("accepte un expectedTenantId qui correspond", async () => {
    const { client } = createCalcContextSupabaseMock();

    await expect(
      loadEstimateCalcContext(asSupabase(client), VERSION_ID, {
        expectedTenantId: TENANT_ID,
      })
    ).resolves.toMatchObject({ calcEngineVersion: 1 });
  });

  // --- Assertion D.3 #8 -----------------------------------------------------
  it("propage une erreur Supabase sur labor_roles au lieu de continuer a taux 0", async () => {
    const { client } = createCalcContextSupabaseMock({
      items: [makeItem({ labor_role_id: "role-1" })],
      laborRolesError: { code: "PGRST301", message: "boom" },
    });

    // Convergence sur le throw de server.ts / pdf-generator : le portail
    // continue aujourd'hui silencieusement avec des taux a 0.
    await expect(
      loadEstimateCalcContext(asSupabase(client), VERSION_ID)
    ).rejects.toThrow("Impossible de charger le contexte de calcul du devis.");
  });

  it("propage les erreurs Supabase des autres requetes", async () => {
    const versionMock = createCalcContextSupabaseMock({
      versionError: { code: "PGRST116", message: "no rows" },
    });
    await expect(
      loadEstimateCalcContext(asSupabase(versionMock.client), VERSION_ID)
    ).rejects.toThrow();

    const itemsMock = createCalcContextSupabaseMock({
      itemsError: { code: "PGRST301", message: "boom" },
    });
    await expect(
      loadEstimateCalcContext(asSupabase(itemsMock.client), VERSION_ID)
    ).rejects.toThrow("Impossible de charger le contexte de calcul du devis.");

    const tiersMock = createCalcContextSupabaseMock({
      marginTiersError: { code: "PGRST301", message: "boom" },
    });
    await expect(
      loadEstimateCalcContext(asSupabase(tiersMock.client), VERSION_ID)
    ).rejects.toThrow("Impossible de charger le contexte de calcul du devis.");
  });

  it("ne calcule rien : le module source n'importe aucune fonction de calcul", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("./calc-context.ts", import.meta.url),
        "utf8"
      )
    );

    // Pur chargeur : aucune fonction de calcul importee.
    expect(source).not.toMatch(/from "@\/lib\/estimate-calculations"/);
    // Client injecte : aucune fabrique de client Supabase importee, meme en
    // type-only, pour que le module reste utilisable et testable partout.
    expect(source).not.toMatch(/from "@\/lib\/supabase\/server"/);
    expect(source).not.toMatch(/from "@\/lib\/supabase\/service-role"/);
    expect(source).not.toMatch(/createSupabaseServerClient\(/);
  });
});
