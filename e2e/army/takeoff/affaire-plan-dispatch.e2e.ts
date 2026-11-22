import { randomUUID } from "node:crypto";

import { expect } from "e2e";

import { armyTest, recordEvidence } from "../critical/fixtures";
import { querySql } from "../local/calculation-gate-support";
import { startTakeoffEmailCollector } from "./completion-support";
import {
  activateOwnedPlanDispatch, deactivateOwnedPlanDispatch, fictionalPlanPdf, readOwnedLedger, readOwnedPlanItems, readOwnedPlanJobs,
  readOwnedPlanRequests, readOwnedRequestNotices, runOwnedPlanDispatch, runOwnedTakeoffCommand, seedPlanDossier,
} from "./plan-dispatch-support";
import { signUpWorkerOwner } from "./worker-support";

// Lot 3, one analysis per plan (migration 20261121231238_takeoff_plan_dispatcher.sql), on the owned worker stack: the
// member's explicit command (the server's), the Mac's dispatcher with the real claim, slot, ledger, processor,
// persistence and end of each unit, and a controlled local provider. Fictional plans and dossier only.

armyTest("TKPD01 a request of three plans gives three analyses read one at a time; one that fails stops nothing; one notice « 2 plans lus sur 3 »", {
  session: "army", trace: "off", tags: ["critical", "takeoff-worker", "local"], timeout: 300_000,
}, async (ui) => {
  await ui.app.open("/dashboard/affaires");
  const owner = await signUpWorkerOwner(ui, "TKPD1");
  const mail = await startTakeoffEmailCollector();
  await activateOwnedPlanDispatch();
  try {
    // Plan 1 is read on its pages 2 and 7 only; the section is set aside; the CCTP is common context.
    const dossier = await seedPlanDossier(ui, owner, [
      { name: "plan-1-rdc.pdf", pages: 7, retained: [2, 7] }, { name: "plan-2-r1.pdf", pages: 1 }, { name: "plan-3-r2.pdf", pages: 1 },
      { name: "plan-4-coupe.pdf", pages: 1, inactive: true },
    ]);
    const [first, second, third, setAside] = dossier.plans;
    const intent = randomUUID();
    const launch = () => runOwnedTakeoffCommand(owner, ["launch", dossier.projectId, dossier.planSetId, intent, "1",
      [first, second, third].map((plan) => plan.id).join(",")]);
    const command = await launch();
    expect(command).toMatchObject({ result: { outcome: "admitted" } });
    const requestId = command.result!.requestId!;
    // A double click or a replay of the same command gets its answer and creates nothing more.
    expect(await launch()).toMatchObject({ result: { outcome: "replayed", requestId } });

    // One request, one analysis per retained plan, in the order a member reads them, each with its plan and the reference.
    const [request] = await readOwnedPlanRequests(dossier.projectId);
    expect(request).toMatchObject({ id: requestId, state: "admitted", format: 2, units_expected: 3 });
    expect(request.units?.map((unit) => [unit.ordinal, unit.plans])).toEqual([[1, [first.id]], [2, [second.id]], [3, [third.id]]]);
    const jobs = await readOwnedPlanJobs(dossier.projectId);
    expect(jobs.map((job) => [job.launch_unit_key, job.status, job.plans, job.pages, job.references])).toEqual([
      [`plan:${first.id}`, "pending", [first.id], [[2, 7]], [dossier.cctpId]],
      [`plan:${second.id}`, "pending", [second.id], [[]], [dossier.cctpId]],
      [`plan:${third.id}`, "pending", [third.id], [[]], [dossier.cctpId]],
    ]);
    expect(jobs.flatMap((job) => job.plans)).not.toContain(setAside.id);
    expect(await readOwnedRequestNotices(dossier.projectId)).toEqual([]);

    // Two processes of the Mac at once: one plan is read at a time; the second plan fails definitively and alone.
    const modes = { [jobs[1].id]: "terminal" as const };
    const passes = await Promise.all([1, 2].map(() => runOwnedPlanDispatch(ui, owner, dossier.projectId,
      { modes, delayMs: 800, mailCollector: mail.origin })));
    const calls = passes.flatMap((pass) => pass.calls).sort((left, right) => left.startedAt - right.startedAt);
    expect(calls.map((call) => call.jobId)).toEqual(jobs.map((job) => job.id));
    for (let index = 1; index < calls.length; index += 1) expect(calls[index].startedAt).toBeGreaterThanOrEqual(calls[index - 1].endedAt);
    expect(Math.max(...passes.map((pass) => pass.maxInFlight))).toBe(1);
    // Each reading got its plan's pages and the CCTP, its common context.
    expect(calls.every((call) => call.files.filter((file) => file.mimeType === "application/pdf").length === 2)).toBe(true);

    const ended = await readOwnedPlanJobs(dossier.projectId);
    expect(ended.map((job) => [job.status, job.analysis_outcome, job.error_code])).toEqual([
      ["completed", "success", null], ["failed", "failure", "AI_PROVIDER"], ["completed", "success", null],
    ]);
    // The pages 2 and 7 of plan 1 stay 2 and 7 in its result.
    expect((await readOwnedPlanItems(ended[0].id)).map((item) => item.source_page)).toEqual([2, 7]);
    const [closed] = await readOwnedPlanRequests(dossier.projectId);
    expect(closed).toMatchObject({ state: "closed", outcome: "partial", units_succeeded: 2, units_failed: 1, units_not_started: 0 });
    // Each paid call was reserved and settled once in the request's ledger.
    expect((await readOwnedLedger(requestId)).map((row) => row.state)).toEqual(["observed", "observed", "observed"]);
    // One notice and one e-mail for the request, none for its plans.
    expect(await readOwnedRequestNotices(dossier.projectId)).toEqual([expect.objectContaining({ subject_kind: "request", request_id: requestId,
      job_id: null, outcome: "partial", plans_read_count: 2, plans_failed_count: 1, delivery_state: "sent" })]);
    expect([...mail.receipts.values()]).toHaveLength(1);
    const [message] = [...mail.receipts.values()].map((receipt) => receipt.message);
    expect(message.subject).toContain("Votre métré est terminé en partie");
    expect(message.text).toContain("2 plans lus sur 3.");
    expect(message.text).toContain(`/dashboard/affaires/${dossier.projectId}/takeoff?request=${requestId}`);
    expect(await querySql(`select count(*) from public.estimate_versions where project_id = '${dossier.projectId}';`)).toEqual(["0"]);

    // A plan added to the dossier after the analysis: nothing reads it on its own; only a command that names it does.
    const added = randomUUID();
    const bytes = await fictionalPlanPdf(`${ui.army.runPrefix} plan-5`, 1);
    const path = `${owner.tenantId}/${dossier.planSetId}/${added}/plan-5-r3.pdf`;
    expect((await dossier.setup.storage.from("plan-files").upload(path, bytes, { contentType: "application/pdf" })).error).toBeNull();
    expect((await dossier.setup.from("plan_files").insert({ id: added, tenant_id: owner.tenantId, plan_set_id: dossier.planSetId,
      file_name: "plan-5-r3.pdf", file_path: path, file_type: "application/pdf", file_size_bytes: bytes.length, page_count: 1 })).error).toBeNull();
    const idle = await runOwnedPlanDispatch(ui, owner, dossier.projectId);
    expect([idle.pass.ran, idle.calls]).toEqual([[], []]);
    const hash = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
    await dossier.confirm([...dossier.plans, { id: added, name: "plan-5-r3.pdf", bytes, hash, pages: [], inactive: false }], 2);
    // The command names the plan and the analysis it extends (never a first analysis on an affaire that has one).
    const extended = (await readOwnedPlanJobs(dossier.projectId)).find((job) => job.launch_request_id === requestId)!.id;
    const reread = await runOwnedTakeoffCommand(owner, ["launch", dossier.projectId, dossier.planSetId, randomUUID(), "2", added, extended]);
    expect(reread).toMatchObject({ result: { outcome: "admitted" } });
    const later = await runOwnedPlanDispatch(ui, owner, dossier.projectId);
    expect(later.calls.map((call) => call.jobId)).toHaveLength(1);
    expect((await readOwnedPlanJobs(dossier.projectId)).filter((job) => job.launch_request_id === reread.result!.requestId)
      .map((job) => [job.plans, job.status])).toEqual([[[added], "completed"]]);
    expect(await readOwnedPlanRequests(dossier.projectId)).toHaveLength(2);

    // The dialogue's relaunch of the first plan's analysis names no plan: its receipt is looked up first (none), then the
    // server reads that plan at its current copy (the plan-location reader, under the member's session) and reads it
    // alone. The plans the affaire read before stay theirs (their last successful readings, across both requests); the
    // plan whose reading failed is not among them.
    const firstJob = (await readOwnedPlanJobs(dossier.projectId))
      .find((job) => job.launch_request_id === requestId && job.launch_unit_key === `plan:${first.id}`)!.id;
    const relaunch = await runOwnedTakeoffCommand(owner, ["launch", dossier.projectId, dossier.planSetId, randomUUID(), "2", "-", firstJob]);
    expect(relaunch).toMatchObject({ result: { outcome: "admitted" } });
    const requests = await readOwnedPlanRequests(dossier.projectId);
    expect(requests).toHaveLength(3);
    expect(requests.at(-1)!.units?.map((unit) => unit.plans)).toEqual([[first.id]]);
    const [setAsideAsRead] = await querySql(`select coalesce(jsonb_agg(entry ->> 'id' order by entry ->> 'id'), '[]'::jsonb)
      from public.takeoff_launch_requests r, jsonb_array_elements(r.manifest #> '{coverage,plans_omitted}') entry
      where r.id = '${relaunch.result!.requestId}' and entry ->> 'reason' = 'not_requested';`).then((lines) =>
      lines.filter((line) => line.trim().startsWith("[")));
    expect(JSON.parse(setAsideAsRead!)).toEqual([third.id, added].sort());
    const relaunched = await runOwnedPlanDispatch(ui, owner, dossier.projectId);
    expect(relaunched.calls).toHaveLength(1);

    await recordEvidence(ui.army, "TKPD01-plan-analyses", { projectId: dossier.projectId, requestId, jobs: ended, calls, closed,
      laterRequest: reread.result, boundary: "Fictional plans, a controlled local provider and an e-mail collector on an owned local backend." });
  } finally {
    await deactivateOwnedPlanDispatch();
    await mail.close();
  }
});

