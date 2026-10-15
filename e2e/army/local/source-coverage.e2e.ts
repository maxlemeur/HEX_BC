import { randomUUID } from "node:crypto";
import { expect } from "e2e";
import type { CoverageDecisionMutation, CoverageMutationResult, CoveragePreview } from "@/lib/estimates/source-coverage-contracts";
import { apiRequest, armyTest, recordEvidence, type ArmyState } from "../critical/fixtures";
import {
  base, clauses, decide, editorReady, establishS1, exportsAt, financial, loadFixture,
  openCoverage, retainReference, s1Counts, saveEditor,
  saveRequirement, selectRequirement, workspace,
  type Case, type Ui,
} from "./source-coverage-support";

const options = { session: "army", tags: ["source-coverage"], trace: "off" as const, timeout: 600_000 };
async function context(ui: Ui & { army: ArmyState }, name: string): Promise<Case> {
  const fixture = await loadFixture();
  const scenario = fixture.scenarios[name];
  if (!scenario) throw new Error(`Fresh coverage scenario required: ${name}`);
  ui.army.ownedEstimates.push({ projectId: scenario.projectId, versionId: scenario.versionId });
  ui.army.projectName = `${fixture.prefix}-${name}`;
  return { ...ui, fixture, scenario };
}
function exactInvalidations(state: Awaited<ReturnType<typeof workspace>>, ids: Record<string, string>, expected: string[]) {
  expect(state.requirements.filter((entry) => entry.validity === "needs_review").map((entry) => entry.id).sort()).toEqual(expected.map((alias) => ids[alias]).sort());
  expect(state.requirements.find((entry) => entry.id === ids.E2)?.validity).toBe("unreviewed");
  expect(state.requirements.find((entry) => entry.id === ids.E2)?.treatment).toBe("unresolved");
}

armyTest("SC01-03 eight explicit requirements use real applied work and register without changing 71000/14200/85200 cents or eight hours", options, async (ui) => {
  const c = await context(ui, "nominal");
  await openCoverage(c);
  const prepared = await establishS1(c);
  const e1 = (await workspace(c, prepared.ids.E1)).selectedRequirement!;
  expect(e1.links).toHaveLength(1); expect(e1.links[0].kind).toBe("component");
  expect(e1.targets[0].state).toBe("available"); expect(e1.targets[0].fact?.kind).toBe("component");
  if (e1.targets[0].fact?.kind !== "component") throw new Error("An applied component is required for E1.");
  expect({ applicationId: e1.targets[0].fact.applicationId, snapshotId: e1.targets[0].fact.snapshotId }).toEqual(prepared.lines.applied);
  expect([e1.targets[0].fact.quantity, e1.targets[0].fact.unit, e1.targets[0].fact.parent.itemId]).toEqual([10, "m", prepared.lines.L1.id]);
  const e3 = (await workspace(c, prepared.ids.E3)).selectedRequirement!;
  const e4 = (await workspace(c, prepared.ids.E4)).selectedRequirement!;
  expect(e3.links.map((link) => link.kind === "line" ? link.itemId : null).sort()).toEqual([prepared.lines.L2.id, prepared.lines.L3.id].sort());
  expect(e4.links.map((link) => link.kind === "line" ? link.itemId : null)).toEqual([prepared.lines.L3.id]);
  for (const [alias, expected] of [["E7", [prepared.register.H1.id, prepared.register.M1.id]], ["E8", [prepared.register.H1.id]]] as const) {
    const entry = (await workspace(c, prepared.ids[alias])).selectedRequirement!;
    expect(entry.links.map((link) => link.kind === "register" ? link.registerEntryId : null).sort()).toEqual([...expected].sort());
    expect([entry.treatment, entry.validity]).toEqual(["provisional", "current"]);
  }
  await selectRequirement(c, prepared.ids.E3);
  const beforeDuplicate = e3.links;
  await c.screen.getByRole("button", "Ajouter un lien", { exact: true }).tap();
  await c.screen.getByLabel("Type de cible", { exact: true }).selectOption({ value: "line" });
  await c.screen.getByLabel("Recherche de cible", { exact: true }).fill(prepared.lines.L3.title);
  await c.screen.getByLabel("Justification du lien", { exact: true }).fill("Même cible tentée une seconde fois.");
  await c.screen.getByRole("button", "Rechercher les cibles", { exact: true }).tap();
  await c.screen.getByTestId(`coverage-target-${prepared.lines.L3.id}`).getByRole("button", "Lier cette cible", { exact: true }).tap();
  await expect(c.screen.getByText("Cette cible est déjà liée à l’exigence.", { exact: true })).toBeVisible();
  expect((await workspace(c, e3.id)).selectedRequirement!.links).toEqual(beforeDuplicate);
  await c.browser.reload(); expect((await workspace(c)).counts).toEqual(s1Counts);
  await exportsAt(c, "s1"); await financial(c, "nominal-final");
  await recordEvidence(c.army, "nominal-complete", { ids: prepared.ids, component: e1.targets[0], e3, e4, counts: (await workspace(c)).counts, finalCoverageSeeded: false, modelCalls: 0 });
});

