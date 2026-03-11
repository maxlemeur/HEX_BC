import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import * as XLSX from "xlsx";

loadEnvConfig(path.resolve(__dirname, "../.."));

import {
  buildEstimateName,
  createEstimateViaWizard,
  ensureMapping,
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
  XLSX.writeFile(workbook, filePath, { bookType: "xlsx" });
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
  XLSX.writeFile(workbook, filePath, { bookType: "xlsx" });
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

function readSupabaseAuthCookieValue(
  cookies: Array<{
    name: string;
    value: string;
  }>
) {
  const byBaseName = new Map<
    string,
    {
      fullValue: string | null;
      chunks: Map<number, string>;
    }
  >();

  for (const cookie of cookies) {
    const match = cookie.name.match(/^(sb-.*-auth-token)(?:\.(\d+))?$/i);
    if (!match) continue;

    const baseName = match[1] ?? cookie.name;
    const chunkIndexRaw = match[2];
    const entry = byBaseName.get(baseName) ?? {
      fullValue: null,
      chunks: new Map<number, string>(),
    };

    if (typeof chunkIndexRaw === "string") {
      entry.chunks.set(Number.parseInt(chunkIndexRaw, 10), cookie.value);
    } else {
      entry.fullValue = cookie.value;
    }

    byBaseName.set(baseName, entry);
  }

  for (const candidate of byBaseName.values()) {
    if (candidate.chunks.size === 0) {
      if (candidate.fullValue) return candidate.fullValue;
      continue;
    }

    const parts: string[] = [];
    let index = 0;
    while (candidate.chunks.has(index)) {
      parts.push(candidate.chunks.get(index) ?? "");
      index += 1;
    }

    if (parts.length === candidate.chunks.size && parts.length > 0) {
      return parts.join("");
    }
  }

  return null;
}

function extractAccessTokenFromCookie(cookieValue: string) {
  const decoded = decodeURIComponent(cookieValue);
  const payload = decoded.startsWith("base64-")
    ? Buffer.from(decoded.slice("base64-".length), "base64").toString("utf8")
    : decoded;
  const parsed = JSON.parse(payload) as { access_token?: string };

  if (typeof parsed.access_token !== "string" || parsed.access_token.length === 0) {
    throw new Error("Missing access token in Supabase auth cookie.");
  }

  return parsed.access_token;
}

async function uploadAndClassifyIntakeDpgf(page: Page, input: {
  projectId: string;
  fixturePath: string;
}) {
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

  const authCookieValue = readSupabaseAuthCookieValue(await page.context().cookies());
  if (!authCookieValue) {
    throw new Error("Missing Supabase auth cookie for intake reclassification.");
  }

  const accessToken = extractAccessTokenFromCookie(authCookieValue);
  const nowIso = new Date().toISOString();
  const supabaseUrl = envOrThrow("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = envOrThrow("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const reclassifyResponse = await page.request.patch(
    `${supabaseUrl}/rest/v1/affaire_intake_documents?id=eq.${documentId}`,
    {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      data: {
        document_kind: "dpgf",
        classification_status: "classified",
        confidence: 0.99,
        issues: [],
        classification_source: "manual",
        classified_at: nowIso,
        manually_overridden_at: nowIso,
      },
      failOnStatusCode: false,
    }
  );

  expect([200, 204].includes(reclassifyResponse.status())).toBe(true);
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
  const supplierPriceId = randomUUID();

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
    tax_rate_bp: 2000,
    is_active: true,
  });
  if (productError) {
    throw new Error(`Seed product failed: ${productError.message}`);
  }

  const { error: priceError } = await sb.from("supplier_pricebook").insert({
    id: supplierPriceId,
    tenant_id: input.tenantId,
    supplier_id: supplierId,
    product_id: productId,
    supplier_sku: input.supplierReference,
    unit: "u",
    min_quantity: 1,
    unit_price_cents: input.unitPriceCents,
    currency: "EUR",
    valid_from: "2026-03-01",
    valid_to: null,
    is_active: true,
    notes: "Seed US-4.4",
  });
  if (priceError) {
    throw new Error(`Seed supplier price failed: ${priceError.message}`);
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

test.describe("VNEXT Team B - user stories e2e", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithUi(page);
  });

  test("US-2.1 exposes mapping import stats in the canonical mapping wizard", async ({
    page,
  }, testInfo) => {
    const fixturePath = testInfo.outputPath("us21-mapping-stats.xlsx");
    createDuplicateAwareDpgfWorkbook(fixturePath);

    await page.goto("/dashboard/imports");
    await expect(page.getByRole("heading", { name: /Import DPGF/i })).toBeVisible();

    await page.setInputFiles("#import-file-input", fixturePath);
    await page.getByRole("button", { name: /^(Importer|Lancer l['’]import)$/i }).first().click();

    const mapLink = page.getByRole("link", { name: /Mapper les colonnes/i });
    await expect(mapLink).toBeVisible({ timeout: 60_000 });
    await mapLink.click();

    await expect(page).toHaveURL(/\/dashboard\/mappings\?import_id=/i);
    await ensureMapping(page, "hex_code", "hex_code");
    await ensureMapping(page, "designation", "designation");
    await ensureMapping(page, "quantity", "quantity");
    await ensureMapping(page, "unit", "unit");
    await ensureMapping(page, "unit_price_ht", "unit_price_ht");
    await ensureMapping(page, "total_ht", "total_ht");

    await expect(
      page.getByRole("heading", { name: /Apercu des donnees mappees/i })
    ).toBeVisible();
    const previewSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: /Apercu des donnees mappees/i }) })
      .first();
    await expect(previewSection.getByText("Validation", { exact: true })).toBeVisible();
    await expect(previewSection.getByText("Champs a completer", { exact: true })).toBeVisible();
    await expect(previewSection.getByText("Doublons", { exact: true })).toBeVisible();
    await expect(
      previewSection.getByText(/groupe\(s\) de doublons detecte\(s\)|Aucun doublon detecte/i)
    ).toBeVisible();
  });

  test("US-2.2 reviews tabular PDF imports before entering the canonical flow", async ({
    page,
  }) => {
    const pdfFixturePath = path.join(process.cwd(), "e2e/fixtures/us22_live_tabular.pdf");

    await page.goto("/dashboard/imports");
    await expect(page.getByRole("heading", { name: /Import DPGF/i })).toBeVisible();

    await page.setInputFiles("#import-file-input", pdfFixturePath);

    await expect(page.getByText(/Validation renforcee/i)).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText(
        /Le PDF rejoint le mapping standard uniquement apres approbation explicite/i
      )
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Valider les tableaux et lancer l'import/i })
    ).toBeVisible();

    await page.getByRole("button", { name: /Valider les tableaux et lancer l'import/i }).click();
    const mapLink = page.getByRole("link", { name: /Mapper les colonnes/i });
    await expect(mapLink).toBeVisible({ timeout: 60_000 });
    await mapLink.click();

    await expect(page).toHaveURL(/\/dashboard\/mappings\?import_id=/i);
    await expect(page.getByRole("heading", { name: /Mapping DPGF/i })).toBeVisible();
  });

  test("US-2.3 materializes imported DPGF rows into a new estimate version with totals", async ({
    page,
  }, testInfo) => {
    const fixturePath = testInfo.outputPath("us23-materialize.xlsx");
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
    await page.getByRole("button", { name: /Lancer l'import structure/i }).click();
    await expect(page.getByText("Glissez-deposez votre fichier DPGF ici")).toBeVisible();

    await page.locator('input[type="file"]').first().setInputFiles(fixturePath);
    await page.getByRole("button", { name: "Lancer l'import" }).click();

    await expect(page.getByRole("button", { name: /Suivant : Apercu/i })).toBeVisible({
      timeout: 60_000,
    });

    await ensureMapping(page, "hex_code", "hex_code");
    await ensureMapping(page, "designation", "designation");
    await ensureMapping(page, "quantity", "quantity");
    await ensureMapping(page, "unit", "unit");
    await ensureMapping(page, "unit_price_ht", "unit_price_ht");
    await ensureMapping(page, "total_ht", "total_ht");

    await page.getByRole("button", { name: /Suivant : Apercu/i }).click();
    await page.getByRole("button", { name: /Suivant : Confirmation/i }).click();
    await page.getByRole("button", { name: /Creer le chiffrage/i }).click();

    await expect
      .poll(async () => fetchLatestProjectVersion(projectId), {
        timeout: 60_000,
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

  test("US-4.1 keeps supplier CSV import guided and explicit inside the canonical flow", async ({
    page,
  }) => {
    await page.goto("/dashboard/affaires/436dcf37-73c8-4d95-9ab2-42759deaa991/prices");
    await expect(page.getByRole("heading", { name: "Prix fournisseurs", exact: true })).toBeVisible();

    await page.locator('input[type="file"]').first().setInputFiles({
      name: "us41-guided.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "supplier_name;product_label;supplier_ref;unit_price_ht;currency",
          "Stabilize Supplier;Tube cuivre 18;TC18-STAB;21.00;EUR",
        ].join("\n"),
        "utf8"
      ),
    });

    await page.getByRole("button", { name: "Analyser" }).first().click();
    await expect(page.getByRole("heading", { name: /Etape 1 - Charger le CSV/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Etape 2 - Associer les colonnes/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Etape 3 - Resoudre les inconnus/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Etape 4 - Importer/i })).toBeVisible();
    await expect(page.getByRole("cell", { name: /Fournisseur inconnu/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Importer les lignes pretes/i })).toBeDisabled();
  });

  test("US-4.3 preserves supplier comparison coverage and the current selection alternative", async ({
    page,
  }) => {
    const versionId = "b685e238-191e-48e8-8622-3beacb2ad966";
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
    expect(comparison?.coverage_status).toBe("stale");
    expect(comparison?.selected_alternative?.kind).toBe("selected_current");

    const alternativeKinds = (comparison?.alternatives ?? [])
      .map((alternative) => alternative.kind)
      .filter((value): value is string => typeof value === "string");
    expect(alternativeKinds).toEqual(
      expect.arrayContaining([
        "best_price",
        "most_recent",
        "selected_current",
        "preferred_supplier",
      ])
    );

    const supplierNames = (comparison?.alternatives ?? [])
      .map((alternative) => alternative.supplier_name)
      .filter((value): value is string => typeof value === "string");
    expect(supplierNames).toEqual(expect.arrayContaining(["Best Supplier", "Preferred Supplier", "Old Supplier"]));
  });

  test("US-4.4 reviews supplier preselection and creates purchase-order drafts from explicit choices", async ({
    page,
  }) => {
    const { versionId } = await createEstimateViaApi(page, {
      projectName: buildEstimateName("VNEXT-US44"),
      title: "US-4.4 supplier preselection",
    });
    const tenantId = await getTenantIdForVersion(versionId);
    const supplyTypeId = await fetchSupplyTypeId();
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

    await page.goto(`/dashboard/estimates/${versionId}/edit`);
    await page.getByRole("button", { name: "Outils" }).click();

    const preselectionButton = page.getByRole("button", {
      name: /Préselection fournisseurs \(\d+\)/i,
    });
    await expect(preselectionButton).toBeVisible();
    await preselectionButton.click();

    const dialog = page.getByRole("dialog", { name: /Présélection fournisseurs/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Propositions", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Exceptions", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Déjà couverts", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Tube cuivre 18").first()).toBeVisible();

    await dialog.getByLabel(/Sélectionner toutes les préselections fournisseurs/i).check();
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

    const draftResponse = await page.request.post(
      `/api/estimates/${versionId}/purchase-order-drafts`,
      {
        failOnStatusCode: false,
        data: {
          groups: [
            {
              supplier_id: preparedGroup?.supplier_id,
              delivery_site_id: siteId,
              item_ids: [lineId],
              expected_delivery_date: "2026-03-25",
            },
          ],
        },
      }
    );
    expect([200, 201]).toContain(draftResponse.status());

    const draftPayload = (await draftResponse.json()) as {
      data?: {
        orders?: Array<{ purchase_order_id?: string; ordered_source_item_ids?: string[] }>;
      };
    };

    expect(draftPayload.data?.orders?.[0]?.ordered_source_item_ids).toEqual(
      expect.arrayContaining([lineId])
    );

    const purchaseOrderId = draftPayload.data?.orders?.[0]?.purchase_order_id;
    expect(purchaseOrderId).toBeTruthy();
    await page.goto(`/dashboard/orders/${purchaseOrderId}/edit`);
    await expect(page).toHaveURL(new RegExp(`/dashboard/orders/${purchaseOrderId}/edit`, "i"));
    await expect(page.locator("select").first().locator("option:checked")).toHaveText(
      /Best Supplier E2E/i
    );
    await expect(page.getByRole("textbox", { name: /Designation/i }).first()).toHaveValue(
      "Tube cuivre 18"
    );
  });

  test("US-6.2 keeps takeoff recovery context visible in the affaire-first hub", async ({
    page,
  }) => {
    await page.goto("/dashboard/affaires/8ba45ad2-c20d-4b50-b56b-69e2d0bd6e94");

    const plansSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Plans, preuves & exceptions" }) })
      .first();

    await expect(plansSection).toBeVisible();
    await expect(plansSection.getByText("Statuts precedents conserves")).toBeVisible();
    await expect(plansSection.getByText("1 acquis")).toBeVisible();
    await expect(plansSection.getByText("1 en attente")).toBeVisible();
    await expect(plansSection.getByText("0 a corriger")).toBeVisible();
    await expect(plansSection.getByText("En attente provider")).toBeVisible();
    await expect(plansSection.getByText("Analyse terminee")).toBeVisible();
  });

  test("US-6.3 makes the main, adjacent and legacy takeoff hierarchy explicit", async ({
    page,
  }) => {
    await page.goto("/dashboard/affaires/8ba45ad2-c20d-4b50-b56b-69e2d0bd6e94");

    await expect(page.getByText("Parcours recommande", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Flux principal", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Aides adjacentes", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Fallback legacy", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ouvrir le fallback legacy" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ouvrir le centre metres" })).toBeVisible();
  });
});
