import { randomUUID } from "node:crypto";

import { expect } from "e2e";

import type { TakeoffPageContributionsResponse } from "@/lib/takeoff/page-contributions-contracts";

import { apiRequest, armyTest, createLineViaApi, ownEstimate, readEstimate, recordEvidence } from "../critical/fixtures";
import { applyOwnedTakeoff } from "./fixtures";
import { VECTOR_PLAN, buildVectorPlanPdf } from "./vector-plan-fixture";
import { launchWorkerVectorUpload, startOwnedWorker, type WorkerUi } from "./worker-support";

// TI-682 lot D: a plan page enters an estimate once. Before lot D nothing compared two takeoffs of one page: relaunch a
// plan and apply it with « Ajouter », its quantities were counted twice without a word. A fictional vector plan,
// uploaded directly with its confirmed preparation, is read by the real worker and applied once; the same PDF (same
// content hash), uploaded again under another name so that only its hash can tie the two, is read by a second takeoff
// of the same estimate version.
// TKD01 (PR 1, then PR 2): its targeted and complete reviews name the page, the first takeoff (which the link opens) and
// its line in the estimate; the application wizard asks, before its last click, to replace the earlier measure
// (preselected) or keep both. Kept both with « another zone », the page is in the estimate twice by decision, and the
// banner says so with the reason, read again after a reload. The version is then copied: both takeoffs are carried over
// with their lines. Once the second takeoff's line is removed from the copy only, the first takeoff reviewed under the
// copy reports nothing, while under the original version the page is still there twice; a version the takeoff is not
// part of reads nothing (404).
// TKD02 (PR 2): the estimator prices and renames the first takeoff's lines by hand; the plan is measured again (a count
// changed, one line gone, one new). Applied without a decision, the database refuses and names the page. Through the
// wizard, the proposal pairs each line with its earlier line, the vanished line waits for a choice, and the replacement
// keeps every line's identity, title and price, with each quantity of the page counted once.
// TKR01 and TKR02 (two zone plans, two pages) are the negative control. Fictional plans only.

const options = { session: "army", tags: ["critical", "takeoff", "local"], timeout: 240_000 };
const REGION = "Pages déjà au devis";

type Envelope<T> = { ok: boolean; data: T };

type Upload = Awaited<ReturnType<typeof launchWorkerVectorUpload>>;
type ProviderItem = { designation: string; quantity: number; unit: string; source_page: number; confidence: number; evidence: string };

/**
 * The same plan read again: the same bytes and confirmed preparation, a new takeoff of the same version, under another
 * file name: neither side has a plan file, so only the content hash can tell it is the same page.
 */
async function relaunch(ui: WorkerUi, upload: Upload, providerItems: ProviderItem[]) {
  const { ids, jobId: first, fileName, tenantId, client, owner } = upload;
  const second = randomUUID();
  const relaunchName = fileName.replace(/\.pdf$/, "-relance.pdf");
  expect(relaunchName).not.toBe(fileName);
  const bytes = Buffer.from(await buildVectorPlanPdf({ printedScale: false }));
  const sourcePath = `${tenantId}/${second}/${relaunchName}`;
  (ui.army.ownedTakeoffUploads ??= []).push({ projectId: ids.projectId, tenantId, jobId: second });
  expect((await client.storage.from("takeoff-files").upload(sourcePath, bytes, { contentType: "application/pdf" })).error).toBeNull();
  const snapshot = await client.from("takeoff_jobs").select("preparation_snapshot").eq("id", first).single();
  expect(snapshot.error).toBeNull();
  const inserted = await client.from("takeoff_jobs").insert({ id: second, tenant_id: tenantId, estimate_version_id: ids.versionId,
    created_by: owner.userId, level: "C", status: "pending", source_file_name: relaunchName, source_file_path: sourcePath,
    source_file_type: "application/pdf", source_file_size_bytes: bytes.length, execution_provider: "gemini",
    preparation_snapshot: (snapshot.data as { preparation_snapshot: unknown }).preparation_snapshot } as never).select("id").single();
  expect(inserted.error).toBeNull();
  const run = await startOwnedWorker(ui, ids, second, "success", { vectors: true, owner, providerItems }).done;
  expect(run.outcome.status).toBe("completed");
  return { second, relaunchName, retained: run.items.filter((item) => !item.is_excluded) };
}

