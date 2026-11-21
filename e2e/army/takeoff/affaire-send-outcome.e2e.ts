import { createHash, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect } from "e2e";

import { createEmptyTakeoffPreparation, createTakeoffPreparationSnapshot } from "@/lib/takeoff/preparation";
import { getPreparationPlanSourceVersion } from "@/lib/takeoff/preparation-sources";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";

import type { TakeoffJobDetailResponse } from "@/lib/takeoff/job-response-contracts";

import { apiRequest, armyTest, recordEvidence, saveLineEditsWithShortcut, setLineCoreValues, waitForAutoSave } from "../critical/fixtures";
import { querySql } from "../local/calculation-gate-support";
import { setTenantCalcPolicy } from "../local/engine-v3-persistence-support";
import { startOwnedTakeoffAdmission } from "./affaire-admission-support";
import { ownedWorkerHostId, signUpWorkerOwner, startOwnedWorker, type WorkerOwner, type WorkerUi } from "./worker-support";
import { ZONE_PLANS, buildZonePlanPdf } from "./zone-plans-fixture";

// Lot 2 M2, fix round 1: what an estimator confirms when sending a takeoff of an affaire is what the estimate holds,
// through the real screens. TKAW03 (points 5, 6, 10): plan A sends 3 washbasins to a first draft of engine 3, the
// estimator types a price, plan B adds its 2 to that line (3 → 5, the price unchanged), then a takeoff that reads plan
// B's page again finds that page in the estimate: the estimator keeps both measures, sees what that gives, replaces
// instead (5 → 7) and confirms; each receipt names the line changed and its real target. TKAW04 (point 4): takeoff A
// sent to a first draft, the draft copied (A stays on the version it was applied to, carried over to the copy), takeoff
// B of the next zone sent to the copy: its duplicate with A is found only against that destination and shown before the
// administrator confirms (a zone duplicate is a recommended control, not a blocker). Written before the fix: red on
// 986aea27 (B's page was not found, engine 2 and copies compared nothing, the preview showed the measures, not the
// lines). Fictional plans and values only.

const options = { session: "army", trace: "off" as const, tags: ["critical", "takeoff-worker", "local"], timeout: 300_000 };
const SEND = "Envoyer au tableau de chiffrage";
const LINES = "Lignes du devis après l’envoi";
const PAGES = "Pages déjà au devis";

type Plan = { planSetId: string; planFileId: string; fileName: string; row: { id: string; plan_set_id: string; file_path: string;
  file_name: string; file_size_bytes: number; file_hash: string | null; page_count: number; updated_at: string }; hash: string };
type Affaire = { owner: WorkerOwner; projectId: string; setup: SupabaseClient };

