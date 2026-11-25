import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { expect } from "e2e";
import type { TakeoffJobDetailResponse } from "@/lib/takeoff/types";

import { apiRequest, armyTest, recordEvidence } from "../critical/fixtures";
import { waitForHydration } from "../critical/hydration-support";
import { querySql } from "../local/calculation-gate-support";
import {
  activateOwnedPlanDispatch, deactivateOwnedPlanDispatch, readOwnedPlanItems, readOwnedPlanJobs, runOwnedPlanDispatch,
  runOwnedTakeoffCommand, seedPlanDossier,
} from "./plan-dispatch-support";
import {
  activateOwnedItemListOrder, deactivateOwnedItemListOrder, publishOwnedItemTemplate, readOwnedItemReadings, readOwnedPlanItemRows,
  type OwnedItemReading,
} from "./poste-reading-support";
import { signUpWorkerOwner, type WorkerOwner, type WorkerUi } from "./worker-support";

// Lot 4, PR 3c: a plan read against the affaire's sealed list of items (the second measuring order, activated on the owned
// worker stack only), its answers published with its end (public.publish_takeoff_item_answers, migration
// 20261122080845_takeoff_item_answers.sql) and read back as a member reads them. Two plans, A and B, and three items of the
// tenant's template; a controlled local provider answers each call item by item. A read and B still read: A's measure is
// a partial quantity and no item is « not found »; B answering « not found » everywhere is a valid reading. B failed, an
// answer omitted or a reading cut short: B publishes nothing, and no item is « not found ». Written before the reading's
// call to the command: red on bb115b83f (the job of the second order stopped once claimed, before any call).

const LAVABO = "Lavabo sur colonne";
const WC = "WC suspendu";
const ROBINET = "Robinet de puisage";
const ITEMS = [{ id: "lavabo-colonne", label: LAVABO, expectedUnit: "u" }, { id: "wc-suspendu", label: WC, expectedUnit: "u" },
  { id: "robinet-puisage", label: ROBINET, expectedUnit: "u" }];
const options = { session: "army" as const, trace: "off" as const, tags: ["critical", "takeoff-worker", "local"], timeout: 300_000 };

/** An affaire of two plans, A (2 pages) and B (1 page), its request admitted by the member's command with the list sealed. */
async function admittedRequest(ui: WorkerUi, owner: WorkerOwner, templated: { done: boolean }, objective?: "estimate",
  beforeLaunch?: (dossier: Awaited<ReturnType<typeof seedPlanDossier>>) => Promise<void>) {
  const dossier = await seedPlanDossier(ui, owner, [{ name: "plan-a.pdf", pages: 2 }, { name: "plan-b.pdf", pages: 1 }], { objective });
  if (!templated.done) {
    await publishOwnedItemTemplate(dossier.setup, owner, ITEMS);
    templated.done = true;
  }
  await beforeLaunch?.(dossier);
  const command = await runOwnedTakeoffCommand(owner, ["launch", dossier.projectId, dossier.planSetId, randomUUID(), "1",
    dossier.plans.map((plan) => plan.id).join(",")]);
  expect(command).toMatchObject({ result: { outcome: "admitted" } });
  const [jobA, jobB] = await readOwnedPlanJobs(dossier.projectId);
  expect([jobA.plans, jobB.plans]).toEqual([[dossier.plans[0].id], [dossier.plans[1].id]]);
  // The request sealed the list of the three items, in their order, and each job was claimed with the list's prompt.
  const [sealed] = await querySql(`select r.manifest #>> '{order,kind}' || ':' || (r.manifest #>> '{order,list,item_count}')
    from public.takeoff_launch_requests r where r.id = '${jobA.launch_request_id}';`);
  expect(sealed).toBe("item_list:3");
  return { dossier, jobA, jobB };
}

/** Each item's state and coverage, and its answer on each plan: [plan file, reading, outcome, quantity]. */
function summary(readings: OwnedItemReading[], plans: Record<string, string>) {
  return readings.map((item) => ({ label: item.label, state: item.state, coverage: item.coverage,
    plans: item.readings.map((reading) => [plans[reading.plan.fileId ?? ""], reading.reading, reading.answer?.outcome ?? null,
      reading.answer?.quantity ?? null]) }));
}

async function publications(jobId: string) {
  return Number((await querySql(`select count(*) from public.takeoff_item_answer_publications where job_id = '${jobId}';`))
    .find((line) => /^\s*\d+\s*$/.test(line)));
}

