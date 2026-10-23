import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { expect } from "e2e";
import { armyTest, ownEstimate, readEstimate, recordEvidence } from "../critical/fixtures";
import {
  action, assertApplied, capture, cost, installProbe, prepare, replies,
  resumeDialog, review, saved, selectOnly, stableRows, totals, type Json, type Prepared, type Ui,
} from "./generated-ouvrage-recovery-support";

// Observable failures and exact oracles were written before this implementation:
// docs/testing/generated-ouvrage-recovery-e2e.md. No model or hidden repair.
const options = { session: "army", trace: "off" as const, tags: ["source-coverage", "generated-recovery"], timeout: 240_000 };
const inserts = (p: Prepared) => p.calls.filter((call) => call.action === "insertGeneratedOuvrages");

async function clickActionReply(ui: Ui, p: Pick<Prepared, "ids">, name: string, click: () => Promise<void>) {
  // Read the real action before Next handles its reply and reloads the editor.
  // URL-only response matching can select a subsequently aborted RSC response.
  await installProbe(ui, p, "none", true);
  const before = (await replies(ui)).filter((reply) => reply.action === name).length;
  await click();
  await expect.poll(async () => (await replies(ui)).filter((reply) => reply.action === name).length, { timeout: 45_000 }).toBe(before + 1);
  const reply = (await replies(ui)).filter((entry) => entry.action === name)[before];
  expect(reply.changedRecords).toBe(0); expect(reply.discarded).toBe(false);
  return reply;
}

async function apply(ui: Ui, p: Prepared) {
  const response = await clickActionReply(ui, p, "insertGeneratedOuvrages", () => ui.screen.getByTestId("generated-ouvrage-insert-button").click());
  const records = response.records;
  await recordEvidence(ui.army, `${p.s.label}-application-response-${inserts(p).length}`, { status: response.status, records });
  expect(response.status).toBe(200); expect(records).toHaveLength(1);
  return records[0];
}