armyTest("SC04 activating B invalidates seven decisions and only a newly verified B citation revalidates E4", options, async (ui) => {
  const c = await context(ui, "reference"); const prepared = await establishS1(c);
  const oldE4 = (await workspace(c, prepared.ids.E4)).selectedRequirement!;
  await retainReference(c, "B"); await openCoverage(c);
  const changed = await workspace(c);
  exactInvalidations(changed, prepared.ids, ["E1", "E3", "E4", "E5", "E6", "E7", "E8"]);
  expect(changed.counts.validities).toEqual({ unreviewed: 1, current: 0, needs_review: 7 });
  await selectRequirement(c, oldE4.id);
  await c.screen.getByRole("button", "Préparer la décision", { exact: true }).tap();
  await c.screen.getByLabel("Traitement", { exact: true }).selectOption({ value: "priced" });
  await c.screen.getByLabel("Motif de décision", { exact: true }).fill("L’ancienne citation A ne suffit pas sous B.");
  await c.screen.getByLabel("J’ai examiné les faits et le traitement proposé", { exact: true }).check();
  await expect(c.screen.getByRole("button", "Confirmer le traitement", { exact: true })).toBeDisabled();
  await c.screen.getByRole("button", "Ajouter une citation de la référence actuelle", { exact: true }).tap();
  const newest = c.browser.locator('[data-testid^="coverage-citation-"]').last();
  await newest.getByLabel("Page physique", { exact: true }).fill("2");
  await newest.getByLabel("Folio imprimé", { exact: true }).fill("CVC-10");
  await newest.getByLabel("Passage cité", { exact: true }).fill(clauses[2]);
  await saveRequirement(c);
  // The old A citation remains history. Only B's current citation is consulted.
  const current = (await workspace(c, oldE4.id)).selectedRequirement!;
  const bCitation = current.citations.find((citation) => citation.copyId === changed.activeCopyId)!;
  await c.screen.getByTestId(`coverage-citation-${bCitation.id}`).getByRole("button", "Consulter le passage", { exact: true }).tap();
  const consultation = c.screen.getByRole("region", "Consultation du passage cité", { exact: true });
  await consultation.getByLabel("J’ai vérifié ce passage dans cette copie", { exact: true }).check();
  await consultation.getByRole("button", "Vérifier la citation", { exact: true }).tap();
  await expect.poll(async () => Boolean((await workspace(c, current.id)).selectedRequirement?.citations.find((citation) => citation.id === bCitation.id)?.verification)).toBe(true);
  await expect(consultation).toBeHidden();
  await expect(c.screen.getByRole("button", "Préparer la décision", { exact: true })).toBeEnabled();
  await expect(c.screen.getByLabel("Prestation entièrement traitée", { exact: true })).not.toBeChecked();
  await c.screen.getByLabel("Prestation entièrement traitée", { exact: true }).check();
  await c.screen.getByLabel("Motif de complétude", { exact: true }).fill("Clause B/C3 relue et raccords L3 revus : prestation E4 entière explicitement traitée.");
  await saveRequirement(c);
  await decide(c, (await workspace(c, current.id)).selectedRequirement!, "priced");
  await c.browser.reload();
  const final = await workspace(c, current.id);
  expect(final.counts.validities).toEqual({ unreviewed: 1, current: 1, needs_review: 6 });
  exactInvalidations(final, prepared.ids, ["E1", "E3", "E5", "E6", "E7", "E8"]);
  expect(final.history.some((event) => event.decision?.copyId === oldE4.lastDecision!.copyId)).toBe(true);
  await financial(c, "b-finances"); await exportsAt(c, "b");
  await recordEvidence(c.army, "reference-b-complete", final);
});