async function affaire(ui: WorkerUi, tag: string, name: string): Promise<Affaire> {
  await ui.app.open("/dashboard/affaires");
  const owner = await signUpWorkerOwner(ui, tag);
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const workerKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (process.env.E2E_ARMY_TAKEOFF_WORKER !== "1" || !["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname)
    || backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST || !workerKey) {
    throw new Error("An owned local worker stack is required.");
  }
  const setup = createClient(backend.origin, workerKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const projectId = randomUUID();
  expect((await setup.from("estimate_projects").insert({ id: projectId, tenant_id: owner.tenantId, user_id: owner.userId,
    name: `${ui.army.runPrefix} ${name}` })).error).toBeNull();
  (ui.army.ownedTakeoffAffaires ??= []).push(projectId);
  return { owner, projectId, setup };
}

async function plan(ui: WorkerUi, { owner, projectId, setup }: Affaire, setName: string, fileName: string, bytes: Uint8Array): Promise<Plan> {
  const planSetId = randomUUID();
  const planFileId = randomUUID();
  const filePath = `${owner.tenantId}/${planSetId}/${planFileId}/${fileName}`;
  expect((await setup.from("plan_sets").insert({ id: planSetId, tenant_id: owner.tenantId, project_id: projectId, name: setName })).error).toBeNull();
  expect((await setup.storage.from("plan-files").upload(filePath, bytes, { contentType: "application/pdf" })).error).toBeNull();
  const row = await setup.from("plan_files").insert({ id: planFileId, tenant_id: owner.tenantId, plan_set_id: planSetId, file_name: fileName,
    file_path: filePath, file_type: "application/pdf", file_size_bytes: bytes.length, page_count: 1 })
    .select("id,plan_set_id,file_path,file_name,file_size_bytes,file_hash,page_count,updated_at").single();
  expect(row.error).toBeNull();
  (ui.army.ownedPlanSets ??= []).push({ projectId, planSetId, tenantId: owner.tenantId });
  return { planSetId, planFileId, fileName, row: row.data as unknown as Plan["row"], hash: createHash("sha256").update(bytes).digest("hex") };
}

/** A takeoff of the affaire: its preparation confirmed on this plan at this revision, admitted, read by the owned worker. */
async function launch(ui: WorkerUi, seed: Affaire, source: Plan, revision: number, worker: { vectors: boolean; rules: boolean;
  providerItems?: Array<{ designation: string; quantity: number; unit: string; source_page: number; confidence: number; evidence: string }> }) {
  const { owner, projectId, setup } = seed;
  const preparation = createEmptyTakeoffPreparation({ estimateVersionId: null });
  preparation.objective = "measure_length";
  preparation.objective_confirmed = true;
  preparation.scope = { ...preparation.scope, lots: ["Plomberie"], networks: ["EF"], confirmed: true };
  preparation.sources = [{ document_id: source.planFileId, document_name: source.fileName, kind: "plan", revision: "A",
    source_version: getPreparationPlanSourceVersion(source.row), content_hash: source.hash, pages: [1], active: true, confirmed: true,
    plan_set_id: source.planSetId, file_path: source.row.file_path, page_count: 1, logical_document_id: null,
    source_updated_at: source.row.updated_at, mime_type: "application/pdf", page_triage: null }];
  preparation.conventions = { unit: "m", measurement_basis: "dimensioned", calibration: null, purchase: null, confirmed: true };
  preparation.destination = { kind: "analysis_only", estimate_version_id: null, reviewer: null, confirmed: true };
  preparation.processing = { level: "C", provider: "chatgpt" };
  const confirmedAt = new Date().toISOString();
  // A confirmation pins the member's ChatGPT selection; the admission script connects this profile on the worker host.
  const snapshot = { ...createTakeoffPreparationSnapshot({ preparation, revision, confirmedAt, confirmedBy: owner.userId }),
    execution_selection: { profileId: "army", model: "army", reasoningEffort: null, hostId: await ownedWorkerHostId() } };
  expect((await setup.from("takeoff_preparations").upsert({ tenant_id: owner.tenantId, project_id: projectId, revision, draft: preparation,
    confirmed_snapshot: snapshot, confirmed_at: confirmedAt, confirmed_by: owner.userId, updated_by: owner.userId },
    { onConflict: "tenant_id,project_id" })).error).toBeNull();
  const launched = await startOwnedTakeoffAdmission(owner, ui.army.runPrefix, projectId, source.planSetId, randomUUID(), revision).done;
  if (!launched.receipt) throw new Error(`The admission of revision ${revision} was refused: ${launched.rejected}`);
  const jobId = launched.receipt.id;
  const completed = await startOwnedWorker(ui, { projectId, versionId: null }, jobId, "success", { owner, ...worker }).done;
  return { jobId, items: completed.items };
}

type Item = TakeoffJobDetailResponse["items"]["data"][number];

/**
 * The review's own choice of quantity sources (as quantity-rules.e2e.ts makes it): the vector EF line of a zone plan is
 * an excluded alternative of the controlled provider's stub lines; the estimator includes it and sets the stubs aside.
 */
async function retainVectorLine(ui: WorkerUi, jobId: string) {
  const read = await apiRequest<{ ok: boolean; data: TakeoffJobDetailResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}?items_limit=200`);
  expect([read.status, read.body.ok]).toEqual([200, true]);
  const items = read.body.data.items.data;
  const ef = items.find((item) => item.designation === ZONE_PLANS.designation) as Item;
  expect(ef).toMatchObject({ is_excluded: true });
  const stubs = items.filter((item) => item.designation === "ARMY worker pipe" || item.designation === "ARMY worker valve");
  const patched = await apiRequest<{ ok: boolean; data: { results: Array<{ item_id: string; success: boolean }> } }>(ui.browser, "PATCH",
    `/api/takeoff/jobs/${jobId}/items`, { items: [{ item_id: ef.id, updated_at: ef.updated_at, fields: { is_excluded: false } },
      ...stubs.map((stub) => ({ item_id: stub.id, updated_at: stub.updated_at,
        fields: { is_excluded: true, exclusion_reason: "Ligne du fournisseur fictif, sans réseau." } }))] });
  expect([patched.status, patched.body.ok, patched.body.data.results.every((result) => result.success)]).toEqual([200, true, true]);
  return ef;
}

async function openSend(ui: WorkerUi, projectId: string, jobId: string) {
  await ui.app.open(takeoffReviewHref({ projectId, jobId }));
  await ui.screen.getByRole("button", SEND, { exact: true }).click();
  const dialog = ui.screen.getByRole("dialog", SEND, { exact: true });
  await expect(dialog.getByRole("region", "Contenu de l’envoi", { exact: true })).toBeVisible({ timeout: 30_000 });
  return dialog;
}

/** Confirms, lands in the estimate table of the version the receipt names, and returns that version. */
async function confirmAndLand(ui: WorkerUi, dialog: Awaited<ReturnType<typeof openSend>>, button: string, jobId: string) {
  await dialog.getByRole("button", button, { exact: true }).click();
  await expect(ui.browser).toHaveURL(/\/dashboard\/estimates\/[0-9a-f-]{36}\/edit/, { timeout: 60_000 });
  const [versionId] = await querySql(`select target_version_id from public.takeoff_send_receipts where job_id = '${jobId}';`);
  await expect(ui.browser).toHaveURL(new RegExp(`/dashboard/estimates/${versionId}/edit`));
  return versionId;
}

async function receiptOf(jobId: string) {
  const [row] = await querySql(`select jsonb_build_object('result', r.result, 'parts', r.write_plan -> 'parts')
    from public.takeoff_send_receipts r where r.job_id = '${jobId}';`);
  return JSON.parse(row) as { result: { lines_created: string[]; lines_changed: string[]; lines_removed: Array<{ id: string }>;
    sections_changed: string[]; outcome: { lines: Array<{ change: string; quantity: number; quantity_before: number | null }> } };
    parts: Array<{ takeoff_item_id: string; estimate_item_id: string; section_id: string; target: { kind: string; quantity_before?: number } }> };
}

async function linesOf(versionId: string) {
  const [row] = await querySql(`select coalesce(jsonb_agg(jsonb_build_array(i.id, i.title, i.quantity::float8, i.unit_price_ht_cents,
    i.parent_id) order by i.title, i.position), '[]'::jsonb) from public.estimate_items i where i.version_id = '${versionId}' and i.item_type = 'line';`);
  return JSON.parse(row) as Array<[string, string, number, number, string]>;
}

armyTest("TKAW03 plan A then plan B feed one priced line of engine 3, and a re-read of B's page is decided and confirmed as shown", options,
  async (ui) => {
    const seed = await affaire(ui, "AWB", "A puis B");
    await setTenantCalcPolicy(seed.owner, { engine: 3, fo: "1.30", mo: "1.20", reason: "ARMY-TKAW03 plan A then plan B on engine 3" });
    // Two different documents (another file of the same bytes would be the same plan, its page already in the estimate).
    const planA = await plan(ui, seed, "Plans A", "plan-fictif-A.pdf", Buffer.from(await buildZonePlanPdf("Z1")));
    const planB = await plan(ui, seed, "Plans B", "plan-fictif-B.pdf", Buffer.from(await buildZonePlanPdf("Z2")));
    const washbasins = (quantity: number) => [{ designation: "Lavabo", quantity, unit: "u", source_page: 1, confidence: 0.99,
      evidence: `${quantity} lavabos, page 1` }];

    // A: three washbasins, to the first draft of engine 3. Its lines carry no rule input: the controls say so.
    const a = await launch(ui, seed, planA, 1, { vectors: false, rules: false, providerItems: washbasins(3) });
    let dialog = await openSend(ui, seed.projectId, a.jobId);
    await expect(dialog.getByText("Créer le premier brouillon et y envoyer 1 ligne", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/non évalués : aucune ligne de ce métré ne porte les repères qu’ils comparent/)).toBeVisible();
    await expect(dialog.getByRole("list", LINES, { exact: true }).getByRole("listitem", "Lavabo", { exact: true })).toContainText(/3 u$/);
    const versionId = await confirmAndLand(ui, dialog, "Créer le brouillon et envoyer", a.jobId);
    const [[lineId]] = await linesOf(versionId);
    // The estimator types the washbasin's price in the estimate table.
    await setLineCoreValues(ui, "Lavabo", { quantity: "3", unitPriceHt: "45" });
    await saveLineEditsWithShortcut(ui, versionId, "Lavabo", ui.army);
    await waitForAutoSave(ui, versionId, (snapshot) => snapshot.items.some((item) => item.id === lineId && item.unit_price_ht_cents === 4500),
      ui.army);

    // B: two more washbasins, to the same draft: the preview shows the line going from 3 to 5, its price unchanged.
    const b = await launch(ui, seed, planB, 2, { vectors: false, rules: false, providerItems: washbasins(2) });
    dialog = await openSend(ui, seed.projectId, b.jobId);
    const fed = dialog.getByRole("list", LINES, { exact: true }).getByRole("listitem", "Lavabo", { exact: true });
    await expect(fed).toContainText("ligne modifiée");
    await expect(fed).toContainText(/3 → 5 u$/);
    const shownB = await ui.app.screenshot("takeoff-affaire-send-b-adds-to-a");
    expect(await confirmAndLand(ui, dialog, "Confirmer l'envoi", b.jobId)).toBe(versionId);
    expect((await linesOf(versionId)).map(([id, title, quantity, price]) => [id, title, quantity, price]))
      .toEqual([[lineId, "Lavabo", 5, 4500]]);
    const receiptB = await receiptOf(b.jobId);
    expect(receiptB.result.lines_changed).toEqual([lineId]);
    expect(receiptB.parts).toMatchObject([{ takeoff_item_id: b.items[0].id, estimate_item_id: lineId, target: { kind: "existing_line",
      quantity_before: 3 } }]);

    // C reads plan B's page again (4 washbasins): the page is in the estimate through the line A and B feed. The estimator
    // first keeps both measures, with its reason: a new line of 4 beside the 5.
    const c = await launch(ui, seed, planB, 3, { vectors: false, rules: false, providerItems: washbasins(4) });
    dialog = await openSend(ui, seed.projectId, c.jobId);
    const decision = dialog.getByRole("region", PAGES, { exact: true }).getByRole("group", `Page ${planB.fileName}, page 1`, { exact: true });
    await expect(decision.getByRole("radio", "Remplacer la mesure précédente (recommandé)", { exact: true })).toBeChecked();
    await decision.getByRole("radio", "Garder les deux", { exact: true }).check();
    await decision.getByLabel(`Motif pour ${planB.fileName}, page 1`, { exact: true }).selectOption({ value: "other_zone" });
    const kept = dialog.getByRole("list", LINES, { exact: true });
    await expect(kept).toContainText("nouvelle ligne", { timeout: 30_000 });
    await expect(kept.getByRole("listitem", "Lavabo", { exact: true })).toContainText(/4 u$/);
    // Then replaces the earlier measure of that page instead: the line goes from 5 to 7 (A's 3 and C's 4).
    await decision.getByRole("radio", "Remplacer la mesure précédente (recommandé)", { exact: true }).check();
    const replaced = dialog.getByRole("list", LINES, { exact: true }).getByRole("listitem", "Lavabo", { exact: true });
    await expect(replaced).toContainText(/5 → 7 u$/, { timeout: 30_000 });
    const shownC = await ui.app.screenshot("takeoff-affaire-send-page-reread-replaced");
    expect(await confirmAndLand(ui, dialog, "Confirmer l'envoi", c.jobId)).toBe(versionId);
    expect((await linesOf(versionId)).map(([id, title, quantity, price]) => [id, title, quantity, price]))
      .toEqual([[lineId, "Lavabo", 7, 4500]]);
    const receiptC = await receiptOf(c.jobId);
    expect([receiptC.result.lines_changed, receiptC.result.lines_created, receiptC.result.lines_removed]).toEqual([[lineId], [], []]);
    expect(receiptC.result.outcome.lines).toMatchObject([{ change: "changed", quantity_before: 5, quantity: 7 }]);
    expect(receiptC.parts).toMatchObject([{ takeoff_item_id: c.items[0].id, estimate_item_id: lineId, target: { kind: "existing_line",
      quantity_before: 5 } }]);
    await recordEvidence(ui.army, "TKAW03-plan-a-then-b-then-reread", { projectId: seed.projectId, versionId, lineId,
      jobs: { a: a.jobId, b: b.jobId, c: c.jobId }, receiptB, receiptC, screenshots: [shownB, shownC] });
  });

armyTest("TKAW04 a copied draft compares a takeoff with the takeoff carried over to it, before its administrator confirms", options,
  async (ui) => {
    const seed = await affaire(ui, "AWC", "copie et doublon");
    const z1 = await plan(ui, seed, "Plans Z1", ZONE_PLANS.zones.Z1.fileName, Buffer.from(await buildZonePlanPdf("Z1")));
    const z2 = await plan(ui, seed, "Plans Z2", ZONE_PLANS.zones.Z2.fileName, Buffer.from(await buildZonePlanPdf("Z2")));

    // A reads zone Z1 and is sent to the first draft; the draft is then copied, as « Dupliquer » does: A stays on the
    // version it was applied to, carried over to the copy.
    const a = await launch(ui, seed, z1, 1, { vectors: true, rules: true });
    const runA = await retainVectorLine(ui, a.jobId);
    let dialog = await openSend(ui, seed.projectId, a.jobId);
    const first = await confirmAndLand(ui, dialog, "Créer le brouillon et envoyer", a.jobId);
    const copied = await ui.browser.evaluate(async (versionId) => {
      const response = await fetch(`/api/estimates/${versionId}/duplicate`, { method: "POST", credentials: "same-origin" });
      return { status: response.status, body: await response.json() as { data?: { version_id?: string } } };
    }, first);
    expect(copied.status).toBe(201);
    const copyId = copied.body.data!.version_id!;
    const [carried] = await querySql(`select count(*) from public.takeoff_version_links where takeoff_job_id = '${a.jobId}'
      and target_version_id = '${copyId}';`);
    expect(carried).toBe("1");

    // B reads zone Z2, which draws 1.00 m of the same EF run. On its own, B is compared with its own lines only: the
    // comparison between takeoffs waits for a destination.
    const b = await launch(ui, seed, z2, 2, { vectors: true, rules: true });
    const runB = await retainVectorLine(ui, b.jobId);
    const overlapOf = async () => {
      const [row] = await querySql(`select coalesce((select r from public.takeoff_items i, jsonb_array_elements(i.rule_results) r
        where i.id = '${runB.id}' and r ->> 'rule' = 'zone_overlap'), 'null'::jsonb);`);
      return JSON.parse(row) as { status: string; code: string; details?: { cross_job_comparison?: string;
        partners?: Array<{ item_id: string }> } } | null;
    };
    expect((await overlapOf())?.details?.cross_job_comparison).toBe("deferred");

    // Sent to the copy, B is compared with A, carried over: the duplicate is shown before anything is confirmed, with A's
    // run named, and the administrator confirms knowingly. (A zone duplicate is a recommended control: it does not block.)
    dialog = await openSend(ui, seed.projectId, b.jobId);
    await expect(dialog.getByText("Plusieurs brouillons peuvent recevoir ce métré : choisissez la destination.", { exact: true }))
      .toBeVisible();
    await dialog.getByLabel("Devis qui reçoit le métré", { exact: true }).selectOption({ value: `draft:${copyId}` });
    await expect(dialog.getByText(/vérifiés avec les métrés de ce brouillon/)).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toContainText(/Doublon entre zones : .*1,00 m avec « EF Inox 316L DN 22 » \(Z1\)/);
    await expect(dialog.getByRole("list", LINES, { exact: true }).getByRole("listitem", ZONE_PLANS.designation, { exact: true }))
      .toContainText(/3 ml?$/);
    const shown = await ui.app.screenshot("takeoff-affaire-send-copy-carried-duplicate");
    expect(await confirmAndLand(ui, dialog, "Confirmer l'envoi", b.jobId)).toBe(copyId);

    // What was shown is what is stored: B's line on the copy fails the overlap control against A's line.
    const overlap = await overlapOf();
    expect(overlap).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_DUPLICATE" });
    expect(overlap?.details?.cross_job_comparison).toBeUndefined();
    expect(overlap?.details?.partners?.map((partner) => partner.item_id)).toEqual([runA.id]);
    await recordEvidence(ui.army, "TKAW04-copy-carried-peer", { projectId: seed.projectId, first, copyId,
      jobs: { a: a.jobId, b: b.jobId }, overlap, screenshots: [shown] });
  });
