import { expect } from "e2e";

import { apiRequest, armyTest, createLineViaApi, ownEstimate, readEstimate, recordEvidence } from "../critical/fixtures";
import { querySql } from "./calculation-gate-support";
import { signUpDedicatedOwner } from "./dedicated-owner";
import { assertOwnedLocalBackend, inputValue, openSettings, type Envelope, type Ui } from "./engine-v3-editor-support";
import { setTenantCalcPolicy, type V3Owner } from "./engine-v3-persistence-support";

// Lot 2, sous-lot 2.10b — bascule du moteur des nouvelles versions (M8,
// docs/testing/estimate-engine-v3-2.10.md §3). Défaillances observables, écrites avant M8 :
//  F210-01 Sans ligne de politique, une création qui annonce le moteur 3 est refusée (absente = 2), ou crée une v3
//          sans les coefficients documentés 1,30 / 1,20 (P-02), ou écrit une ligne de politique.
//  F210-02 Sans ligne de politique, un ancien bundle (création sans attente de moteur) crée une v2 ou une v3 au
//          lieu d'échouer fermé avec CONTEXT_CHANGED, sans rien écrire (D3).
//  F210-07 Une v2 dupliquée alors que son entreprise crée des v3 devient une v3, change un montant, ou sa source
//          change (D17, P-15).
// V3S01 est le rouge de M8 (absente → 2 avant la bascule). V3S02 est une garde : verte avant M8, elle doit le
// rester après. Chaque parcours tourne sur son propre propriétaire (dedicated-owner.ts) : V3S01 sans ligne de
// politique (le défaut d'une entreprise neuve), V3S02 en politique 2 explicite puis 3 par l'unique écrivain.
const options = { session: "army", tags: ["critical", "local", "engine-v3"], timeout: 240_000 } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NEUTRAL_VERSION = {
  margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, discount_bp: 0, discount_mode: "simple", discount_steps: [],
  global_coefficient: 1, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 1,
  currency: "EUR", contractor_role: "principal",
} as const;
type Created = { project: { id: string }; version: { id: string; calc_engine_version: number } };

function uuid(value: string) {
  if (!UUID.test(value)) throw new Error("Invalid identity.");
  return value;
}

/** Policy row and journal of the owner's tenant, read as the native owner of the owned stack. */
async function policyState(owner: V3Owner) {
  const [row] = await querySql(`SELECT jsonb_build_object(
  'rows', (SELECT count(*) FROM public.tenant_calc_policies p WHERE p.tenant_id = '${uuid(owner.tenantId)}'),
  'engine', (SELECT p.new_estimate_calc_engine FROM public.tenant_calc_policies p WHERE p.tenant_id = '${owner.tenantId}'),
  'events', (SELECT count(*) FROM public.tenant_calc_policy_events e WHERE e.tenant_id = '${owner.tenantId}'))
WHERE current_user = 'postgres';
`);
  return JSON.parse(row ?? "null") as { rows: number; engine: number | null; events: number };
}

/** Versions of an affaire as stored: engine, sale coefficients (numeric text) and the three totals. */
async function storedVersions(projectId: string) {
  const [row] = await querySql(`SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id', v.id, 'number', v.version_number, 'engine', v.calc_engine_version,
  'coefficients', jsonb_build_array(v.sale_coefficient_fo::text, v.sale_coefficient_mo::text),
  'totals', jsonb_build_array(v.total_ht_cents, v.total_tax_cents, v.total_ttc_cents)) ORDER BY v.version_number), '[]'::jsonb)
FROM public.estimate_versions v WHERE v.project_id = '${uuid(projectId)}' AND current_user = 'postgres';
`);
  return JSON.parse(row ?? "[]") as Array<{ id: string; number: number; engine: number; coefficients: [string | null, string | null]; totals: number[] }>;
}

/**
 * The acceptance fingerprint of a version (brief §7): status, revisions, amounts and engine of the version, and the
 * amount columns of its lines, as one md5 — plus the readable values the journey asserts.
 */
