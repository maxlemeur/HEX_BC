import { stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import { apiRequest, ownEstimate, readEstimate, recordEvidence, type ArmyState, type OwnedEstimate, type createEstimateViaWizard } from "./fixtures";
import { localTakeoffFixture } from "../takeoff/fixtures";

type Ui = Parameters<typeof createEstimateViaWizard>[0];
type Envelope<T> = { ok: boolean; data: T };
type PlanSet = { id: string; project_id: string; tenant_id: string; name: string; file_count: number };
type PlanFile = { id: string; plan_set_id: string; file_name: string; file_type: string; file_size_bytes: number };

export function requireLocalPlansBackend() {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (backend.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) ||
    backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST) {
    throw new Error("Plan and analysis fixtures require the explicitly allowlisted local Supabase.");
  }
}

export async function readPlanSets(browser: Browser, projectId: string) {
  const result = await apiRequest<Envelope<{ plan_sets: PlanSet[] }>>(browser, "GET", `/api/takeoff/plan-sets?project_id=${projectId}`);
  expect([result.status, result.body.ok]).toEqual([200, true]);
  return result.body.data.plan_sets;
}

export async function readPlanFiles(browser: Browser, planSetId: string) {
  // Metadata only: never return or archive a signed download URL.
  const result = await apiRequest<Envelope<{ plan_files: PlanFile[] }>>(browser, "GET", `/api/takeoff/plan-sets/${planSetId}/files?include_download_url=false`);
  expect([result.status, result.body.ok]).toEqual([200, true]);
  return result.body.data.plan_files.map(({ id, plan_set_id, file_name, file_type, file_size_bytes }) =>
    ({ id, plan_set_id, file_name, file_type, file_size_bytes }));
}

export async function createPlanSet(ui: Ui, army: ArmyState, estimate: OwnedEstimate, name: string) {
  requireLocalPlansBackend();
  if (!army.ownedEstimates.some((owned) => owned.projectId === estimate.projectId && owned.versionId === estimate.versionId)) {
    throw new Error("Only this test's new ARMY project may receive plans.");
  }
  await ui.app.open(`/dashboard/affaires/${estimate.projectId}/plans`);
  await expect(ui.screen.getByRole("heading", "Plans", { exact: true, level: 1 })).toBeVisible();
  await expect(ui.screen.getByText("Aucun jeu de plans", { exact: true })).toBeVisible();
  expect(await readPlanSets(ui.browser, estimate.projectId)).toEqual([]);
  await ui.screen.getByRole("button", /Cr[ée]er.*jeu de plans/i).first().click();
  const dialog = ui.screen.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/Nom/i).fill(name);
  await dialog.getByRole("button", /Creer|Créer/i).click();
  await expect(dialog).toBeHidden();
  await expect(ui.screen.getByRole("heading", name, { exact: true })).toBeVisible();
  await expect(ui.screen.getByText("0 plans", { exact: true, visible: true })).toBeVisible();
  const sets = await readPlanSets(ui.browser, estimate.projectId);
  expect(sets).toHaveLength(1);
  expect(sets[0]).toMatchObject({ project_id: estimate.projectId, name, file_count: 0 });
  expect(sets[0].tenant_id).toMatch(/^[0-9a-f-]{36}$/i);
  (army.ownedPlanSets ??= []).push({ projectId: estimate.projectId, planSetId: sets[0].id, tenantId: sets[0].tenant_id });
  await recordEvidence(army, "plan-set-created", { estimate, planSet: sets[0] });
  return sets[0];
}

export async function uploadSamplePlan(ui: Ui, army: ArmyState, planSet: PlanSet) {
  await ui.screen.getByRole("heading", planSet.name, { exact: true }).click();
  const filePath = path.resolve("e2e/fixtures/sample-plan.pdf");
  const size = (await stat(filePath)).size;
  const [uploaded] = await Promise.all([
    ui.browser.waitForResponse(`**/storage/v1/object/upload/sign/plan-files/${planSet.tenant_id}/${planSet.id}/**`, { timeout: 60_000 }),
    ui.browser.locator("input[type='file'][accept*='pdf']").first().setInputFiles(filePath),
  ]);
  expect(uploaded.status).toBe(200);
  await expect(ui.screen.getByRole("button", "Supprimer sample-plan.pdf", { exact: true })).toBeVisible();
  const files = await readPlanFiles(ui.browser, planSet.id);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatchObject({ plan_set_id: planSet.id, file_name: "sample-plan.pdf", file_type: "application/pdf", file_size_bytes: size });
  expect((await readPlanSets(ui.browser, planSet.project_id))[0]).toMatchObject({ id: planSet.id, file_count: 1 });
  await recordEvidence(army, "plan-uploaded", { planSetId: planSet.id, status: uploaded.status, file: files[0] });
  return files[0];
}