armyTest("TKPR01 two plans read against three items: A read while B is read gives partial quantities and no « not found », then B all « not found »",
  options, async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser, army };
    await ui.app.open("/dashboard/affaires");
    const owner = await signUpWorkerOwner(ui, "TKPR1");
    await activateOwnedPlanDispatch();
    await activateOwnedItemListOrder();
    const barrier = mkdtempSync(join(tmpdir(), "army-poste-reading-"));
    const release = join(barrier, "release-b");
    try {
      const { dossier, jobA, jobB } = await admittedRequest(ui, owner, { done: false });
      const plans = { [dossier.plans[0].id]: "A", [dossier.plans[1].id]: "B" };
      // The Mac reads A (three lavabos on its page 2, nothing else), then holds B's reading until the journey releases it.
      const pass = runOwnedPlanDispatch(ui, owner, dossier.projectId, { modes: { [jobB.id]: "release" }, releaseFile: release,
        itemAnswers: { [jobA.id]: { items: { [LAVABO]: { quantity: 3, unit: "u", page: 2 } } } } });
      await expect.poll(async () => (await readOwnedPlanJobs(dossier.projectId)).map((job) => job.status), { timeout: 90_000 })
        .toEqual(["completed", "processing"]);

      // While B is read: A's measure is the lavabos' partial quantity; nothing is « not found » while B may still find it.
      const reading = { expected: 2, answered: 1, inFlight: 1, ended: 0 };
      expect(summary(await readOwnedItemReadings(owner, dossier.projectId), plans)).toEqual([
        { label: LAVABO, state: "reading", coverage: reading, plans: [["A", "answered", "measured", { value: 3, unit: "u" }],
          ["B", "in_flight", null, null]] },
        { label: WC, state: "reading", coverage: reading, plans: [["A", "answered", "not_found", null], ["B", "in_flight", null, null]] },
        { label: ROBINET, state: "reading", coverage: reading, plans: [["A", "answered", "not_found", null], ["B", "in_flight", null, null]] },
      ]);
      // A's one contribution is its one countable row, at its page.
      expect(await readOwnedPlanItems(jobA.id)).toEqual([{ designation: LAVABO, source_page: 2 }]);

      // B answers « not found » for every item: a valid reading, published with its end.
      writeFileSync(release, "released");
      const passed = await pass;
      expect(passed.calls.map((call) => call.jobId)).toEqual([jobA.id, jobB.id]);
      expect((await readOwnedPlanJobs(dossier.projectId)).map((job) => [job.status, job.analysis_outcome])).toEqual([
        ["completed", "success"], ["completed", "success"]]);
      const full = { expected: 2, answered: 2, inFlight: 0, ended: 0 };
      const read = await readOwnedItemReadings(owner, dossier.projectId);
      expect(summary(read, plans)).toEqual([
        { label: LAVABO, state: "measured", coverage: full, plans: [["A", "answered", "measured", { value: 3, unit: "u" }],
          ["B", "answered", "not_found", null]] },
        { label: WC, state: "not_found", coverage: full, plans: [["A", "answered", "not_found", null], ["B", "answered", "not_found", null]] },
        { label: ROBINET, state: "not_found", coverage: full, plans: [["A", "answered", "not_found", null], ["B", "answered", "not_found", null]] },
      ]);
      // B searched its one page, read it, observed nothing, and wrote no row.
      for (const item of read) {
        expect(item.readings[1].answer).toMatchObject({ searchedPages: [1], unreadablePages: [], observations: [],
          reasons: [{ code: "NO_INDICATION", by: "model" }] });
      }
      expect(await readOwnedPlanItems(jobB.id)).toEqual([]);
      // A's lavabos: one contribution naming its row (the row's own id), on its page.
      const [rowA] = await readOwnedPlanItemRows(jobA.id);
      expect(rowA).toMatchObject({ designation: LAVABO, source_page: 2 });
      expect(read[0].readings[0].answer?.observations).toEqual([expect.objectContaining({ role: "contribution", page: 2, quantity: 3,
        takeoffItemId: rowA.id })]);
      await recordEvidence(ui.army, "takeoff-poste-reading-two-plans", { jobs: [jobA.id, jobB.id], states: read.map((item) => item.state) });
    } finally {
      rmSync(barrier, { recursive: true, force: true });
      await deactivateOwnedItemListOrder();
      await deactivateOwnedPlanDispatch();
    }
  });

