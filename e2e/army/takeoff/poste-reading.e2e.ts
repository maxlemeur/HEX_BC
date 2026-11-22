import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { expect } from "e2e";

import { armyTest, recordEvidence } from "../critical/fixtures";
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
async function admittedRequest(ui: WorkerUi, owner: WorkerOwner, templated: { done: boolean }, objective?: "estimate") {
  const dossier = await seedPlanDossier(ui, owner, [{ name: "plan-a.pdf", pages: 2 }, { name: "plan-b.pdf", pages: 1 }], { objective });
  if (!templated.done) {
    await publishOwnedItemTemplate(dossier.setup, owner, ITEMS);
    templated.done = true;
  }
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
  options, async (ui) => {
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

armyTest("TKPR02 B failed, an answer omitted, a reading cut short: B publishes nothing and no item is « not found »", options, async (ui) => {
  await ui.app.open("/dashboard/affaires");
  const owner = await signUpWorkerOwner(ui, "TKPR2");
  await activateOwnedPlanDispatch();
  await activateOwnedItemListOrder();
  try {
    const templated = { done: false };
    for (const failure of ["terminal", "omitted", "truncated"] as const) {
      const { dossier, jobA, jobB } = await admittedRequest(ui, owner, templated);
      const plans = { [dossier.plans[0].id]: "A", [dossier.plans[1].id]: "B" };
      await runOwnedPlanDispatch(ui, owner, dossier.projectId, {
        modes: failure === "terminal" ? { [jobB.id]: "terminal" } : {},
        itemAnswers: { [jobA.id]: { items: { [LAVABO]: { quantity: 3, unit: "u", page: 2 } } },
          ...(failure === "omitted" ? { [jobB.id]: { items: { [WC]: "omit" } } } : {}),
          ...(failure === "truncated" ? { [jobB.id]: { truncate: true } } : {}) },
      });
      const [doneA, doneB] = await readOwnedPlanJobs(dossier.projectId);
      expect([doneA.status, doneA.analysis_outcome]).toEqual(["completed", "success"]);
      // B published nothing: no answer, no row; A's answers stand.
      expect({ failure, status: doneB.status, code: doneB.error_code, publishedB: await publications(jobB.id),
        publishedA: await publications(jobA.id), rowsB: await readOwnedPlanItems(jobB.id) }).toEqual({ failure, status: "failed",
        code: failure === "terminal" ? "AI_PROVIDER" : "TAKEOFF_LEVEL_C_INVALID_SCHEMA", publishedB: 0, publishedA: 1, rowsB: [] });
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
