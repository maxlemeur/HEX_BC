import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

loadEnvConfig(path.resolve(__dirname, "../.."));

import { buildEstimateName, createEstimateViaWizard, loginWithUi } from "./helpers";

const SAMPLE_PLAN_PDF = path.join(__dirname, "../fixtures/sample-plan.pdf");

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

function hasDefaultImportPlanSetMarker(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }

  const record = metadata as Record<string, unknown>;
  return record.default_import_plan_set === true;
}

async function resolveAutoPromptPlanSetId(input: {
  projectId: string;
  versionId: string;
  tenantId: string;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const { data, error } = await sb
    .from("plan_sets")
    .select("id, name, metadata, estimate_version_id, updated_at")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Cannot load plan sets: ${error.message}`);
  }

  const planSets = (data ?? []) as Array<{
    id: string;
    name: string;
    metadata: unknown;
    estimate_version_id: string | null;
    updated_at: string;
  }>;

  const versionScopedMarked =
    planSets.find(
      (planSet) =>
        planSet.estimate_version_id === input.versionId &&
        hasDefaultImportPlanSetMarker(planSet.metadata),
    ) ?? null;
  if (versionScopedMarked) {
    return versionScopedMarked.id;
  }

  const projectScopedMarked =
    planSets.find(
      (planSet) =>
        planSet.estimate_version_id === null &&
        hasDefaultImportPlanSetMarker(planSet.metadata),
    ) ?? null;
  if (projectScopedMarked) {
    return projectScopedMarked.id;
  }

  if (planSets.length > 0) {
    return planSets[0].id;
  }

  const planSetId = randomUUID();
  const { error: insertError } = await sb.from("plan_sets").insert({
    id: planSetId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    estimate_version_id: input.versionId,
    name: "Plans import",
    metadata: {
      source: "import-flow",
      default_import_plan_set: true,
    },
  });

  if (insertError) {
    throw new Error(`Cannot create fallback plan set: ${insertError.message}`);
  }

  return planSetId;
}

async function seedAutoPromptPlanFile(input: {
  page: Page;
  projectId: string;
  versionId: string;
  tenantId: string;
}) {
  const planSetId = await resolveAutoPromptPlanSetId(input);
  const fileBuffer = fs.readFileSync(SAMPLE_PLAN_PDF);
  const registerResponse = await input.page.request.post(
    `/api/takeoff/plan-sets/${planSetId}/files`,
    {
      failOnStatusCode: false,
      headers: {
        "Content-Type": "application/json",
      },
      data: {
        file_name: "sample-plan.pdf",
        file_type: "application/pdf",
        file_size_bytes: fileBuffer.byteLength,
      },
    },
  );
  const registerBody = await registerResponse.text();
  expect(
    registerResponse.status(),
    `Plan file registration failed. status=${registerResponse.status()} body=${registerBody}`,
  ).toBe(201);

  const registerPayload = JSON.parse(registerBody) as {
    data?: {
      signed_upload?: {
        url?: string;
      };
    };
  };
  const signedUploadUrl = registerPayload.data?.signed_upload?.url ?? null;
  if (!signedUploadUrl) {
    throw new Error(`Missing signed upload URL in response: ${registerBody}`);
  }

  const uploadResponse = await input.page.request.fetch(signedUploadUrl, {
    method: "PUT",
    failOnStatusCode: false,
    headers: {
      "Content-Type": "application/pdf",
    },
    data: fileBuffer,
  });
  expect(
    uploadResponse.status(),
    `Plan file upload failed. status=${uploadResponse.status()} body=${await uploadResponse.text()}`,
  ).toBe(200);

  return { planSetId };
}

async function openHubWithPrompt(page: Page) {
  const { versionId } = await createEstimateViaWizard(page, {
    projectName: buildEstimateName("V3014-HUB"),
    title: "V3-014 Hub auto-propose",
  });
  const projectId = await extractProjectId(page, versionId);
  const tenantId = await getTenantIdForVersion(versionId);

  await seedAutoPromptPlanFile({
    page,
    projectId,
    versionId,
    tenantId,
  });

  await page.goto(`/dashboard/affaires/${projectId}`, {
    waitUntil: "domcontentloaded",
  });

  const prompt = page.getByRole("region", {
    name: "Proposition d'analyse automatique",
  });
  await expect(prompt).toBeVisible({ timeout: 15_000 });

  const plansSection = page
    .locator("section")
    .filter({ hasText: "Plans, preuves & exceptions" });
  await expect(plansSection).toBeVisible();
  await expect(
    plansSection.getByRole("button", { name: "Analyser les plans" }),
  ).toBeVisible();

  return { projectId, versionId, prompt, plansSection };
}

test.describe("V3-014 — Auto-proposition metre", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithUi(page);
  });

  test("hub prompt can be dismissed temporarily and comes back after reload", async ({
    page,
  }) => {
    const { prompt, plansSection } = await openHubWithPrompt(page);

    await prompt.getByRole("button", { name: "Plus tard" }).click();
    await expect(prompt).toBeHidden();
    await expect(
      plansSection.getByRole("button", { name: "Analyser les plans" }),
    ).toBeVisible();

    await page.reload();

    const promptAfterReload = page.getByRole("region", {
      name: "Proposition d'analyse automatique",
    });
    await expect(promptAfterReload).toBeVisible({ timeout: 15_000 });
  });

  test("hub prompt can be dismissed permanently without hiding the manual CTA", async ({
    page,
  }) => {
    const { prompt, plansSection } = await openHubWithPrompt(page);

    await prompt
      .getByRole("button", { name: "Ne plus proposer sur cette affaire" })
      .click();
    await expect(prompt).toBeHidden();
    await expect(
      plansSection.getByRole("button", { name: "Analyser les plans" }),
    ).toBeVisible();

    await page.reload();

    await expect(
      page.getByRole("region", { name: "Proposition d'analyse automatique" }),
    ).toBeHidden();
    await expect(
      plansSection.getByRole("button", { name: "Analyser les plans" }),
    ).toBeVisible();
  });

  test("hub prompt launches a first takeoff job from the plan set and hides on reload", async ({
    page,
  }) => {
    const { projectId, prompt, plansSection } = await openHubWithPrompt(page);

    await prompt.getByRole("button", { name: "Lancer maintenant" }).click();

    await expect(
      page.getByRole("status").getByText("Analyse lancee", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(prompt).toBeHidden({ timeout: 15_000 });
    await expect(
      plansSection.getByRole("button", { name: "Analyser les plans" }),
    ).toBeVisible();
    await expect(
      plansSection.getByText(/Analyse en attente|Analyse en cours/i),
    ).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(
      page.getByRole("region", { name: "Proposition d'analyse automatique" }),
    ).toBeHidden();

    await page.goto(`/dashboard/affaires/${projectId}/takeoff`);
    await expect(page).toHaveURL(new RegExp(`/dashboard/affaires/${projectId}/takeoff`));
    await expect(page.getByText(/Jobs|Centre d'activite|Activite/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});
