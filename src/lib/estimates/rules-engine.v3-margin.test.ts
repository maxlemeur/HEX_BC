import { describe, expect, it } from "vitest";

import { evaluateRules, type RulesEngineVersion } from "@/lib/estimates/rules-engine";

/**
 * Contrat de la preuve vivante de marque v3 que 2.5 exporte de
 * `src/lib/estimates/v3-margin-evidence-server.ts` et que `evaluateRules` reçoit en
 * `v3MarginEvidence`. Recopié ici tant que le module n'existe pas : le build de production
 * vérifie aussi les tests, et le parcours E2E rouge doit pouvoir s'y construire. L'implémentation
 * remplace ce type par `import type { V3MarginEvidence }` depuis ce module.
 */
type V3MarginEvidence = {
  source: "authenticated_live";
  version: { id: string; tenant_id: string; project_id: string; status: string; content_revision: number; updated_at: string };
  /** HT net N, égal à `version.total_ht_cents`. */
  net_ht_cents: number;
  /** Déboursé Σ D (§4.5). */
  cost_subtotal_cents: number;
};

/**
 * Lot 2, sous-lot 2.5 — règle `min_margin` sur une v3 (conception D5, F20, T-MARG du §5.3).
 *
 * Isolation justifiée par l'intégrité des règles : le parcours `engine-v3-persistence` ne voit
 * que la marque d'un devis gelé et approuvable (11,71 %). Il ne peut pas montrer, sans rendre la
 * campagne dépendante d'une règle d'entreprise bloquante partagée par les parcours concurrents :
 *  - qu'un brouillon v3 sans preuve de marque donne « indisponible » et jamais une marque de 0 %
 *    (F20 : `resolveEffectiveMarginBp(version) ?? 0` lève aujourd'hui une violation fausse) ;
 *  - qu'une preuve périmée, un gel périmé, un HT nul ou la clé v2 `effective_margin_multiplier`
 *    ne sont jamais lus comme la marque nette v3 ;
 *  - la paire T-MARG : 0 % viole un minimum de 15 %, 20 % ne le viole pas.
 * Défaillances écrites avant le code (docs/testing/estimate-engine-v3-2.5-e2e.md, R-01 à R-05) :
 *  R-01 brouillon v3 sans preuve → violation à 0 au lieu d'un signal indisponible ;
 *  R-02 preuve d'une autre révision, gel périmé ou HT nul → marque inventée ;
 *  R-03 contexte v3 lu par le multiplicateur v2 (marque prise sur `effective_margin_multiplier`) ;
 *  R-04 T-MARG : la marque ne suit pas la preuve (0 % et 20 % confondus) ;
 *  R-05 gel v3 frais : la marque n'est pas (HT − déboursé) / HT, arrondie au point de base ½↑.
 */

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const RULE_ID = "11111111-1111-4111-8111-111111111111";
const UPDATED_AT = "2026-10-17T10:00:00.000Z";