armyTest("SC05 register validation and reopening invalidate only linked provisional decisions", options, async (ui) => {
  const c = await context(ui, "register"); const prepared = await establishS1(c);
  const transition = async (text: string, action: "validate" | "reopen") => {
    await c.app.open(`/dashboard/affaires/${c.scenario.projectId}?versionId=${c.scenario.versionId}#register`);
    const card = c.screen.getByRole("article").filter({ hasText: text });
    await card.getByRole("button", action === "validate" ? "Marquer comme traité Le point est considéré comme levé ou accepté." : "Rouvrir le point Le point redevient actif dans le registre.", { exact: true }).tap();
    const dialog = c.screen.getByRole("dialog", action === "validate" ? "Marquer ce point comme traité" : "Rouvrir cette entrée", { exact: true });
    await dialog.getByRole("textbox").fill("Recette DOS-CAL-01 : transition réelle du registre.");
    await dialog.getByRole("button", action === "validate" ? "Marquer comme traité" : "Confirmer la réouverture", { exact: true }).tap();
    await expect(dialog).toBeHidden(); await openCoverage(c);
  };
  await transition(prepared.register.H1.text, "validate");
  exactInvalidations(await workspace(c), prepared.ids, ["E7", "E8"]);
  for (const alias of ["E7", "E8"]) await decide(c, (await workspace(c, prepared.ids[alias])).selectedRequirement!, "provisional");
  await transition(prepared.register.H1.text, "reopen");
  exactInvalidations(await workspace(c), prepared.ids, ["E7", "E8"]);
  for (const alias of ["E7", "E8"]) await decide(c, (await workspace(c, prepared.ids[alias])).selectedRequirement!, "provisional");
  await transition(prepared.register.M1.text, "validate");
  const final = await workspace(c); exactInvalidations(final, prepared.ids, ["E7"]);
  for (const alias of ["E7", "E8"]) expect(final.requirements.find((entry) => entry.id === prepared.ids[alias])?.treatment).toBe("provisional");
  await financial(c, "register-final-finances"); await recordEvidence(c.army, "register-final", final);
});

