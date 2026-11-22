import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { expect } from "e2e";

import { takeoffReviewHref } from "@/lib/takeoff/review-href";

import { apiRequest, armyTest, recordEvidence } from "../critical/fixtures";
import { waitForHydration } from "../critical/hydration-support";
import { querySql } from "../local/calculation-gate-support";
import {
  activateOwnedPlanDispatch, deactivateOwnedPlanDispatch, readOwnedPlanJobs, runOwnedPlanDispatch, runOwnedTakeoffCommand, seedPlanDossier,
} from "./plan-dispatch-support";
import { signUpWorkerOwner, type WorkerUi } from "./worker-support";

// Lot 3, PR 5 (migration 20261122030312_takeoff_partial_send.sql): the send of one plan while the request's other plans
// are read, through the real screens, on the owned worker stack with one analysis per plan active (fictional plans, a
// controlled local provider). A request reads plans A, B and C one at a time; B's reading is held (a barrier the journey
// releases). A's preview, opened while B is read and closed, creates nothing; A confirmed while B is read creates one
// first draft with A's three valves on its page 2 and A's network, and the estimator lands on it. B, read later, brings
// two valves from its page 1 to that draft: one valve line of 5 with both sources, its price untouched. C's line set
// aside between B's preview and its confirmation refuses B's confirmation (« … un autre plan de l’affaire a changé »), with
// nothing written, and the preview read again is confirmed. Written before the migration: red on 2c5424215 (the preview
// of a per-plan analysis answered « L’envoi … d’une analyse par plan arrive avec une prochaine version »).

const SEND = "Envoyer au tableau de chiffrage";
const LINES = "Lignes du devis après l’envoi";
const VALVE = "Vanne d'arrêt DN20";
const NETWORK = "Réseau EF";

async function openSend(ui: WorkerUi, projectId: string, jobId: string) {
  await ui.app.open(takeoffReviewHref({ projectId, jobId }));
  await waitForHydration(ui.browser);
  await ui.screen.getByRole("button", SEND, { exact: true }).click();
  const dialog = ui.screen.getByRole("dialog", SEND, { exact: true });
  await expect(dialog.getByRole("region", "Contenu de l’envoi", { exact: true })).toBeVisible({ timeout: 30_000 });
  return dialog;
}

async function versionsOf(projectId: string) {
  return Number((await querySql(`select count(*) from public.estimate_versions where project_id = '${projectId}';`))[0]);
}

async function linesOf(versionId: string) {
  const [row] = await querySql(`select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'quantity', i.quantity::float8,
    'price', i.unit_price_ht_cents, 'file', i.source_file_name, 'page', i.source_page,
    'parts', (select jsonb_agg(jsonb_build_object('job_id', part -> 'job_id', 'quantity', (part ->> 'quantity')::float8)
      order by part ->> 'job_id') from jsonb_array_elements(i.source_metadata #> '{takeoff_contributions,parts}') part))
    order by i.title), '[]'::jsonb) from public.estimate_items i where i.version_id = '${versionId}' and i.item_type = 'line';`);
  return JSON.parse(row) as Array<{ id: string; title: string; quantity: number; price: number | null; file: string | null; page: number | null;
    parts: Array<{ job_id: string; quantity: number }> | null }>;
}

async function receiptContext(jobId: string) {
  const [row] = await querySql(`select coalesce((select write_plan -> 'context' from public.takeoff_send_receipts where job_id = '${jobId}'),
    'null'::jsonb);`);
  return JSON.parse(row) as { unit: { request_id: string; key: string } | null; peers: string[] } | null;
}

