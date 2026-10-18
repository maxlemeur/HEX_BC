import { randomUUID } from "node:crypto";

import type { Browser } from "@e2e-dev/web";
import { expect, type App } from "e2e";

import { apiRequest, armyTest, ownEstimate, recordEvidence, type ArmyState } from "../critical/fixtures";
import { ownedEstimateContext } from "./calculation-gate-support";
import { waitForDraftLease } from "./engine-v3-editor-support";
import { insertV3Fixture, readV3State, type V3Fixture } from "./engine-v3-support";

// Lot 2, sous-lot 2.1 — socle fermé par défaut (docs/testing/estimate-engine-v3-2.1.md, E2E-01
// à E2E-03). Défaillances observables, écrites avant le code :
//  E2E-01 L'éditeur ou la fiche d'une v3 la relit comme une v1 : totaux v1 affichés
//         (45,00 € HT, 54,00 € TTC, PU 22,50 € pour 2 × 22,50 € à marge ×1).
//         Réécrit en 2.6 (docs/testing/estimate-engine-v3-2.6.md §1.4) : l'éditeur et la fiche d'un
//         brouillon v3 s'ouvrent sans le bandeau de 2.1 ; l'éditeur montre l'aperçu du moteur 3
//         (PU 29,25 €, 58,50 € HT, 70,20 € TTC à c_FO 1,30), la fiche les montants stockés. Le
//         propriétaire de la fixture est en mode Simplifié : le pied montre la seule pastille HT et
//         le TTC se lit dans son détail (« Voir les détails de TVA, remise et TTC »).
//  E2E-02 Ouvrir une v3 la réécrit (sauvegarde, normalisation, totaux) : révision ou montants
//         modifiés en base.
//  E2E-03 Publier ou envoyer une v3 réussit, échoue sans message nommé, ou laisse un document,
//         un envoi réservé ou un changement de statut en base.
// La fixture ARMY-L2-V3-FIXTURE-<run> est insérée en SQL par le propriétaire natif de la pile
// possédée : aucune RPC ne crée de v3 avant 2.10. Sans M1, son insertion échoue (moteur 3 non
// admis), ce qui est le premier rouge attendu.
const options = { session: "army", tags: ["critical", "local", "engine-v3"], timeout: 180_000 } as const;
const BANNER = "Ce devis utilise le moteur de calcul 3, pas encore disponible pour cette action.";
const V1_AMOUNTS = /45,00|54,00|22,50/;
// L'éditeur v3 affiche le PR FO saisi (22,50) : seule la lecture v1 du HT et du TTC y est interdite.
const V1_TOTALS = /45,00\s?€|54,00\s?€/;
// Aperçu du moteur 3 de la fixture : 2 × ⌈2 250 × 1,30⌋ = 5 850 c HT, TVA 20 % 1 170 c, TTC 7 020 c.
const V3_PREVIEW_HT_CHIP = "Total HT : 58,50 €";
const V3_PREVIEW_TTC = /TTC à payer\s*70,20\s?€/;
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };

function assertOwnedLocalBackend() {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) || backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST ||
    !process.env.E2E_ARMY_LOCAL_DB_URL) {
    throw new Error("The v3 fixture requires the owned local Supabase stack and its SQL route.");
  }
}

async function prepareV3Fixture(app: App, browser: Browser, army: ArmyState): Promise<V3Fixture & { anchorVersionId: string }> {
  assertOwnedLocalBackend();
  await app.open("/dashboard/affaires");
  const created = await apiRequest<Envelope<{ project: { id: string }; version: { id: string } }>>(browser, "POST", "/api/estimates", {
    project: { name: army.projectName },
    version: {
      title: `${army.runPrefix} v2 anchor`, margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, tax_rate_bp: 2000,
      rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 1, currency: "EUR",
    },
  });
  expect([created.status, created.body.ok]).toEqual([201, true]);
  const projectId = created.body.data.project.id;
  ownEstimate(army, { projectId, versionId: created.body.data.version.id });
  const owner = await ownedEstimateContext(projectId);
  const fixture = await insertV3Fixture(army, { projectId, tenantId: owner.tenantId, userId: owner.userId });
  ownEstimate(army, { projectId, versionId: fixture.versionId });
  await recordEvidence(army, "engine-v3-fixture", { fixture, insertedBy: "postgres (owned native stack)", state: await readV3State(fixture.versionId) });
  return { ...fixture, anchorVersionId: created.body.data.version.id };
}

async function visibleText(browser: Browser) {
  return browser.evaluate(() => document.body.innerText);
}

/**
 * The critical browser guard aborts every POST …/send, by design. This single probe goes
 * from the journey process to the owned app, for the owned v3 fixture only, while the
 * runner leaves the provider key empty and the recipient is a reserved .invalid domain.
 * It carries the page lease session when the journey holds one (2.7), a fresh one otherwise.
 */
