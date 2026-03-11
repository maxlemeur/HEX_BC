import { randomUUID } from "node:crypto";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

loadEnvConfig(path.resolve(__dirname, "../.."));

import {
  buildEstimateName,
  createEstimateViaWizard,
  duplicateEstimateViaApi,
  loginWithUi,
} from "./helpers";

function envOrThrow(name: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  throw new Error(`Missing required env var: ${name}`);
}

let supabaseClient: SupabaseClient | null = null;

async function getAuthenticatedSupabaseClient(): Promise<SupabaseClient> {
  if (supabaseClient) return supabaseClient;

  const url = envOrThrow("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey =
    process.env.E2E_SUPABASE_SERVICE_ROLE_KEY?.trim() ??
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (serviceRoleKey) {
    supabaseClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return supabaseClient;
  }

  const anonKey = envOrThrow("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const email = envOrThrow("E2E_LOGIN_EMAIL");
  const password = envOrThrow("E2E_LOGIN_PASSWORD");

  supabaseClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Supabase sign-in failed: ${error.message}`);
  }

  return supabaseClient;
}

async function extractProjectId(page: Page, versionId: string) {
  const response = await page.request.get(`/api/estimates/${versionId}`, {
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as {
    data?: { version?: { project_id?: string }; project_id?: string };
    project_id?: string;
  };

  const projectId =
    payload.data?.version?.project_id ??
    payload.data?.project_id ??
    payload.project_id ??
    null;

  expect(projectId, "project_id should be present in estimate version response").toBeTruthy();
  return projectId as string;
}

async function getTenantIdForVersion(versionId: string) {
  const sb = await getAuthenticatedSupabaseClient();
  const { data, error } = await sb
    .from("estimate_versions")
    .select("tenant_id")
    .eq("id", versionId)
    .single();

  if (error) {
    throw new Error(`Cannot resolve tenant for version: ${error.message}`);
  }

  const tenantId = (data as { tenant_id?: string }).tenant_id;
  if (!tenantId) {
    throw new Error("Missing tenant_id for version.");
  }

  return tenantId;
}

async function seedPlanSetWithFile(input: {
  projectId: string;
  versionId: string;
  tenantId: string;
  planSetName: string;
  fileName: string;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const planSetId = randomUUID();

  const { error: planSetError } = await sb.from("plan_sets").insert({
    id: planSetId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    estimate_version_id: input.versionId,
    name: input.planSetName,
    description: "E2E reprise affaire-first",
  });

  if (planSetError) {
    throw new Error(`Seed plan set failed: ${planSetError.message}`);
  }

  const { error: fileError } = await sb.from("plan_files").insert({
    id: randomUUID(),
    tenant_id: input.tenantId,
    plan_set_id: planSetId,
    file_path: `e2e/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`,
    file_name: input.fileName,
    file_type: "application/pdf",
    file_size_bytes: 183_500,
    page_count: 2,
  });

  if (fileError) {
    throw new Error(`Seed plan file failed: ${fileError.message}`);
  }

  return { planSetId };
}

async function seedTakeoffJob(input: {
  versionId: string;
  tenantId: string;
  sourceFileName: string;
  status: "completed" | "failed" | "processing";
  level?: "A" | "B" | "C";
  processingStrategy?: "sync" | "batch";
  providerBatchState?:
    | "submitted"
    | "pending"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "expired"
    | "unknown"
    | null;
  retryCount?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  createResult?: boolean;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const nowIso = new Date().toISOString();
  const jobId = randomUUID();

  const { error: jobError } = await sb.from("takeoff_jobs").insert({
    id: jobId,
    tenant_id: input.tenantId,
    estimate_version_id: input.versionId,
    level: input.level ?? "A",
    status: input.status,
    processing_strategy: input.processingStrategy ?? "sync",
    provider_batch_state: input.providerBatchState ?? null,
    provider_batch_id:
      input.providerBatchState && input.providerBatchState !== "unknown"
        ? randomUUID()
        : null,
    source_file_name: input.sourceFileName,
    source_file_type: "application/pdf",
    source_file_size_bytes: 2048,
    schema_version: "v1",
    retry_count: input.retryCount ?? 0,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ?? null,
    started_at: nowIso,
    completed_at: input.status === "processing" ? null : nowIso,
  });

  if (jobError) {
    throw new Error(`Seed takeoff job failed: ${jobError.message}`);
  }

  if (input.createResult) {
    const resultId = randomUUID();

    const { error: resultError } = await sb.from("takeoff_results").insert({
      id: resultId,
      tenant_id: input.tenantId,
      job_id: jobId,
      extracted_json: {},
      warnings: [],
      tables: [],
    });

    if (resultError) {
      throw new Error(`Seed takeoff result failed: ${resultError.message}`);
    }

    const { error: itemError } = await sb.from("takeoff_items").insert({
      id: randomUUID(),
      tenant_id: input.tenantId,
      job_id: jobId,
      result_id: resultId,
      designation: "Tube cuivre 18",
      quantity: 12,
      unit: "u",
      confidence: 0.96,
      evidence: "preuve e2e",
      source_file_name: input.sourceFileName,
      source_page: 1,
      metadata: {},
      is_excluded: false,
      is_verified: false,
    });

    if (itemError) {
      throw new Error(`Seed takeoff item failed: ${itemError.message}`);
    }
  }

  return { jobId };
}

async function seedVersionLink(input: {
  tenantId: string;
  jobId: string;
  sourceVersionId: string;
  targetVersionId: string;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const { error } = await sb.from("takeoff_version_links").insert({
    id: randomUUID(),
    tenant_id: input.tenantId,
    takeoff_job_id: input.jobId,
    source_version_id: input.sourceVersionId,
    target_version_id: input.targetVersionId,
  });

  if (error) {
    throw new Error(`Seed takeoff version link failed: ${error.message}`);
  }
}

async function openPlansSection(page: Page, projectId: string) {
  await page.goto(`/dashboard/affaires/${projectId}`);

  const plansSection = page
    .locator("section")
    .filter({ hasText: "Plans, preuves & exceptions" });
  await expect(plansSection).toBeVisible();
  return plansSection;
}

test.describe("US-6.2 - reprise apres attente, erreur ou echec partiel", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithUi(page);
  });

  test("conserve les statuts acquis et renvoie vers la bonne etape apres un echec partiel", async ({
    page,
  }) => {
    const sourceFileName = "us62-partial-recovery.pdf";
    const { versionId: sourceVersionId } = await createEstimateViaWizard(page, {
      projectName: buildEstimateName("US62-PARTIAL"),
      title: "US-6.2 Reprise partielle",
    });
    const projectId = await extractProjectId(page, sourceVersionId);
    const targetVersionId = await duplicateEstimateViaApi(page, sourceVersionId);
    const tenantId = await getTenantIdForVersion(sourceVersionId);

    await seedPlanSetWithFile({
      projectId,
      versionId: targetVersionId,
      tenantId,
      planSetName: "Plans reprise partielle",
      fileName: sourceFileName,
    });

    const { jobId: acquiredJobId } = await seedTakeoffJob({
      versionId: sourceVersionId,
      tenantId,
      sourceFileName,
      status: "completed",
      createResult: true,
    });

    await seedVersionLink({
      tenantId,
      jobId: acquiredJobId,
      sourceVersionId,
      targetVersionId,
    });

    await seedTakeoffJob({
      versionId: targetVersionId,
      tenantId,
      sourceFileName,
      status: "failed",
      retryCount: 1,
      errorCode: "AI_TIMEOUT",
      errorMessage: "E2E partial failure",
    });

    const plansSection = await openPlansSection(page, projectId);

    await expect(plansSection.getByText("Reprise apres echec partiel")).toBeVisible();
    await expect(
      plansSection.getByText(
        "Les analyses deja acquises restent visibles. Corrigez ou relancez uniquement la reprise en echec."
      )
    ).toBeVisible();
    await expect(plansSection.getByText("1 acquis")).toBeVisible();
    await expect(plansSection.getByText("0 en attente")).toBeVisible();
    await expect(plansSection.getByText("1 a corriger")).toBeVisible();
    await expect(plansSection.getByText("V2")).toBeVisible();
    await expect(plansSection.getByText("Echec a corriger")).toBeVisible();
    await expect(plansSection.getByText("V1")).toBeVisible();
    await expect(plansSection.getByText("Analyse terminee")).toBeVisible();

    const resumeLink = plansSection.getByRole("link", { name: "Reprendre l'analyse" });
    await expect(resumeLink).toHaveAttribute(
      "href",
      `/dashboard/affaires/${projectId}/takeoff`
    );

    await resumeLink.click();
    await expect(page).toHaveURL(`/dashboard/affaires/${projectId}/takeoff`);
  });

  test("garde la reprise lisible pendant l'attente et permet de suivre seulement ce qui manque", async ({
    page,
  }) => {
    const sourceFileName = "us62-pending-recovery.pdf";
    const { versionId: sourceVersionId } = await createEstimateViaWizard(page, {
      projectName: buildEstimateName("US62-PENDING"),
      title: "US-6.2 Reprise en attente",
    });
    const projectId = await extractProjectId(page, sourceVersionId);
    const targetVersionId = await duplicateEstimateViaApi(page, sourceVersionId);
    const tenantId = await getTenantIdForVersion(sourceVersionId);

    await seedPlanSetWithFile({
      projectId,
      versionId: targetVersionId,
      tenantId,
      planSetName: "Plans reprise en attente",
      fileName: sourceFileName,
    });

    const { jobId: acquiredJobId } = await seedTakeoffJob({
      versionId: sourceVersionId,
      tenantId,
      sourceFileName,
      status: "completed",
      createResult: true,
    });

    await seedVersionLink({
      tenantId,
      jobId: acquiredJobId,
      sourceVersionId,
      targetVersionId,
    });

    await seedTakeoffJob({
      versionId: targetVersionId,
      tenantId,
      sourceFileName,
      status: "processing",
      processingStrategy: "batch",
      providerBatchState: "pending",
      retryCount: 2,
    });

    const plansSection = await openPlansSection(page, projectId);

    await expect(plansSection.getByText("Reprise en attente")).toBeVisible();
    await expect(
      plansSection.getByText(
        "Les resultats deja acquis restent disponibles pendant l'attente. Revenez ici pour suivre ou relancer seulement ce qui manque."
      )
    ).toBeVisible();
    await expect(plansSection.getByText("1 acquis")).toBeVisible();
    await expect(plansSection.getByText("1 en attente")).toBeVisible();
    await expect(plansSection.getByText("0 a corriger")).toBeVisible();
    await expect(plansSection.getByText("V2")).toBeVisible();
    await expect(plansSection.getByText("En attente provider")).toBeVisible();
    await expect(plansSection.getByText("V1")).toBeVisible();
    await expect(plansSection.getByText("Analyse terminee")).toBeVisible();

    const followLink = plansSection.getByRole("link", { name: "Suivre la reprise" });
    await expect(followLink).toHaveAttribute(
      "href",
      `/dashboard/affaires/${projectId}/takeoff`
    );

    await followLink.click();
    await expect(page).toHaveURL(`/dashboard/affaires/${projectId}/takeoff`);
  });
});