for (const mutation of [
  { name: "l2_quantity", line: "L2", label: "Quantité", value: "5", totals: [72000, 14400, 86400], stale: ["E3"] },
  { name: "l1_quantity", line: "L1", label: "Quantité", value: "12", totals: [75000, 15000, 90000], stale: ["E1"] },
  { name: "l4_quantity", line: "L4", label: "Quantité", value: "7", totals: [73000, 14600, 87600], stale: [] },
  { name: "l2_price", line: "L2", label: "Prix d’achat unitaire HT", value: "12", totals: [71800, 14360, 86160], stale: [] },
] as const) {
  armyTest(`SC06 ${mutation.name} preserves unrelated decisions and exact stored amounts`, options, async (ui) => {
    const c = await context(ui, mutation.name); const prepared = await establishS1(c);
    await c.app.open(`/dashboard/estimates/${c.scenario.versionId}/edit`);
    const line = prepared.lines[mutation.line];
    const input = c.screen.getByLabel(`${mutation.label} pour ${line.title}`, { exact: true });
    await input.fill(mutation.value); await input.press("Tab");
    await saveEditor(c, [...mutation.totals]); await c.browser.reload();
    await editorReady(c, [...mutation.totals]);
    await financial(c, "mutation-finances", [...mutation.totals]);
    await openCoverage(c); const final = await workspace(c);
    exactInvalidations(final, prepared.ids, [...mutation.stale]);
    await recordEvidence(c.army, "targeted-invalidation", { mutation, final });
    if (mutation.name === "l2_quantity") {
      await c.app.open(`/dashboard/estimates/${c.scenario.versionId}/edit`);
      await c.screen.getByLabel(`Quantité pour ${line.title}`, { exact: true }).fill("4");
      await c.screen.getByLabel(`Quantité pour ${line.title}`, { exact: true }).press("Tab");
      await saveEditor(c, [71000, 14200, 85200]); await openCoverage(c);
      exactInvalidations(await workspace(c), prepared.ids, ["E3"]);
    }
  });
}

armyTest("SC08 committed decision response lost then reload replays the same event without an automatic POST", options, async (ui) => {
  const c = await context(ui, "recovery"); const prepared = await establishS1(c);
  const id = prepared.ids.E5;
  const posts: Array<{ pathname: string; body: unknown }> = [];
  await c.browser.route(`**${base(c.scenario)}**`, async (route) => {
    if (route.request.method === "POST") posts.push({ pathname: new URL(route.request.url).pathname, body: JSON.parse(route.request.postData!) });
    await route.fallback();
  });
  await c.browser.evaluate((pathname) => {
    const scope = window as Window & { __coverageLost?: { request: unknown; status: number; body: unknown; discarded: boolean } };
    const original = window.fetch;
    window.fetch = async function(input, init) {
      const response = await original.call(window, input, init);
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (!scope.__coverageLost && url.pathname === pathname && init?.method === "POST") {
        scope.__coverageLost = { request: JSON.parse(String(init.body)), status: response.status, body: await response.clone().json(), discarded: true };
        throw new TypeError("ARMY response ignored after real server commit");
      }
      return response;
    };
    return true;
  }, `${base(c.scenario)}/${id}/decisions`);
  await selectRequirement(c, id);
  await c.screen.getByRole("button", "Préparer la décision", { exact: true }).tap();
  await c.screen.getByLabel("Traitement", { exact: true }).selectOption({ value: "excluded" });
  await c.screen.getByLabel("Motif de décision", { exact: true }).fill("Hors du lot dans le corpus, clause C4 — nouvelle revue explicite.");
  await c.screen.getByLabel("J’ai examiné les faits et le traitement proposé", { exact: true }).check();
  await c.screen.getByRole("button", "Confirmer le traitement", { exact: true }).tap();
  await expect.poll(async () => await c.browser.evaluate(() => Boolean((window as Window & { __coverageLost?: unknown }).__coverageLost))).toBe(true);
  const lost = JSON.parse(await c.browser.evaluate(() => JSON.stringify((window as Window & { __coverageLost?: unknown }).__coverageLost))) as { request: CoverageDecisionMutation; status: number; body: { ok: boolean; data: CoverageMutationResult }; discarded: boolean };
  await recordEvidence(c.army, "decision-response-discarded", lost);
  expect(lost.status).toBe(201); expect(lost.body.ok).toBe(true);
  const before = await workspace(c, id); const count = posts.length;
  await c.browser.reload();
  const resume = c.screen.getByRole("button", "Reprendre l’enregistrement", { exact: true });
  await expect(resume).toBeEnabled(); const afterReloadPosts = posts.length; expect(afterReloadPosts).toBe(count);
  const response = c.browser.waitForResponse(new URL(`${base(c.scenario)}/${id}/decisions`, c.app.baseUrl!).href);
  await resume.tap(); const actual = await response; const body = JSON.parse(await actual.text());
  expect(actual.status).toBe(200); expect(body.data.replayed).toBe(true);
  expect(body.data.receipt).toEqual(lost.body.data.receipt);
  expect(posts.at(-1)!.body).toEqual(lost.request);
  const after = await workspace(c, id); expect(after.history).toEqual(before.history);
  const conflict = await apiRequest<{ ok: boolean; error: { code: string } }>(c.browser, "POST", `${base(c.scenario)}/${id}/decisions`, { ...lost.request, decision: { ...lost.request.decision, reason: "Contenu différent pour la même clé." } });
  expect(conflict.status).toBe(409); expect(conflict.body.error.code).toBe("SOURCE_COVERAGE_IDEMPOTENCY_CONFLICT");
  expect((await workspace(c, id)).history).toEqual(before.history);
  await financial(c, "recovery-finances"); await recordEvidence(c.army, "recovery-complete", { before, after, posts, postsBeforeReload: count, postsAfterReload: afterReloadPosts, sameEvent: true, noAutomaticPosts: true });
});