async function sendFromJourneyProcess(app: App, browser: Browser, fixture: V3Fixture & { anchorVersionId: string }, updatedAt: string,
  draftLockSessionId: string = randomUUID()) {
  if (process.env.RESEND_API_KEY !== "") throw new Error("The v3 send probe requires the empty provider key of the owned runner.");
  const origin = new URL(app.baseUrl!).origin;
  if (!/^http:\/\/localhost:\d+$/.test(origin)) throw new Error("The v3 send probe targets the owned loopback app only.");
  const cookie = (await browser.cookies())
    .filter(entry => !entry.domain || entry.domain === "localhost" || entry.domain === ".localhost")
    .map(entry => `${entry.name}=${entry.value}`).join("; ");
  // The probe must carry the browser session: a read of the v2 anchor proves it, so a
  // refusal below cannot be an authentication artifact.
  const sessionCheck = await fetch(`${origin}/api/estimates/${fixture.anchorVersionId}`, { redirect: "manual", headers: { cookie } });
  const response = await fetch(`${origin}/api/estimates/${fixture.versionId}/send`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie, origin, "content-type": "application/json", "idempotency-key": randomUUID(), "if-match": updatedAt,
      "x-estimate-draft-lock-session-id": draftLockSessionId,
    },
    body: JSON.stringify({ to: "client@example.invalid", subject: `${fixture.title} envoi`, message: "Tentative d'envoi d'une v3." }),
  });
  let body: Envelope<unknown> | { invalidJson: true };
  try { body = await response.json() as Envelope<unknown>; } catch { body = { invalidJson: true }; }
  return { status: response.status, body, sessionCheckStatus: sessionCheck.status };
}

armyTest("V3FC01 a v3 draft opens in the v3 editor and on its detail page without the engine banner, shows no v1 total and is not rewritten", options, async ({ app, screen, browser, army }) => {
  const fixture = await prepareV3Fixture(app, browser, army);
  const before = await readV3State(fixture.versionId);
  const summaryChips = () => browser.evaluate(() => Array.from(
    document.querySelectorAll("[role=\"region\"][aria-label=\"Résumé du paramétrage\"] button")
  ).map(button => (button.getAttribute("aria-label") ?? button.textContent ?? "").replace(/[\s  ]+/g, " ").trim()));

  // 2.6 : l'éditeur v3 s'ouvre (grille, pied v3) ; on attend l'aperçu du moteur 3 avant de lire l'écran.
  await app.open(`/dashboard/estimates/${fixture.versionId}/edit`);
  await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await summaryChips()).includes(V3_PREVIEW_HT_CHIP), { timeout: 30_000 }).toBe(true);
  const editorChips = await summaryChips();
  // Mode Simplifié : le détail (TVA, TTC) s'ouvre au clavier, sans le survol qui l'ouvre aussi. La grille (re)donne le
  // focus à sa cellule active quand son modèle de navigation change (useSpreadsheetNavigation), dont le passage en
  // édition à la prise du bail : on attend un éditeur posé (bail pris), sans rien supposer du focus, puis Entrée part
  // sur le déclencheur lui-même (doc 2.6 §10.4 et §11.4, revue du 18/10/2026).
  await waitForDraftLease({ app, screen, browser });
  await screen.getByRole("button", "Voir les détails de TVA, remise et TTC", { exact: true }).press("Enter");
  await expect.poll(async () => V3_PREVIEW_TTC.test(await visibleText(browser)), { timeout: 30_000 }).toBe(true);
  const editorText = await visibleText(browser);
  // La fiche relit les montants stockés (nuls pour cette fixture insérée en SQL), sans recalcul.
  await app.open(`/dashboard/estimates/${fixture.versionId}`);
  await expect.poll(async () => (await visibleText(browser)).includes("Brouillon au moteur de calcul 3"), { timeout: 30_000 }).toBe(true);
  const detailText = await visibleText(browser);

  const after = await readV3State(fixture.versionId);
  await recordEvidence(army, "engine-v3-read", {
    fixture: { versionId: fixture.versionId, title: fixture.title },
    expected: { banner: false, v1AmountsShown: false, editorHtChip: V3_PREVIEW_HT_CHIP, editorTtc: String(V3_PREVIEW_TTC), state: before },
    actual: {
      editor: { banner: editorText.includes(BANNER), v1TotalsShown: V1_TOTALS.test(editorText), chips: editorChips,
        ttcShown: V3_PREVIEW_TTC.test(editorText) },
      detail: { banner: detailText.includes(BANNER), v1AmountsShown: V1_AMOUNTS.test(detailText) },
      state: after,
    },
  });
  expect(editorText).not.toContain(BANNER);
  expect(detailText).not.toContain(BANNER);
  expect(editorChips).toContain(V3_PREVIEW_HT_CHIP);
  expect(editorText).toMatch(V3_PREVIEW_TTC);
  expect(editorText).not.toMatch(V1_TOTALS);
  expect(detailText).not.toMatch(V1_AMOUNTS);
  expect(after).toEqual(before);
  expect([after.engine, after.status, after.totals]).toEqual([3, "draft", [0, 0, 0]]);
});