armyTest("TKPR02 B failed, an answer omitted, a reading cut short: B publishes nothing and no item is « not found »", options, async ({ app, screen, browser, army }) => {
  const ui = { app, screen, browser, army };
  await ui.app.open("/dashboard/affaires");
  const owner = await signUpWorkerOwner(ui, "TKPR2");
  await activateOwnedPlanDispatch();
  await activateOwnedItemListOrder();
  try {
    const templated = { done: false };
    for (const failure of ["terminal", "omitted", "truncated", "nested"] as const) {
      const { dossier, jobA, jobB } = await admittedRequest(ui, owner, templated);
      const plans = { [dossier.plans[0].id]: "A", [dossier.plans[1].id]: "B" };
      const dispatch = await runOwnedPlanDispatch(ui, owner, dossier.projectId, {
        modes: failure === "terminal" ? { [jobB.id]: "terminal" } : {},
        itemAnswers: { [jobA.id]: { items: { [LAVABO]: { quantity: 3, unit: "u", page: 2 } } },
          ...(failure === "omitted" ? { [jobB.id]: { items: { [WC]: "omit" } } } : {}),
          ...(failure === "truncated" ? { [jobB.id]: { truncate: true } } : {}),
          ...(failure === "nested" ? { [jobB.id]: { items: { [LAVABO]: { quantity: 2, unit: "u", page: 1 } }, invalidQuantity: true } } : {}) },
      });
      const [doneA, doneB] = await readOwnedPlanJobs(dossier.projectId);
      expect([doneA.status, doneA.analysis_outcome]).toEqual(["completed", "success"]);
      // B published nothing: no answer, no row; A's answers stand.
      expect({ failure, status: doneB.status, code: doneB.error_code, publishedB: await publications(jobB.id),
        publishedA: await publications(jobA.id), rowsB: await readOwnedPlanItems(jobB.id) }).toEqual({ failure, status: "failed",
        code: failure === "terminal" ? "AI_PROVIDER" : "TAKEOFF_LEVEL_C_INVALID_SCHEMA", publishedB: 0, publishedA: 1, rowsB: [] });
      if (failure === "truncated" || failure === "nested") {
        const diagnosis = failure === "truncated" ? { stage: "answer_json", exception: "SyntaxError" }
          : { stage: "answer_schema", exception: "ZodError", issues: [{ path: "$.responses[0].observations[0].quantity", code: "invalid_type" }], issue_count: 1 };
        const details = { provider: "chatgpt", retryable: false, diagnosis, usage: { input: 900, reasoning: 25, output: 75, total: 1000 } };
        const message = "La réponse de l’analyse n’est pas exploitable pour ce plan et le métré peut être relancé.";
        const detail = await apiRequest<{ data: TakeoffJobDetailResponse }>(browser, "GET", `/api/takeoff/jobs/${jobB.id}`);
        expect(detail.status).toBe(200);
        expect(detail.body.data.job).toMatchObject({ error_message: message, next_retry_at: null });
        const [stored] = await querySql(`select json_build_object('result', r.raw_response, 'resultTotal', r.token_count,
          'chunk', json_build_object('details', m.metadata->'error_details', 'message', m.metadata->'error_message',
            'duration', m.duration_ms, 'total', m.total_tokens, 'input', m.input_tokens,
            'reasoning', m.reasoning_tokens, 'output', m.output_tokens))
          from public.takeoff_results r join public.takeoff_run_metrics m on m.result_id = r.id
          where r.job_id = '${jobB.id}';`);
        const receipt = JSON.parse(stored);
        expect(receipt).toMatchObject({ result: details, resultTotal: 1000, chunk: { details, message,
          duration: expect.any(Number), total: 1000, input: 900, reasoning: 25, output: 75 } });
        expect(receipt.chunk.duration).toBeGreaterThan(0);
        expect(stored).not.toContain("FICTIONAL_PLAN_MARKER");
        expect(dispatch.calls.map((call) => call.jobId)).toEqual([jobA.id, jobB.id]);
        await app.open(`/dashboard/affaires/${dossier.projectId}/takeoff?request=${jobB.launch_request_id}`);
        const plan = screen.getByRole("list", "Plans de l’analyse", { exact: true }).getByRole("listitem")
          .filter({ hasText: "plan-b.pdf" });
        await expect(plan.getByText(message, { exact: true })).toBeVisible();
        await recordEvidence(army, `takeoff-poste-rejected-${failure}`, receipt);
      }
      // A's measure stays a partial quantity, and an item A did not find is never « not found » while B gave no answer.
      const ended = { expected: 2, answered: 1, inFlight: 0, ended: 1 };
      expect({ failure, items: summary(await readOwnedItemReadings(owner, dossier.projectId), plans) }).toEqual({ failure, items: [
        { label: LAVABO, state: "incomplete", coverage: ended, plans: [["A", "answered", "measured", { value: 3, unit: "u" }],
          ["B", "ended", null, null]] },
        { label: WC, state: "incomplete", coverage: ended, plans: [["A", "answered", "not_found", null], ["B", "ended", null, null]] },
        { label: ROBINET, state: "incomplete", coverage: ended, plans: [["A", "answered", "not_found", null], ["B", "ended", null, null]] },
      ] });
    }

    // #470: an affaire whose objective is an estimate. A's three lavabos are an hypothesis, never a counted row: a candidate
    // of an uncertain answer, with its reason; both plans are read and the unit is not refused after its calls were paid.
    const estimate = await admittedRequest(ui, owner, templated, "estimate");
    await runOwnedPlanDispatch(ui, owner, estimate.dossier.projectId, {
      itemAnswers: { [estimate.jobA.id]: { items: { [LAVABO]: { quantity: 3, unit: "u", page: 2 } } } } });
    expect((await readOwnedPlanJobs(estimate.dossier.projectId)).map((job) => [job.status, job.analysis_outcome])).toEqual([
      ["completed", "success"], ["completed", "success"]]);
    expect(await readOwnedPlanItems(estimate.jobA.id)).toEqual([]);
    const [lavabo] = await readOwnedItemReadings(owner, estimate.dossier.projectId);
    expect(lavabo).toMatchObject({ label: LAVABO, state: "uncertain" });
    expect(lavabo.readings[0].answer).toMatchObject({ outcome: "uncertain", quantity: null, candidate: { value: 3, unit: "u" },
      reasonCode: "QUANTITY_ESTIMATED", observations: [expect.objectContaining({ role: "candidate", quantity: 3, takeoffItemId: null })] });
  } finally {
    await deactivateOwnedItemListOrder();
    await deactivateOwnedPlanDispatch();
  }
});