/** Through the application wizard of a review, up to its confirmation (section, « Ajouter », preview). */
async function openWizardConfirmation(ui: WorkerUi, sectionId: string, designation: string) {
  await ui.screen.getByRole("button", "Appliquer au devis", { exact: true }).click();
  const wizard = ui.screen.getByRole("dialog", "Appliquer au devis", { exact: true });
  await wizard.getByLabel("Section cible", { exact: true }).selectOption({ value: sectionId });
  await wizard.getByRole("button", "Suivant", { exact: true }).click();
  await wizard.getByRole("radio", /^Ajouter sans effacer/).check();
  await wizard.getByRole("button", "Suivant", { exact: true }).click();
  await expect(wizard).toContainText(designation);
  await wizard.getByRole("button", "Suivant", { exact: true }).click();
  return wizard;
}

async function readPages(ui: WorkerUi, jobId: string, versionId: string) {
  const read = await apiRequest<Envelope<TakeoffPageContributionsResponse>>(ui.browser, "GET",
    `/api/takeoff/jobs/${jobId}/page-contributions?version_id=${versionId}`);
  expect([read.status, read.body.ok]).toEqual([200, true]);
  return read.body.data;
}

armyTest("TKD01 a page another takeoff already brought into the estimate is named in both reviews and decided in the wizard, kept both with its reason", options,
  async (ui) => {
    const upload = await launchWorkerVectorUpload(ui);
    const { ids, jobId: first, fileName, client, owner } = upload;
    const network = VECTOR_PLAN.networks[0];
    // The model reads the EF run of page 1: the worker pairs it with the vector measure, which is retained (TKQ02).
    const providerItems = [{ designation: network.designation, quantity: network.length_m + 2, unit: "ml", source_page: 1,
      confidence: 0.95, evidence: "Lecture contrôlée du réseau EF sur le plan fictif, page 1." }];
    const firstRun = await startOwnedWorker(ui, ids, first, "success", { vectors: true, owner, providerItems }).done;
    expect(firstRun.outcome.status).toBe("completed");
    const firstRetained = firstRun.items.filter((item) => !item.is_excluded);
    expect(firstRetained.map((item) => [item.designation, item.quantity])).toEqual([[network.designation, network.length_m]]);
    const target = await createLineViaApi(ui.browser, ids.versionId, `${ui.army.runPrefix} target`);
    const applied = await applyOwnedTakeoff(ui.browser, ids.versionId, first, { strategy: "append", target_section_id: target.parent_id });
    expect(applied.status).toBe(200);
    // The first takeoff's own page is in the estimate through itself only: nothing to report.
    expect(await readPages(ui, first, ids.versionId)).toMatchObject({ pages: [], other_takeoff_line_count: 0 });

    const { second, relaunchName, retained } = await relaunch(ui, upload, providerItems);
    expect(retained.map((item) => [item.designation, item.quantity])).toEqual([[network.designation, network.length_m]]);

    // The read names page 1 of the plan, the first takeoff and its one estimate line.
    const estimateLines = (await readEstimate(ui.browser, ids.versionId)).items.filter((item) => item.title === network.designation);
    expect(estimateLines).toHaveLength(1);
    const pages = await readPages(ui, second, ids.versionId);
    expect(pages).toMatchObject({ version_id: ids.versionId, unidentified_item_ids: [], other_takeoff_line_count: 1,
      pages: [{ file_name: relaunchName, page: 1, earlier: [{ job_id: first, line_count: 1 }], own_line_count: 0 }],
      jobs: [{ id: first, estimate_version_id: ids.versionId, source_file_name: fileName }] });
    expect(pages.pages[0].item_ids).toEqual(expect.arrayContaining(retained.map((item) => item.id)));
    // The first takeoff's own line on the page, named: a Z1/Z2 partner is placed on the page by it, not by its takeoff.
    expect(pages.pages[0].earlier[0].takeoff_item_ids).toEqual(firstRetained.map((item) => item.id));
    await recordEvidence(ui.army, "TKD01-read", { ids, first, second, pages, estimateLines: estimateLines.map((line) => line.id) });

    // The targeted review names it at its head; « Ouvrir le métré » opens the first takeoff.
    const targeted = `/dashboard/affaires/${ids.projectId}/takeoff/${second}/review/targeted?versionId=${ids.versionId}`;
    const escaped = (name: string) => name.replace(/[.+]/g, "\\$&");
    const pageRow = new RegExp(`${escaped(relaunchName)}, page 1 : déjà au devis par le métré du \\d{2}/\\d{2}/\\d{4} \\(${escaped(fileName)}\\), 1 ligne`);
    await ui.app.open(targeted);
    const banner = ui.screen.getByRole("region", REGION, { exact: true });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(pageRow);
    await expect(banner).toContainText("À l’application, choisissez pour chaque page de remplacer sa mesure précédente ou de garder les deux");
    await expect(banner.getByRole("button")).toHaveCount(0);
    const screenshots = [await ui.app.screenshot("ti682-targeted-review-page-already-in-estimate")];

    // The application wizard asks at its confirmation: replace the earlier measure (preselected), or keep both. The run
    // measured again is paired with its earlier line; it is closed without applying.
    const wizard = await openWizardConfirmation(ui, String(target.parent_id), network.designation);
    const notice = wizard.getByRole("region", REGION, { exact: true });
    const decision = notice.getByRole("group", `Page ${relaunchName}, page 1`, { exact: true });
    await expect(decision).toContainText(/Déjà au devis par le métré du \d{2}\/\d{2}\/\d{4} \(niveau C\), 1 ligne\./);
    await expect(decision.getByRole("radio", "Remplacer la mesure précédente (recommandé)", { exact: true })).toBeChecked();
    await expect(decision).toContainText(`${network.designation} : `);
    await expect(wizard.getByRole("button", "Confirmer l'application", { exact: true })).toBeEnabled();
    screenshots.push(await ui.app.screenshot("ti682-apply-wizard-page-already-in-estimate"));
    await wizard.getByRole("button", "Annuler", { exact: true }).click();
    await expect(wizard).toBeHidden();

    // The complete review names it too, and its link opens the first takeoff's review.
    await ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff/${second}/review?versionId=${ids.versionId}`);
    const complete = ui.screen.getByRole("region", REGION, { exact: true });
    await expect(complete).toContainText(pageRow);
    screenshots.push(await ui.app.screenshot("ti682-complete-review-page-already-in-estimate"));
    await complete.getByRole("link", "Ouvrir le métré", { exact: true }).click();
    await expect(ui.browser).toHaveURL(new RegExp(`/dashboard/affaires/${ids.projectId}/takeoff/${first}/review\\?versionId=${ids.versionId}`));

    // Warned, not applied: the estimate still holds the run once, the second takeoff still completed.
    const after = (await readEstimate(ui.browser, ids.versionId)).items.filter((item) => item.title === network.designation);
    expect(after.map((line) => [line.id, Number(line.quantity)])).toEqual([[estimateLines[0].id, network.length_m]]);
    const job = await client.from("takeoff_jobs").select("status").eq("id", second).single();
    expect(job.data).toEqual({ status: "completed" });

    // Two zones drawn on one sheet: the estimator keeps both, with the reason « another zone ». The banner reads the
    // estimate again on the same screen (the read taken before holds none of this takeoff's lines) and says the decision.
    await ui.app.open(targeted);
    const applyWizard = await openWizardConfirmation(ui, String(target.parent_id), network.designation);
    const keep = applyWizard.getByRole("group", `Page ${relaunchName}, page 1`, { exact: true });
    await keep.getByRole("radio", "Garder les deux", { exact: true }).check();
    await expect(applyWizard.getByRole("button", "Confirmer l'application", { exact: true })).toBeDisabled();
    await keep.getByLabel(`Motif pour ${relaunchName}, page 1`, { exact: true }).selectOption({ value: "other_zone" });
    const [applyResponse] = await Promise.all([
      ui.browser.waitForResponse(`**/api/takeoff/jobs/${second}/apply`),
      applyWizard.getByRole("button", "Confirmer l'application", { exact: true }).click(),
    ]);
    expect(applyResponse.status).toBe(200);
    await expect(applyWizard).toBeHidden();
    const twice = ui.screen.getByRole("region", REGION, { exact: true });
    await expect(twice).toContainText(pageRow);
    await expect(twice).toContainText("Mesures gardées toutes les deux à l’application : Autre zone de la même feuille.");
    screenshots.push(await ui.app.screenshot("ti682-targeted-review-page-kept-both"));
    // The reason is the trace of the application: read again after a reload.
    await ui.app.open(targeted);
    await expect(ui.screen.getByRole("region", REGION, { exact: true })).toContainText("Autre zone de la même feuille");
    const appliedPages = await readPages(ui, second, ids.versionId);
    expect(appliedPages.pages).toMatchObject([{ file_name: relaunchName, page: 1, earlier: [{ job_id: first, line_count: 1 }], own_line_count: 1 }]);

    // Kept both by decision: the run is in the estimate twice, the second takeoff applied.
    const doubled = (await readEstimate(ui.browser, ids.versionId)).items.filter((item) => item.title === network.designation);
    expect(doubled.map((line) => Number(line.quantity))).toEqual([network.length_m, network.length_m]);
    expect((await client.from("takeoff_jobs").select("status").eq("id", second).single()).data).toEqual({ status: "applied" });
    await recordEvidence(ui.army, "TKD01-warned", { ids, first, second, screenshots, appliedPages, doubled: doubled.map((line) => line.id),
      boundary: "Owned worker with MERGEONE_TAKEOFF_VECTORS=1 on one fictional vector plan uploaded twice with the same confirmed preparation; applied twice only by the estimator's « keep both » decision with its reason." });

    // A copy of the version: both takeoffs are carried over into it, each line keeping its provenance.
    const copied = await apiRequest<Envelope<{ version_id: string }>>(ui.browser, "POST", `/api/estimates/${ids.versionId}/duplicate`);
    expect(copied.status).toBe(201);
    const copy = copied.body.data.version_id;
    ownEstimate(ui.army, { projectId: ids.projectId, versionId: copy });
    expect((await readPages(ui, first, copy)).pages).toMatchObject([{ page: 1, earlier: [{ job_id: second, line_count: 1 }], own_line_count: 1 }]);
    // The second takeoff's line removed from the copy only: under the copy the page is in the estimate once.
    const copiedLines = await client.from("estimate_items").select("id").eq("version_id", copy).eq("source_job_id", second);
    expect(copiedLines.error).toBeNull();
    expect(copiedLines.data).toHaveLength(1);
    expect((await apiRequest(ui.browser, "POST", `/api/estimates/${copy}/lock`)).status).toBe(201);
    const removed = await apiRequest(ui.browser, "DELETE", `/api/estimates/${copy}/items`, { id: (copiedLines.data as Array<{ id: string }>)[0].id });
    expect(removed.status).toBe(200);
    const underCopy = await readPages(ui, first, copy);
    expect(underCopy).toMatchObject({ version_id: copy, pages: [], other_takeoff_line_count: 0 });
    // The original version is unchanged: the page is still there twice.
    expect((await readPages(ui, first, ids.versionId)).pages).toMatchObject([{ page: 1, earlier: [{ job_id: second, line_count: 1 }], own_line_count: 1 }]);
    // The first takeoff's review opened under the copy reads the copy, and names no page.
    const [copyRead] = await Promise.all([
      ui.browser.waitForResponse(new RegExp(`/api/takeoff/jobs/${first}/page-contributions\\?version_id=${copy}$`)),
      ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff/${first}/review?versionId=${copy}`),
    ]);
    expect(copyRead.status).toBe(200);
    expect((await copyRead.json<Envelope<TakeoffPageContributionsResponse>>()).data.pages).toEqual([]);
    await expect(ui.browser.locator("#takeoff-review-mode-panel")).toBeVisible();
    await expect(ui.screen.getByRole("region", REGION, { exact: true })).toHaveCount(0);
    // A version id the takeoff is not part of (here: none the user can read) opens nothing.
    const foreign = await apiRequest<{ ok: boolean }>(ui.browser, "GET", `/api/takeoff/jobs/${first}/page-contributions?version_id=${randomUUID()}`);
    expect([foreign.status, foreign.body.ok]).toEqual([404, false]);
    await recordEvidence(ui.army, "TKD01-copied-version", { ids, first, second, copy, removed: copiedLines.data, underCopy });
  });