armyTest("SC09 unavailable workspace never becomes an empty or current coverage decision", options, async (ui) => {
  const c = await context(ui, "read_failure"); const prepared = await establishS1(c);
  let mode: "503" | "malformed" | "real" = "real"; let intercepted = 0; let posts = 0;
  await c.browser.route(`**${base(c.scenario)}**`, async (route) => {
    if (route.request.method === "POST") posts++;
    const url = new URL(route.request.url);
    if (route.request.method === "GET" && url.pathname === base(c.scenario) && mode !== "real") {
      await route.fulfill({ status: mode === "503" ? 503 : 200, headers: { "content-type": "application/json", "cache-control": "private, no-store" }, body: JSON.stringify(mode === "503" ? { ok: false, error: { code: "SOURCE_COVERAGE_TEMPORARILY_UNAVAILABLE", message: "Recette de lecture indisponible" } } : { ok: true, data: { ...prepared.state, counts: { ...s1Counts, total: 0 } } }) });
      intercepted++; return;
    }
    await route.fallback();
  });
  await selectRequirement(c, prepared.ids.E5);
  await c.screen.getByRole("button", "Préparer la décision", { exact: true }).tap();
  await c.screen.getByLabel("Traitement", { exact: true }).selectOption({ value: "excluded" });
  await c.screen.getByLabel("Motif de décision", { exact: true }).fill("Aperçu réel ouvert avant la panne de lecture.");
  await c.screen.getByLabel("J’ai examiné les faits et le traitement proposé", { exact: true }).check();
  await expect(c.screen.getByRole("button", "Confirmer le traitement", { exact: true })).toBeEnabled();
  for (const fault of ["503", "malformed"] as const) {
    mode = fault; const previous = intercepted;
    await c.screen.getByRole("region", "Exigences identifiées", { exact: true }).getByRole("button", "Actualiser les exigences", { exact: true }).tap();
    await expect.poll(() => intercepted > previous).toBe(true);
    await expect(c.screen.getByRole("alert").filter({ hasText: "Vérification indisponible" })).toBeVisible();
    const confirm = c.screen.getByRole("button", "Confirmer le traitement", { exact: true });
    if (await confirm.count()) await expect(confirm).toBeDisabled();
    else await expect(confirm).toHaveCount(0);
    const observation = await c.browser.evaluate(() => ({ text: document.body.innerText, requirements: document.querySelectorAll('[data-testid^="coverage-requirement-"]').length }));
    await recordEvidence(c.army, `unavailable-${fault}`, { observation, intercepted, posts });
    expect(observation.text.includes("indisponible") || observation.text.includes("Impossible") || observation.text.includes("invalide")).toBe(true);
    expect(observation.text.includes("0 exigence")).toBe(false); expect(posts).toBe(0);
  }
  mode = "real"; await c.browser.reload();
  await expect(c.screen.getByRole("table", "Traitement et validité des exigences identifiées", { exact: true })).toBeVisible();
  expect((await workspace(c)).counts).toEqual(s1Counts);
  await financial(c, "unavailable-recovered-finances");
});

