import { randomUUID } from "node:crypto";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page } from "@playwright/test";

loadEnvConfig(path.resolve(__dirname, "../.."));

import { buildEstimateName, ensureEstimatePdfReady, loginWithUi } from "./helpers";

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

async function createEstimateViaApi(
  page: Page,
  options: {
    projectName: string;
    title: string;
    dateDevis?: string;
    validiteJours?: number;
  }
) {
  const response = await page.request.post("/api/estimates", {
    failOnStatusCode: false,
    data: {
      project: {
        name: options.projectName,
      },
      version: {
        title: options.title,
        date_devis: options.dateDevis ?? "2026-03-10",
        validite_jours: options.validiteJours ?? 30,
      },
    },
  });
  const body = await response.text();

  expect(
    response.status(),
    `Failed to create estimate. status=${response.status()} body=${body}`
  ).toBe(201);

  const payload = JSON.parse(body) as {
    data?: {
      version?: {
        id?: string;
        project_id?: string;
      };
      version_id?: string;
      project_id?: string;
    };
    version_id?: string;
    project_id?: string;
  };

  const versionId =
    payload.data?.version?.id ??
    payload.data?.version_id ??
    payload.version_id ??
    null;
  const projectId =
    payload.data?.version?.project_id ??
    payload.data?.project_id ??
    payload.project_id ??
    null;

  if (!versionId || !projectId) {
    throw new Error(`Unable to extract estimate ids from payload: ${body}`);
  }

  return { versionId, projectId };
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

async function seedRegisterEntries(input: {
  projectId: string;
  tenantId: string;
  versionId: string;
  sourceDocumentId: string;
  sourceFileName: string;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const criticalEntryId = randomUUID();
  const clarifyEntryId = randomUUID();

  const { error: entriesError } = await sb.from("affaire_register_entries").insert([
    {
      id: criticalEntryId,
      tenant_id: input.tenantId,
      project_id: input.projectId,
      source_document_id: input.sourceDocumentId,
      kind: "assumption",
      code: "critical_scope_clarification",
      text: "Clarifier le perimetre exact avec le client",
      severity: "critical",
      status: "open",
      origin_kind: "ai",
      scope_type: "project",
      scope_label: "Dossier",
      source_file_name: input.sourceFileName,
      sync_key: `critical-${criticalEntryId}`,
      metadata: {},
    },
    {
      id: clarifyEntryId,
      tenant_id: input.tenantId,
      project_id: input.projectId,
      source_document_id: input.sourceDocumentId,
      kind: "missing_piece",
      code: "clarify_dpgf_detail",
      text: "DPGF detaille toujours absent pour fiabiliser le chiffrage",
      severity: "warning",
      status: "clarify_with_client",
      origin_kind: "ai",
      scope_type: "project",
      scope_label: "Dossier",
      source_file_name: input.sourceFileName,
      sync_key: `clarify-${clarifyEntryId}`,
      metadata: {},
    },
  ]);

  if (entriesError) {
    throw new Error(`Seed register entries failed: ${entriesError.message}`);
  }

  const { error: eventsError } = await sb.from("affaire_register_events").insert([
    {
      id: randomUUID(),
      tenant_id: input.tenantId,
      project_id: input.projectId,
      version_id: input.versionId,
      entry_id: criticalEntryId,
      event_type: "created",
      after_payload: { status: "open", severity: "critical" },
    },
    {
      id: randomUUID(),
      tenant_id: input.tenantId,
      project_id: input.projectId,
      version_id: input.versionId,
      entry_id: clarifyEntryId,
      event_type: "created",
      after_payload: { status: "clarify_with_client", severity: "warning" },
    },
  ]);

  if (eventsError) {
    throw new Error(`Seed register events failed: ${eventsError.message}`);
  }
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
    description: "E2E pilotage panel",
  });

  if (setError) {
    throw new Error(`Seed plan set failed: ${setError.message}`);
  }

  const { error: fileError } = await sb.from("plan_files").insert({
    id: randomUUID(),
    tenant_id: input.tenantId,
    plan_set_id: planSetId,
    file_path: `e2e/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`,
    file_name: "plan-affaire.pdf",
    file_type: "application/pdf",
    file_size_bytes: 245_760,
    page_count: 2,
  });

  if (fileError) {
    throw new Error(`Seed plan file failed: ${fileError.message}`);
  }

  return { planSetId };
}

