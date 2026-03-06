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
  const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY?.trim();

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
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
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
  name: string;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const planSetId = randomUUID();

  const { error: setError } = await sb.from("plan_sets").insert({
    id: planSetId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    estimate_version_id: input.versionId,
    name: input.name,
    description: "E2E seeded plan set",
  });

  if (setError) {
    throw new Error(`Seed plan set failed: ${setError.message}`);
  }

  const { error: fileError } = await sb.from("plan_files").insert({
    id: randomUUID(),
    tenant_id: input.tenantId,
    plan_set_id: planSetId,
    file_path: `e2e/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`,
    file_name: "e2e-plan.pdf",
    file_type: "application/pdf",
    file_size_bytes: 245760,
    page_count: 2,
  });

  if (fileError) {
    throw new Error(`Seed plan file failed: ${fileError.message}`);
  }
}

async function seedCompletedTakeoffJob(input: {
  versionId: string;
  tenantId: string;
  sourceFileName: string;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const nowIso = new Date().toISOString();
  const jobId = randomUUID();
  const resultId = randomUUID();

  const { error: jobError } = await sb.from("takeoff_jobs").insert({
    id: jobId,
    tenant_id: input.tenantId,
    estimate_version_id: input.versionId,
    level: "A",
    status: "completed",
    source_file_name: input.sourceFileName,
    source_file_type: "application/pdf",
    source_file_size_bytes: 1024,
    schema_version: "v1",
    started_at: nowIso,
    completed_at: nowIso,
  });

  if (jobError) {
    throw new Error(`Seed takeoff job failed: ${jobError.message}`);
  }

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
    designation: "Reserve technique inutile",
    quantity: 4,
    unit: "u",
    confidence: 0.94,
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

test.describe("V3-005 — Plans, preuves & exceptions dans le hub affaire", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithUi(page);
  });

  test("hub affaire sans plans — empty state dismissable", async ({ page }) => {
    const { versionId } = await createEstimateViaWizard(page, {
      projectName: buildEstimateName("V3005-NOPLAN"),
      title: "V3-005 Hub sans plans",
    });
    const projectId = await extractProjectId(page, versionId);

    await page.goto(`/dashboard/affaires/${projectId}`);

    const plansSection = page
      .locator("section")
      .filter({ hasText: "Plans, preuves & exceptions" });
    await expect(plansSection).toBeVisible();

    await expect(
      plansSection.getByText("Importez vos plans pour lancer l'analyse")
    ).toBeVisible();
    await expect(
      plansSection.getByRole("link", { name: "Ajouter les plans" })
    ).toHaveAttribute("href", `/dashboard/affaires/${projectId}/plans`);

    await plansSection.getByRole("button", { name: "Continuer sans plans" }).click();
    await expect(plansSection).toBeHidden();
  });

  test("hub affaire avec plans — card title and actions are updated", async ({ page }) => {
    const { versionId } = await createEstimateViaWizard(page, {
      projectName: buildEstimateName("V3005-PLANS"),
      title: "V3-005 Hub avec plans",
    });
    const projectId = await extractProjectId(page, versionId);
    const tenantId = await getTenantIdForVersion(versionId);

    await seedPlanSetWithFile({
      projectId,
      versionId,
      tenantId,
      name: "Lot CVC",
    });

    await page.goto(`/dashboard/affaires/${projectId}`);

    const plansSection = page
      .locator("section")
      .filter({ hasText: "Plans, preuves & exceptions" });
    await expect(plansSection).toBeVisible();

    await expect(plansSection.getByText(/1 jeu/i)).toBeVisible();
    await expect(plansSection.getByText(/1 fichier/i)).toBeVisible();
    await expect(
      plansSection.getByRole("link", { name: "Voir les plans" })
    ).toHaveAttribute("href", `/dashboard/affaires/${projectId}/plans`);
    await expect(
      plansSection.getByRole("button", { name: "Analyser les plans" })
    ).toBeVisible();
  });

  test("hub affaire carry-over — exceptions link targets the current linked version", async ({
    page,
  }) => {
    const { versionId: sourceVersionId } = await createEstimateViaWizard(page, {
      projectName: buildEstimateName("V3005-CARRY"),
      title: "V3-005 Hub carry-over",
    });
    const projectId = await extractProjectId(page, sourceVersionId);
    const targetVersionId = await duplicateEstimateViaApi(page, sourceVersionId);
    const tenantId = await getTenantIdForVersion(sourceVersionId);

    await seedPlanSetWithFile({
      projectId,
      versionId: targetVersionId,
      tenantId,
      name: "Plans carry-over",
    });

    const { jobId } = await seedCompletedTakeoffJob({
      versionId: sourceVersionId,
      tenantId,
      sourceFileName: "carry-over.pdf",
    });

    await seedVersionLink({
      tenantId,
      jobId,
      sourceVersionId,
      targetVersionId,
    });

    await page.goto(`/dashboard/affaires/${projectId}`);

    await expect(
      page.getByRole("link", { name: /Version 2 .*Courante/i })
    ).toBeVisible();

    const plansSection = page
      .locator("section")
      .filter({ hasText: "Plans, preuves & exceptions" });
    await expect(plansSection).toBeVisible();

    const exceptionsLink = plansSection.getByRole("link", {
      name: "Voir les exceptions",
    });
    await expect(exceptionsLink).toHaveAttribute(
      "href",
      `/dashboard/affaires/${projectId}/takeoff/${jobId}/review?versionId=${targetVersionId}&view=dpgf&dpgfView=exceptions_only`
    );
  });
});