armyTest("SC02 technical edits require a new human completeness declaration before another decision", options, async (ui) => {
  const c = await context(ui, "form_change"); const prepared = await establishS1(c);
  const id = prepared.ids.E3;
  const before = (await workspace(c, id)).selectedRequirement!;
  await selectRequirement(c, id);
  await expect(c.screen.getByLabel("Prestation entièrement traitée", { exact: true })).toBeChecked();
  await c.screen.getByLabel("Prestation attendue", { exact: true }).fill(`${before.expectedService} Périmètre de recette précisé.`);
  await expect(c.screen.getByLabel("Prestation entièrement traitée", { exact: true })).not.toBeChecked();
  await saveRequirement(c);
  const changed = (await workspace(c, id)).selectedRequirement!;
  expect([changed.completeness, changed.validity, changed.treatment]).toEqual(["partial", "needs_review", "priced"]);
  expect(changed.lastDecision).toEqual(before.lastDecision);
  await c.screen.getByRole("button", "Préparer la décision", { exact: true }).tap();
  await c.screen.getByLabel("Traitement", { exact: true }).selectOption({ value: "priced" });
  await c.screen.getByLabel("Motif de décision", { exact: true }).fill("Aucune nouvelle déclaration de complétude encore donnée.");
  await c.screen.getByLabel("J’ai examiné les faits et le traitement proposé", { exact: true }).check();
  await expect(c.screen.getByRole("button", "Confirmer le traitement", { exact: true })).toBeDisabled();
  await financial(c, "form-change-finances"); await recordEvidence(c.army, "form-change-partial", { before, changed });
});

armyTest("SC07 rejects a stale decision without changing its current history", options, async (ui) => {
  const c = await context(ui, "stale"); const prepared = await establishS1(c);
  const id = prepared.ids.E3;
  const preview = await apiRequest<{ ok: boolean; data: CoveragePreview }>(c.browser, "GET", `${base(c.scenario)}/${id}/preview`);
  expect(preview.status).toBe(200);
  const before = await workspace(c, id);
  await c.app.open(`/dashboard/estimates/${c.scenario.versionId}/edit`);
  await c.screen.getByLabel(`Quantité pour ${prepared.lines.L2.title}`, { exact: true }).fill("5");
  await c.screen.getByLabel(`Quantité pour ${prepared.lines.L2.title}`, { exact: true }).press("Tab");
  await saveEditor(c, [72000, 14400, 86400]); await openCoverage(c);
  const stale: CoverageDecisionMutation = { requirementId: id, expectedRequirementRevision: preview.body.data.requirementRevision, expectedReferenceRevision: preview.body.data.referenceRevision, expectedContentRevision: preview.body.data.contentRevision, reviewedFingerprint: preview.body.data.reviewedFingerprint, operationKey: randomUUID(), decision: { treatment: "priced", reason: "Ancien aperçu volontairement rejoué.", otherLot: null, uncertainty: null, completeness: "complete" } };
  const response = await apiRequest<{ error: { code: string } }>(c.browser, "POST", `${base(c.scenario)}/${id}/decisions`, stale);
  expect(response.status).toBe(409); expect(response.body.error.code).toBe("SOURCE_COVERAGE_STALE");
  const after = await workspace(c, id); expect(after.history).toEqual(before.history);
  exactInvalidations(after, prepared.ids, ["E3"]);
  await recordEvidence(c.army, "stale-decision-rejected", { before, after, response, ordinaryHttpFault: true });
});