export async function duplicateHubVersion(browser: Browser, army: ArmyState, source: OwnedEstimate) {
  const duplicated = await apiRequest<Envelope<{ version_id: string }>>(browser, "POST", `/api/estimates/${source.versionId}/duplicate`);
  expect([duplicated.status, duplicated.body.ok]).toEqual([201, true]);
  const target = { projectId: source.projectId, versionId: duplicated.body.data.version_id };
  expect(target.versionId).not.toBe(source.versionId);
  ownEstimate(army, target);
  expect((await readEstimate(browser, target.versionId)).project.id).toBe(source.projectId);
  await recordEvidence(army, "hub-duplicate", { source, target });
  return target;
}

export async function markOwnedPlansAsIntake(army: ArmyState, estimate: OwnedEstimate, planSet: PlanSet, file: PlanFile) {
  const fixture = await localTakeoffFixture(army, estimate);
  expect(planSet.tenant_id).toBe(fixture.tenantId);
  const intakeDocumentId = randomUUID();
  const setMetadata = { source: "affaire-intake", default_import_plan_set: true, intake_document_id: intakeDocumentId };
  const set = await fixture.client.from("plan_sets").update({ metadata: setMetadata })
    .eq("id", planSet.id).eq("tenant_id", fixture.tenantId).eq("project_id", estimate.projectId).select("id, metadata").single();
  if (set.error) throw new Error(`Owned intake plan metadata failed: ${set.error.code}`);
  expect(set.data.metadata).toEqual(setMetadata);
  const fileMetadata = { source: "affaire-intake", intake_document_id: intakeDocumentId,
    intake_storage_path: `e2e/intake/${file.id}.pdf` };
  const updatedFile = await fixture.client.from("plan_files").update({ metadata: fileMetadata })
    .eq("id", file.id).eq("tenant_id", fixture.tenantId).eq("plan_set_id", planSet.id).select("id, metadata").single();
  if (updatedFile.error) throw new Error(`Owned intake file metadata failed: ${updatedFile.error.code}`);
  expect(updatedFile.data.metadata).toEqual(fileMetadata);
  await recordEvidence(army, "intake-plan-fixture", { estimate, planSetId: planSet.id, fileId: file.id, intakeDocumentId, setMetadata, fileMetadata,
    fixtureBoundary: "Synthetic intake provenance on a real uploaded plan, matching the historical UI fixture." });
}

export function ownedTakeoffJobs(browser: Browser, estimate: OwnedEstimate) {
  type Job = { id: string; estimate_version_id: string; level: string; source_file_name: string; status: string };
  const list = async () => {
    const response = await apiRequest<Envelope<{ jobs: Job[] }>>(browser, "GET", `/api/takeoff/jobs?estimate_version_id=${estimate.versionId}`);
    expect([response.status, response.body.ok]).toEqual([200, true]);
    return response.body.data.jobs.map(({ id, estimate_version_id, level, source_file_name, status }) =>
      ({ id, estimate_version_id, level, source_file_name, status }));
  };
  const cancel = async () => {
    for (const job of await list()) {
      expect(job.estimate_version_id).toBe(estimate.versionId);
      if (!["pending", "processing"].includes(job.status)) continue;
      const response = await apiRequest<Envelope<{ job: Job }>>(browser, "POST", `/api/takeoff/jobs/${job.id}/cancel`);
      if (response.status === 409) {
        expect((await list()).find((current) => current.id === job.id)?.status).toMatch(/^(completed|failed|canceled)$/);
      } else {
        expect([response.status, response.body.ok, response.body.data.job.status]).toEqual([200, true, "canceled"]);
      }
    }
  };
  return { list, cancel };
}