async function versionFingerprint(versionId: string) {
  const [row] = await querySql(`SELECT jsonb_build_object(
  'engine', v.calc_engine_version, 'status', v.status, 'contentRevision', v.content_revision,
  'totals', jsonb_build_array(v.total_ht_cents, v.total_tax_cents, v.total_ttc_cents),
  'lines', (SELECT count(*) FROM public.estimate_items i WHERE i.version_id = v.id AND i.item_type = 'line'),
  'md5', md5(concat_ws('|', v.id, v.status, v.content_revision, v.calc_engine_version, v.total_ht_cents, v.total_tax_cents,
    v.total_ttc_cents, v.gross_ht_cents, v.discount_applied_cents, v.commercial_rounding_cents, v.calc_snapshot_content_revision,
    (SELECT string_agg(concat_ws('|', i.id, i.pu_ht_cents, i.line_total_ht_cents, i.line_tax_cents, i.line_total_ttc_cents,
       i.snapshot_gross_ht_cents, i.snapshot_gross_fo_ht_cents), ',' ORDER BY i.id)
     FROM public.estimate_items i WHERE i.version_id = v.id))))
FROM public.estimate_versions v WHERE v.id = '${uuid(versionId)}' AND current_user = 'postgres';
`);
  return JSON.parse(row ?? "null") as { engine: number; status: string; contentRevision: number; totals: number[]; lines: number; md5: string };
}

armyTest("V3S01 without a policy row a new estimate is a v3 at the documented 1,30 / 1,20 and an old bundle fails closed", options,
  async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    assertOwnedLocalBackend();
    // The default of a new tenant: no policy row at all (since M8: engine 3).
    const dedicated = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "V3S01", calcPolicy: "absent" });
    const owner: V3Owner = { tenantId: dedicated.tenantId, userId: dedicated.userId };
    await app.open("/dashboard/affaires");
    const policyBefore = await policyState(owner);
    expect(policyBefore).toEqual({ rows: 0, engine: null, events: 0 });

    // F210-01: a blank creation stating engine 3, without sale coefficients: the absent policy gives them.
    const projectName = `ARMY-L2-V3S01-${army.runPrefix}`;
    const created = await apiRequest<Envelope<Created>>(browser, "POST", "/api/estimates", {
      project: { name: projectName }, version: { ...NEUTRAL_VERSION, title: `${army.runPrefix} V3S01 v3`, expected_calc_engine_version: 3 },
    });
    await recordEvidence(army, "v3s01-created", { owner, policyBefore, status: created.status, body: created.body });
    expect([created.status, created.body.ok, created.body.error?.code ?? null], "an absent policy creates engine 3").toEqual([201, true, null]);
    const projectId = created.body.data.project.id;
    const versionId = created.body.data.version.id;
    ownEstimate(army, { projectId, versionId });
    const stored = await storedVersions(projectId);
    const expected = [{ id: versionId, number: 1, engine: 3, coefficients: ["1.3000", "1.2000"], totals: [0, 0, 0] }];
    await recordEvidence(army, "v3s01-stored", { projectId, expected, actual: stored });
    expect(stored, "SQL read: one v3 at the absent policy's 1,30 / 1,20").toEqual(expected);

    // The settings drawer of the new version shows the same coefficients.
    const dialog = await openSettings(ui, versionId);
    const shown = {
      fo: await inputValue(dialog.getByLabel("Coefficient de vente FO", { exact: true })),
      mo: await inputValue(dialog.getByLabel("Coefficient de vente MO", { exact: true })),
    };
    await recordEvidence(army, "v3s01-settings", { versionId, expected: { fo: "1,30", mo: "1,20" }, actual: shown });
    expect(shown).toEqual({ fo: "1,30", mo: "1,20" });

    // F210-02: an old bundle states no engine (read as 2): refused by name, nothing written.
    const legacy = await apiRequest<Envelope<Created>>(browser, "POST", "/api/estimates", {
      project_id: projectId, version: { ...NEUTRAL_VERSION, title: `${army.runPrefix} V3S01 sans attente` },
    });
    const afterLegacy = await storedVersions(projectId);
    await recordEvidence(army, "v3s01-old-bundle", { status: legacy.status, body: legacy.body, versions: afterLegacy.length });
    if (legacy.body.ok && legacy.body.data?.version?.id) ownEstimate(army, { projectId, versionId: legacy.body.data.version.id });
    expect([legacy.status, legacy.body.ok, legacy.body.error?.code]).toEqual([409, false, "CONTEXT_CHANGED"]);
    expect(afterLegacy.map((version) => version.id)).toEqual([versionId]);

    // F210-09: neither creation wrote a policy row or a journal event.
    const policyAfter = await policyState(owner);
    await recordEvidence(army, "v3s01-policy-after", { expected: policyBefore, actual: policyAfter });
    expect(policyAfter).toEqual(policyBefore);
  });