async function seedCompletedTakeoffJob(input: {
  versionId: string;
  tenantId: string;
  planSetId: string;
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
    plan_set_id: input.planSetId,
    level: "A",
    status: "completed",
    source_file_name: input.sourceFileName,
    source_file_type: "application/pdf",
    source_file_size_bytes: 1_024,
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

async function fetchSupplyTypeId() {
  const sb = await getAuthenticatedSupabaseClient();
  const { data, error } = await sb.from("supply_types").select("id").limit(1).single();

  if (error || !data?.id) {
    throw new Error(`Cannot resolve supply type: ${error?.message ?? "missing row"}`);
  }

  return data.id as string;
}

async function seedFinishLineLine(input: {
  tenantId: string;
  versionId: string;
  supplyTypeId: string;
  unitPriceHtCents?: number;
  puHtCents?: number;
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
        title: "Section finish line",
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
        title: "Tube cuivre 18",
        description: "ml",
        quantity: 12,
        unit_price_ht_cents: input.unitPriceHtCents ?? 0,
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
        pu_ht_cents: input.puHtCents ?? 0,
        labor_role_id: null,
        category_id: null,
        supply_type_id: input.supplyTypeId,
        selected_supplier_price_id: null,
        line_total_ht_cents: (input.puHtCents ?? 0) * 12,
        line_tax_cents: Math.round(((input.puHtCents ?? 0) * 12 * 2000) / 10000),
        line_total_ttc_cents:
          (input.puHtCents ?? 0) * 12 +
          Math.round(((input.puHtCents ?? 0) * 12 * 2000) / 10000),
      },
    ] as never
  );

  if (error) {
    throw new Error(`Seed finish line estimate items failed: ${error.message}`);
  }

  return { lineId };
}

async function expectPilotageSection(page: Page) {
  const pilotageSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Pilotage de l'affaire" }) });
  await expect(pilotageSection).toBeVisible();
  return pilotageSection;
}

async function openAffaireHub(page: Page, projectId: string) {
  await page.goto(`/dashboard/affaires/${projectId}`, { waitUntil: "domcontentloaded" });
  return expectPilotageSection(page);
}

async function clickWithin(section: Locator, role: "button" | "link", name: string) {
  const target = section.getByRole(role, { name });
  await expect(target).toBeVisible();
  await target.click();
}