armyTest("TKPD02 a member stops the rest of a request after its first plan: the plan read stays, its requester is told; a full stop sends nothing", {
  session: "army", trace: "off", tags: ["critical", "takeoff-worker", "local"], timeout: 300_000,
}, async (ui) => {
  await ui.app.open("/dashboard/affaires");
  const owner = await signUpWorkerOwner(ui, "TKPD2");
  const mail = await startTakeoffEmailCollector();
  await activateOwnedPlanDispatch();
  try {
    const dossier = await seedPlanDossier(ui, owner, [{ name: "plan-1.pdf", pages: 1 }, { name: "plan-2.pdf", pages: 1 }, { name: "plan-3.pdf", pages: 1 }]);
    const command = await runOwnedTakeoffCommand(owner, ["launch", dossier.projectId, dossier.planSetId, randomUUID(), "1",
      dossier.plans.map((plan) => plan.id).join(",")]);
    const requestId = command.result!.requestId!;
    const jobs = await readOwnedPlanJobs(dossier.projectId);
    // The Mac reads the first plan, then the second, whose call is held (a barrier) until the member stops the rest.
    const reading = runOwnedPlanDispatch(ui, owner, dossier.projectId, { modes: { [jobs[1].id]: "hold" }, mailCollector: mail.origin });
    await expect.poll(async () => (await readOwnedLedger(requestId)).filter((row) => row.job_id === jobs[1].id).map((row) => row.state),
      { timeout: 60_000 }).toEqual(["reserved"]);
    expect((await readOwnedPlanJobs(dossier.projectId)).map((job) => job.status)).toEqual(["completed", "processing", "pending"]);
    const stopped = await runOwnedTakeoffCommand(owner, ["stop", dossier.projectId, requestId]);
    expect(stopped).toMatchObject({ result: { outcome: "stopped", state: "closed", canceledUnits: 2 } });
    const pass = await reading;
    // The plan read while the stop came can neither spend nor commit later: its call stays held, never credited back.
    expect((await readOwnedLedger(requestId)).filter((row) => row.job_id === jobs[1].id).map((row) => row.state)).toEqual(["unknown"]);
    expect(pass.calls.map((call) => call.jobId)).toEqual([jobs[0].id, jobs[1].id]);
    expect((await readOwnedPlanItems(jobs[1].id))).toEqual([]);
    expect((await readOwnedPlanJobs(dossier.projectId)).map((job) => job.status)).toEqual(["completed", "canceled", "canceled"]);
    expect((await readOwnedPlanRequests(dossier.projectId))[0]).toMatchObject({ state: "closed", outcome: "partial", units_succeeded: 1,
      units_canceled: 2, reason_code: "STOPPED_BY_MEMBER" });
    expect([...mail.receipts.values()].map((receipt) => receipt.message.text)).toEqual([
      expect.stringContaining("1 plan disponible, 2 arrêtés à votre demande.")]);

    // Stopped before any plan is read: cancelled, and no e-mail.
    const other = await seedPlanDossier(ui, owner, [{ name: "plan-a.pdf", pages: 1 }, { name: "plan-b.pdf", pages: 1 }]);
    const second = await runOwnedTakeoffCommand(owner, ["launch", other.projectId, other.planSetId, randomUUID(), "1",
      other.plans.map((plan) => plan.id).join(",")]);
    expect(await runOwnedTakeoffCommand(owner, ["stop", other.projectId, second.result!.requestId!])).toMatchObject({
      result: { outcome: "stopped", state: "closed", canceledUnits: 2 } });
    expect((await readOwnedPlanRequests(other.projectId))[0]).toMatchObject({ outcome: "canceled", units_canceled: 2 });
    expect(await readOwnedRequestNotices(other.projectId)).toEqual([expect.objectContaining({ outcome: "canceled", delivery_state: "suppressed" })]);
    expect(mail.receipts.size).toBe(1);
    await recordEvidence(ui.army, "TKPD02-stop-the-rest", { projectId: dossier.projectId, requestId, calls: pass.calls, stopped: stopped.result,
      boundary: "Fictional plans, a controlled local provider and an e-mail collector on an owned local backend." });
  } finally {
    await deactivateOwnedPlanDispatch();
    await mail.close();
  }
});