armyTest("V3S02 guard: a v2 duplicated while its tenant creates engine 3 stays a v2 and its source is untouched", options,
  async ({ app, screen, browser, army }) => {
    assertOwnedLocalBackend();
    // A v1/v2 owner: its tenant starts at the explicit policy 2 (D-i).
    const dedicated = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "V3S02" });
    const owner: V3Owner = { tenantId: dedicated.tenantId, userId: dedicated.userId };
    await app.open("/dashboard/affaires");
    expect(await policyState(owner)).toEqual({ rows: 1, engine: 2, events: 1 });

    // The source: a v2 with one priced line, 2 × 10,00 € at margin × 1 and 20 % VAT.
    const created = await apiRequest<Envelope<Created>>(browser, "POST", "/api/estimates", {
      project: { name: `ARMY-L2-V3S02-${army.runPrefix}` }, version: { ...NEUTRAL_VERSION, title: `${army.runPrefix} V3S02 source v2` },
    });
    expect([created.status, created.body.ok, created.body.data?.version?.calc_engine_version]).toEqual([201, true, 2]);
    const projectId = created.body.data.project.id;
    const sourceId = created.body.data.version.id;
    ownEstimate(army, { projectId, versionId: sourceId });
    await createLineViaApi(browser, sourceId, `${army.runPrefix} V3S02 ligne`, { quantity: 2 });
    await apiRequest(browser, "DELETE", `/api/estimates/${sourceId}/lock`);
    await expect.poll(async () => (await readEstimate(browser, sourceId)).version.total_ht_cents, { timeout: 30_000 }).toBe(2000);
    const sourceBefore = await versionFingerprint(sourceId);
    expect([sourceBefore.engine, sourceBefore.status, sourceBefore.totals, sourceBefore.lines]).toEqual([2, "draft", [2000, 400, 2400], 1]);

    // The team's lever moves the tenant to engine 3 (the state every tenant without a row reaches with M8).
    const policy3 = await setTenantCalcPolicy(owner, { engine: 3, fo: "1.30", mo: "1.20", reason: `${army.runPrefix} recette 2.10b V3S02` });
    expect(policy3).toMatchObject({ engine: 3, fo: 1.3, mo: 1.2, events: 2 });

    // « Dupliquer » from the source's detail page.
    await app.open(`/dashboard/estimates/${sourceId}`);
    await screen.getByTestId("estimate-detail-more-actions").tap();
    const actions = browser.locator("[aria-label=\"Autres actions sur la version\"]");
    await expect(actions).toBeVisible({ timeout: 30_000 });
    await actions.getByRole("button", "Dupliquer", { exact: true }).click();
    await expect.poll(async () => {
      const match = /\/dashboard\/estimates\/([0-9a-f-]{36})\/edit/i.exec(await browser.url());
      return match && match[1] !== sourceId ? match[1] : null;
    }, { timeout: 60_000, interval: 500 }).not.toBeNull();
    const duplicateId = /\/dashboard\/estimates\/([0-9a-f-]{36})\/edit/i.exec(await browser.url())![1];
    ownEstimate(army, { projectId, versionId: duplicateId });

    const duplicate = await versionFingerprint(duplicateId);
    const versions = await storedVersions(projectId);
    const sourceAfter = await versionFingerprint(sourceId);
    const policyAfter = await policyState(owner);
    await recordEvidence(army, "v3s02-duplicated", { projectId, sourceId, duplicateId, sourceBefore, sourceAfter, duplicate, versions, policyAfter });
    expect([duplicate.engine, duplicate.status, duplicate.totals, duplicate.lines], "the duplicate of a v2 is a v2 with the same amounts")
      .toEqual([2, "draft", [2000, 400, 2400], 1]);
    expect(versions.find((version) => version.id === duplicateId)?.coefficients).toEqual([null, null]);
    expect(sourceAfter, "the source keeps its status, revision and amounts").toEqual(sourceBefore);
    // Duplication reads no policy and writes none.
    expect(policyAfter).toEqual({ rows: 1, engine: 3, events: 2 });
  });