test.describe("US-1.3 - pilotage affaire centre sur les exceptions", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithUi(page);
  });

  test("le cockpit guide vers intake, brief, registre et revue takeoff sans dispersion", async ({
    page,
  }) => {
    const { versionId, projectId } = await createEstimateViaApi(page, {
      projectName: buildEstimateName("US13-PILOTAGE"),
      title: "US-1.3 Pilotage exceptions",
    });
    const tenantId = await getTenantIdForVersion(versionId);
    const intakeDocument = await seedReviewIntakeDocument({
      projectId,
      tenantId,
    });

    await seedPendingBrief({
      projectId,
      tenantId,
      uploadId: intakeDocument.uploadId,
      sourceDocumentId: intakeDocument.documentId,
      sourceFileName: intakeDocument.fileName,
    });
    await seedRegisterEntries({
      projectId,
      tenantId,
      versionId,
      sourceDocumentId: intakeDocument.documentId,
      sourceFileName: intakeDocument.fileName,
    });

    const { planSetId } = await seedPlanSetWithFile({
      projectId,
      versionId,
      tenantId,
      name: "Plans E2E pilotage",
    });
    const { jobId } = await seedCompletedTakeoffJob({
      versionId,
      tenantId,
      planSetId,
      sourceFileName: "plan-affaire.pdf",
    });

    let pilotageSection = await openAffaireHub(page, projectId);

    await expect(pilotageSection).toContainText("Confirmer 1 piece ambigue");
    await expect(pilotageSection).toContainText("Ajouter 4 pieces manquantes");
    await expect(pilotageSection.getByRole("button", { name: "Ouvrir le brief" })).toBeVisible();
    await expect(
      pilotageSection.getByRole("link", { name: "Ouvrir les pieces a revoir" })
    ).toHaveAttribute("href", `/dashboard/affaires/${projectId}?intakeFilter=a_revoir#intake`);
    await expect(
      pilotageSection.getByRole("link", { name: "Ouvrir le registre" })
    ).toHaveAttribute(
      "href",
      `/dashboard/affaires/${projectId}?registerStatus=open&registerSeverity=critical#register`
    );
    await expect(
      pilotageSection.getByRole("link", { name: "Revoir les exceptions" })
    ).toHaveAttribute(
      "href",
      `/dashboard/affaires/${projectId}/takeoff/${jobId}/review?versionId=${versionId}&view=dpgf&dpgfView=exceptions_only`
    );

    await clickWithin(pilotageSection, "link", "Ouvrir les pieces a revoir");
    await expect(
      page.getByRole("region", { name: /Intake dossier affaire/i })
    ).toContainText(intakeDocument.fileName);

    pilotageSection = await openAffaireHub(page, projectId);
    await clickWithin(pilotageSection, "button", "Ajouter des pieces");
    await expect(
      page.getByRole("button", {
        name: /Zone de depot multi-documents\. Glissez des fichiers ou appuyez pour selectionner\./i,
      })
    ).toBeVisible();

    pilotageSection = await openAffaireHub(page, projectId);
    await clickWithin(pilotageSection, "button", "Ouvrir le brief");
    await expect(page.getByText("Confirmer ce brief ?")).toBeVisible();

    pilotageSection = await openAffaireHub(page, projectId);
    await clickWithin(pilotageSection, "link", "Ouvrir le registre");
    await expect(
      page.getByText("Clarifier le perimetre exact avec le client", { exact: true })
    ).toBeVisible();

    pilotageSection = await openAffaireHub(page, projectId);
    await clickWithin(pilotageSection, "link", "Revoir les exceptions");
    await expect(page).toHaveURL(
      new RegExp(
        `/dashboard/affaires/${projectId}/takeoff/${jobId}/review\\?versionId=${versionId}&view=dpgf&dpgfView=exceptions_only$`
      )
    );
    await expect(
      page.getByRole("heading", { name: /Revue des exceptions & preuves/i })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Revoir les ecarts DPGF/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Ecarts DPGF/i })).toBeVisible();
  });

  test("affiche une finish line lisible avec deux statuts distincts et leurs blocages", async ({
    page,
  }) => {
    const { versionId, projectId } = await createEstimateViaApi(page, {
      projectName: buildEstimateName("US51-FINISH"),
      title: "US-5.1 Finish line",
    });
    const tenantId = await getTenantIdForVersion(versionId);
    const supplyTypeId = await fetchSupplyTypeId();

    await seedFinishLineLine({
      tenantId,
      versionId,
      supplyTypeId,
    });

    const pilotageSection = await openAffaireHub(page, projectId);

    await expect(pilotageSection).toContainText("Pret a envoyer");
    await expect(pilotageSection).toContainText("Pret a commander");
    await expect(pilotageSection).toContainText("PDF absent");
    await expect(pilotageSection).toContainText("Prix manquant");
    await expect(pilotageSection).toContainText("1 ligne a arbitrer");
    await expect(
      pilotageSection.getByRole("link", { name: "Reprendre le devis" })
    ).toHaveAttribute("href", `/dashboard/estimates/${versionId}/edit`);
    await expect(
      pilotageSection.getByRole("link", { name: "Revoir les fournisseurs" })
    ).toHaveAttribute("href", `/dashboard/estimates/${versionId}/edit`);
  });

  test("regroupe PDF, email et BDC dans une seule zone de sortie affaire", async ({
    page,
  }) => {
    const projectName = buildEstimateName("US52-SORTIE");
    const { versionId, projectId } = await createEstimateViaApi(page, {
      projectName,
      title: "US-5.2 Sortie finish line",
    });
    const tenantId = await getTenantIdForVersion(versionId);
    const supplyTypeId = await fetchSupplyTypeId();

    await seedFinishLineLine({
      tenantId,
      versionId,
      supplyTypeId,
      unitPriceHtCents: 2_500,
      puHtCents: 2_500,
    });
    await ensureEstimatePdfReady(page, versionId);

    const pilotageSection = await openAffaireHub(page, projectId);

    await expect(
      pilotageSection.getByText("PDF, email et BDC depuis le meme point")
    ).toBeVisible();
    await expect(
      pilotageSection.getByRole("button", { name: "Telecharger le PDF" })
    ).toBeVisible();
    await expect(
      pilotageSection.getByRole("button", { name: "Preparer l'envoi" })
    ).toBeVisible();
    await expect(
      pilotageSection.getByRole("button", { name: "Exporter le BDC" })
    ).toBeVisible();

    await clickWithin(pilotageSection, "button", "Preparer l'envoi");
    await expect(
      page.getByRole("heading", { name: /Envoyer le devis par email/i })
    ).toBeVisible();
    await expect(page.getByLabel("Objet *")).toHaveValue(`Devis - ${projectName} V1`);
    await page.getByRole("button", { name: "Annuler" }).click();
    await expect(
      page.getByRole("heading", { name: /Envoyer le devis par email/i })
    ).not.toBeVisible();
  });
});
