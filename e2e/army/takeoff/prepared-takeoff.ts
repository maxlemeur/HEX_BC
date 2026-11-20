import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Browser } from "@e2e-dev/web";
import { expect, type App } from "e2e";
import { z } from "zod";
import { createEmptyTakeoffPreparation } from "@/lib/takeoff/preparation";
import { type ArmyState, type createEstimateViaWizard, type OwnedEstimate } from "../critical/fixtures";
import { createPlanSet, ownedTakeoffJobs, uploadSamplePlan } from "../critical/plans-support";
import { fillTakeoffPreparation } from "../critical/preparation-support";
import { querySql } from "../local/calculation-gate-support";
import { callServerAction, confirmTakeoffPreparationViaAction, serverActionId } from "../local/engine-v3-creators-support";

/** Saves and confirms a level-A preparation of a CSV source on an owned affaire: no job is created from it. */
export async function confirmPreparedCsv(
  ui: { app: App; browser: Browser },
  ids: { projectId: string; versionId: string },
  filePath: string,
  provider: "chatgpt" | "auto",
  manifest?: string,
) {
  const projectId = z.uuid().parse(ids.projectId);
  const versionId = z.uuid().parse(ids.versionId);
  await ui.app.open(`/dashboard/affaires/${projectId}/takeoff`);
  const text = await readFile(filePath, "utf8");
  const name = path.basename(filePath);
  const hash = createHash("sha256").update(text).digest("hex");
  const draft = createEmptyTakeoffPreparation({ estimateVersionId: versionId });
  draft.objective = "extract_quantities";
  draft.objective_confirmed = true;
  draft.scope = { ...draft.scope, inclusions: ["Toutes les lignes du fichier"], confirmed: true };
  draft.sources = [{ document_id: `upload:${hash}`, document_name: name, kind: "plan", revision: "A",
    source_version: hash, content_hash: hash, pages: [], active: true, confirmed: true, plan_set_id: null,
    file_path: null, page_count: null, logical_document_id: null, source_updated_at: null, mime_type: "text/csv", page_triage: null }];
  draft.conventions = { ...draft.conventions, unit: "Unités des lignes sources", measurement_basis: "documented", confirmed: true };
  draft.destination.confirmed = true;
  draft.processing = { level: "A", provider };
  const rows = await querySql(`SELECT revision FROM public.takeoff_preparations WHERE project_id='${projectId}'
    AND EXISTS (SELECT 1 FROM public.estimate_versions v WHERE v.id='${versionId}' AND v.project_id='${projectId}');`);
  const expectedRevision = rows.length ? Number(rows[0]) : null;
  const saved = await callServerAction(ui.browser, await serverActionId("saveTakeoffPreparationAction", manifest),
    { projectId, draft, expectedRevision });
  expect(saved).toMatchObject({ ok: true, status: 200 });
  const confirmation = await confirmTakeoffPreparationViaAction(ui.browser, {
    actionId: await serverActionId("confirmTakeoffPreparationAction", manifest),
    projectId, expectedRevision: (expectedRevision ?? 0) + 1,
  });
  expect(confirmation.ok).toBe(true);
  return confirmation;
}

/**
 * Launches a level B or C takeoff of a fictional plan as the application does: a plan set and its sample PDF on an
 * owned affaire, its preparation filled and confirmed in the dialog, then « Confirmer et lancer le métré ».
 */
export async function launchPreparedPlanSet(
  ui: Parameters<typeof createEstimateViaWizard>[0],
  army: ArmyState,
  ids: OwnedEstimate,
  processing: { level: "B" | "C"; provider: "auto" | "chatgpt" },
) {
  const planSet = await createPlanSet(ui, army, ids, `${army.runPrefix} plans`);
  const file = await uploadSamplePlan(ui, army, planSet);
  await ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff?launch=1&launchPlanSet=${planSet.id}`);
  const dialog = await fillTakeoffPreparation({ ...ui, army }, { sources: [file.file_name], processing });
  await dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
  await expect(dialog.getByRole("link", /Centre d'activit/i)).toBeVisible();
  const jobs = ownedTakeoffJobs(ui.browser, ids);
  await expect.poll(async () => (await jobs.list()).length, { timeout: 45_000 }).toBe(1);
  const [job] = await jobs.list();
  return { jobId: job.id, planSet, file };
}