function supabaseWithRules(rules: unknown[]) {
  const rulesBuilder = {
    eq: () => rulesBuilder,
    order: () => Promise.resolve({ data: rules, error: null }),
  };
  const approvalsBuilder = {
    eq: () => approvalsBuilder,
    in: () => approvalsBuilder,
    is: () => approvalsBuilder,
    order: () => Promise.resolve({ data: [], error: null }),
  };
  return {
    rpc: (name: string) => {
      throw new Error(`Unexpected RPC: ${name}`);
    },
    from: (table: string) => {
      if (table === "estimate_rules") return { select: () => rulesBuilder };
      if (table === "estimate_approvals") return { select: () => approvalsBuilder };
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function minMarginRule(thresholdBp: number) {
  return {
    id: RULE_ID,
    created_at: "2026-10-17T09:00:00.000Z",
    updated_at: "2026-10-17T09:00:00.000Z",
    tenant_id: TENANT_ID,
    rule_type: "min_margin",
    scope_type: "global",
    scope_id: null,
    threshold_value: thresholdBp,
    action: "block",
    is_active: true,
  };
}

/** Une v3 a la forme imposée par le CHECK de M4 : marge fixe à 1, coefficient global à 1. */
function v3Draft(overrides: Partial<RulesEngineVersion> = {}): RulesEngineVersion {
  return {
    id: VERSION_ID,
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    status: "draft",
    updated_at: UPDATED_AT,
    calc_engine_version: 3,
    margin_mode: "fixed",
    margin_multiplier: 1,
    margin_bp: 0,
    discount_bp: 2000,
    discount_amount_cents: null,
    total_ht_cents: 48000,
    content_revision: 7,
    calc_snapshot_content_revision: null,
    calc_snapshot_context: null,
    ...overrides,
  };
}

function liveEvidence(netHtCents: number, costSubtotalCents: number, contentRevision = 7): V3MarginEvidence {
  return {
    source: "authenticated_live",
    version: {
      id: VERSION_ID, tenant_id: TENANT_ID, project_id: PROJECT_ID,
      status: "draft", content_revision: contentRevision, updated_at: UPDATED_AT,
    },
    net_ht_cents: netHtCents,
    cost_subtotal_cents: costSubtotalCents,
  };
}

async function evaluateMinMargin(version: RulesEngineVersion, thresholdBp: number, v3MarginEvidence?: V3MarginEvidence | null) {
  // Variable, not a fresh literal: `v3MarginEvidence` is the input 2.5 adds to evaluateRules.
  const input: Parameters<typeof evaluateRules>[0] & { v3MarginEvidence?: V3MarginEvidence | null } = {
    supabase: supabaseWithRules([minMarginRule(thresholdBp)]) as never,
    tenantId: TENANT_ID,
    version,
    project: { id: PROJECT_ID, client_name: "Client v3" },
    items: [],
    v3MarginEvidence,
  };
  return evaluateRules(input);
}

const unavailableMargin = {
  rule_id: RULE_ID,
  rule_type: "min_margin",
  metric_key: "margin_bp",
  comparator: ">=",
  source_state: "unavailable",
  action: "block",
};

describe("min_margin on a v3 version (lot 2, sous-lot 2.5)", () => {
  it("R-01 reports an unavailable margin, never a 0 % violation, for a v3 draft without margin evidence", async () => {
    const result = await evaluateMinMargin(v3Draft(), 1500);

    expect(result.violations).toEqual([]);
    expect(result.unavailableSignals).toEqual([expect.objectContaining(unavailableMargin)]);
  });

  it("R-02 never invents a margin from evidence of another revision, a stale freeze or a zero HT", async () => {
    const staleEvidence = await evaluateMinMargin(v3Draft(), 1500, liveEvidence(48000, 48000, 6));
    const staleFreeze = await evaluateMinMargin(v3Draft({
      calc_snapshot_content_revision: 6,
      calc_snapshot_context: { engine: 3, cost_subtotal_cents: 48000 },
    }), 1500);
    const zeroHt = await evaluateMinMargin(v3Draft({ total_ht_cents: 0 }), 1500, liveEvidence(0, 0));

    for (const result of [staleEvidence, staleFreeze, zeroHt]) {
      expect(result.violations).toEqual([]);
      expect(result.unavailableSignals).toEqual([expect.objectContaining(unavailableMargin)]);
    }
  });

  it("R-03 reads a fresh v3 freeze through cost_subtotal_cents, never through the v2 multiplier key", async () => {
    // HT 60 000, déboursé 48 000 : marque nette 20 %. Lue par la clé v2 égarée (×1,1), elle
    // tomberait à 9,09 % et violerait le minimum de 15 %.
    const sent = v3Draft({
      status: "sent", discount_bp: 0, total_ht_cents: 60000,
      calc_snapshot_content_revision: 7,
      calc_snapshot_context: { engine: 3, cost_subtotal_cents: 48000, effective_margin_multiplier: 1.1 },
    });
    const passing = await evaluateMinMargin(sent, 1500);
    const exact = await evaluateMinMargin(sent, 2001);

    expect(passing).toMatchObject({ violations: [], unavailableSignals: [] });
    expect(exact.violations).toEqual([
      expect.objectContaining({ rule_type: "min_margin", metric_key: "margin_bp", actual_value: 2000, threshold_value: 2001, source_state: "ready" }),
    ]);
  });

  it("R-04 T-MARG: c 1,25 / 1,25 with a 20 % discount leaves 0 % and violates 15 %, the same draft without discount (20 %) does not", async () => {
    // T-MARG (§5.3, entrées de oracle.fixtures.ts) : Q 4, PR 10 000 c, 0,5 h/u à 4 000 c/h ;
    // brut 60 000, déboursé 48 000 ; remise 20 % → HT 48 000, marque nette 0 %.
    const discounted = await evaluateMinMargin(v3Draft(), 1500, liveEvidence(48000, 48000));
    const undiscounted = await evaluateMinMargin(v3Draft({ discount_bp: 0, total_ht_cents: 60000 }), 1500, liveEvidence(60000, 48000));

    expect(discounted.unavailableSignals).toEqual([]);
    expect(discounted.violations).toEqual([
      expect.objectContaining({ rule_type: "min_margin", metric_key: "margin_bp", actual_value: 0, threshold_value: 1500, source_state: "ready" }),
    ]);
    expect(undiscounted).toMatchObject({ violations: [], unavailableSignals: [] });
  });

  it("R-05 uses the half-up basis-point net margin of the frozen oracle (S3, TVA 10 %): 1 171 bp", async () => {
    // (6 214 910 − 5 487 177) × 10 000 / 6 214 910 = 1 170,95 → 1 171 (computeEstimateV3NetMarginBp).
    const frozen = v3Draft({
      status: "draft", discount_bp: 1000, total_ht_cents: 6214910,
      calc_snapshot_content_revision: 7,
      calc_snapshot_context: { engine: 3, cost_subtotal_cents: 5487177 },
    });
    const above = await evaluateMinMargin(frozen, 1172);
    const at = await evaluateMinMargin(frozen, 1171);

    expect(above.violations).toEqual([
      expect.objectContaining({ rule_type: "min_margin", actual_value: 1171, threshold_value: 1172, source_state: "ready" }),
    ]);
    expect(at).toMatchObject({ violations: [], unavailableSignals: [] });
  });
});
