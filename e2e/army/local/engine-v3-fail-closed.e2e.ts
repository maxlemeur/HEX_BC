import { randomUUID } from "node:crypto";

import type { Browser } from "@e2e-dev/web";
import { expect, type App } from "e2e";

import { apiRequest, armyTest, ownEstimate, recordEvidence, type ArmyState } from "../critical/fixtures";
import { ownedEstimateContext } from "./calculation-gate-support";
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
 */
async function sendFromJourneyProcess(app: App, browser: Browser, fixture: V3Fixture & { anchorVersionId: string }, updatedAt: string) {
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
      "x-estimate-draft-lock-session-id": randomUUID(),
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
  // Mode Simplifié : le détail (TVA, TTC) s'ouvre au clavier, sans le survol qui l'ouvre aussi.
  await screen.getByRole("button", "Voir les détails de TVA, remise et TTC", { exact: true }).focus();
  await browser.keyboard.press("Enter");
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

armyTest("V3FC02 publishing or sending a v3 is refused by name and leaves no document, envelope or status change", options, async ({ app, browser, army }) => {
  const fixture = await prepareV3Fixture(app, browser, army);
  const before = await readV3State(fixture.versionId);

  const publication = await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${fixture.versionId}/pdf`, {});
  const afterPublication = await readV3State(fixture.versionId);
  const send = await sendFromJourneyProcess(app, browser, fixture, before.updatedAt);
  const after = await readV3State(fixture.versionId);

  const summary = (response: { status: number; body: unknown }) => {
    const body = response.body as Envelope<unknown>;
    return { status: response.status, ok: body.ok ?? null, code: body.error?.code ?? null, message: body.error?.message ?? null };
  };
  await recordEvidence(army, "engine-v3-emission", {
    fixture: { versionId: fixture.versionId, title: fixture.title },
    expected: { status: 409, code: "ESTIMATE_ENGINE_UNAVAILABLE", message: BANNER, state: before },
    actual: { publication: summary(publication), send: summary(send), sendSessionCheck: send.sessionCheckStatus, afterPublication, after },
  });
  expect(send.sessionCheckStatus).toBe(200);
  expect(summary(publication)).toEqual({ status: 409, ok: false, code: "ESTIMATE_ENGINE_UNAVAILABLE", message: BANNER });
  expect(summary(send)).toEqual({ status: 409, ok: false, code: "ESTIMATE_ENGINE_UNAVAILABLE", message: BANNER });
  expect(afterPublication).toEqual(before);
  expect(after).toEqual(before);
  expect([after.status, after.documents, after.emails]).toEqual(["draft", 0, 0]);
});