armyTest("TKPS01 a plan is sent while the others are read: nothing before the confirmation, one first draft, then B adds its part to A's line",
  { session: "army", trace: "off", tags: ["critical", "takeoff-worker", "local"], timeout: 300_000 }, async (ui) => {
    await ui.app.open("/dashboard/affaires");
    const owner = await signUpWorkerOwner(ui, "TKPS1");
    await activateOwnedPlanDispatch();
    const barrier = mkdtempSync(join(tmpdir(), "army-partial-send-"));
    const release = join(barrier, "release-b");
    try {
      const dossier = await seedPlanDossier(ui, owner, [{ name: "plan-a.pdf", pages: 2 }, { name: "plan-b.pdf", pages: 1 },
        { name: "plan-c.pdf", pages: 1 }]);
      const [planA, planB, planC] = dossier.plans;
      const command = await runOwnedTakeoffCommand(owner, ["launch", dossier.projectId, dossier.planSetId, randomUUID(), "1",
        dossier.plans.map((plan) => plan.id).join(",")]);
      expect(command).toMatchObject({ result: { outcome: "admitted" } });
      const [jobA, jobB, jobC] = await readOwnedPlanJobs(dossier.projectId);
      expect([jobA.plans, jobB.plans, jobC.plans]).toEqual([[planA.id], [planB.id], [planC.id]]);

      // The Mac reads A, then holds B's reading until the journey releases it; C waits behind B.
      const pass = runOwnedPlanDispatch(ui, owner, dossier.projectId, { modes: { [jobB.id]: "release" }, releaseFile: release, items: {
        [jobA.id]: [{ designation: NETWORK, quantity: 4, unit: "m", source_page: 1 }, { designation: VALVE, quantity: 3, unit: "u", source_page: 2 }],
        [jobB.id]: [{ designation: VALVE, quantity: 2, unit: "u", source_page: 1 }],
        [jobC.id]: [{ designation: "Robinet de puisage", quantity: 1, unit: "u", source_page: 1 }],
      } });
      await expect.poll(async () => (await readOwnedPlanJobs(dossier.projectId)).map((job) => job.status), { timeout: 60_000 })
        .toEqual(["completed", "processing", "pending"]);

      // A's preview while B is read: the plan sent, the plans not read yet, A's two lines; closed, it leaves nothing.
      let dialog = await openSend(ui, dossier.projectId, jobA.id);
      const scope = dialog.getByRole("region", "Contenu de l’envoi", { exact: true });
      await expect(scope.getByRole("heading", "Envoi du plan « plan-a.pdf »", { exact: true })).toBeVisible();
      const unread = scope.getByRole("list", "Plans non lus", { exact: true });
      await expect(unread.getByRole("listitem")).toHaveText(["« plan-b.pdf » : en lecture", "« plan-c.pdf » : en attente de lecture"]);
      await expect(dialog.getByText("Créer le premier brouillon et y envoyer 2 lignes", { exact: true })).toBeVisible();
      const outcome = dialog.getByRole("list", LINES, { exact: true });
      await expect(outcome.getByRole("listitem", VALVE, { exact: true })).toContainText(/3 u$/);
      await expect(outcome.getByRole("listitem", NETWORK, { exact: true })).toContainText(/4 m$/);
      const previewA = await ui.app.screenshot("takeoff-partial-send-a-while-b-read");
      await dialog.getByRole("button", "Annuler", { exact: true }).click();
      await expect(dialog).toBeHidden();
      expect(await versionsOf(dossier.projectId)).toBe(0);

      // A confirmed while B is still read: one first draft, A's lines with their page, and the estimator lands on it.
      dialog = await openSend(ui, dossier.projectId, jobA.id);
      await expect(dialog.getByRole("list", LINES, { exact: true }).getByRole("listitem", VALVE, { exact: true })).toContainText(/3 u$/);
      await dialog.getByRole("button", "Créer le brouillon et envoyer", { exact: true }).click();
      await expect(ui.browser).toHaveURL(/\/dashboard\/estimates\/[0-9a-f-]{36}\/edit\?focusItemId=/, { timeout: 60_000 });
      await expect(ui.screen.getByText("Plan « plan-a.pdf » envoyé au tableau de chiffrage", { exact: true })).toBeVisible();
      const [versionId] = await querySql(`select target_version_id from public.takeoff_send_receipts where job_id = '${jobA.id}';`);
      await expect(ui.browser).toHaveURL(new RegExp(`/dashboard/estimates/${versionId}/edit`));
      expect(await versionsOf(dossier.projectId)).toBe(1);
      const afterA = await linesOf(versionId);
      expect(afterA.map(({ title, quantity, file, page }) => [title, quantity, file, page])).toEqual([
        [NETWORK, 4, "plan-a.pdf", 1], [VALVE, 3, "plan-a.pdf", 2]]);
      expect((await readOwnedPlanJobs(dossier.projectId)).map((job) => job.status)).toEqual(["applied", "processing", "pending"]);
      // The receipt records the unit sent, and that no other plan was read when it was checked.
      expect(await receiptContext(jobA.id)).toMatchObject({ unit: { key: `plan:${planA.id}` }, peers: [] });

      // B and C are read (B released).
      writeFileSync(release, "released");
      const passed = await pass;
      expect(passed.calls.map((call) => call.jobId)).toEqual([jobA.id, jobB.id, jobC.id]);
      expect((await readOwnedPlanJobs(dossier.projectId)).map((job) => job.status)).toEqual(["applied", "completed", "completed"]);

      // B's preview: its valve adds to A's line (3 → 5); it is compared with C, read and not sent.
      dialog = await openSend(ui, dossier.projectId, jobB.id);
      await expect(dialog.getByText(/Comparé avec le plan déjà lu : « plan-c\.pdf »\./)).toBeVisible();
      const fed = dialog.getByRole("list", LINES, { exact: true }).getByRole("listitem", VALVE, { exact: true });
      await expect(fed).toContainText("ligne modifiée");
      await expect(fed).toContainText(/3 → 5 u$/);
      const previewB = await ui.app.screenshot("takeoff-partial-send-b-adds-to-a");

      // C's line is set aside meanwhile (another tab of the review): B's confirmation is refused, nothing written.
      const read = await apiRequest<{ ok: boolean; data: { items: { data: Array<{ id: string; updated_at: string }> } } }>(ui.browser, "GET",
        `/api/takeoff/jobs/${jobC.id}?items_limit=50`);
      expect([read.status, read.body.ok]).toEqual([200, true]);
      const [faucet] = read.body.data.items.data;
      const patched = await apiRequest<{ ok: boolean }>(ui.browser, "PATCH", `/api/takeoff/jobs/${jobC.id}/items`, { items: [{
        item_id: faucet.id, updated_at: faucet.updated_at, fields: { is_excluded: true, exclusion_reason: "Robinet fictif hors lot." } }] });
      expect([patched.status, patched.body.ok]).toEqual([200, true]);
      await dialog.getByRole("button", "Confirmer l'envoi", { exact: true }).click();
      // The server's own preview at the confirmation already differs (its context names C's line set aside): refused at once.
      await expect(dialog.getByText("Le métré, le devis ou un autre plan de l’affaire a changé depuis l’aperçu : vérifiez le nouvel aperçu "
        + "puis confirmez. Rien n’a été écrit.", { exact: true })).toBeVisible({ timeout: 30_000 });
      expect((await linesOf(versionId)).find((line) => line.title === VALVE)?.quantity).toBe(3);
      expect(await receiptContext(jobB.id)).toBeNull();

      // The preview read again (C's line set aside) is confirmed: one valve line of 5, both sources, its price untouched.
      await expect(dialog.getByRole("list", LINES, { exact: true }).getByRole("listitem", VALVE, { exact: true })).toContainText(/3 → 5 u$/,
        { timeout: 30_000 });
      await dialog.getByRole("button", "Confirmer l'envoi", { exact: true }).click();
      await expect(ui.browser).toHaveURL(new RegExp(`/dashboard/estimates/${versionId}/edit\\?focusItemId=`), { timeout: 60_000 });
      await expect(ui.screen.getByText("Plan « plan-b.pdf » envoyé au tableau de chiffrage", { exact: true })).toBeVisible();
      const afterB = await linesOf(versionId);
      const valveBefore = afterA.find((line) => line.title === VALVE)!;
      expect(afterB.map(({ title, quantity }) => [title, quantity])).toEqual([[NETWORK, 4], [VALVE, 5]]);
      const valve = afterB.find((line) => line.title === VALVE)!;
      expect([valve.id, valve.price]).toEqual([valveBefore.id, valveBefore.price]);
      expect(valve.parts).toEqual([{ job_id: jobA.id, quantity: 3 }, { job_id: jobB.id, quantity: 2 }].sort((left, right) =>
        (left.job_id < right.job_id ? -1 : 1)));
      expect(await receiptContext(jobB.id)).toMatchObject({ unit: { key: `plan:${planB.id}` }, peers: [jobC.id] });

      await recordEvidence(ui.army, "TKPS01-partial-send", { projectId: dossier.projectId, versionId, jobs: { a: jobA.id, b: jobB.id, c: jobC.id },
        afterA, afterB, receipts: { a: await receiptContext(jobA.id), b: await receiptContext(jobB.id) }, screenshots: [previewA, previewB],
        boundary: "Fictional plans and a controlled local provider on an owned local backend, one analysis per plan active." });
    } finally {
      writeFileSync(release, "released");
      await deactivateOwnedPlanDispatch();
      rmSync(barrier, { recursive: true, force: true });
    }
  });
