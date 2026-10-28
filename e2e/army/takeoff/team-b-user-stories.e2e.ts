import { nativeTest as test, describe, expect, buildEstimateName, createEstimateViaWizard, loginWithUi, localClient, outputPath, ensureMapping, fixtureFile, expectSummaryValue, type NativeUi as Page } from "./native-ui";

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { createLineViaApi, ownEstimate, recordEvidence } from "../critical/fixtures";
import { localTakeoffFixture, seedOwnedSupplyType } from "./fixtures";
import { duplicateEstimateViaApi } from "./native-ui";
import { seedPlanSetWithFile, seedTakeoffJob, seedVersionLink } from "./recovery-support";
async function getAuthenticatedSupabaseClient() { return (await localClient()).client; }

async function createPendingRecoveryFixture(page: Page) {
  const source = await createEstimateViaWizard(page, {
    projectName: `${page.army.runPrefix} US62 recovery`, title: "ARMY Team B recovery",
  });
  await createLineViaApi(page.browser, source.versionId, `${page.army.runPrefix} recovery line`);
  const fixture = await localTakeoffFixture(page.army, source);
  const targetVersionId = await duplicateEstimateViaApi(page, source.versionId);
  ownEstimate(page.army, { projectId: source.projectId, versionId: targetVersionId });
  const sourceFileName = `${page.army.runPrefix}-recovery.pdf`;
  const plan = await seedPlanSetWithFile({ projectId: source.projectId, versionId: targetVersionId,
    tenantId: fixture.tenantId, planSetName: `${page.army.runPrefix} recovery plans`, fileName: sourceFileName });
  const acquired = await seedTakeoffJob(page.army, { versionId: source.versionId, tenantId: fixture.tenantId,
    sourceFileName, status: "completed", createResult: true });
  await seedVersionLink({ tenantId: fixture.tenantId, jobId: acquired.jobId,
    sourceVersionId: source.versionId, targetVersionId });
  const pending = await seedTakeoffJob(page.army, { versionId: targetVersionId, tenantId: fixture.tenantId,
    sourceFileName, status: "processing", processingStrategy: "batch", providerBatchState: "pending", retryCount: 2 });
  await recordEvidence(page.army, "team-b-recovery-fixture", { source, targetVersionId, plan, acquired, pending,
    fixtureBoundary: "Locally seeded completed and pending provider states; no provider is invoked." });
  return source.projectId;
}

async function createHierarchyFixture(page: Page) {
  const ids = await createEstimateViaWizard(page, {
    projectName: `${page.army.runPrefix} US63 hierarchy`, title: "ARMY Team B hierarchy",
  });
  const fixture = await localTakeoffFixture(page.army, ids);
  const plan = await seedPlanSetWithFile({ ...ids, tenantId: fixture.tenantId,
    planSetName: `${page.army.runPrefix} legacy plans`, fileName: `${page.army.runPrefix}-plan.pdf` });
  const uploadId = randomUUID();
  const documentId = randomUUID();
  const { userId } = await localClient();
  const now = new Date().toISOString();
  const upload = await fixture.client.from("affaire_intake_uploads").insert({
    id: uploadId, tenant_id: fixture.tenantId, project_id: ids.projectId, created_by: userId, status: "ready", completed_at: now,
  });
  expect(upload.error).toBe(null);
  // Same ambiguous-document fixture as the existing cockpit intake scenario.
  const document = await fixture.client.from("affaire_intake_documents").insert({
    id: documentId, tenant_id: fixture.tenantId, project_id: ids.projectId, upload_id: uploadId, created_by: userId,
    storage_path: `e2e/intake/${documentId}.pdf`, file_name: `${page.army.runPrefix}-piece-a-revoir.pdf`,
    mime_type: "application/pdf", size_bytes: 1024, upload_status: "uploaded", classification_status: "ambiguous",
    document_kind: "a_classer", confidence: 0.42, issues: ["Faible confiance"],
    extracted_metadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
    classification_source: "ai", classified_at: now,
  });
  expect(document.error).toBe(null);
  await recordEvidence(page.army, "team-b-hierarchy-fixture", { ids, plan, uploadId, documentId,
    fixtureBoundary: "Locally seeded ambiguous document; no classifier or file provider is invoked." });
  return ids;
}

function createDuplicateAwareDpgfWorkbook(filePath: string) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    [
      "hex_code",
      "designation",
      "quantity",
      "unit",
      "unit_price_ht",
      "total_ht",
    ],
    ["B-001", "Faux plafond acoustique", 12, "m2", 45.5, 546],
    ["B-001", "Faux plafond acoustique", 12, "m2", 45.5, 546],
    ["B-002", "Tube cuivre 18", 4, "u", 21, 84],
  ]);

  XLSX.utils.book_append_sheet(workbook, sheet, "DPGF");
  fs.writeFileSync(filePath, XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }));
}

function createMaterializedDpgfWorkbook(filePath: string) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    [
      "hex_code",
      "designation",
      "quantity",
      "unit",
      "unit_price_ht",
      "total_ht",
    ],
    ["B-010", "Tube cuivre 18", 12, "u", 21, 252],
    ["B-011", "Faux plafond acoustique", 10, "m2", 45.5, 455],
  ]);

  XLSX.utils.book_append_sheet(workbook, sheet, "DPGF");
  fs.writeFileSync(filePath, XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }));
}

async function createStructuredDpgfWorkbook(filePath: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("plb Z3-5");

  sheet.addRow(["", "Qte", "U", "PR. FO", "h MO", "commentaire"]);
  sheet.addRow(["Eaux usées"]);
  sheet.addRow(["EUEV"]);
  sheet.addRow(["Tube acier DN100", 200, "ml", 40.74, 1.2, "Sous-sol"]);
  sheet.addRow(["Poste hors lot", "—", "ens", "—", 0, "A chiffrer"]);
  sheet.addRow(["TOTAL HT"]);
  sheet.addRow(["Conditions générales de vente"]);

  sheet.getCell("A2").font = { bold: true };
  sheet.getCell("A3").font = { bold: true };
  sheet.mergeCells("A2:F2");
  sheet.mergeCells("A3:F3");

  await workbook.xlsx.writeFile(filePath);
}

async function fetchEstimateItems(page: Page, versionId: string) {
  const response = await page.request.get("/api/estimates/" + versionId + "/items");
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as {
    data?: { items?: Array<Record<string, unknown>> };
  };
  return payload.data?.items ?? [];
}