armyTest("TKPD03 a plan whose bytes changed after its admission fails at once, alone, and the next plan is read in the same pass", {
  session: "army", trace: "off", tags: ["critical", "takeoff-worker", "local"], timeout: 300_000,
}, async (ui) => {
  await ui.app.open("/dashboard/affaires");
  const owner = await signUpWorkerOwner(ui, "TKPD3");
  await activateOwnedPlanDispatch();
  try {
    const dossier = await seedPlanDossier(ui, owner, [{ name: "plan-1.pdf", pages: 1 }, { name: "plan-2.pdf", pages: 1 }]);
    const command = await runOwnedTakeoffCommand(owner, ["launch", dossier.projectId, dossier.planSetId, randomUUID(), "1",
      dossier.plans.map((plan) => plan.id).join(",")]);
    expect(command).toMatchObject({ result: { outcome: "admitted" } });
    const [first, second] = await readOwnedPlanJobs(dossier.projectId);
    // The first plan's stored bytes are replaced after the admission, before its reading.
    const [path] = (await querySql(`select file_path from public.plan_files where id = '${dossier.plans[0].id}';`))
      .filter((line) => line.includes("/"));
    const replaced = await fictionalPlanPdf(`${ui.army.runPrefix} plan-1 modifié`, 1);
    expect((await dossier.setup.storage.from("plan-files").update(path.trim(), replaced, { contentType: "application/pdf" })).error)
      .toBeNull();
    // One pass of the Mac: the changed plan ends at once with its reason (no call, nothing held), the next is read after it.
    const pass = await runOwnedPlanDispatch(ui, owner, dossier.projectId);
    expect(pass.pass.ran).toEqual([first.id, second.id]);
    expect(pass.calls.map((call) => call.jobId)).toEqual([second.id]);
    expect((await readOwnedPlanJobs(dossier.projectId)).map((job) => [job.status, job.error_code])).toEqual([
      ["failed", "TAKEOFF_PREPARATION_SOURCE_CHANGED"], ["completed", null]]);
    expect((await readOwnedPlanRequests(dossier.projectId))[0]).toMatchObject({ state: "closed", outcome: "partial",
      units_succeeded: 1, units_failed: 1 });
    await recordEvidence(ui.army, "TKPD03-source-changed", { projectId: dossier.projectId, calls: pass.calls, ran: pass.pass.ran,
      boundary: "Fictional plans and a controlled local provider on an owned local backend." });
  } finally {
    await deactivateOwnedPlanDispatch();
  }
});