armyTest("TKPR04 les indices provisoires restent hors des totaux et le motif ouvre la page à vérifier", options, async ({ app, screen, browser, army }) => {
  const ui = { app, screen, browser, army };
  await ui.app.open("/dashboard/affaires");
  const owner = await signUpWorkerOwner(ui, "TKPR4");
  await activateOwnedPlanDispatch();
  await activateOwnedItemListOrder();
  try {
    const { dossier, jobA, jobB } = await admittedRequest(ui, owner, { done: false });
    const provisional = (quantity: number, page: number) => ({ uncertain: "PARTIAL_QUANTITY" as const,
      text: "Symboles lisibles dans une seule zone.", page, figure: { quantity, unit: "u" } });
    const dispatch = await runOwnedPlanDispatch(ui, owner, dossier.projectId, { itemAnswers: {
      [jobA.id]: { items: { [LAVABO]: { quantity: 2, unit: "u", page: 1 }, [WC]: provisional(3, 2),
        [ROBINET]: { uncertain: "QUALIFIER_UNREADABLE", text: "Diamètre illisible sous la légende R2.", page: 2 } } },
      [jobB.id]: { items: { [LAVABO]: provisional(4, 1), [WC]: provisional(6, 1) } },
    } });
    expect(dispatch.calls.map(({ jobId }) => jobId)).toEqual([jobA.id, jobB.id]);
    const readings = await readOwnedItemReadings(owner, dossier.projectId);
    const planA = readings.find(({ label }) => label === ROBINET)!.readings[0].plan.logicalId;
    expect(readings.find(({ label }) => label === ROBINET)!.readings[0].answer).toMatchObject({ outcome: "uncertain",
      quantity: null, candidate: null, observations: [expect.objectContaining({ page: 2, quantity: null, unit: null })] });
    expect(await readOwnedPlanItems(jobA.id)).toEqual([{ designation: LAVABO, source_page: 1 }]);
    expect(await readOwnedPlanItems(jobB.id)).toEqual([]);

    const ids = await itemIdsByLabel(dossier.projectId);
    const href = `/dashboard/affaires/${dossier.projectId}/takeoff`;
    const row = (label: string) => ui.screen.getByTestId(`poste-${ids[label]}`);
    await ui.browser.setViewport({ width: 1440, height: 900 });
    await ui.app.open(href);
    await waitForHydration(ui.browser);
    await row(WC).getByText("2 plans incertains", { exact: true }).click();
    await expect(row(WC).getByText("Quantité provisoire partielle · 3 u", { exact: true })).toBeVisible();
    await expect(row(WC).getByText("Quantité provisoire partielle · 6 u", { exact: true })).toBeVisible();
    await expect(row(WC).getByText("9 u", { exact: true })).toHaveCount(0);
    const totals = await ui.browser.evaluate((itemIds) => {
      const table = document.querySelector<HTMLTableElement>('table[aria-label="Postes du métré"]')!;
      const columns = Array.from(table.tHead!.rows[0].cells).map((cell) => cell.textContent?.trim());
      return itemIds.map((id) => {
        const line = document.querySelector<HTMLTableRowElement>(`[data-testid="poste-${id}"]`)!;
        return ["Observé", "Retenu"].map((column) => line.cells[columns.indexOf(column)].textContent?.trim());
      });
    }, [ids[LAVABO], ids[WC]]);
    expect(totals).toEqual([["2 u", ""], ["", ""]]);

    await ui.browser.setViewport({ width: 390, height: 844 });
    await ui.app.open(`${href}?postePlan=${planA}`);
    await waitForHydration(ui.browser);
    await expect(row(WC).getByText("Quantité provisoire partielle · 3 u", { exact: true })).toBeVisible();
    await expect(row(ROBINET)).toContainText("Diamètre illisible sous la légende R2.");
    await row(ROBINET).getByRole("link", "Vérifier le plan · page 2", { exact: true }).click();
    await expect(ui.screen.getByRole("img", "plan-a.pdf, page 2", { exact: true })).toBeVisible({ timeout: 30_000 });
    await recordEvidence(ui.army, "poste-uncertain-v3", { calls: 2, viewportWidths: [1440, 390], totals, verifiedPage: 2 });
  } finally {
    await deactivateOwnedItemListOrder();
    await deactivateOwnedPlanDispatch();
  }
});