// Réaligné en 2.7 (docs/testing/estimate-engine-v3-2.7.md §10.3) : 2.7 ouvre l'émission v3 (contrat client 2,
// §5.2 : fin de ESTIMATE_ENGINE_UNAVAILABLE sur POST …/pdf et POST …/send), donc le refus général de 2.1 ne
// tient plus. E2E-03 porte désormais sur une v3 que le moteur 3 ne peut pas figer : la ligne chiffrée de la
// fixture n'a pas d'unité (D9) et ses montants stockés sont périmés (0). Sous le bail de la page (pour qu'un
// refus ne soit pas un artefact de verrou), la publication est refusée par son nom avant toute réclamation.
// Revue 2.7 (docs/testing/estimate-engine-v3-2.7.md §12) : l'aperçu d'impression et les exports XLSX
// standard et DPGF de ce brouillon, qui le présentent par le moteur pur sans le figer, le refusent par le
// même nom (rouge : page d'erreur et 500 INTERNAL_ERROR, le préparateur levant
// ESTIMATE_V3_STORED_INCOHERENT pendant le rendu).
// L'envoi n'est ici qu'un contrôle de configuration, pas une preuve du moteur 3 : la campagne critique n'a
// pas de fournisseur et `getRequiredEnvVar("RESEND_API_KEY")` refuse avant toute relecture, tout gel et toute
// réservation, quel que soit le moteur. Le refus nommé de l'envoi d'une v3 sans unité, avec un fournisseur,
// est prouvé par V3M04 (phase calc-v3 emission-v3, collecteur sentinelle).
const UNIT_REQUIRED = "Une unité est requise sur chaque ligne chiffrée avant le gel.";
const PRINT_REFUSAL = `Le document client de ce devis ne peut pas être préparé : ${UNIT_REQUIRED}`;
// Titre de la limite d'erreur des chiffrages (src/app/dashboard/estimates/error.tsx), qui couvre l'impression.
const ROUTE_ERROR = "Ce chiffrage n’a pas pu être chargé";
const NO_PROVIDER = "Configuration email manquante: RESEND_API_KEY.";

armyTest("V3FC02 publishing, printing or exporting a v3 that engine 3 cannot freeze is refused by name, and no document, envelope or status change is left (send: configuration refusal)", options, async ({ app, browser, army }) => {
  const fixture = await prepareV3Fixture(app, browser, army);
  const lock = await apiRequest(browser, "POST", `/api/estimates/${fixture.versionId}/lock`);
  expect(lock.status).toBe(201);
  const lockSessionId = await browser.evaluate(
    (versionId) => sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${versionId}`), fixture.versionId);
  if (!lockSessionId) throw new Error("The page lease session of the v3 fixture is missing.");
  const before = await readV3State(fixture.versionId);

  const publication = await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${fixture.versionId}/pdf`, {});
  const afterPublication = await readV3State(fixture.versionId);
  // Wait until the print page shows either the named notice or the route error, so the evidence
  // records which one a red build rendered before the assertions below.
  await app.open(`/dashboard/estimates/${fixture.versionId}/print`);
  await expect.poll(async () => {
    const text = await visibleText(browser);
    return text.includes(PRINT_REFUSAL) || text.includes(ROUTE_ERROR);
  }, { timeout: 30_000 }).toBe(true);
  const printText = await visibleText(browser);
  const exportStandard = await apiRequest<Envelope<unknown>>(browser, "GET", `/api/estimates/${fixture.versionId}/export?format=xlsx`);
  const exportDpgf = await apiRequest<Envelope<unknown>>(browser, "GET", `/api/estimates/${fixture.versionId}/export?format=xlsx&mode=dpgf`);
  const afterReads = await readV3State(fixture.versionId);
  const send = await sendFromJourneyProcess(app, browser, fixture, before.updatedAt, lockSessionId);
  const after = await readV3State(fixture.versionId);

  const summary = (response: { status: number; body: unknown }) => {
    const body = response.body as Envelope<unknown>;
    return { status: response.status, ok: body.ok ?? null, code: body.error?.code ?? null, message: body.error?.message ?? null };
  };
  const refusal = { status: 400, ok: false, code: "ESTIMATE_V3_UNIT_REQUIRED", message: UNIT_REQUIRED };
  const expected = {
    publication: refusal,
    print: { notice: true, routeError: false },
    exports: { standard: refusal, dpgf: refusal },
    send: { status: 500, ok: false, code: "INTERNAL_ERROR", message: NO_PROVIDER },
  };
  const actual = {
    publication: summary(publication),
    print: { notice: printText.includes(PRINT_REFUSAL), routeError: printText.includes(ROUTE_ERROR) },
    exports: { standard: summary(exportStandard), dpgf: summary(exportDpgf) },
    send: summary(send),
  };
  await recordEvidence(army, "engine-v3-emission", {
    fixture: { versionId: fixture.versionId, title: fixture.title },
    expected: { ...expected, lease: 201, state: before },
    actual: { ...actual, lease: lock.status, sendSessionCheck: send.sessionCheckStatus, afterPublication, afterReads, after },
  });
  expect(send.sessionCheckStatus).toBe(200);
  expect(actual).toEqual(expected);
  expect(afterPublication).toEqual(before);
  expect(afterReads).toEqual(before);
  expect(after).toEqual(before);
  expect([after.status, after.documents, after.emails]).toEqual(["draft", 0, 0]);
});
