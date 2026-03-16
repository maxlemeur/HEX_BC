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

  test("hub affaire sans plans — la section plans reste masquee tant qu'aucun jeu n'est disponible", async ({ page }) => {
    const { versionId } = await createEstimateViaWizard(page, {
      projectName: buildEstimateName("V3005-NOPLAN"),
      title: "V3-005 Hub sans plans",
    });
    const projectId = await extractProjectId(page, versionId);

    await page.goto(`/dashboard/affaires/${projectId}`);

    await expect(
      page.getByRole("heading", { name: "Plans, preuves & exceptions" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Analyser les plans" })
    ).toHaveCount(0);
  });

  test("hub affaire avec plans — the launch hero targets the seeded plan set and version", async ({ page }) => {
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

    const launchHero = page.getByRole("region", {
      name: "Proposition d'analyse automatique",
    });
    await expect(launchHero).toBeVisible();
    await expect(launchHero.getByText("Jeu de plans : Lot CVC (1 fichier)")).toBeVisible();
    await expect(launchHero.getByText("Version cible :")).toBeVisible();
    await expect(launchHero.getByText("V1 (brouillon)")).toBeVisible();
    await expect(
      launchHero.getByRole("button", { name: "Analyser maintenant" })
    ).toBeVisible();
  });

  test("hub affaire carry-over — contextual exceptions action targets the current linked version", async ({
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

    const exceptionsButton = page.getByRole("button", {
      name: "Voir les 1 exception",
    });
    await expect(exceptionsButton).toBeVisible();
    await exceptionsButton.click();

    await expect(page).toHaveURL(
      `/dashboard/affaires/${projectId}/takeoff/${jobId}/review?versionId=${targetVersionId}&view=dpgf&dpgfView=exceptions_only`
    );
  });
});