for (const [code, fault] of [["GO01", "lost"], ["GO02", "malformed"]] as const) {
  armyTest(`${code} generated application ${fault} committed response survives reload and exact explicit recovery`, options, async (ui) => {
    const p = await prepare(ui, fault), c = p.s.candidates[0];
    const dialogs: string[] = [];
    // Unknown durable intention may trigger the existing leave-page warning.
    let permitUnknownReload = true;
    const dispose = await ui.browser.onDialog(async (dialog) => {
      dialogs.push(dialog.message);
      if (!permitUnknownReload) throw new Error("Unexpected unsaved-change prompt after confirmed recovery.");
      await dialog.accept();
    });
    try {
      await resumeDialog(ui, p.s); await review(ui, c); await selectOnly(ui, p.s, c);
      await installProbe(ui, p, fault);
      await ui.screen.getByTestId("generated-ouvrage-insert-button").click();
      await expect.poll(async () => (await replies(ui)).filter((reply) => reply.action === "insertGeneratedOuvrages").length, { timeout: 45_000 }).toBe(1);
      const first = (await replies(ui)).find((reply) => reply.action === "insertGeneratedOuvrages")!;
      const immediate = await capture(ui, p, `${code}-first-get-after-server-response`);
      await recordEvidence(ui.army, `${code}-actual-completed-response`, first);
      expect(first.status).toBe(200); expect(first.records).toHaveLength(1); expect(first.records[0].ok).toBe(true);
      expect(first.discarded).toBe(fault === "lost"); expect(first.changedRecords).toBe(fault === "malformed" ? 1 : 0);
      assertApplied(immediate, p, [1000, 200, 1200], [c]);
      expect(immediate.objects.drafts[0].status).toBe("applied"); expect(p.bulk).toHaveLength(0);
      await expect(ui.screen.getByRole("dialog", "Générer des ouvrages", { exact: true })).toHaveCount(0);
      await expect(ui.screen.getByRole("button", "Reprendre cette opération", { exact: true })).toBeEnabled();
      await expect(ui.screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText("Résultat à vérifier");
      const pendingBefore = await p.pending();
      expect(pendingBefore?.workflow).toBe("generated-ouvrage"); expect(pendingBefore?.body).toEqual(first.request);
      expect(inserts(p)).toHaveLength(1);
      const origin = await ui.browser.evaluate(() => performance.timeOrigin);
      await ui.browser.reload({ timeout: 15_000 });
      expect(await ui.browser.evaluate(() => performance.timeOrigin) > origin).toBe(true);
      await expect(ui.screen.getByRole("button", "Reprendre cette opération", { exact: true })).toBeEnabled();
      await expect(ui.screen.getByLabel(`Quantité pour ${c.designation}`, { exact: true })).toBeDisabled();
      const observationStart = Date.now(); await new Promise((resolve) => setTimeout(resolve, 3_000));
      const afterReloadPosts = inserts(p).length, pendingAfter = await p.pending();
      await recordEvidence(ui.army, `${code}-reload-no-application`, { beforeReloadPosts: 1, afterReloadPosts, windowMs: Date.now() - observationStart, pendingBefore, pendingAfter, dialogs });
      expect(afterReloadPosts).toBe(1); expect(pendingAfter).toEqual(pendingBefore);
      if (code === "GO02") {
        await installProbe(ui, p, "receipt");
        await ui.screen.getByRole("button", "Vérifier le résultat", { exact: true }).click();
        await expect.poll(async () => (await replies(ui)).filter((entry) => entry.action === "getGeneratedOuvrageApplicationReceipt").length, { timeout: 30_000 }).toBe(1);
        const observed = (await replies(ui)).find((entry) => entry.action === "getGeneratedOuvrageApplicationReceipt")!;
        await expect(ui.screen.getByRole("alert").filter({ hasText: "L'application des ouvrages reste à vérifier. Vérifiez son résultat avant de reprendre." })).toBeVisible();
        await expect(ui.screen.getByRole("button", "Reprendre cette opération", { exact: true })).toBeEnabled();
        await expect(ui.screen.getByText("Aucun résultat n'est encore disponible.", { exact: false })).toHaveCount(0);
        await recordEvidence(ui.army, "GO02-malformed-receipt-retained", { observed, pending: await p.pending(), applicationPosts: inserts(p).length });
        expect(observed.status).toBe(200); expect(observed.changedRecords).toBe(1);
        expect(await p.pending()).toEqual(pendingBefore); expect(inserts(p)).toHaveLength(1);
      }
      const response = await clickActionReply(ui, p, code === "GO01" ? "insertGeneratedOuvrages" : "abandonGeneratedOuvrageApplication",
        () => ui.screen.getByRole("button", code === "GO01" ? "Reprendre cette opération" : "Abandonner la demande", { exact: true }).click());
      expect(response.request).toEqual(first.request);
      const wireResult = response.records;
      const result = code === "GO02" ? [wireResult[0]?.data as Json] : wireResult;
      const resumed = await capture(ui, p, `${code}-first-get-after-replay`);
      await recordEvidence(ui.army, `${code}-replay-result`, { status: response.status, wireResult, result, applicationCalls: inserts(p) });
      expect(response.status).toBe(200); expect(wireResult).toHaveLength(1); expect(wireResult[0].ok).toBe(true);
      expect(result).toHaveLength(1); expect(result[0].replayed).toBe(true);
      expect(inserts(p)).toHaveLength(code === "GO01" ? 2 : 1);
      if (code === "GO01") expect(inserts(p)[1].request).toEqual(first.request);
      else {
        const closures = p.calls.filter((call) => call.action === "abandonGeneratedOuvrageApplication");
        expect(closures).toHaveLength(1); expect(closures[0].request).toEqual(first.request);
        expect(result[0].ok).toBe(true); expect("outcome" in result[0]).toBe(false);
      }
      expect(inserts(p).every((call) => call.sessionPresent)).toBe(true);
      assertApplied(resumed, p, [1000, 200, 1200], [c]);
      for (const table of ["applications", "snapshots", "assemblies", "libraryComponents"]) expect(stableRows(resumed.objects[table])).toEqual(stableRows(immediate.objects[table]));
      await expect(ui.screen.getByRole("button", "Reprendre cette opération", { exact: true })).toHaveCount(0);
      await expect(ui.screen.getByLabel(`Quantité pour ${c.designation}`, { exact: true })).toBeEnabled();
      await recordEvidence(ui.army, `${code}-recovery-editable-local-state`, {
        pending: await p.pending(),
        local: JSON.parse(await ui.browser.evaluate((versionId) => JSON.stringify({
          autosaveStatus: document.querySelector('[data-testid="estimate-page-toolbar-autosave-status"]')?.textContent,
          buffer: JSON.parse(sessionStorage.getItem(`estimate:edit:autosave-buffer:${versionId}`) ?? "null"),
        }), p.s.versionId)),
      });
      await saved(ui); expect(await p.pending()).toBe(null); permitUnknownReload = false;
      if (code === "GO01") {
        await ui.screen.getByLabel(`Quantité pour ${c.designation}`, { exact: true }).fill("2");
        await ui.browser.keyboard.press("Tab"); await ui.browser.keyboard.press("Control+s");
        await expect.poll(async () => totals((await readEstimate(ui.browser, p.s.versionId)).version), { timeout: 30_000 }).toEqual([2000, 400, 2400]);
        await saved(ui);
        const newer = await capture(ui, p, "GO01-newer-real-UI-quantity");
        const old = await action(ui, p, "insertGeneratedOuvrages", first.request);
        const receipt = await action(ui, p, "getGeneratedOuvrageApplicationReceipt", { versionId: p.s.versionId, operationKey: first.request.operationKey });
        const final = await capture(ui, p, "GO01-old-replay-keeps-newer-state");
        await recordEvidence(ui.army, "GO01-historical-receipt", { old, receipt, newer, final });
        expect(old.records).toHaveLength(1); expect(old.records[0].replayed).toBe(true);
        expect(old.records[0].totals).toEqual({ totalHtCents: 1000, totalTaxCents: 200, totalTtcCents: 1200 });
        expect(receipt.records).toHaveLength(1); expect(receipt.records[0].ok).toBe(true);
        expect(final.estimate.items).toEqual(newer.estimate.items); expect(totals(final.estimate.version)).toEqual([2000, 400, 2400]);
        expect((old.records[0].currentVersion as Json).updatedAt).toBe(final.estimate.version.updated_at);
      }
      await ui.browser.reload({ timeout: 15_000 });
      await expect(ui.screen.getByLabel(`Quantité pour ${c.designation}`, { exact: true })).toBeEnabled(); await saved(ui);
      const final = await capture(ui, p, `${code}-final-reload`);
      assertApplied(final, p, code === "GO01" ? [2000, 400, 2400] : [1000, 200, 1200], [{ ...c, lineQuantity: code === "GO01" ? 2 : 1 }]);
      expect(p.bulk).toHaveLength(0);
    } finally { await dispose(); await p.close(); }
  });
}

armyTest("GO03 stale human review refuses application and stale save before explicit reload of the current reviewed content", options, async (ui) => {
  const p = await prepare(ui, "stale"), c = p.s.candidates[0];
  try {
    await installProbe(ui, p, "none"); await resumeDialog(ui, p.s); await review(ui, c); await selectOnly(ui, p.s, c);
    const original = (await replies(ui)).find((reply) => reply.action === "updateGeneratedOuvrageSubdetailDraft")!;
    expect(original.records).toHaveLength(1);
    const token = original.records[0].reviewToken; expect(typeof token === "string" && /^[0-9a-f]{64}$/.test(token)).toBe(true);
    const components = structuredClone(original.request.components) as Json[];
    expect(components).toHaveLength(1); components[0].unitCostHtCents = 1200;
    // A real second server action; the visible form deliberately retains its old token.
    const concurrent = await action(ui, p, "updateGeneratedOuvrageSubdetailDraft", { ...original.request, expectedReviewToken: token, components, markReviewed: true });
    await recordEvidence(ui.army, "GO03-second-authorized-review", { original, concurrent, sameBrowserSession: true, independentSessionClaim: false });
    expect(concurrent.status).toBe(200); expect(concurrent.records).toHaveLength(1);
    expect(concurrent.records[0].status).toBe("reviewed"); expect(concurrent.records[0].reviewToken === token).toBe(false);
    const changed = await capture(ui, p, "GO03-concurrent-review-before-apply");
    const refused = await apply(ui, p), after = await capture(ui, p, "GO03-first-get-after-stale-apply");
    expect(refused.ok).toBe(false); expect((refused.error as Json).code).toBe("GENERATED_OUVRAGE_REVIEW_CHANGED");
    expect(totals(after.estimate.version)).toEqual([0, 0, 0]); expect(after.estimate.items).toEqual(changed.estimate.items);
    for (const table of ["applications", "snapshots", "assemblies", "libraryComponents"]) expect(after.objects[table]).toHaveLength(0);
    expect(after.objects.components[0].unit_cost_ht_cents).toBe(1200); expect(after.objects.drafts[0].status).toBe("pending");
    await expect(ui.screen.getByRole("dialog", "Générer des ouvrages", { exact: true })).toBeVisible();
    expect(await p.pending()).toBe(null);
    await cost(ui, c, 1100);
    await expect(ui.screen.getByTestId("generated-ouvrage-insert-button")).toBeDisabled();
    const section = ui.browser.locator(`[data-testid="candidate-card-${c.candidateId}"] section`);
    const staleSaveResponse = await clickActionReply(ui, p, "updateGeneratedOuvrageSubdetailDraft",
      () => section.getByRole("button", "Revalider le sous-détail", { exact: true }).click());
    const staleSaveRecords = staleSaveResponse.records;
    await recordEvidence(ui.army, "GO03-stale-save-response", {
      status: staleSaveResponse.status, records: staleSaveRecords,
    });
    expect(staleSaveResponse.status).toBe(200);
    expect(staleSaveRecords).toHaveLength(1);
    expect(staleSaveRecords[0].ok).toBe(false);
    expect((staleSaveRecords[0].error as Json).status).toBe(409);
    expect((staleSaveRecords[0].error as Json).code).toBe("GENERATED_OUVRAGE_REVIEW_CHANGED");
    const reload = ui.screen.getByRole("button", "Recharger la revue enregistrée", { exact: true });
    await expect(reload).toBeEnabled();
    const afterSave = await capture(ui, p, "GO03-stale-save-preserves-current-review");
    expect(afterSave.objects.components[0].unit_cost_ht_cents).toBe(1200);
    expect(stableRows(afterSave.objects.components)).toEqual(stableRows(changed.objects.components));
    await reload.click();
    const card = ui.screen.getByTestId(`candidate-card-${c.candidateId}`);
    const input = card.getByLabel("Coût unitaire HT (€)", { exact: true });
    if (!await input.isVisible()) await card.getByRole("button", c.componentDesignation, { exact: false }).click();
    await expect(input).toHaveValue("12,00");
    // The second ordinary action already validated this current content. Reload
    // must expose that exact review, without silently replacing the stale one.
    await expect(section.getByRole("button", "Sous-détail déjà validé", { exact: true })).toBeDisabled();
    await selectOnly(ui, p.s, c);
    const result = await apply(ui, p), final = await capture(ui, p, "GO03-current-review-applied");
    expect(result.ok).toBe(true); assertApplied(final, p, [1200, 240, 1440], [{ ...c, unitCostHtCents: 1200 }]);
    expect(inserts(p)).toHaveLength(2); expect(inserts(p)[0].request.operationKey === inserts(p)[1].request.operationKey).toBe(false);
    expect(p.bulk).toHaveLength(0);
  } finally { await p.close(); }
});

armyTest("GO05 a lost real refusal can be durably abandoned after review changes without enabling the old intent", options, async (ui) => {
  const p = await prepare(ui, "abandon"), c = p.s.candidates[0];
  const dialogs: string[] = []; let allowUnknownReload = true;
  const dispose = await ui.browser.onDialog(async (dialog) => {
    dialogs.push(dialog.message); if (!allowUnknownReload) throw new Error("Unexpected leave prompt after verified abandonment.");
    await dialog.accept();
  });
  try {
    await installProbe(ui, p, "none"); await resumeDialog(ui, p.s); await review(ui, c); await selectOnly(ui, p.s, c);
    const firstReview = (await replies(ui)).find((reply) => reply.action === "updateGeneratedOuvrageSubdetailDraft")!;
    const components = structuredClone(firstReview.request.components) as Json[];
    components[0].unitCostHtCents = 1200;
    const secondReview = await action(ui, p, "updateGeneratedOuvrageSubdetailDraft", { ...firstReview.request,
      expectedReviewToken: firstReview.records[0].reviewToken, components, markReviewed: true });
    expect(secondReview.records).toHaveLength(1); expect(secondReview.records[0].status).toBe("reviewed");
    await installProbe(ui, p, "lost");
    await ui.screen.getByTestId("generated-ouvrage-insert-button").click();
    await expect.poll(async () => (await replies(ui)).filter((entry) => entry.action === "insertGeneratedOuvrages").length, { timeout: 45_000 }).toBe(1);
    const lost = (await replies(ui)).find((entry) => entry.action === "insertGeneratedOuvrages")!;
    const empty = await capture(ui, p, "GO05-first-get-after-real-refusal");
    await recordEvidence(ui.army, "GO05-refusal-response-lost", { firstReview, secondReview, lost, empty });
    expect(lost.discarded).toBe(true); expect(lost.records).toHaveLength(1); expect(lost.records[0].ok).toBe(false);
    expect((lost.records[0].error as Json).code).toBe("GENERATED_OUVRAGE_REVIEW_CHANGED");
    expect(totals(empty.estimate.version)).toEqual([0, 0, 0]); expect(empty.estimate.items.map((row) => row.id)).toEqual([p.s.sectionId]);
    for (const key of ["applications", "snapshots", "assemblies", "libraryComponents"]) expect(empty.objects[key]).toHaveLength(0);
    await expect(ui.screen.getByRole("dialog", "Générer des ouvrages", { exact: true })).toHaveCount(0);
    await expect(ui.screen.getByRole("button", "Reprendre cette opération", { exact: true })).toBeEnabled();
    const pending = await p.pending(); expect(pending?.body).toEqual(lost.request);
    components[0].unitCostHtCents = 1400;
    const thirdReview = await action(ui, p, "updateGeneratedOuvrageSubdetailDraft", { ...firstReview.request,
      expectedReviewToken: secondReview.records[0].reviewToken, components, markReviewed: true });
    expect(thirdReview.records).toHaveLength(1); expect(thirdReview.records[0].status).toBe("reviewed");
    await recordEvidence(ui.army, "GO05-review-changed-after-unknown", { thirdReview, pending: await p.pending() });
    await ui.browser.reload({ timeout: 15_000 });
    await expect(ui.screen.getByRole("button", "Reprendre cette opération", { exact: true })).toBeEnabled();
    const start = Date.now(); await new Promise((resolve) => setTimeout(resolve, 3_000));
    await recordEvidence(ui.army, "GO05-no-auto-application", { windowMs: Date.now() - start, posts: inserts(p).length, pending: await p.pending(), dialogs });
    expect(inserts(p)).toHaveLength(1); expect(await p.pending()).toEqual(pending);
    const refusedResponse = await clickActionReply(ui, p, "insertGeneratedOuvrages",
      () => ui.screen.getByRole("button", "Reprendre cette opération", { exact: true }).click());
    const refused = refusedResponse.records;
    const stillEmpty = await capture(ui, p, "GO05-first-get-after-refused-replay");
    await recordEvidence(ui.army, "GO05-refused-replay-retains-intention", { status: refusedResponse.status, refused, pending: await p.pending() });
    expect(refused).toHaveLength(1); expect(refused[0].ok).toBe(false);
    expect((refused[0].error as Json).code).toBe("GENERATED_OUVRAGE_REVIEW_CHANGED");
    expect(inserts(p)).toHaveLength(2); expect(inserts(p)[1].request).toEqual(lost.request);
    expect(await p.pending()).toEqual(pending); expect(stillEmpty.estimate.items).toEqual(empty.estimate.items);
    expect(totals(stillEmpty.estimate.version)).toEqual([0, 0, 0]);
    await expect(ui.screen.getByRole("button", "Abandonner la demande", { exact: true })).toBeEnabled();
    const closeResponse = await clickActionReply(ui, p, "abandonGeneratedOuvrageApplication",
      () => ui.screen.getByRole("button", "Abandonner la demande", { exact: true }).click());
    const closed = closeResponse.records;
    const tombstone = closed[0]?.data as Json, receipt = tombstone?.receipt as Json;
    const abandoned = await capture(ui, p, "GO05-first-get-after-abandonment");
    await recordEvidence(ui.army, "GO05-durable-abandonment", { status: closeResponse.status, closed, abandoned });
    expect(closeResponse.status).toBe(200); expect(closed).toHaveLength(1); expect(closed[0].ok).toBe(true);
    expect(tombstone.ok).toBe(true); expect(tombstone.outcome).toBe("abandoned");
    expect(Object.fromEntries(Object.keys(lost.request).map((key) => [key, receipt[key]]))).toEqual(lost.request);
    expect(receipt.actorId).toBe(p.f.owner.userId); expect(Number.isFinite(Date.parse(String(receipt.abandonedAt)))).toBe(true);
    expect(totals(abandoned.estimate.version)).toEqual([0, 0, 0]);
    await expect(ui.screen.getByRole("button", "Reprendre cette opération", { exact: true })).toHaveCount(0);
    await expect(ui.screen.getByRole("button", `Ajouter dans ${p.f.prefix} ${p.s.label} S`, { exact: true })).toBeEnabled(); await saved(ui);
    expect(await p.pending()).toBe(null); allowUnknownReload = false;
    await ui.browser.reload({ timeout: 15_000 });
    await expect(ui.screen.getByRole("button", `Ajouter dans ${p.f.prefix} ${p.s.label} S`, { exact: true })).toBeEnabled(); await saved(ui);
    const read = await action(ui, p, "getGeneratedOuvrageApplicationReceipt", { versionId: p.s.versionId, operationKey: lost.request.operationKey });
    const oldApply = await action(ui, p, "insertGeneratedOuvrages", lost.request);
    const beforeNew = await capture(ui, p, "GO05-old-intent-remains-abandoned-with-fresh-lease");
    await recordEvidence(ui.army, "GO05-tombstone-replay", { read, oldApply, beforeNew });
    expect((read.records[0].data as Json).receipt).toEqual(receipt);
    expect(oldApply.records).toHaveLength(1); expect(oldApply.records[0].outcome).toBe("abandoned"); expect(oldApply.records[0].receipt).toEqual(receipt);
    expect(totals(beforeNew.estimate.version)).toEqual([0, 0, 0]); expect(beforeNew.estimate.items.map((row) => row.id)).toEqual([p.s.sectionId]);
    for (const key of ["applications", "snapshots", "assemblies", "libraryComponents"]) expect(beforeNew.objects[key]).toHaveLength(0);
    await resumeDialog(ui, p.s);
    const card = ui.screen.getByTestId(`candidate-card-${c.candidateId}`);
    await card.getByRole("button", "Valider le sous-détail", { exact: true }).click();
    await expect(card.getByLabel("Coût unitaire HT (€)", { exact: true })).toHaveValue("14,00");
    await expect(card.getByRole("button", "Sous-détail déjà validé", { exact: true })).toBeDisabled();
    await selectOnly(ui, p.s, c);
    const current = await apply(ui, p), final = await capture(ui, p, "GO05-new-intention-after-closure");
    expect(current.ok).toBe(true); expect((current.receipt as Json).operationKey === lost.request.operationKey).toBe(false);
    assertApplied(final, p, [1400, 280, 1680], [{ ...c, unitCostHtCents: 1400 }]); expect(p.bulk).toHaveLength(0);
  } finally { await dispose(); await p.close(); }
});

armyTest("GO04 edited reviewed cost blocks insertion until revalidation and partial selection survives reload", options, async (ui) => {
  const p = await prepare(ui, "partial"), [first, second] = p.s.candidates;
  const appliedFirst = { ...first, unitCostHtCents: 1500 };
  try {
    await resumeDialog(ui, p.s); await review(ui, first); await selectOnly(ui, p.s, first);
    await cost(ui, first, 1500);
    await expect(ui.screen.getByTestId("generated-ouvrage-insert-button")).toBeDisabled();
    const section = ui.browser.locator(`[data-testid="candidate-card-${first.candidateId}"] section`);
    await expect(section.getByText("À revoir", { exact: true })).toBeVisible();
    const unchanged = await capture(ui, p, "GO04-dirty-local-review-not-applied");
    expect(unchanged.objects.components.find((row) => row.id === first.componentId)?.unit_cost_ht_cents).toBe(1000);
    expect(unchanged.objects.applications).toHaveLength(0); expect(inserts(p)).toHaveLength(0);
    await section.getByRole("button", "Revalider le sous-détail", { exact: true }).click();
    await expect(section.getByRole("button", "Sous-détail déjà validé", { exact: true })).toBeDisabled();
    await selectOnly(ui, p.s, first);
    const partialResult = await apply(ui, p), partial = await capture(ui, p, "GO04-first-partial-commit");
    expect(partialResult.ok).toBe(true); expect(partialResult.draftStatus).toBe("partially_applied");
    assertApplied(partial, p, [1500, 300, 1800], [appliedFirst]);
    expect(partial.objects.drafts[0].status).toBe("partially_applied");
    expect(partial.objects.candidates.find((row) => row.id === second.candidateId)?.resolution_status).toBe("pending");
    const dialog = ui.screen.getByRole("dialog", "Générer des ouvrages", { exact: true });
    await expect(dialog).toBeVisible();
    await expect(ui.screen.getByTestId(`candidate-card-${first.candidateId}`).getByText("Inséré", { exact: true })).toBeVisible();
    await expect(ui.screen.getByTestId(`candidate-card-${second.candidateId}`).getByRole("button", "Valider le sous-détail", { exact: true })).toBeEnabled();
    await ui.browser.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
    await expect(ui.screen.getByLabel(`Quantité pour ${first.designation}`, { exact: true })).toBeEnabled(); await saved(ui);
    await ui.browser.reload({ timeout: 15_000 });
    await expect(ui.screen.getByLabel(`Quantité pour ${first.designation}`, { exact: true })).toBeEnabled(); await saved(ui);
    const reloaded = await capture(ui, p, "GO04-partial-reloaded");
    expect(reloaded.estimate.items).toEqual(partial.estimate.items);
    for (const table of ["applications", "snapshots", "assemblies", "libraryComponents"]) expect(stableRows(reloaded.objects[table])).toEqual(stableRows(partial.objects[table]));
    await resumeDialog(ui, p.s);
    const inserted = ui.screen.getByTestId(`candidate-card-${first.candidateId}`);
    await expect(inserted.getByText("Inséré", { exact: true })).toBeVisible(); await expect(inserted.getByRole("checkbox")).toHaveCount(0);
    await review(ui, second); await selectOnly(ui, p.s, second);
    const completed = await apply(ui, p), final = await capture(ui, p, "GO04-second-commit");
    expect(completed.ok).toBe(true); expect(completed.draftStatus).toBe("applied");
    assertApplied(final, p, [3500, 700, 4200], [appliedFirst, second]);
    expect(final.objects.drafts[0].status).toBe("applied");
    const firstLineId = partial.objects.applications[0].estimate_item_id;
    const originalLine = partial.estimate.items.find((row) => row.id === firstLineId)!;
    const currentLine = final.estimate.items.find((row) => row.id === firstLineId)!;
    expect(Date.parse(String(currentLine.updated_at)) >= Date.parse(String(originalLine.updated_at))).toBe(true);
    expect({ ...currentLine, updated_at: originalLine.updated_at }).toEqual(originalLine);
    for (const table of ["applications", "snapshots", "assemblies", "libraryComponents"]) {
      for (const original of partial.objects[table]) expect(final.objects[table].find((row) => row.id === original.id)).toEqual(original);
    }
    expect(inserts(p)).toHaveLength(2); expect(p.bulk).toHaveLength(0);
    await expect(dialog).toHaveCount(0); await saved(ui);
    await ui.browser.reload({ timeout: 15_000 });
    await expect(ui.screen.getByLabel(`Quantité pour ${second.designation}`, { exact: true })).toBeEnabled(); await saved(ui);
    assertApplied(await capture(ui, p, "GO04-final-reload"), p, [3500, 700, 4200], [appliedFirst, second]);
  } finally { await p.close(); }
});

armyTest("GO06 two real local fallback generations discard the previous pending draft only after replacement and resume the current draft", options, async (ui) => {
  const file = process.env.E2E_GENERATED_RECOVERY_FIXTURE_PATH;
  if (!file) throw new Error("Explicit generated recovery fixture required.");
  const f = JSON.parse(await readFile(file, "utf8"));
  const g = f.generation as { projectId: string; versionId: string; sectionA: string; sectionB: string };
  if (f.schemaVersion !== "estimate-generated-recovery-fixture-1" || f.status !== "ready" ||
    f.apiUrl !== process.env.NEXT_PUBLIC_SUPABASE_URL || f.apiUrl !== process.env.E2E_COVERAGE_BACKEND_ORIGIN || !g) throw new Error("Generation fixture differs from the profile.");
  ownEstimate(ui.army, { projectId: g.projectId, versionId: g.versionId });
  await ui.app.open(`/dashboard/estimates/${g.versionId}/edit`);
  await expect(ui.screen.getByRole("button", `Ajouter dans ${f.prefix} génération lot1`, { exact: true })).toBeEnabled(); await saved(ui);
  const client = createClient(f.apiUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const login = await client.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL!, password: process.env.E2E_LOGIN_PASSWORD! });
  if (login.error || login.data.user?.id !== f.owner.userId) throw new Error("Generation ordinary observer identity differs.");
  const observe = async (label: string) => {
    const estimate = await readEstimate(ui.browser, g.versionId), rows: Record<string, Json[]> = {};
    for (const [name, table, field, id] of [
      ["drafts", "estimate_generated_ouvrage_drafts", "target_version_id", g.versionId],
      ["candidates", "estimate_generated_ouvrage_candidates", "target_version_id", g.versionId],
      ["fragments", "estimate_generated_ouvrage_source_fragments", "project_id", g.projectId],
      ["subdetails", "estimate_generated_ouvrage_subdetail_drafts", "target_version_id", g.versionId],
      ["applications", "estimate_generated_ouvrage_applications", "target_version_id", g.versionId],
      ["snapshots", "estimate_generated_ouvrage_work_snapshots", "target_version_id", g.versionId],
    ]) {
      const result = await client.from(table).select("*").eq("tenant_id", f.owner.tenantId).eq(field, id).order("id");
      if (result.error) throw new Error(`Generation observation failed: ${table}/${result.error.code}`);
      rows[name] = result.data;
    }
    rows.assemblies = [];
    rows.candidateSources = [];
    if (rows.drafts.length) {
      const result = await client.from("estimate_assemblies").select("*").eq("tenant_id", f.owner.tenantId).in("source_metadata->>draft_id", rows.drafts.map((row) => row.id));
      if (result.error) throw new Error("Generation library observation failed."); rows.assemblies = result.data;
      const sources = await client.from("estimate_generated_ouvrage_candidate_sources").select("*").eq("tenant_id", f.owner.tenantId)
        .in("draft_id", rows.drafts.map((row) => row.id)).order("id");
      if (sources.error) throw new Error("Generation candidate provenance observation failed."); rows.candidateSources = sources.data;
    }
    const value = { estimate, rows }; await recordEvidence(ui.army, label, value);
    expect(totals(estimate.version)).toEqual([0, 0, 0]);
    expect(estimate.items.map((item) => item.id).sort()).toEqual([g.sectionA, g.sectionB].sort());
    for (const key of ["subdetails", "applications", "snapshots", "assemblies"]) expect(rows[key]).toHaveLength(0);
    return value;
  };
  const manifest = JSON.parse(await readFile(".e2e/army/next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName?: string }> };
  const names = new Map(Object.entries(manifest.node).map(([id, entry]) => [id, entry.exportedName]));
  const editorUrl = new URL(`/dashboard/estimates/${g.versionId}/edit`, ui.app.baseUrl!).href;
  const ids: Record<string, string> = {};
  for (const name of ["generateOuvragesFromText", "fetchResumableGeneratedOuvrageDraft"]) {
    const found = [...names].find(([, exported]) => exported === name);
    if (!found) throw new Error(`Built generation action missing: ${name}`);
    ids[name] = found[0];
  }
  const probe = { ids };
  const calls: Json[] = [], bulk: string[] = [];
  await ui.browser.route(editorUrl, async (route) => {
    const actionName = names.get(route.request.headers["next-action"] ?? "");
    if (["insertGeneratedOuvrages", "updateGeneratedOuvrageSubdetailDraft", "fetchGeneratedOuvrageSubdetailDraft"].includes(actionName ?? "")) {
      await route.abort(); throw new Error("GO06 must not review or apply a generated candidate.");
    }
    if (actionName === "generateOuvragesFromText") {
      const [body] = JSON.parse(route.request.postData ?? "[]"), { draftLockSessionId, ...request } = body;
      calls.push({ action: actionName, request, sessionPresent: typeof draftLockSessionId === "string", at: new Date().toISOString() });
    }
    await route.fallback();
  });
  const bulkUrl = new URL(`/api/estimates/${g.versionId}/items/bulk`, ui.app.baseUrl!).href;
  await ui.browser.route(bulkUrl, async (route) => { bulk.push(route.request.method); await route.fallback(); });
  const open = async () => {
    const opener = ui.screen.getByTestId("estimate-editor-open-generated-ouvrage-button");
    if (!await opener.isVisible()) {
      const tab = ui.screen.getByRole("tab", "Insérer", { exact: true }); if (await tab.isVisible()) await tab.click();
      await ui.screen.getByRole("button", "Insérer", { exact: true }).click();
    }
    await opener.click(); await expect(ui.screen.getByRole("dialog", "Générer des ouvrages", { exact: true })).toBeVisible();
  };
  try {
    const initial = await observe("GO06-empty-before-generation");
    for (const key of ["drafts", "candidates", "fragments", "candidateSources"]) expect(initial.rows[key]).toHaveLength(0);
    const catalogue: Array<{ kind: "templateId" | "assemblyId"; id: string; label: string; excerpt: string; row: Json }> = [];
    for (const [table, kind, label] of [["estimate_templates", "templateId", "Template de devis"], ["estimate_assemblies", "assemblyId", "Ouvrage"]] as const) {
      const result = await client.from(table).select("id,name,description,updated_at").eq("tenant_id", f.owner.tenantId)
        .eq("created_by", f.owner.userId).order("updated_at", { ascending: false }).limit(6);
      if (result.error) throw new Error(`Generation catalogue observation failed: ${table}/${result.error.code}`);
      for (const row of result.data) {
        const name = String(row.name).trim().replace(/\s+/g, " ").slice(0, 180).trim();
        const description = typeof row.description === "string" ? row.description.trim() : "";
        catalogue.push({ kind, id: row.id, label, excerpt: [name, description].filter(Boolean).join(" | "), row });
      }
    }
    await recordEvidence(ui.army, "GO06-library-context-before-generation", { catalogue, scope: "Latest six templates and assemblies of this ordinary owner/tenant; context is not filtered by source text." });
    await open();
    const generated: Array<{ draftId: string; candidateId: string; designation: string; unit: string; quantity: number; sources: Json[]; links: Json[] }> = [];
    let firstFragments: Json[] = [];
    for (const [index, sourceText] of ["Fourniture tube cuivre 10 m", "Fourniture isolant thermique 6 m"].entries()) {
      if (index === 1) {
        await ui.screen.getByRole("button", "Nouvelle génération", { exact: true }).click();
        const beforeSecond = await observe("GO06-before-second-submit");
        expect(beforeSecond.rows.drafts[0].status).toBe("pending");
        expect(beforeSecond.rows.fragments.every((row) => row.status === "active")).toBe(true);
      }
      await ui.screen.getByLabel("Texte source", { exact: true }).fill(sourceText);
      await ui.screen.getByLabel("Lot cible (optionnel)", { exact: true }).selectOption({ value: index === 0 ? g.sectionA : g.sectionB });
      const response = await clickActionReply(ui, probe, "generateOuvragesFromText",
        () => ui.screen.getByTestId("generated-ouvrage-generate-button").click());
      const results = response.records;
      const observed = await observe(`GO06-first-get-after-generation-${index + 1}`);
      await recordEvidence(ui.army, `GO06-real-generation-response-${index + 1}`, { status: response.status, results, calls });
      expect(response.status).toBe(200); expect(results).toHaveLength(1); expect(results[0].candidates).toHaveLength(1);
      const result = results[0] as { draftId: string; candidates: Array<{
        candidateId: string; designation: string; unit: string; quantity: number; sources: Json[];
      }> }, candidate = result.candidates[0];
      generated.push({ draftId: result.draftId, candidateId: candidate.candidateId, designation: candidate.designation, unit: candidate.unit, quantity: candidate.quantity,
        sources: candidate.sources, links: observed.rows.candidateSources.filter((row) => row.draft_id === result.draftId) });
      expect([candidate.designation, candidate.unit, candidate.quantity]).toEqual(index === 0 ? ["Fourniture tube cuivre", "m", 10] : ["Fourniture isolant thermique", "m", 6]);
      await expect(ui.screen.getByTestId(`candidate-card-${candidate.candidateId}`)).toBeVisible();
      await expect(ui.screen.getByTestId("generated-ouvrage-insert-button")).toBeDisabled();
      expect(observed.rows.drafts).toHaveLength(index + 1);
      const current = observed.rows.drafts.find((row) => row.id === result.draftId)!;
      expect(current.status).toBe("pending");
      expect(current.generation_metadata).toEqual(expect.objectContaining({ used_fallback: true, model: null, token_count: null, cost_cents: null }));
      const fragments = observed.rows.fragments.filter((row) => row.draft_id === result.draftId);
      const primary = fragments.filter((row) => (row.metadata as Json)?.origin === "input");
      expect(primary).toHaveLength(1); expect(primary[0].excerpt).toBe(sourceText); expect(primary[0].status).toBe("active");
      // Real local fallback links its candidate to the primary input only.
      // Library context is kept as context, without inventing evidential links.
      const links = generated[index].links;
      expect(links).toHaveLength(1);
      expect(links[0]).toEqual(expect.objectContaining({ tenant_id: f.owner.tenantId, draft_id: result.draftId,
        candidate_id: candidate.candidateId, source_fragment_id: primary[0].id, source_rank: 0 }));
      expect(candidate.sources).toEqual([{ sourceFragmentId: primary[0].id, sourceDocumentId: primary[0].source_document_id,
        type: "text", label: primary[0].label, excerpt: sourceText, sourceFileName: primary[0].source_file_name,
        sourcePageFrom: primary[0].source_page_from, sourcePageTo: primary[0].source_page_to, selectionLabel: primary[0].selection_label }]);
      const context = fragments.filter((row) => row.id !== primary[0].id);
      for (const fragment of context) {
        const metadata = fragment.metadata as Json;
        const matches = catalogue.filter((entry) => metadata?.[entry.kind] === entry.id && fragment.label === entry.label && fragment.excerpt === entry.excerpt);
        expect(matches).toHaveLength(1); expect(fragment.source_kind).toBe("library"); expect(fragment.status).toBe("active");
      }
      expect((current.generation_metadata as Json).source_fragment_count).toBe(fragments.length);
      expect(new Set(fragments.map((row) => row.id)).size).toBe(fragments.length);
      expect(context.length <= 6).toBe(true);
      if (catalogue.length) expect(context.length > 0).toBe(true);
      if (index === 0) firstFragments = fragments;
      if (index === 1) {
        expect(result.draftId === generated[0].draftId).toBe(false);
        expect(observed.rows.drafts.find((row) => row.id === generated[0].draftId)?.status).toBe("discarded");
        const exactFragments = (rows: Json[]) => rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "updated_at")))
          .sort((a, b) => String(a.id).localeCompare(String(b.id)));
        expect(exactFragments(observed.rows.fragments.filter((row) => row.draft_id === generated[0].draftId)))
          .toEqual(exactFragments(firstFragments.map((row) => ({ ...row, status: "discarded" }))));
        expect(observed.rows.candidateSources.filter((row) => row.draft_id === generated[0].draftId)).toEqual(generated[0].links);
      }
    }
    await ui.browser.keyboard.press("Escape"); await saved(ui);
    await ui.browser.reload({ timeout: 15_000 });
    await expect(ui.screen.getByRole("button", `Ajouter dans ${f.prefix} génération lot1`, { exact: true })).toBeEnabled(); await saved(ui);
    await open();
    await expect(ui.screen.getByTestId(`generated-ouvrage-draft-${generated[0].draftId}`)).toHaveCount(0);
    const resumedResponse = await clickActionReply(ui, probe, "fetchResumableGeneratedOuvrageDraft",
      () => ui.screen.getByTestId(`generated-ouvrage-draft-${generated[1].draftId}`).getByRole("button", "Reprendre", { exact: true }).click());
    const resumedRecords = resumedResponse.records;
    await recordEvidence(ui.army, "GO06-real-resume-provenance", { status: resumedResponse.status, records: resumedRecords });
    expect(resumedResponse.status).toBe(200); expect(resumedRecords).toHaveLength(1); expect(resumedRecords[0].ok).toBe(true);
    const resumedDraft = resumedRecords[0].data as Json;
    expect(resumedDraft.draftId).toBe(generated[1].draftId);
    const resumedCandidates = resumedDraft.candidates as Json[];
    expect(resumedCandidates).toHaveLength(1); expect(resumedCandidates[0].candidateId).toBe(generated[1].candidateId);
    expect(resumedCandidates[0].sources).toEqual(generated[1].sources);
    await expect(ui.screen.getByTestId(`candidate-card-${generated[1].candidateId}`)).toBeVisible();
    const final = await observe("GO06-replacement-reloaded-and-resumed");
    const candidate = final.rows.candidates.find((row) => row.id === generated[1].candidateId)!;
    expect([candidate.designation, candidate.unit, candidate.quantity, candidate.resolution_status, candidate.suggested_lot_id]).toEqual([generated[1].designation, "m", 6, "pending", g.sectionB]);
    for (const value of generated) expect(final.rows.candidateSources.filter((row) => row.draft_id === value.draftId)).toEqual(value.links);
    expect(calls).toHaveLength(2); expect(calls.every((call) => call.sessionPresent)).toBe(true); expect(bulk).toHaveLength(0);
    const networkFile = process.env.E2E_COVERAGE_NETWORK_LOG;
    if (!networkFile) throw new Error("Real server network guard evidence is required for the local fallback.");
    const network = (await readFile(networkFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const denied = network.filter((entry) => entry.allowed === false);
    await recordEvidence(ui.army, "GO06-no-model-proof", { calls, bulk, guardInstalled: network.some((entry) => entry.kind === "guard-installed"), denied,
      generationMetadata: final.rows.drafts.map((row) => ({ id: row.id, metadata: row.generation_metadata })), modelCounterAloneIsInsufficient: true });
    expect(network.some((entry) => entry.kind === "guard-installed")).toBe(true); expect(denied).toHaveLength(0);
  } finally {
    await recordEvidence(ui.army, "GO06-request-ledger", { calls, bulk });
    await ui.browser.unroute(editorUrl); await ui.browser.unroute(bulkUrl);
    await ui.browser.evaluate(async (versionId) => {
      const session = sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${versionId}`);
      if (session) await fetch(`/api/estimates/${versionId}/lock`, { method: "DELETE", credentials: "same-origin", headers: { "content-type": "application/json", "x-estimate-draft-lock-session-id": session }, body: "{}" });
      return true;
    }, g.versionId);
    const logout = await client.auth.signOut({ scope: "local" }); if (logout.error) throw new Error("Generation observer local sign-out failed.");
  }
});