armyTest("TKD02 re-measuring a page replaces its earlier measure line by line, keeping the estimator's titles and prices, and is refused without a decision", options,
  async (ui) => {
    const upload = await launchWorkerVectorUpload(ui);
    const { ids, jobId: first, client } = upload;
    const network = VECTOR_PLAN.networks[0];
    const reading = (designation: string, quantity: number, unit: string) => ({ designation, quantity, unit, source_page: 1, confidence: 0.95,
      evidence: `Lecture contrôlée de « ${designation} » sur le plan fictif, page 1.` });
    // The model reads the EF run (paired with the vector measure, which is retained) and two counts of the page.
    const firstRun = await startOwnedWorker(ui, ids, first, "success", { vectors: true, owner: upload.owner, providerItems: [
      reading(network.designation, network.length_m + 2, "ml"), reading("Robinet d'arrêt", 4, "u"), reading("Vanne de purge", 3, "u")] }).done;
    expect(firstRun.outcome.status).toBe("completed");
    expect(firstRun.items.filter((item) => !item.is_excluded).map((item) => [item.designation, item.quantity]).sort())
      .toEqual([[network.designation, network.length_m], ["Robinet d'arrêt", 4], ["Vanne de purge", 3]].sort());
    const target = await createLineViaApi(ui.browser, ids.versionId, `${ui.army.runPrefix} target`);
    expect((await applyOwnedTakeoff(ui.browser, ids.versionId, first, { strategy: "append", target_section_id: target.parent_id })).status).toBe(200);

    // The estimator prices and renames the run by hand, and prices the count.
    const applied = (await readEstimate(ui.browser, ids.versionId)).items;
    const run = applied.find((item) => item.title === network.designation)!;
    const valve = applied.find((item) => item.title === "Robinet d'arrêt")!;
    const purge = applied.find((item) => item.title === "Vanne de purge")!;
    const measuredRun = Math.ceil(network.length_m);
    expect([Number(run.quantity), Number(valve.quantity), Number(purge.quantity)]).toEqual([measuredRun, 4, 3]);
    const priced = await readEstimate(ui.browser, ids.versionId);
    const edited = await apiRequest<Envelope<{ committed: boolean }>>(ui.browser, "POST", `/api/estimates/${ids.versionId}/batch`,
      { operation_key: randomUUID(), operations: [
        { op: "update", id: run.id, data: { title: "Réseau EF chiffré", unit_price_ht_cents: 2500 } },
        { op: "update", id: valve.id, data: { unit_price_ht_cents: 1500 } }] }, { "if-match": priced.version.updated_at });
    expect([edited.status, edited.body.ok]).toEqual([200, true]);

    // The plan measured again: the count changed, the purge valve is gone, a WC is new.
    const { second, relaunchName, retained } = await relaunch(ui, upload, [reading(network.designation, network.length_m + 2, "ml"),
      reading("Robinet d'arrêt", 5, "u"), reading("WC suspendu", 2, "u")]);
    expect(retained.map((item) => [item.designation, item.quantity]).sort())
      .toEqual([[network.designation, network.length_m], ["Robinet d'arrêt", 5], ["WC suspendu", 2]].sort());

    // The page read again names the earlier takeoff's three lines (the run and the two counts).
    const before = await readPages(ui, second, ids.versionId);
    const lines = await client.from("takeoff_items").select("id,job_id,designation,source_page,source_file_name,metadata->source_document")
      .in("job_id", [first, second]);
    const provenance = (await readEstimate(ui.browser, ids.versionId)).items.map((item) => ({ id: item.id, title: item.title,
      item_type: item.item_type, source_provider: item.source_provider, source_job_id: item.source_job_id, source_page: item.source_page,
      source_file_name: item.source_file_name, source_metadata: item.source_metadata }));
    await recordEvidence(ui.army, "TKD02-relaunch-read", { ids, first, second, before, lines: lines.data, provenance });
    expect(before.pages.map((entry) => [entry.page, entry.earlier.map((earlier) => [earlier.job_id, earlier.line_count])]))
      .toEqual([[1, [[first, 3]]]]);

    // Applied without a decision (a direct call, as a second tab or a script would): refused, the page named.
    const refused = await applyOwnedTakeoff(ui.browser, ids.versionId, second, { strategy: "append", target_section_id: target.parent_id });
    const refusal = refused.body as { ok: boolean; error: { message: string; details: { guard: string; source_page: number; line_count: number } } };
    expect([refused.status, refusal.ok, refusal.error.details.guard, refusal.error.details.source_page, refusal.error.details.line_count])
      .toEqual([422, false, "page_already_applied", 1, 3]);
    expect(refusal.error.message).toContain(`La page 1 de « ${relaunchName} » est déjà au devis par un autre métré (3 lignes).`);
    expect((await client.from("takeoff_jobs").select("status").eq("id", second).single()).data).toEqual({ status: "completed" });
    expect((await readEstimate(ui.browser, ids.versionId)).items.filter((item) => item.item_type === "line").length).toBe(4);

    // Through the wizard of the targeted review: the proposal pairs the run and the count with their earlier lines.
    await ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff/${second}/review/targeted?versionId=${ids.versionId}`);
    const wizard = await openWizardConfirmation(ui, String(target.parent_id), network.designation);
    const page = wizard.getByRole("group", `Page ${relaunchName}, page 1`, { exact: true });
    await expect(page.getByRole("radio", "Remplacer la mesure précédente (recommandé)", { exact: true })).toBeChecked();
    const updated = page.getByRole("list", `Quantités mises à jour, ${relaunchName}, page 1`, { exact: true });
    await expect(updated).toContainText(`Réseau EF chiffré : ${measuredRun} → ${measuredRun}`);
    await expect(updated).toContainText("Robinet d'arrêt : 4 → 5 (+1)");
    await expect(page.getByLabel("Remplace, pour WC suspendu", { exact: true })).toHaveValue("");
    // The vanished line has no default: the confirmation waits; one click settles every such line.
    const confirm = wizard.getByRole("button", "Confirmer l'application", { exact: true });
    await expect(confirm).toBeDisabled();
    await page.getByRole("button", "Retirer les 1 ligne", { exact: true }).click();
    await expect(page.getByLabel("Choix pour Vanne de purge", { exact: true })).toHaveValue("remove");
    // On an engine 1/2 version, a count line names no source line: whether its quantity was changed by hand cannot be
    // seen, so the estimator chooses (engine 3 knows its sources and asks nothing here).
    const versionRow = await client.from("estimate_versions").select("calc_engine_version").eq("id", ids.versionId).single();
    expect(versionRow.error).toBeNull();
    const engine = Number((versionRow.data as { calc_engine_version: number }).calc_engine_version);
    if (engine !== 3) {
      await expect(confirm).toBeDisabled();
      await page.getByRole("radiogroup", "Quantité de Robinet d'arrêt", { exact: true })
        .getByRole("radio", "Prendre la nouvelle mesure", { exact: true }).check();
    }
    const screenshot = await ui.app.screenshot("ti682-apply-wizard-replace-page");
    const [applyResponse] = await Promise.all([
      ui.browser.waitForResponse(`**/api/takeoff/jobs/${second}/apply`),
      confirm.click(),
    ]);
    expect(applyResponse.status).toBe(200);
    await expect(wizard).toBeHidden();

    // In the estimate: each quantity of the page counted once, each earlier line with its identity, title and price.
    const after = (await readEstimate(ui.browser, ids.versionId)).items.filter((item) => item.item_type === "line");
    const observed = after.map((item) => [item.title, Number(item.quantity), item.unit_price_ht_cents]).sort();
    await recordEvidence(ui.army, "TKD02-replaced", { ids, first, second, engine, screenshot, observed, refusal: refusal.error });
    expect(observed).toEqual([[`${ui.army.runPrefix} target`, 1, 1000], ["Réseau EF chiffré", measuredRun, 2500], ["Robinet d'arrêt", 5, 1500],
      ["WC suspendu", 2, 0]].sort());
    expect(after.find((item) => item.title === "Réseau EF chiffré")?.id).toBe(run.id);
    expect(after.find((item) => item.title === "Robinet d'arrêt")?.id).toBe(valve.id);
    expect(after.some((item) => item.id === purge.id)).toBe(false);
    expect(after.filter((item) => item.title !== `${ui.army.runPrefix} target`).every((item) => item.source_job_id === second)).toBe(true);
    // The total is the sum of the lines: the page is priced once.
    const version = (await readEstimate(ui.browser, ids.versionId)).version as { total_ht_cents?: number };
    expect(version.total_ht_cents).toBe(after.reduce((total, item) => total + Number(item.line_total_ht_cents ?? 0), 0));
    expect((await client.from("takeoff_jobs").select("status").eq("id", second).single()).data).toEqual({ status: "applied" });
  });
