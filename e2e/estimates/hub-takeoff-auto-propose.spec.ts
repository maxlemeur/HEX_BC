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

async function seedIntakeSyncedPlanSet(input: {
  projectId: string;
  tenantId: string;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const planSetId = randomUUID();
  const planFileId = randomUUID();

  const { error: setError } = await sb.from("plan_sets").insert({
    id: planSetId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    estimate_version_id: null,
    name: "Plans synchronises dossier",
    description: "Jeu de plans cree automatiquement depuis le dossier affaire",
    metadata: {
      source: "affaire-intake",
      default_import_plan_set: true,
      intake_document_id: randomUUID(),
    },
  });
  if (setError) {
    throw new Error(`Cannot create intake-synced plan set: ${setError.message}`);
  }

  const { error: fileError } = await sb.from("plan_files").insert({
    id: planFileId,
    tenant_id: input.tenantId,
    plan_set_id: planSetId,
    file_path: `e2e/${planSetId}/plan-synchronise.pdf`,
    file_name: "plan-synchronise.pdf",
    file_type: "application/pdf",
    file_size_bytes: 245_760,
    page_count: 2,
    metadata: {
      source: "affaire-intake",
      intake_document_id: randomUUID(),
      intake_storage_path: `e2e/intake/${planFileId}.pdf`,
    },
  });
  if (fileError) {
    throw new Error(`Cannot create intake-synced plan file: ${fileError.message}`);
  }

  return { planSetId };
}

async function openHubWithPrompt(page: Page) {
  const { versionId } = await createEstimateViaWizard(page, {
    projectName: buildEstimateName("V3014-HUB"),
    title: "V3-014 Hub auto-propose",
  });
  const projectId = await extractProjectId(page, versionId);
  const tenantId = await getTenantIdForVersion(versionId);

  await seedIntakeSyncedPlanSet({
    projectId,
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

async function openLaunchDialog(page: Page) {
  const dialog = page.getByRole("dialog");
  const promptLaunchButton = page
    .getByRole("region", { name: "Proposition d'analyse automatique" })
    .getByRole("button", { name: "Lancer maintenant" });
  const manualLaunchButton = page
    .locator("section")
    .filter({ hasText: "Plans, preuves & exceptions" })
    .getByRole("button", { name: "Analyser les plans" });

  if (await promptLaunchButton.isVisible().catch(() => false)) {
    await promptLaunchButton.click();
  } else {
    await manualLaunchButton.click();
  }

  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
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

  test("hub and launch dialog keep an intake-synced plan set understandable for affaire-first launch", async ({
    page,
  }) => {
    const { plansSection } = await openHubWithPrompt(page);

    await expect(plansSection.getByRole("button", { name: "Analyser les plans" })).toBeVisible();

    const provenanceSignals = [
      /synchronis/i,
      /depuis le dossier/i,
      /sans reupload/i,
      /affaire-intake/i,
    ];
    const hasHubProvenanceSignal = await Promise.any(
      provenanceSignals.map(async (pattern) => {
        const locator = plansSection.getByText(pattern);
        await expect(locator.first()).toBeVisible({ timeout: 1_500 });
        return true;
      }),
    ).catch(() => false);

    expect(
      hasHubProvenanceSignal,
      "The hub should explain provenance or no-reupload behavior for an intake-synced plan set."
    ).toBe(true);

    const dialog = await openLaunchDialog(page);
    await expect(dialog.getByText("Jeu de plans retenu")).toBeVisible();
    await expect(dialog.getByText(/Plans synchronises dossier|plan-synchronise\.pdf/i)).toBeVisible();

    const hasDialogProvenanceSignal = await Promise.any(
      provenanceSignals.map(async (pattern) => {
        const locator = dialog.getByText(pattern);
        await expect(locator.first()).toBeVisible({ timeout: 1_500 });
        return true;
      }),
    ).catch(() => false);

    expect(
      hasDialogProvenanceSignal,
      "The launch dialog should keep provenance or eligibility messaging visible."
    ).toBe(true);

    await expect(dialog.getByRole("combobox", { name: /Version cible/i })).toBeVisible();
    await expect(dialog.getByText("Niveau d'analyse")).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Standard" })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Detaille" })).toBeVisible();
  });

  test("launch dialog supports explicit target-version selection when the shell exposes it", async ({
    page,
  }) => {
    const { versionId } = await openHubWithPrompt(page);
    await duplicateEstimateViaApi(page, versionId);

    await page.reload({ waitUntil: "domcontentloaded" });

    const dialog = await openLaunchDialog(page);
    const versionSelector = dialog.getByRole("combobox", { name: /Version cible/i });
    await expect(versionSelector).toBeVisible();
    if (await versionSelector.isVisible().catch(() => false)) {
      const options = await versionSelector.locator("option").allTextContents();
      expect(
        options.length,
        "The version selector should expose at least two candidate targets once another version exists."
      ).toBeGreaterThan(1);

      const nonDraftOption =
        options.find((label) => /^V\d+$/i.test(label.trim())) ??
        options.find((label) => /nouveau brouillon/i.test(label)) ??
        null;

      if (nonDraftOption) {
        await versionSelector.selectOption({ label: nonDraftOption });
        await expect(
          dialog.getByRole("button", { name: /Creer un brouillon et analyser/i })
        ).toBeVisible();
      }
    } else {
      await expect(
        dialog.getByText(/V\d+ \(brouillon\)|Nouveau brouillon depuis V\d+/i)
      ).toBeVisible();
    }
  });
});