/** The id of each item of the affaire's list, by its label. */
async function itemIdsByLabel(projectId: string) {
  const rows = JSON.parse((await querySql(`select coalesce(json_object_agg(e.label, e.item_id), '{}'::json)
    from public.takeoff_list_revision_entries e join public.takeoff_list_revisions r on r.id = e.revision_id
    where r.project_id = '${projectId}';`)).find((line) => line.trim().startsWith("{")) ?? "{}") as Record<string, string>;
  return rows;
}

/** Each answer of the affaire: its item, plan file, job, reading revision and the answer it replaces. */
async function ownedAnswers(projectId: string) {
  return JSON.parse((await querySql(`select coalesce(json_agg(json_build_object('id', a.id, 'item_id', a.item_id,
    'plan_file_id', a.plan_file_id, 'plan_logical_id', a.plan_logical_id, 'job_id', a.job_id, 'outcome', a.outcome,
    'reading_revision', a.reading_revision, 'replaces', a.replaces_answer_id) order by a.item_id, a.plan_file_id, a.reading_revision), '[]'::json)
    from public.takeoff_item_answers a where a.project_id = '${projectId}';`)).find((line) => line.trim().startsWith("[")) ?? "[]") as
    Array<{ id: string; item_id: string; plan_file_id: string; plan_logical_id: string; job_id: string; outcome: string;
      reading_revision: number; replaces: string | null }>;
}

