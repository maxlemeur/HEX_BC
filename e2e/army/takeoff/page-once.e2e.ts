import { randomUUID } from "node:crypto";

import { expect } from "e2e";

import type { TakeoffPageContributionsResponse } from "@/lib/takeoff/page-contributions-contracts";

import { apiRequest, armyTest, createLineViaApi, ownEstimate, readEstimate, recordEvidence } from "../critical/fixtures";
import { applyOwnedTakeoff } from "./fixtures";
import { VECTOR_PLAN, buildVectorPlanPdf } from "./vector-plan-fixture";
import { launchWorkerVectorUpload, startOwnedWorker, type WorkerUi } from "./worker-support";

// TI-682 lot D, PR 1: a plan page enters an estimate once. Today nothing compares two takeoffs of one page: relaunch
// a plan and apply it with « Ajouter », its quantities are counted twice without a word. Before any refusal, the
// estimator is warned. A fictional vector plan, uploaded directly with its confirmed preparation, is read by the real
// worker and applied once; the same PDF (same content hash), uploaded again under another name so that only its hash
// can tie the two, is read by a second takeoff of the same estimate version. Its targeted and complete reviews name the page, the first takeoff (which the link opens) and its line in
// the estimate; the application wizard names them before its last click. The warning decides nothing: applied anyway
// from the targeted review, the page is in the estimate twice, and the banner, read again without a reload, says so.
// The version is then copied: both takeoffs are carried over with their lines. Once the second takeoff's line is
// removed from the copy only, the first takeoff reviewed under the copy reports nothing, while under the original
// version the page is still there twice; a version the takeoff is not part of reads nothing (404).
// TKR01 and TKR02 (two zone plans, two pages) are the negative control. Fictional plans only.

const options = { session: "army", tags: ["critical", "takeoff", "local"], timeout: 240_000 };
const REGION = "Pages déjà au devis";

type Envelope<T> = { ok: boolean; data: T };

async function readPages(ui: WorkerUi, jobId: string, versionId: string) {
  const read = await apiRequest<Envelope<TakeoffPageContributionsResponse>>(ui.browser, "GET",
    `/api/takeoff/jobs/${jobId}/page-contributions?version_id=${versionId}`);
  expect([read.status, read.body.ok]).toEqual([200, true]);
  return read.body.data;
}

armyTest("TKD01 a page another takeoff already brought into the estimate is named in both reviews and in the wizard, with that takeoff, and again once applied", options,
  async (ui) => {
    const { ids, jobId: first, fileName, tenantId, client, owner } = await launchWorkerVectorUpload(ui);
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

    // The same plan read again: the same bytes and confirmed preparation, a new takeoff of the same version, under another
    // file name: neither side has a plan file, so only the content hash can tell it is the same page.
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
    const secondRun = await startOwnedWorker(ui, ids, second, "success", { vectors: true, owner, providerItems }).done;
    expect(secondRun.outcome.status).toBe("completed");
    const retained = secondRun.items.filter((item) => !item.is_excluded);
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
    await expect(banner).toContainText("Appliquer ce métré ajouterait ces pages une seconde fois");
    await expect(banner.getByRole("button")).toHaveCount(0);
    const screenshots = [await ui.app.screenshot("ti682-targeted-review-page-already-in-estimate")];

    // The application wizard names it at the confirmation, with nothing to decide; it is closed without applying.
    await ui.screen.getByRole("button", "Appliquer au devis", { exact: true }).click();
    const wizard = ui.screen.getByRole("dialog", "Appliquer au devis", { exact: true });
    await wizard.getByLabel("Section cible", { exact: true }).selectOption({ value: String(target.parent_id) });
    await wizard.getByRole("button", "Suivant", { exact: true }).click();
    await wizard.getByRole("radio", /^Ajouter sans effacer/).check();
    await wizard.getByRole("button", "Suivant", { exact: true }).click();
    await expect(wizard).toContainText(network.designation);
    await wizard.getByRole("button", "Suivant", { exact: true }).click();
    const notice = wizard.getByRole("region", REGION, { exact: true });
    await expect(notice).toContainText(pageRow);
    await expect(notice.getByRole("button")).toHaveCount(0);
    await expect(notice.getByRole("radio")).toHaveCount(0);
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

    // Applied anyway from the targeted review: the banner reads the estimate again on the same screen (the read taken
    // before holds none of this takeoff's lines) and names the page, now in the estimate twice.
    await ui.app.open(targeted);
    const before = ui.screen.getByRole("region", REGION, { exact: true });
    await expect(before).toContainText("Appliquer ce métré ajouterait ces pages une seconde fois");
    await ui.screen.getByRole("button", "Appliquer au devis", { exact: true }).click();
    const applyWizard = ui.screen.getByRole("dialog", "Appliquer au devis", { exact: true });
    await applyWizard.getByLabel("Section cible", { exact: true }).selectOption({ value: String(target.parent_id) });
    await applyWizard.getByRole("button", "Suivant", { exact: true }).click();
    await applyWizard.getByRole("radio", /^Ajouter sans effacer/).check();
    await applyWizard.getByRole("button", "Suivant", { exact: true }).click();
    await expect(applyWizard).toContainText(network.designation);
    await applyWizard.getByRole("button", "Suivant", { exact: true }).click();
    const [applyResponse] = await Promise.all([
      ui.browser.waitForResponse(`**/api/takeoff/jobs/${second}/apply`),
      applyWizard.getByRole("button", "Confirmer l'application", { exact: true }).click(),
    ]);
    expect(applyResponse.status).toBe(200);
    await expect(applyWizard).toBeHidden();
    const twice = ui.screen.getByRole("region", REGION, { exact: true });
    await expect(twice).toContainText(pageRow);
    await expect(twice).toContainText("Ce métré est déjà appliqué : ces pages sont au devis deux fois.");
    screenshots.push(await ui.app.screenshot("ti682-targeted-review-page-applied-twice"));
    const appliedPages = await readPages(ui, second, ids.versionId);
    expect(appliedPages.pages).toMatchObject([{ file_name: relaunchName, page: 1, earlier: [{ job_id: first, line_count: 1 }], own_line_count: 1 }]);

    // The warning decided nothing: the run is now in the estimate twice, the second takeoff applied.
    const doubled = (await readEstimate(ui.browser, ids.versionId)).items.filter((item) => item.title === network.designation);
    expect(doubled.map((line) => Number(line.quantity))).toEqual([network.length_m, network.length_m]);
    expect((await client.from("takeoff_jobs").select("status").eq("id", second).single()).data).toEqual({ status: "applied" });
    await recordEvidence(ui.army, "TKD01-warned", { ids, first, second, screenshots, appliedPages, doubled: doubled.map((line) => line.id),
      boundary: "Owned worker with MERGEONE_TAKEOFF_VECTORS=1 on one fictional vector plan uploaded twice with the same confirmed preparation; applied twice only after both reviews and the wizard warned." });

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