async function extractProjectId(page: Page, versionId: string) {
  const response = await page.request.get(`/api/estimates/${versionId}`, {
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as {
    data?: {
      version?: { project_id?: string };
      project_id?: string;
    };
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

async function uploadAndClassifyIntakeDpgf(page: Page, input: {
  projectId: string;
  fixturePath: string;
}) {
  if (!page.army.ownedEstimates.some((estimate) => estimate.projectId === input.projectId)) {
    throw new Error("Only a newly owned local affair may receive the test DPGF.");
  }
  const uploadResponse = await page.request.post(`/api/affaires/${input.projectId}/intake/files`, {
    multipart: {
      files: {
        name: path.basename(input.fixturePath),
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: fs.readFileSync(input.fixturePath),
      },
    },
    failOnStatusCode: false,
  });

  expect(uploadResponse.status()).toBe(201);

  const uploadPayload = (await uploadResponse.json()) as {
    data?: {
      files?: Array<{ documentId?: string }>;
    };
  };

  const documentId = uploadPayload.data?.files?.[0]?.documentId ?? null;
  expect(documentId, "intake upload should return a document id").toBeTruthy();

  const { client, userId } = await localClient();
  await expect.poll(async () => {
    const document = await client.from("affaire_intake_documents")
      .select("classification_status").eq("id", documentId).eq("project_id", input.projectId).single();
    expect(document.error).toBe(null);
    return document.data && !["queued", "processing"].includes(document.data.classification_status);
  }, { timeout: 30_000 }).toBe(true);
  const nowIso = new Date().toISOString();
  const classified = await client.from("affaire_intake_documents").update({
    document_kind: "dpgf", classification_status: "classified", confidence: 0.99, issues: [],
    classification_source: "manual", classified_by: userId, classified_at: nowIso, manually_overridden_at: nowIso,
  }).eq("id", documentId).eq("project_id", input.projectId).select("id,storage_path");
  expect(classified.error).toBe(null);
  expect(classified.data?.map(row => row.id)).toEqual([documentId]);
  const storagePath = classified.data?.[0]?.storage_path;
  if (!storagePath) throw new Error("The owned DPGF has no storage path.");
  (page.army.ownedIntakeCopies ??= []).push({ projectId: input.projectId, storagePath });
}

async function fetchLatestProjectVersion(projectId: string) {
  const sb = await getAuthenticatedSupabaseClient();
  const { data, error } = await sb
    .from("estimate_versions")
    .select("id, version_number, total_ht_cents")
    .eq("project_id", projectId)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    throw new Error(`Cannot fetch latest project version: ${error.message}`);
  }

  return {
    id: data.id as string,
    versionNumber: Number(data.version_number),
    totalHtCents:
      typeof data.total_ht_cents === "number" ? data.total_ht_cents : Number(data.total_ht_cents ?? 0),
  };
}

async function fetchLineItems(page: Page, versionId: string) {
  const response = await page.request.get(`/api/estimates/${versionId}/items`, {
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as {
    data?: {
      items?: Array<Record<string, unknown>>;
    };
  };

  return (payload.data?.items ?? []).filter((item) => item.item_type === "line");
}

async function createEstimateViaApi(page: Page, options: {
  projectName: string;
  title: string;
  dateDevis?: string;
  validiteJours?: number;
}) {
  const response = await page.request.post("/api/estimates", {
    failOnStatusCode: false,
    data: {
      project: {
        name: `${page.army.runPrefix}-${options.projectName}`,
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

async function seedFinishLineLine(input: {
  tenantId: string;
  versionId: string;
  supplyTypeId: string;
  title?: string;
  quantity?: number;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const sectionId = randomUUID();
  const lineId = randomUUID();
  const quantity = input.quantity ?? 12;

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
        title: input.title ?? "Tube cuivre 18",
        description: "u",
        quantity,
        unit_price_ht_cents: 0,
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
        pu_ht_cents: 0,
        labor_role_id: null,
        category_id: null,
        supply_type_id: input.supplyTypeId,
        selected_supplier_price_id: null,
        line_total_ht_cents: 0,
        line_tax_cents: 0,
        line_total_ttc_cents: 0,
      },
    ] as never
  );

  if (error) {
    throw new Error(`Seed finish line estimate items failed: ${error.message}`);
  }

  return { lineId };
}

async function seedComparableSupplierPrice(input: {
  tenantId: string;
  supplierName: string;
  productDesignation: string;
  supplierReference: string;
  unitPriceCents: number;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const supplierId = randomUUID();
  const productId = randomUUID();

  const { error: supplierError } = await sb.from("suppliers").insert({
    id: supplierId,
    tenant_id: input.tenantId,
    name: input.supplierName,
    is_active: true,
  });
  if (supplierError) {
    throw new Error(`Seed supplier failed: ${supplierError.message}`);
  }

  const { error: productError } = await sb.from("products").insert({
    id: productId,
    tenant_id: input.tenantId,
    designation: input.productDesignation,
    reference: input.supplierReference,
    unit_price_cents: input.unitPriceCents,
    is_active: true,
  });
  if (productError) {
    throw new Error(`Seed product failed: ${productError.message}`);
  }

  const { data: priceData, error: priceError } = await sb.rpc(
    "create_supplier_catalog_price",
    {
      payload: {
        supplier_id: supplierId,
        product_id: productId,
        supplier_sku: input.supplierReference,
        product_url: null,
        price: {
          unit: "u",
          min_quantity: 1,
          unit_price_cents: input.unitPriceCents,
          currency: "EUR",
          valid_from: new Date().toISOString().slice(0, 10),
          valid_to: null,
          is_active: true,
          notes: "Seed US-4.4",
        },
      },
    }
  );
  const supplierPriceId =
    priceData && typeof priceData === "object" && "id" in priceData
      ? String(priceData.id)
      : null;

  if (priceError || !supplierPriceId) {
    throw new Error(
      `Seed supplier price failed: ${priceError?.message ?? "missing id"}`
    );
  }

  return { supplierId, productId, supplierPriceId };
}

async function seedDeliverySite(input: {
  tenantId: string;
  name: string;
  projectCode: string;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const siteId = randomUUID();

  const { error } = await sb.from("delivery_sites").insert({
    id: siteId,
    tenant_id: input.tenantId,
    name: input.name,
    project_code: input.projectCode,
    address: "1 rue du chantier",
    postal_code: "69000",
    city: "Lyon",
    contact_name: "Chef chantier",
    contact_phone: "0102030405",
    is_active: true,
  });

  if (error) {
    throw new Error(`Seed delivery site failed: ${error.message}`);
  }

  return { siteId };
}

describe("VNEXT Team B - user stories e2e", { session: "army", tags: ["critical", "extended"], timeout: 180_000 }, () => {
  test.beforeEach(async ({ ui: page }) => {
    await loginWithUi(page);
  });

  test("US-2.1 exposes mapping import stats in the canonical mapping wizard", async ({ ui: page }) => {
    const fixturePath = outputPath(page, "us21-mapping-stats.xlsx");
    createDuplicateAwareDpgfWorkbook(fixturePath);

    await page.goto("/dashboard/imports");
    await expect(page.getByRole("heading", { name: /Import DPGF/i })).toBeVisible();

    const uploadInput = page.getByLabel("Fichier DPGF à importer", { exact: true, visible: true });
    await expect(uploadInput).toHaveCount(1);
    await uploadInput.setInputFiles(fixturePath);
    await page.getByRole("button", { name: /^(Importer|Lancer l['’]import)$/i }).first().click();

    const mapLink = page.getByRole("link", { name: /Mapper les colonnes/i });
    await expect(mapLink).toBeVisible({ timeout: 30_000 });
    await mapLink.click();

    await expect(page.browser).toHaveURL(/\/dashboard\/mappings\?import_id=/i);
    await ensureMapping(page, "hex_code", "hex_code");
    await ensureMapping(page, "designation", "designation");
    await ensureMapping(page, "quantity", "quantity");
    await ensureMapping(page, "unit", "unit");
    await ensureMapping(page, "unit_price_ht", "unit_price_ht");
    await ensureMapping(page, "total_ht", "total_ht");

    await expect(
      page.getByRole("heading", { name: /Aperçu des données mapp[ée]es/i })
    ).toBeVisible();
    const previewSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: /Aperçu des données mapp[ée]es/i }) })
      .first();
    await expect(previewSection.getByText("Validation", { exact: true })).toBeVisible();
    await expect(previewSection.getByText("Champs à compléter", { exact: true })).toBeVisible();
    await expect(previewSection.getByText("Doublons", { exact: true })).toBeVisible();
    await expect(
      previewSection.getByText(/groupes? de doublons détectés?|Aucun doublon détecté/i)
    ).toBeVisible();
  });

  test("US-2.2 reviews tabular PDF imports before entering the canonical flow", async ({ ui: page }) => {
    const pdfFixturePath = path.join(process.cwd(), "e2e/fixtures/us22_live_tabular.pdf");

    await page.goto("/dashboard/imports");
    await expect(page.getByRole("heading", { name: /Import DPGF/i })).toBeVisible();

    const uploadInput = page.getByLabel("Fichier DPGF à importer", { exact: true, visible: true });
    await expect(uploadInput).toHaveCount(1);
    await uploadInput.setInputFiles(pdfFixturePath);

    await expect(page.getByText(/Validation renforc[ée]e/i)).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(
        /Le PDF rejoint le mapping standard uniquement après approbation explicite/i
      )
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Valider les tableaux et lancer l'import/i })
    ).toBeVisible();

    await page.getByRole("button", { name: /Valider les tableaux et lancer l'import/i }).click();
    const mapLink = page.getByRole("link", { name: /Mapper les colonnes/i });
    await expect(mapLink).toBeVisible({ timeout: 30_000 });
    await mapLink.click();

    await expect(page.browser).toHaveURL(/\/dashboard\/mappings\?import_id=/i);
    await expect(page.getByRole("heading", { name: /Mapping DPGF/i })).toBeVisible();
  });

  test("US-2.3 materializes imported DPGF rows into a new estimate version with totals", async ({ ui: page }) => {
    const fixturePath = outputPath(page, "us23-materialize.xlsx");
    createMaterializedDpgfWorkbook(fixturePath);

    const { versionId: sourceVersionId } = await createEstimateViaWizard(page, {
      projectName: buildEstimateName("VNEXT-US23"),
      title: "US-2.3 source version",
    });

    const [projectId] = await Promise.all([
      extractProjectId(page, sourceVersionId),
      uploadAndClassifyIntakeDpgf(page, {
        projectId: await extractProjectId(page, sourceVersionId),
        fixturePath,
      }),
    ]);

    await page.goto(`/dashboard/affaires/${projectId}`);
    await page.getByRole("button", { name: /Lancer l'import structur[ée]/i }).click();
    await expect(page.getByText("Glissez-déposez votre fichier DPGF ici")).toBeVisible();

    await page.locator('input[type="file"]').first().setInputFiles(fixturePath);
    await page.getByRole("button", { name: "Lancer l'import" }).click();

    await expect(page.getByRole("button", { name: /Suivant : Aperçu/i })).toBeVisible({
      timeout: 30_000,
    });

    await ensureMapping(page, "hex_code", "hex_code");
    await ensureMapping(page, "designation", "designation");
    await ensureMapping(page, "quantity", "quantity");
    await ensureMapping(page, "unit", "unit");
    await ensureMapping(page, "unit_price_ht", "unit_price_ht");
    await ensureMapping(page, "total_ht", "total_ht");

    await page.getByRole("button", { name: /Suivant : Aperçu/i }).click();
    await page.getByRole("button", { name: /Suivant : Confirmation/i }).click();
    await page.getByRole("button", { name: /Cr[ée]er le chiffrage/i }).click();

    await expect
      .poll(async () => fetchLatestProjectVersion(projectId), {
        timeout: 30_000,
      })
      .toMatchObject({
        versionNumber: 2,
      });

    const targetVersion = await fetchLatestProjectVersion(projectId);
    expect(targetVersion.id).not.toBe(sourceVersionId);
    expect(targetVersion.totalHtCents).toBeGreaterThan(0);

    const lines = await fetchLineItems(page, targetVersion.id);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  test("US-2.4 reviews XLSX titles and materializes a two-level DPGF hierarchy", async ({ ui: page }) => {
    const fixturePath = outputPath(page, "us24-structured.xlsx");
    await createStructuredDpgfWorkbook(fixturePath);

    const { versionId: sourceVersionId } = await createEstimateViaWizard(page, {
      projectName: buildEstimateName("VNEXT-US24"),
      title: "US-2.4 source version",
    });
    const projectId = await extractProjectId(page, sourceVersionId);
    await uploadAndClassifyIntakeDpgf(page, { projectId, fixturePath });

    await page.goto("/dashboard/affaires/" + projectId);
    await page.getByRole("button", { name: /Lancer l'import structur[ée]/i }).click();
    await expect(page.getByText("Glissez-déposez votre fichier DPGF ici")).toBeVisible();

    await page.locator('input[type="file"]').first().setInputFiles(fixturePath);
    await page.getByRole("button", { name: "Lancer l'import" }).click();
    await expect(page.getByRole("button", { name: /Suivant : Aperçu/i })).toBeVisible({
      timeout: 30_000,
    });

    await ensureMapping(page, "column_1", "designation");
    await ensureMapping(page, "Qte", "quantity");
    await ensureMapping(page, "U", "unit");
    await ensureMapping(page, "PR._FO", "unit_price_ht");
    await ensureMapping(page, "h_MO", "labor_hours");
    await ensureMapping(page, "commentaire", "notes");

    await page.getByRole("button", { name: /Suivant : Aperçu/i }).click();
    await expect(page.getByText("Structure du DPGF")).toBeVisible();
    await expect(page.getByLabel("Type de Eaux usées")).toHaveValue("section");
    await expect(page.getByLabel("Type de EUEV")).toHaveValue("section");
    await page.getByLabel("Niveau de EUEV").selectOption({ value: "2" });
    await expect(page.getByLabel("Niveau de EUEV")).toHaveValue("2");

    await page.getByRole("button", { name: /Suivant : Confirmation/i }).click();
    await expect(page.getByText("Structure source")).toBeVisible();
    await expectSummaryValue(page, "Sections retenues", "2");
    await expectSummaryValue(page, "Lignes à 0 €", "1");
    await expectSummaryValue(page, "Pied de tableau ignoré", "2");

    await page.getByRole("button", { name: /Créer le chiffrage/i }).click();
    await expect
      .poll(async () => fetchLatestProjectVersion(projectId), {
        timeout: 30_000,
      })
      .toMatchObject({ versionNumber: 2 });

    const targetVersion = await fetchLatestProjectVersion(projectId);
    expect(targetVersion.id).not.toBe(sourceVersionId);
    const items = await fetchEstimateItems(page, targetVersion.id);
    const sections = items.filter((item) => item.item_type === "section");
    const lines = items.filter((item) => item.item_type === "line");

    expect(sections).toHaveLength(3);
    expect(lines).toHaveLength(2);

    const root = sections.find(
      (item) =>
        item.parent_id === null &&
        typeof item.title === "string" &&
        item.title.startsWith("Import DPGF"),
    );
    const eauxUsees = sections.find((item) => item.title === "Eaux usées");
    const euev = sections.find((item) => item.title === "EUEV");

    expect(root).toBeTruthy();
    expect(eauxUsees).toBeTruthy();
    expect(euev).toBeTruthy();
    expect(eauxUsees?.parent_id).toBe(root?.id);
    expect(euev?.parent_id).toBe(eauxUsees?.id);

    const firstLine = lines.find((item) => item.title === "Tube acier DN100");
    const zeroLine = lines.find((item) => item.title === "Poste hors lot");
    expect(firstLine).toMatchObject({
      parent_id: euev?.id,
      description: "ml",
      quantity: 200,
      unit_price_ht_cents: 4074,
      h_mo: 1.2,
      source_provider: "dpgf",
      source_file_name: "us24-structured.xlsx",
    });
    expect(firstLine?.source_metadata).toMatchObject({
      sheet_name: "plb Z3-5",
      source_row_number: 4,
      notes: "Sous-sol",
      import_id: expect.any(String),
      mapping_id: expect.any(String),
    });
    expect(zeroLine).toMatchObject({
      parent_id: euev?.id,
      description: "ens",
      quantity: 0,
      unit_price_ht_cents: 0,
      source_provider: "dpgf",
    });
    expect(items.some((item) => item.title === "TOTAL HT")).toBe(false);
    expect(
      items.some((item) => item.title === "Conditions générales de vente"),
    ).toBe(false);
  });

  test("US-4.1 keeps supplier CSV import guided and explicit inside the canonical flow", async ({ ui: page }) => {
    const ids = await createEstimateViaWizard(page, { projectName: `${page.army.runPrefix} US41 guided`, title: "ARMY guided supplier CSV" });
    const fixture = await localTakeoffFixture(page.army, ids);
    page.army.ownedPriceLookupProjects = [ids.projectId];
    await recordEvidence(page.army, "supplier-import-lookups", { ...ids, tenantId: fixture.tenantId,
      boundary: "Only the two RLS-protected reference reads for this owned local import are permitted." });
    // The client replaces the server-rendered import step with a loading state until
    // these two reads finish, then mounts a new step: a file chosen earlier is lost.
    const lookups = Promise.all([
      page.browser.waitForResponse(/\/rest\/v1\/suppliers\?/, { timeout: 60_000 }),
      page.browser.waitForResponse(/\/rest\/v1\/products\?/, { timeout: 60_000 }),
    ]);
    await page.goto(`/dashboard/affaires/${ids.projectId}/prices`);
    await expect(page.getByRole("heading", { name: "Prix fournisseurs", exact: true })).toBeVisible();
    for (const response of await lookups) expect(response.status).toBe(200);

    await page.getByLabel("Fichier CSV", { exact: true }).setInputFiles(fixtureFile(page, "us41-guided.csv", Buffer.from(
        [
          "supplier_name;product_label;supplier_ref;unit_price_ht;currency",
          "Stabilize Supplier;Tube cuivre 18;TC18-STAB;21.00;EUR",
        ].join("\n"),
        "utf8"
      )));
    await expect(page.getByText("us41-guided.csv", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Analyser" }).first().click();
    await expect(page.getByRole("heading", { name: /Étape 1 [—-] Charger le CSV/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Étape 2 [—-] Associer les colonnes/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Étape 3 [—-] Résoudre les inconnus/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Étape 4 [—-] Importer/i })).toBeVisible();
    await expect(page.getByRole("cell", { name: /Fournisseur inconnu/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Importer les lignes prêtes/i })).toBeDisabled();
  });

  test("US-4.1b keeps the chosen supplier CSV while the import lookups load", async ({ ui: page }) => {
    const ids = await createEstimateViaWizard(page, { projectName: `${page.army.runPrefix} US41 lookups`, title: "ARMY supplier CSV lookups" });
    const fixture = await localTakeoffFixture(page.army, ids);
    page.army.ownedPriceLookupProjects = [ids.projectId];
    // A supplier that exists before the import: only loaded lookups can resolve it.
    const knownSupplier = { id: randomUUID(), tenant_id: fixture.tenantId, name: `${page.army.runPrefix} Fournisseur connu`, is_active: true };
    const seeded = await fixture.client.from("suppliers").insert(knownSupplier);
    expect(seeded.error).toBe(null);
    await recordEvidence(page.army, "supplier-import-lookups-held", { ...ids, tenantId: fixture.tenantId, knownSupplier,
      boundary: "The supplier lookup read is held by the test, then handed to the owned-read guard unchanged." });
    // Hold the supplier read so the file is chosen while the lookups are still loading.
    let releaseSuppliers!: () => void;
    let suppliersRequested!: () => void;
    const suppliersReleased = new Promise<void>((resolve) => { releaseSuppliers = resolve; });
    const suppliersPending = new Promise<void>((resolve) => { suppliersRequested = resolve; });
    await page.browser.route(/\/rest\/v1\/suppliers\?/, async (route) => {
      suppliersRequested();
      await suppliersReleased;
      await route.fallback();
    });
    try {
      await page.goto(`/dashboard/affaires/${ids.projectId}/prices`);
      await expect(page.getByRole("heading", { name: "Prix fournisseurs", exact: true })).toBeVisible();
      let requestTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([suppliersPending, new Promise<never>((_, reject) => {
        requestTimer = setTimeout(() => reject(new Error("The import never requested its supplier lookups.")), 60_000);
      })]).finally(() => clearTimeout(requestTimer));
      await expect(page.getByText("Chargement des référentiels pour l’import…")).toBeVisible();

      await page.getByLabel("Fichier CSV", { exact: true }).setInputFiles(fixtureFile(page, "us41-lookups.csv", Buffer.from(
        ["fournisseur;reference_produit;prix_unitaire;devise", `${knownSupplier.name};${page.army.runPrefix}-REF;21.00;EUR`].join("\n"),
        "utf8"
      )));
      await expect(page.getByText("us41-lookups.csv", { exact: true })).toBeVisible();
      // Analysing against empty lookups would mark existing suppliers and products as unknown.
      await expect(page.getByRole("button", { name: "Analyser" })).toBeDisabled();
    } finally {
      releaseSuppliers();
    }

    await expect(page.getByText("Chargement des référentiels pour l’import…")).toBeHidden();
    await expect(page.getByText("us41-lookups.csv", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyser" })).toBeEnabled();
    await page.getByRole("button", { name: "Analyser" }).click();
    await expect(page.getByRole("heading", { name: /Étape 2 [—-] Associer les colonnes/i })).toBeVisible();
    await expect(page.getByText("Fournisseurs inconnus : 0 · Produits inconnus : 1", { exact: true })).toBeVisible();
  });

  test("US-4.1c keeps the supplier CSV wizard state after creating its unknowns", async ({ ui: page }) => {
    const ids = await createEstimateViaWizard(page, { projectName: `${page.army.runPrefix} US41 create missing`, title: "ARMY supplier CSV unknowns" });
    const fixture = await localTakeoffFixture(page.army, ids);
    page.army.ownedPriceLookupProjects = [ids.projectId];
    const supplierName = `${page.army.runPrefix} Fournisseur`;
    const productReference = `${page.army.runPrefix}-REF`;
    await recordEvidence(page.army, "supplier-import-create-missing", { ...ids, tenantId: fixture.tenantId, supplierName, productReference,
      boundary: "Creates one supplier and one product named with this run's prefix in the owned ARMY tenant." });
    const lookupReads = () => Promise.all([
      page.browser.waitForResponse(/\/rest\/v1\/suppliers\?/, { timeout: 60_000 }),
      page.browser.waitForResponse(/\/rest\/v1\/products\?/, { timeout: 60_000 }),
    ]);
    const initialLookups = lookupReads();
    await page.goto(`/dashboard/affaires/${ids.projectId}/prices`);
    await expect(page.getByRole("heading", { name: "Prix fournisseurs", exact: true })).toBeVisible();
    for (const response of await initialLookups) expect(response.status).toBe(200);

    await page.getByLabel("Fichier CSV", { exact: true }).setInputFiles(fixtureFile(page, "us41-create-missing.csv", Buffer.from(
      ["fournisseur;reference_produit;prix_unitaire;devise", `${supplierName};${productReference};21.00;EUR`].join("\n"),
      "utf8"
    )));
    await expect(page.getByText("us41-create-missing.csv", { exact: true })).toBeVisible();
    const importCreated = page.browser.waitForResponse(/\/api\/imports$/, { timeout: 60_000 });
    await page.getByRole("button", { name: "Analyser" }).click();
    const importResponse = await importCreated;
    expect(importResponse.status).toBe(201);
    const sourceImportId = (await importResponse.json<{ data: { id: string } }>()).data.id;
    await expect(page.getByText("Fournisseurs inconnus : 1 · Produits inconnus : 1", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Importer les lignes prêtes/i })).toBeDisabled();

    const createMissing = page.browser.waitForResponse(/\/api\/prices\/import\/create-missing$/, { timeout: 60_000 });
    const reloadedLookups = lookupReads();
    await page.getByRole("button", { name: "Créer les inconnus" }).click();
    const confirmation = page.getByRole("alertdialog", { name: "Créer 1 fournisseur(s) et 1 produit(s) ?" });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Créer", exact: true }).click();
    const createResponse = await createMissing;
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json<{ data: {
      createdSuppliers: Array<{ id: string; name: string }>;
      createdProducts: Array<{ id: string; reference: string }>;
    } }>()).data;
    expect(created.createdSuppliers.map((supplier) => supplier.name)).toEqual([supplierName]);
    expect(created.createdProducts.map((product) => product.reference)).toEqual([productReference]);
    for (const response of await reloadedLookups) expect(response.status).toBe(200);

    // Same file, mapping, canonical trace and preview, revalidated against the reloaded lookups.
    await expect(page.getByText("Création assistée terminée : 1 fournisseur(s), 1 produit(s).", { exact: true })).toBeVisible();
    await expect(page.getByText("us41-create-missing.csv", { exact: true })).toBeVisible();
    await expect(page.getByText("Trace canonique liée", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Étape 2 [—-] Associer les colonnes/i })).toBeVisible();
    await expect(page.getByText(/^1 ligne\(s\) détectée\(s\), 4 colonne\(s\) associée\(s\) automatiquement\.$/)).toBeVisible();
    await expect(page.getByText("Fournisseurs inconnus : 0 · Produits inconnus : 0", { exact: true })).toBeVisible();
    await expectSummaryValue(page, "Importables", "1");
    await expect(page.getByRole("button", { name: /Importer les lignes prêtes/i })).toBeEnabled();

    await page.getByRole("button", { name: /Importer les lignes prêtes/i }).click();
    await expect(page.getByText(/^Import terminé : 1 ligne\(s\) importée\(s\)/)).toBeVisible();
    const persisted = await fixture.client.from("supplier_pricebook")
      .select("supplier_id, product_id, unit_price_cents, currency, source_import_id")
      .eq("supplier_id", created.createdSuppliers[0].id);
    expect(persisted.error).toBe(null);
    expect(persisted.data).toEqual([{ supplier_id: created.createdSuppliers[0].id, product_id: created.createdProducts[0].id,
      unit_price_cents: 2100, currency: "EUR", source_import_id: sourceImportId }]);
    await recordEvidence(page.army, "supplier-import-create-missing-result", { ...ids, sourceImportId, created, persisted: persisted.data });
  });

  test("US-4.1d blocks the supplier CSV analysis after a failed lookup read until a retry succeeds", async ({ ui: page }) => {
    const ids = await createEstimateViaWizard(page, { projectName: `${page.army.runPrefix} US41 lookup failure`, title: "ARMY supplier CSV lookup failure" });
    const fixture = await localTakeoffFixture(page.army, ids);
    page.army.ownedPriceLookupProjects = [ids.projectId];
    // Only loaded lookups resolve this existing supplier: empty ones would report it unknown.
    const knownSupplier = { id: randomUUID(), tenant_id: fixture.tenantId, name: `${page.army.runPrefix} Fournisseur connu`, is_active: true };
    const seeded = await fixture.client.from("suppliers").insert(knownSupplier);
    expect(seeded.error).toBe(null);
    await recordEvidence(page.army, "supplier-import-lookups-failed", { ...ids, tenantId: fixture.tenantId, knownSupplier,
      boundary: "The test answers every supplier lookup read with a 500 until the retry, which goes to the owned-read guard unchanged." });
    // Every read fails until the retry: a dev server's StrictMode loads twice and only the latest load counts.
    let failSupplierReads = true;
    let failedSupplierReads = 0;
    await page.browser.route(/\/rest\/v1\/suppliers\?/, async (route) => {
      if (!failSupplierReads) return route.fallback();
      failedSupplierReads += 1;
      // supabase-js retries 503, 520 and network errors but not a 500: the page sees each failure once.
      await route.fulfill({ status: 500, headers: { "access-control-allow-origin": "*" },
        json: { code: "ARMY", message: "Lookup read refused by the test", details: null, hint: null } });
    });
    await page.goto(`/dashboard/affaires/${ids.projectId}/prices`);
    await expect(page.getByRole("heading", { name: "Prix fournisseurs", exact: true })).toBeVisible();
    const failure = page.getByRole("alert").filter({ hasText: "Impossible de charger les fournisseurs et produits existants." });
    await expect(failure).toBeVisible();
    expect(failedSupplierReads).toBeGreaterThan(0);

    await page.getByLabel("Fichier CSV", { exact: true }).setInputFiles(fixtureFile(page, "us41-lookups-failed.csv", Buffer.from(
      ["fournisseur;reference_produit;prix_unitaire;devise", `${knownSupplier.name};${page.army.runPrefix}-REF;21.00;EUR`].join("\n"),
      "utf8"
    )));
    await expect(page.getByText("us41-lookups-failed.csv", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyser" })).toBeDisabled();

    failSupplierReads = false;
    const retriedLookups = Promise.all([
      page.browser.waitForResponse(/\/rest\/v1\/suppliers\?/, { timeout: 60_000 }),
      page.browser.waitForResponse(/\/rest\/v1\/products\?/, { timeout: 60_000 }),
    ]);
    await failure.getByRole("button", { name: "Réessayer" }).click();
    for (const response of await retriedLookups) expect(response.status).toBe(200);
    await expect(failure).toBeHidden();
    await expect(page.getByText("us41-lookups-failed.csv", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyser" })).toBeEnabled();
    await page.getByRole("button", { name: "Analyser" }).click();
    await expect(page.getByRole("heading", { name: /Étape 2 [—-] Associer les colonnes/i })).toBeVisible();
    await expect(page.getByText("Fournisseurs inconnus : 0 · Produits inconnus : 1", { exact: true })).toBeVisible();
  });

  test("US-4.1e turns a supplier lookup read that never answers into a retryable failure", async ({ ui: page }) => {
    const ids = await createEstimateViaWizard(page, { projectName: `${page.army.runPrefix} US41 lookup hang`, title: "ARMY supplier CSV lookup hang" });
    const fixture = await localTakeoffFixture(page.army, ids);
    page.army.ownedPriceLookupProjects = [ids.projectId];
    const knownSupplier = { id: randomUUID(), tenant_id: fixture.tenantId, name: `${page.army.runPrefix} Fournisseur connu`, is_active: true };
    const seeded = await fixture.client.from("suppliers").insert(knownSupplier);
    expect(seeded.error).toBe(null);
    await recordEvidence(page.army, "supplier-import-lookups-hung", { ...ids, tenantId: fixture.tenantId, knownSupplier,
      boundary: "The test never answers a supplier lookup read until the retry, which goes to the owned-read guard unchanged." });
    // Every read is held until the retry: a dev server's StrictMode loads twice and only the latest load counts.
    let holdSupplierReads = true;
    let heldSupplierReads = 0;
    let releaseHeldReads!: () => void;
    const heldReadsReleased = new Promise<void>((resolve) => { releaseHeldReads = resolve; });
    await page.browser.route(/\/rest\/v1\/suppliers\?/, async (route) => {
      if (!holdSupplierReads) return route.fallback();
      heldSupplierReads += 1;
      await heldReadsReleased;
      // The page gave up on these reads long ago: aborting them may fail and nothing waits for them.
      await route.abort().catch(() => undefined);
    });
    const failure = page.getByRole("alert").filter({ hasText: "Impossible de charger les fournisseurs et produits existants." });
    try {
      const pricesListed = page.browser.waitForResponse(/\/api\/prices\?/, { timeout: 60_000 });
      await page.goto("/dashboard/prices");
      await expect(page.getByRole("heading", { name: "Prix fournisseurs", exact: true })).toBeVisible();
      // The client reads this list after hydration: the panel toggle then responds.
      expect((await pricesListed).status).toBe(200);
      await page.getByRole("button", { name: /Importer un fichier de prix \(CSV\)/ }).click();
      await expect(page.getByText("Chargement des référentiels pour l’import…")).toBeVisible();
      await page.getByLabel("Fichier CSV", { exact: true }).setInputFiles(fixtureFile(page, "us41-lookups-hung.csv", Buffer.from(
        ["fournisseur;reference_produit;prix_unitaire;devise", `${knownSupplier.name};${page.army.runPrefix}-REF;21.00;EUR`].join("\n"),
        "utf8"
      )));
      await expect(page.getByText("us41-lookups-hung.csv", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Analyser" })).toBeDisabled();

      // The read never answers: only a bounded wait on the client can turn it into a failure.
      await expect(failure).toBeVisible({ timeout: 40_000 });
      await expect(page.getByText("Chargement des référentiels pour l’import…")).toBeHidden();
      await expect(page.getByRole("button", { name: "Analyser" })).toBeDisabled();
      expect(heldSupplierReads).toBeGreaterThan(0);
    } finally {
      holdSupplierReads = false;
      releaseHeldReads();
    }

    const retriedLookups = Promise.all([
      page.browser.waitForResponse(/\/rest\/v1\/suppliers\?/, { timeout: 60_000 }),
      page.browser.waitForResponse(/\/rest\/v1\/products\?/, { timeout: 60_000 }),
    ]);
    await failure.getByRole("button", { name: "Réessayer" }).click();
    for (const response of await retriedLookups) expect(response.status).toBe(200);
    await expect(failure).toBeHidden();
    await expect(page.getByText("us41-lookups-hung.csv", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyser" })).toBeEnabled();
    await page.getByRole("button", { name: "Analyser" }).click();
    await expect(page.getByRole("heading", { name: /Étape 2 [—-] Associer les colonnes/i })).toBeVisible();
    await expect(page.getByText("Fournisseurs inconnus : 0 · Produits inconnus : 1", { exact: true })).toBeVisible();
  });

  test("US-4.3 reports missing supplier coverage without inventing alternatives", async ({ ui: page }) => {
    const ids = await createEstimateViaWizard(page, {
      projectName: `${page.army.runPrefix} no supplier coverage`, title: "ARMY Team B no supplier price",
    });
    const versionId = ids.versionId;
    const ownedLine = await createLineViaApi(page.browser, versionId, `${page.army.runPrefix} ${randomUUID()} no supplier`, {
      product_id: null, selected_supplier_price_id: null,
    });
    await recordEvidence(page.army, "team-b-no-price-fixture", { ids, lineId: ownedLine.id });
    const itemsResponse = await page.request.get(`/api/estimates/${versionId}/items`, {
      failOnStatusCode: false,
    });
    expect(itemsResponse.status()).toBe(200);

    const itemsPayload = (await itemsResponse.json()) as {
      data?: { items?: Array<{ id?: string; item_type?: string }> };
    };
    const lineId =
      itemsPayload.data?.items?.find((item) => item.item_type === "line")?.id ?? null;
    expect(lineId).toBeTruthy();
    expect(lineId).toBe(ownedLine.id);

    await page.goto(`/dashboard/estimates/${versionId}/edit`);
    await expect(page.getByRole("heading", { name: /Éditer le chiffrage/i })).toBeVisible();

    const response = await page.request.post(`/api/estimates/${versionId}/supplier-comparisons`, {
      failOnStatusCode: false,
      data: {
        item_ids: [lineId],
      },
    });
    expect(response.status()).toBe(200);

    const payload = (await response.json()) as {
      data?: {
        comparisons?: Array<{
          coverage_status?: string;
          alternatives?: Array<{ supplier_name?: string; kind?: string }>;
          selected_alternative?: { supplier_name?: string; kind?: string } | null;
        }>;
      };
    };

    const comparison = payload.data?.comparisons?.[0] ?? null;
    expect(comparison?.coverage_status).toBe("no_price");
    expect(comparison?.selected_alternative).toBeNull();
    expect(comparison?.alternatives).toEqual([]);
  });

  test("US-4.4 reviews supplier preselection and creates purchase-order drafts from explicit choices", async ({ ui: page }) => {
    const { versionId, projectId } = await createEstimateViaApi(page, {
      projectName: buildEstimateName("VNEXT-US44"),
      title: "US-4.4 supplier preselection",
    });
    const tenantId = await getTenantIdForVersion(versionId);
    const supplyTypeId = await seedOwnedSupplyType(page.army, versionId);
    const { lineId } = await seedFinishLineLine({
      tenantId,
      versionId,
      supplyTypeId,
      title: "Tube cuivre 18",
      quantity: 12,
    });
    const supplierReference = `TC18-E2E-${Date.now()}`;
    await seedComparableSupplierPrice({
      tenantId,
      supplierName: "Best Supplier E2E",
      productDesignation: "Tube cuivre 18",
      supplierReference,
      unitPriceCents: 2100,
    });
    const { siteId } = await seedDeliverySite({
      tenantId,
      name: "Site US-4.4",
      projectCode: `US44-${Date.now()}`,
    });

    const { client, userId } = await localClient();
    const readMode = async () => {
      const profile = await client.from("profiles").select("ui_mode").eq("id", userId).single();
      if (profile.error || !profile.data) throw new Error("Cannot read the owned UI-mode prerequisite.");
      if (!["simplified", "expert"].includes(profile.data.ui_mode)) throw new Error("Unexpected owned UI mode.");
      return profile.data.ui_mode as "simplified" | "expert";
    };
    const initialMode = await readMode();
    const selectModeViaUi = async (mode: "simplified" | "expert") => {
      const viewport = await page.browser.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      try {
        // The actual drawer trigger is visible below the 960px navigation breakpoint.
        await page.browser.setViewport({ width: 900, height: 800 });
        await page.getByRole("button", { name: "Ouvrir le menu principal", exact: true }).click();
        const navigation = page.getByRole("dialog", { name: "Navigation principale", exact: true });
        await expect(navigation).toBeVisible();
        const modeSwitch = navigation.getByRole("switch", { name: /^Mode (?:Expert|Simplifié) actif, basculer en / });
        await expect(modeSwitch).toBeVisible();
        const desiredSwitch = navigation.getByRole("switch", { name: mode === "expert"
          ? "Mode Expert actif, basculer en Simplifié" : "Mode Simplifié actif, basculer en Expert", exact: true });
        if (!(await desiredSwitch.isVisible())) await modeSwitch.click();
        await expect(desiredSwitch).toBeVisible();
        await expect.poll(readMode).toBe(mode);
        await navigation.getByRole("button", { name: "Fermer le menu", exact: true }).click();
        await expect(navigation).toBeHidden();
      } finally {
        await page.browser.setViewport(viewport);
      }
    };
    await recordEvidence(page.army, "us44-mode-before", { userId, initialMode });
    let modeChangeAttempted = false;
    try {
      await page.goto(`/dashboard/estimates/${versionId}/edit`);
      if (initialMode !== "expert") {
        modeChangeAttempted = true;
        await selectModeViaUi("expert");
      }
      expect(await readMode()).toBe("expert");
      await recordEvidence(page.army, "us44-mode-expert", { userId, initialMode, persistedMode: "expert" });
      const displayTab = page.getByRole("tab", { name: /^Affichage & contrôle(?: \d+)?$/ });
      await expect(displayTab).toBeVisible();
      await displayTab.click();
      await expect(displayTab).toBeSelected();
      await page.getByTestId("estimate-editor-display-button").click();

      const preselectionButton = page.getByRole("button", {
        name: /^Présélectionner les fournisseurs \(\d+\)$/,
      });
      await expect(preselectionButton).toBeVisible();
      await preselectionButton.click();

      const dialog = page.getByRole("dialog", { name: /Présélection fournisseurs/i });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("Propositions", { exact: true })).toBeVisible();
      await expect(dialog.getByText("Exceptions", { exact: true })).toBeVisible();
      await expect(dialog.getByText("Déjà couverts", { exact: true })).toBeVisible();
      await expect(dialog.getByText("Tube cuivre 18").first()).toBeVisible();

      await dialog.getByLabel(/Sélectionner toutes les présélections fournisseurs/i).check();
      await dialog.getByRole("button", { name: /Appliquer la sélection/i }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });

      const preparationResponse = await page.request.get(
        `/api/estimates/${versionId}/purchase-order-drafts`,
        {
          failOnStatusCode: false,
        }
      );
      expect(preparationResponse.status()).toBe(200);

      const preparationPayload = (await preparationResponse.json()) as {
        data?: {
          groups?: Array<{
            supplier_id?: string;
            line_count?: number;
            lines?: Array<{ item_id?: string }>;
          }>;
          blocked_lines?: unknown[];
        };
      };

      const preparedGroup = preparationPayload.data?.groups?.[0] ?? null;
      expect(preparedGroup?.line_count).toBe(1);
      expect(preparationPayload.data?.blocked_lines ?? []).toHaveLength(0);

      expect(preparedGroup?.lines?.map((line) => line.item_id)).toEqual([lineId]);
      await page.goto(`/dashboard/affaires/${projectId}`);
      const purchasePanel = page.locator("#finish-line-orders");
      await expect(purchasePanel.getByText("Brouillons proposés", { exact: true })).toBeVisible();
      await purchasePanel.getByRole("combobox", { name: "Chantier de livraison" }).selectOption({ value: siteId });
      await purchasePanel.getByRole("checkbox", { name: "À déterminer", exact: true }).uncheck();
      await expect(purchasePanel.getByRole("checkbox", { name: "À déterminer", exact: true })).not.toBeChecked();
      const deliveryDate = purchasePanel.getByLabel("Livraison cible", { exact: true });
      await deliveryDate.fill("2026-03-25");
      await expect(deliveryDate).toHaveValue("2026-03-25");
      const createDraft = purchasePanel.getByRole("button", { name: "Créer le brouillon", exact: true });
      await expect(createDraft).toBeDisabled();
      await purchasePanel.getByRole("checkbox", { name: "J’ai vérifié les lignes, les montants et la livraison.", exact: true }).check();
      await expect(createDraft).toBeEnabled();
      const draftResponsePromise = page.browser.waitForResponse(
        `**/api/estimates/${versionId}/purchase-order-drafts`
      );
      await createDraft.click();
      const draftResponse = await draftResponsePromise;
      expect([200, 201]).toContain(draftResponse.status);

      const draftPayload = JSON.parse(await draftResponse.text()) as {
        data?: {
          orders?: Array<{ purchase_order_id?: string; ordered_source_item_ids?: string[] }>;
        };
      };

      expect(draftPayload.data?.orders?.[0]?.ordered_source_item_ids).toEqual(
        expect.arrayContaining([lineId])
      );
      await recordEvidence(page.army, "us44-purchase-draft", {
        versionId, sourceItemId: lineId, siteId,
        status: draftResponse.status, orders: draftPayload.data?.orders ?? [],
      });

      const purchaseOrderId = draftPayload.data?.orders?.[0]?.purchase_order_id;
      expect(draftPayload.data?.orders).toHaveLength(1);
      expect(purchaseOrderId).toBeTruthy();
      const ownedFixture = await localTakeoffFixture(page.army, { projectId, versionId });
      expect(ownedFixture.tenantId).toBe(tenantId);
      const savedOrder = await client.from("purchase_orders")
        .select("id, user_id, tenant_id, source_estimate_version_id, delivery_site_id, expected_delivery_date")
        .eq("id", purchaseOrderId!).eq("tenant_id", tenantId).eq("user_id", userId).eq("source_estimate_version_id", versionId).single();
      await recordEvidence(page.army, "us44-delivery-persisted", { purchaseOrderId, savedOrder: savedOrder.data });
      expect(savedOrder.error).toBe(null);
      expect(savedOrder.data).toEqual({ id: purchaseOrderId, user_id: userId, tenant_id: tenantId,
        source_estimate_version_id: versionId, delivery_site_id: siteId, expected_delivery_date: "2026-03-25" });
      (page.army.ownedPurchaseOrders ??= []).push({ orderId: purchaseOrderId!, projectId, versionId, tenantId });
      await recordEvidence(page.army, "us44-purchase-editor-boundary", { userId, order: page.army.ownedPurchaseOrders[0],
        reads: ["owned order snapshot", "owned item count HEAD", "owned revision", "exact active supplier/site lookups"] });
      await page.goto(`/dashboard/orders/${purchaseOrderId}/edit`);
      await expect(page.browser).toHaveURL(new RegExp(`/dashboard/orders/${purchaseOrderId}/edit`, "i"));
      await expect(page.getByRole("option", { selected: true }).first()).toHaveText(
        /Best Supplier E2E/i
      );
      await expect(page.getByRole("textbox", { name: /D[ée]signation/i }).first()).toHaveValue(
        "Tube cuivre 18"
      );
    } finally {
      if (modeChangeAttempted) {
        // A fresh page also closes any supplier dialog left open by a failure.
        await page.goto("/dashboard/affaires");
        await selectModeViaUi(initialMode);
      }
      const restoredMode = await readMode();
      expect(restoredMode).toBe(initialMode);
      await recordEvidence(page.army, "us44-mode-restored", { userId, initialMode, restoredMode, modeChangeAttempted });
    }
  });

  test("US-6.2 keeps takeoff recovery context visible in the affaire-first hub", async ({ ui: page }) => {
    const projectId = await createPendingRecoveryFixture(page);
    await page.goto(`/dashboard/affaires/${projectId}`);

    const plansSection = page.locator("#plans");

    await expect(plansSection).toBeVisible();
    await expect(plansSection.getByText("Reprise en attente", { exact: true })).toBeVisible();
    await expect(plansSection.getByText("1 acquis")).toBeVisible();
    await expect(plansSection.getByText("1 en attente")).toBeVisible();
    await expect(plansSection.getByText("0 à corriger")).toBeVisible();
    const pendingVersion = plansSection.getByRole("listitem").filter({ has: page.getByText("V2", { exact: true }) });
    const completedVersion = plansSection.getByRole("listitem").filter({ has: page.getByText("V1", { exact: true }) });
    await expect(pendingVersion).toHaveCount(1);
    await expect(pendingVersion.getByText("En attente provider", { exact: true })).toBeVisible();
    await expect(completedVersion).toHaveCount(1);
    await expect(completedVersion.getByText("Analyse terminée", { exact: true })).toBeVisible();
  });

  test("US-6.3 makes the main, adjacent and legacy takeoff hierarchy explicit", async ({ ui: page }) => {
    const ids = await createHierarchyFixture(page);
    await page.goto(`/dashboard/affaires/${ids.projectId}`);

    const flowHierarchy = page
      .locator("section")
      .filter({ has: page.getByText("Prochaine étape", { exact: true }) })
      .first();

    await expect(flowHierarchy).toBeVisible();
    await expect(flowHierarchy.getByText("Documents à confirmer", { exact: true })).toBeVisible();
    await expect(
      flowHierarchy.getByRole("button", { name: "Pourquoi TIMAX hésite" })
    ).toBeVisible();
    await expect(flowHierarchy.getByText("Blocages à traiter")).toBeVisible();
    await expect(
      flowHierarchy.getByRole("link", { name: "Ouvrir l’ancien parcours" })
    ).toBeVisible();
    await expect(flowHierarchy.getByRole("link", { name: "Ouvrir l’ancien parcours" })).toHaveAttribute(
      "href", `/dashboard/estimates/${ids.versionId}/takeoff`,
    );
  });
});