// Lot 4, PR 4b: a new measure of a selection. After the first reading of both plans (the WC not found anywhere), the member
// selects the WC in the table and opens its new measure: the preview names the plans, the item, the paid calls and the
// budget sized on it alone (this application has no local ChatGPT runtime to pay with: the dialog says so and offers no
// confirmation). A confirmation naming another effort than the profile's is refused, nothing recorded (the Mac reads a
// request with its payer's profile as it is). The member's confirmation, run by the server with the member's own subscription on this Mac, is admitted
// for the WC alone on both plans; the WC reads « En lecture » at once, the other items keep their answers. The Mac reads
// both plans against the WC only (the controlled provider answers the items its prompt asks: two on A, none on B); the
// table then shows the WC measured, its new readings to decide, and the lavabo and the tap as they were.
armyTest("TKPR03 a new measure of one item reads it alone on its plans, and the table shows its new readings to decide", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser, army };
    await ui.app.open("/dashboard/affaires");
    const owner = await signUpWorkerOwner(ui, "TKPR3");
    await activateOwnedPlanDispatch();
    await activateOwnedItemListOrder();
    try {
      const { dossier, jobA, jobB } = await admittedRequest(ui, owner, { done: false }, undefined, async (first) => {
        const takeoff = `/dashboard/affaires/${first.projectId}/takeoff`;
        await ui.app.open(`${takeoff}?postes=liste`);
        await waitForHydration(ui.browser);
        await ui.screen.getByRole("button", "Enregistrer la liste proposée", { exact: true }).click();
        await expect(ui.screen.getByText("Liste enregistrée · révision 1 · 3 postes", { exact: false })).toBeVisible();
        const ids = await itemIdsByLabel(first.projectId);
        await ui.app.open(`${takeoff}?poste=${ids[WC]}`);
        await waitForHydration(ui.browser);
        await expect(ui.screen.getByRole("button", /plan-a.pdf.*À mesurer/)).toBeVisible();
        await ui.screen.getByRole("button", /plan-b.pdf.*À mesurer/).click();
        await ui.screen.getByRole("button", "Mesurer ce poste", { exact: true }).click();
        const summary = ui.screen.getByRole("dialog", "Mesurer ce poste", { exact: true });
        await expect(summary).toContainText("plan-b.pdf");
        await expect(summary).toContainText("Cette mesure donnera une première réponse au poste sur ce plan.");
        expect(await readOwnedPlanJobs(first.projectId)).toHaveLength(0);
      });
      const [planA, planB] = dossier.plans.map((plan) => plan.id);
      await runOwnedPlanDispatch(ui, owner, dossier.projectId, {
        itemAnswers: { [jobA.id]: { items: { [LAVABO]: { quantity: 3, unit: "u", page: 2 } } } } });
      expect((await readOwnedPlanJobs(dossier.projectId)).map((job) => job.status)).toEqual(["completed", "completed"]);
      const ids = await itemIdsByLabel(dossier.projectId);
      const before = await ownedAnswers(dossier.projectId);
      expect(before).toHaveLength(6);

      // The member selects the WC (not found on both plans) and opens its new measure.
      const { screen } = ui;
      const row = (label: string) => screen.getByTestId(`poste-${ids[label]}`);
      await ui.app.open(`/dashboard/affaires/${dossier.projectId}/takeoff`);
      await waitForHydration(ui.browser);
      await expect(screen.getByRole("table", "Postes du métré", { exact: true })).toBeVisible();
      await expect(row(WC)).toContainText("Non trouvé");
      await screen.getByRole("checkbox", `Sélectionner le poste « ${WC} »`, { exact: true }).check();
      await screen.getByRole("button", "Demander une nouvelle mesure (1)", { exact: true }).click();
      const preview = screen.getByTestId("poste-remeasure-preview");
      await expect(preview).toContainText("1 poste mesuré");
      await expect(preview).toContainText("plan-a.pdf");
      await expect(preview).toContainText("plan-b.pdf");
      await expect(screen.getByTestId("poste-remeasure-reading")).toContainText("Lecture de 1 poste sur 2 plans");
      await expect(screen.getByTestId("poste-remeasure-reading")).toContainText("Budget réservé sur votre forfait");
      await expect(screen.getByRole("button", "Confirmer la demande sur mon forfait", { exact: true })).toBeDisabled();
      await screen.getByRole("button", "Annuler", { exact: true }).click();

      // A confirmation naming another effort than the profile's (« automatique ») is refused and records nothing: the Mac
      // reads a request with its payer's profile as it is, and would refuse one sealed with another effort.
      const intentKey = randomUUID();
      const requests = async () => Number((await querySql(`select count(*) from public.takeoff_launch_requests
        where project_id = '${dossier.projectId}';`)).find((line) => /^\s*\d+\s*$/.test(line)));
      const requestsBefore = await requests();
      expect(await runOwnedTakeoffCommand(owner, ["remeasure", dossier.projectId, ids[WC], intentKey, "-", "-", "high"]))
        .toMatchObject({ status: 422, rejected: expect.stringContaining("un autre effort pour elle seule n’est pas encore possible") });
      expect(await requests()).toBe(requestsBefore);

      // The member's confirmation with the profile's setting, run by the server on this Mac: admitted for the WC alone, on
      // both plans, under the same key.
      const confirmed = await runOwnedTakeoffCommand(owner, ["remeasure", dossier.projectId, ids[WC], intentKey]);
      expect(confirmed).toMatchObject({ result: { outcome: "admitted", preview: { subscription: "ready",
        items: [{ itemId: ids[WC], label: WC }], reading: { state: "ready", calls: 2 } } } });
      const requestId = confirmed.result!.requestId!;
      const [sealed] = await querySql(`select (r.manifest #> '{order,list,asked_item_ids}')::text || '|' || r.payer_id
        from public.takeoff_launch_requests r where r.id = '${requestId}';`);
      expect(sealed).toBe(`["${ids[WC]}"]|${owner.userId}`);
      const remeasure = (await readOwnedPlanJobs(dossier.projectId)).filter((job) => job.launch_request_id === requestId);
      expect(remeasure.map((job) => job.plans)).toEqual([[planA], [planB]]);
      // The same confirmation sent again (a lost answer: the dialog resends its body) answers what it answered.
      const { planKeys, digest } = confirmed.result!.sent!;
      expect(await runOwnedTakeoffCommand(owner, ["remeasure", dossier.projectId, ids[WC], intentKey, planKeys.join(","), digest]))
        .toMatchObject({ result: { outcome: "replayed", requestId } });

      // The WC reads « En lecture » at once; the lavabo and the tap keep their answers.
      await ui.browser.reload();
      await waitForHydration(ui.browser);
      await expect(row(WC)).toContainText("En lecture");
      await expect(row(LAVABO)).toContainText("Mesuré");
      await expect(row(ROBINET)).toContainText("Non trouvé");

      // The Mac reads both plans against the WC only: two on A, nothing on B.
      const [newA, newB] = remeasure;
      const passed = await runOwnedPlanDispatch(ui, owner, dossier.projectId, {
        itemAnswers: { [newA.id]: { items: { [WC]: { quantity: 2, unit: "u", page: 1 } } } } });
      expect(passed.calls.map((call) => call.jobId).sort()).toEqual([newA.id, newB.id].sort());
      expect((await readOwnedPlanJobs(dossier.projectId)).filter((job) => job.launch_request_id === requestId)
        .map((job) => [job.status, job.analysis_outcome])).toEqual([["completed", "success"], ["completed", "success"]]);
      const after = await ownedAnswers(dossier.projectId);
      // Each new reading answered the WC alone, replacing its reading on that plan; every other answer is the one before.
      const added = after.filter((answer) => !before.some((earlier) => earlier.id === answer.id));
      expect(added.map(({ item_id, plan_file_id, plan_logical_id, outcome, reading_revision }) =>
        [item_id, plan_file_id, plan_logical_id, outcome, reading_revision]).sort()).toEqual([
        [ids[WC], planA, planA, "measured", 2], [ids[WC], planB, planB, "not_found", 2]].sort());
      for (const answer of added) {
        expect(answer.replaces).toBe(before.find((earlier) => earlier.item_id === ids[WC] && earlier.plan_file_id === answer.plan_file_id)!.id);
      }
      expect(after.filter((answer) => answer.item_id !== ids[WC]).map(({ id }) => id).sort())
        .toEqual(before.filter((answer) => answer.item_id !== ids[WC]).map(({ id }) => id).sort());

      // The table shows the WC measured, its new readings to decide; the lavabo and the tap as they were.
      await ui.browser.reload();
      await waitForHydration(ui.browser);
      await expect(row(WC)).toContainText("Mesuré");
      await expect(row(WC)).toContainText("À vérifier");
      expect(Number((await querySql(`select count(*) from public.takeoff_item_answer_decisions where answer_id in
        (${added.map(({ id }) => `'${id}'`).join(", ")});`)).find((line) => /^\s*\d+\s*$/.test(line)))).toBe(0);
      await expect(row(LAVABO)).toContainText("Mesuré");
      await expect(row(ROBINET)).toContainText("Non trouvé");
      await screen.getByRole("button", `Détail du poste « ${WC} »`, { exact: true }).click();
      const detail = screen.getByTestId(`poste-detail-${ids[WC]}`);
      await expect(detail).toContainText("Mesuré");
      await expect(detail).toContainText("Non trouvé");
      const address = `/dashboard/affaires/${dossier.projectId}/takeoff?poste=${ids[WC]}&plan=${planA}&page=1`;
      await ui.app.open(address);
      await waitForHydration(ui.browser);
      await screen.getByRole("button", "Mesurer ce poste", { exact: true }).click();
      const summary = screen.getByRole("dialog", "Mesurer ce poste", { exact: true });
      await expect(summary).toContainText("Couverture précédente · 1, 2");
      await expect(summary).toContainText("Détaillé");
      const screenshots = [await ui.app.screenshot("mesurer-poste-recapitulatif")];
      await screen.getByLabel("Portée").selectOption({ value: "page" });
      await expect(summary).toContainText("La lecture précédente est indivisible");
      await expect(summary).toContainText("MergeOne local");
      await expect(screen.getByRole("button", "Mesurer avec mon forfait", { exact: true })).toBeDisabled();
      screenshots.push(await ui.app.screenshot("mesurer-poste-refus"));
      await ui.browser.keyboard.press("Escape");
      await expect(summary).not.toBeVisible();
      const detailKey = randomUUID();
      const admission = await runOwnedTakeoffCommand(owner, ["measure-item", dossier.projectId, ids[WC], detailKey,
        planA, dossier.plans[0].hash, "1"]);
      expect(admission).toMatchObject({ result: { outcome: "admitted", receipt: { intentKey: detailKey, state: "queued" } } });
      const detailJob = admission.result!.receipt!.jobId;
      const detailRequest = admission.result!.requestId!;
      await ui.browser.reload();
      await waitForHydration(ui.browser);
      const comparison = screen.getByTestId("poste-mesure-resultat");
      const expectPageComparison = async () => {
        await expect(comparison.getByText("Lecture précédente · actuelle · 2 u · pages 1, 2", { exact: true })).toBeVisible();
        await expect(comparison.getByText("Nouvelle lecture · Non trouvé · pages 1", { exact: true })).toBeVisible();
        await expect(comparison.getByText("La nouvelle lecture est une comparaison en lecture seule. Vos corrections restent sur la lecture actuelle.",
          { exact: true })).toBeVisible();
      };
      await expect(comparison).toContainText("En attente de lecture");
      await runOwnedPlanDispatch(ui, owner, dossier.projectId);
      await expectPageComparison();
      const currentItem = screen.getByRole("option", new RegExp(`^${WC}`));
      await expect(currentItem).toContainText("Mesuré");
      await expect(currentItem).toContainText("2 u");
      await expect(screen.getByRole("button", "Mesurer tout le plan", { exact: true })).toBeVisible();
      screenshots.push(await ui.app.screenshot("mesurer-poste-comparaison"));
      const published = (await ownedAnswers(dossier.projectId)).filter((answer) => answer.job_id === detailJob);
      expect(published).toMatchObject([{ item_id: ids[WC], plan_file_id: planA, outcome: "not_found", replaces: null }]);
      // Another request must still name the last business reading of this plan as its predecessor.
      const next = await runOwnedTakeoffCommand(owner, ["measure-item", dossier.projectId, ids[WC], randomUUID(),
        planA, dossier.plans[0].hash, "1"]);
      expect(next).toMatchObject({ result: { outcome: "admitted" } });
      const predecessor = await dossier.setup.from("takeoff_launch_requests").select("predecessor_job_id")
        .eq("id", next.result!.requestId).single();
      expect(predecessor.data?.predecessor_job_id).toBe(newA.id);
      await ui.browser.reload();
      await waitForHydration(ui.browser);
      await expect(comparison).toContainText(detailRequest);
      await expect(comparison).toContainText("Lecture terminée");
      await expectPageComparison();

      const readReceipt = (item: string, plan: string, requestId: string) => {
        const query = new URLSearchParams({ item, plan, jobId: detailJob, requestId });
        return apiRequest(ui.browser, "GET", `/api/affaires/${dossier.projectId}/takeoff/items/remeasure?${query}`);
      };
      for (const [item, plan, requested] of [[ids[LAVABO], planA, detailRequest], [ids[WC], planB, detailRequest],
        [ids[WC], planA, next.result!.requestId!]]) {
        expect(await readReceipt(item, plan, requested)).toMatchObject({ status: 200, body: { ok: true, data: null } });
      }
      // Another member of the same affaire can open the item but cannot follow the payer's receipt.
      const colleague = await signUpWorkerOwner(ui, "TKPR3R");
      await querySql(`update public.tenant_memberships set is_default = false where user_id = '${colleague.userId}';
        insert into public.tenant_memberships (tenant_id,user_id,role,is_default)
        values ('${owner.tenantId}','${colleague.userId}','director',true);`);
      expect(await readReceipt(ids[WC], planA, detailRequest)).toMatchObject({ status: 200, body: { ok: true, data: null } });
      await recordEvidence(ui.army, "takeoff-item-remeasure", { requestId, screenshots, detailJob, jobs: [jobA.id, jobB.id, newA.id, newB.id],
        added: added.map(({ plan_file_id, outcome }) => [plan_file_id === planA ? "A" : "B", outcome]) });
    } finally {
      await deactivateOwnedItemListOrder();
      await deactivateOwnedPlanDispatch();
    }
  });
