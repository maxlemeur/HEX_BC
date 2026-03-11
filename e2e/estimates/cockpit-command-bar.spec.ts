import { randomUUID } from "node:crypto";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

loadEnvConfig(path.resolve(__dirname, "../.."));

import {
  buildEstimateName,
  createEstimateViaWizard,
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

async function extractProjectContext(projectId: string) {
  const sb = await getAuthenticatedSupabaseClient();
  const { data, error } = await sb
    .from("estimate_projects")
    .select("tenant_id")
    .eq("id", projectId)
    .single();

  if (error) {
    throw new Error(`Cannot resolve project context: ${error.message}`);
  }

  const tenantId = (data as { tenant_id?: string }).tenant_id;
  if (!tenantId) {
    throw new Error("Missing tenant_id for project.");
  }

  return { tenantId };
}

async function seedReviewIntakeDocument(input: {
  projectId: string;
  tenantId: string;
  fileName?: string;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const uploadId = randomUUID();
  const documentId = randomUUID();
  const nowIso = new Date().toISOString();
  const fileName = input.fileName ?? "piece-a-revoir.pdf";

  const { error: uploadError } = await sb.from("affaire_intake_uploads").insert({
    id: uploadId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    status: "ready",
    completed_at: nowIso,
  });

  if (uploadError) {
    throw new Error(`Seed intake upload failed: ${uploadError.message}`);
  }

  const { error: documentError } = await sb.from("affaire_intake_documents").insert({
    id: documentId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    upload_id: uploadId,
    storage_path: `e2e/intake/${documentId}.pdf`,
    file_name: fileName,
    mime_type: "application/pdf",
    size_bytes: 1_024,
    upload_status: "uploaded",
    classification_status: "ambiguous",
    document_kind: "a_classer",
    confidence: 0.42,
    issues: ["Faible confiance"],
    extracted_metadata: {
      projectName: null,
      clientName: null,
      deadlineAt: null,
      detectedLots: [],
      detectedVariants: [],
    },
    classification_source: "ai",
    classified_at: nowIso,
  });

  if (documentError) {
    throw new Error(`Seed intake document failed: ${documentError.message}`);
  }

  return { uploadId, documentId, fileName };
}

async function seedEstimateLine(input: {
  tenantId: string;
  versionId: string;
  title?: string;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const sectionId = randomUUID();
  const lineId = randomUUID();

  const { error } = await sb.from("estimate_items").insert(
    [
      {
        id: sectionId,
        tenant_id: input.tenantId,
        version_id: input.versionId,
        item_type: "section",
        position: 0,
        title: "Section cockpit",
        description: null,
        quantity: null,
        unit_price_ht_cents: null,
        tax_rate_bp: null,
        k_fo: null,
        h_mo: null,
        h_mo_majoration: 1,
        k_mo: null,
        h_mo_atelier: null,
        k_mo_atelier: 1,
        labor_role_atelier_id: null,
        h_mo_chantier: null,
        k_mo_chantier: 1,
        labor_role_chantier_id: null,
        pu_ht_cents: null,
        labor_role_id: null,
        category_id: null,
        supply_type_id: null,
        selected_supplier_price_id: null,
        line_total_ht_cents: null,
        line_tax_cents: null,
        line_total_ttc_cents: null,
      },
      {
        id: lineId,
        tenant_id: input.tenantId,
        version_id: input.versionId,
        parent_id: sectionId,
        item_type: "line",
        position: 1,
        title: input.title ?? "Ligne cockpit",
        description: "u",
        quantity: 1,
        unit_price_ht_cents: 1_500,
        tax_rate_bp: 2000,
        k_fo: 1,
        h_mo: 0,
        h_mo_majoration: 1,
        k_mo: 1,
        h_mo_atelier: null,
        k_mo_atelier: 1,
        labor_role_atelier_id: null,
        h_mo_chantier: null,
        k_mo_chantier: 1,
        labor_role_chantier_id: null,
        pu_ht_cents: 1_500,
        labor_role_id: null,
        category_id: null,
        supply_type_id: null,
        selected_supplier_price_id: null,
        line_total_ht_cents: 1_500,
        line_tax_cents: 300,
        line_total_ttc_cents: 1_800,
      },
    ] as never
  );

  if (error) {
    throw new Error(`Seed estimate line failed: ${error.message}`);
  }

  return { lineId };
}

async function seedPendingBrief(input: {
  projectId: string;
  tenantId: string;
  uploadId: string;
  sourceDocumentId: string;
  sourceFileName: string;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const briefId = randomUUID();
  const nowIso = new Date().toISOString();

  const { error: briefError } = await sb.from("affaire_briefs").insert({
    id: briefId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    upload_id: input.uploadId,
    status: "a_confirmer",
    summary: "Brief E2E a confirmer",
    project_object: "Construction d'un local technique",
    scope: ["Lot GO"],
    lots: ["GO"],
    received_pieces: [input.sourceFileName],
    assumptions: ["Acces chantier standard"],
    vigilance_points: ["Verifier les interfaces"],
    missing_elements: [],
    generation_metadata: {},
    last_generated_at: nowIso,
  });

  if (briefError) {
    throw new Error(`Seed affaire brief failed: ${briefError.message}`);
  }

  const { error: sourceError } = await sb.from("affaire_brief_source_links").insert({
    id: randomUUID(),
    tenant_id: input.tenantId,
    project_id: input.projectId,
    brief_id: briefId,
    source_document_id: input.sourceDocumentId,
    block_key: "summary",
    entry_index: 0,
    source_file_name: input.sourceFileName,
  });

  if (sourceError) {
    throw new Error(`Seed affaire brief source failed: ${sourceError.message}`);
  }
}

async function openCommandPalette(page: Page) {
  await page.mouse.click(20, 20);
  if (process.platform === "darwin") {
    await page.keyboard.down("Meta");
    await page.keyboard.press("k");
    await page.keyboard.up("Meta");
  } else {
    await page.keyboard.down("Control");
    await page.keyboard.press("k");
    await page.keyboard.up("Control");
  }
  const dialog = page.getByRole("dialog", { name: /Recherche rapide/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function readPreviewText(page: Page) {
  const dialogs = page.getByRole("dialog");
  const count = await dialogs.count();
  expect(count).toBeGreaterThan(0);
  const preview = dialogs.nth(count - 1);
  await expect(preview).toBeVisible();
  return (await preview.innerText()).trim();
}

async function closePreview(page: Page) {
  const dialogs = page.getByRole("dialog");
  const count = await dialogs.count();
  expect(count).toBeGreaterThan(0);
  const preview = dialogs.nth(count - 1);
  await preview.getByRole("button", { name: /Annuler/i }).click();
}

async function clickCockpitAction(page: Page, label: string) {
  const inlineAction = page.locator(".cockpit-command-strip button", {
    hasText: label,
  });
  if (await inlineAction.isVisible().catch(() => false)) {
    await inlineAction.click();
    return;
  }

  const overflowToggle = page
    .locator(".cockpit-command-strip button")
    .filter({ hasText: /^\+\d+ autre/ })
    .first();
  await expect(overflowToggle).toBeVisible();
  await overflowToggle.click();
  await page.getByRole("button", { name: label, exact: true }).click();
}

test.describe("EST-374 — Command bar contextuelle du cockpit affaire", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithUi(page);
  });

  test("ouvre le meme preview Prepare validation depuis le strip inline et Ctrl+K", async ({
    page,
  }) => {
    const { versionId } = await createEstimateViaWizard(page, {
      projectName: buildEstimateName("EST374-PREVIEW"),
      title: "EST-374 Preview",
    });
    const projectId = await extractProjectId(page, versionId);
    const { tenantId } = await extractProjectContext(projectId);
    await seedEstimateLine({
      tenantId,
      versionId,
      title: "Ligne validation",
    });

    await page.goto(`/dashboard/affaires/${projectId}`);
    await expect(page.locator(".cockpit-command-strip")).toBeVisible();
    await clickCockpitAction(page, "Preparer la validation");

    const inlinePreviewText = await readPreviewText(page);
    expect(inlinePreviewText).toContain("Preparer la validation");
    expect(inlinePreviewText).toContain(
      "Soumettre le chiffrage pour validation par la direction.",
    );
    await closePreview(page);

    const palette = await openCommandPalette(page);
    await palette.getByRole("option", { name: /Preparer la validation/i }).click();

    const palettePreviewText = await readPreviewText(page);
    expect(palettePreviewText).toBe(inlinePreviewText);
  });

  test("propose le parcours intake a revoir et route le hub avec le filtre adequat", async ({
    page,
  }) => {
    const { versionId } = await createEstimateViaWizard(page, {
      projectName: buildEstimateName("EST374-INTAKE"),
      title: "EST-374 Intake review",
    });
    const projectId = await extractProjectId(page, versionId);
    const { tenantId } = await extractProjectContext(projectId);

    await seedReviewIntakeDocument({
      projectId,
      tenantId,
    });

    await page.goto(`/dashboard/affaires/${projectId}`);

    await expect(page.locator(".cockpit-command-strip")).toBeVisible();
    await clickCockpitAction(page, "Confirmer 1 piece a revoir");

    await expect(page).toHaveURL(
      new RegExp(`/dashboard/affaires/${projectId}\\?intakeFilter=a_revoir`),
    );
    await expect(
      page.getByRole("region", { name: /Intake dossier affaire/i }),
    ).toContainText("piece-a-revoir.pdf");
    await expect(page.getByText("piece-a-revoir.pdf")).toBeVisible();
  });

  test("propose le brief a confirmer puis ouvre le panneau brief apres validation du preview", async ({
    page,
  }) => {
    const { versionId } = await createEstimateViaWizard(page, {
      projectName: buildEstimateName("EST374-BRIEF"),
      title: "EST-374 Brief confirm",
    });
    const projectId = await extractProjectId(page, versionId);
    const { tenantId } = await extractProjectContext(projectId);
    const seededDocument = await seedReviewIntakeDocument({
      projectId,
      tenantId,
      fileName: "brief-source.pdf",
    });

    await seedPendingBrief({
      projectId,
      tenantId,
      uploadId: seededDocument.uploadId,
      sourceDocumentId: seededDocument.documentId,
      sourceFileName: seededDocument.fileName,
    });

    await page.goto(`/dashboard/affaires/${projectId}`);

    await expect(page.locator(".cockpit-command-strip")).toBeVisible();
    await clickCockpitAction(page, "Confirmer le brief affaire");

    const preview = page.getByRole("dialog").last();
    await expect(preview).toContainText("Confirmer le brief affaire");
    await expect(preview).toContainText(
      "Valider le cadrage du dossier pour debloquer la suite du chiffrage assiste.",
    );
    await preview.getByRole("button", { name: /Confirmer/i }).click();

    await expect(page.getByText("Confirmer ce brief ?")).toBeVisible();
  });
});
