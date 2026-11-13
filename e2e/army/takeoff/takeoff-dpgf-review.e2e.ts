import { nativeTest as test, describe, expect, buildEstimateName, duplicateEstimateViaApi, loginWithUi, localClient, type NativeUi as Page } from "./native-ui";
import { resolveDownload, recordEvidence } from "../critical/fixtures";
import { localTakeoffWorkerClient } from "./fixtures";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import type { TakeoffDpgfComparisonResponse } from "@/lib/takeoff/types";

type SeededEstimateLine = {
  id: string;
  title: string;
  quantity: number;
  position: number;
  sourcePage: number;
  sourceFileName: string;
  description?: string | null;
  unitPriceHtCents?: number | null;
  mappedRowId?: string;
};

type SeededTakeoffItem = {
  id?: string;
  designation: string;
  quantity: number;
  unit: string;
  confidence?: number | null;
  evidence?: string | null;
  sourcePage?: number | null;
  sourceFileName: string;
};

async function getAuthenticatedSupabaseClient() { return (await localClient()).client; }

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
        name: `${page.army.runPrefix}-${options.projectName}`,
      },
      version: {
        title: options.title,
        date_devis: options.dateDevis ?? "2026-02-02",
        validite_jours: options.validiteJours ?? 30,
      },
    },
  });
  const body = await response.text();

  expect(
    response.status(),
    `Failed to create estimate. status=${response.status()} body=${body}`
  ).toBe(201);

  let payload: unknown = null;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = null;
  }

  if (!payload || typeof payload !== "object") {
    throw new Error(`Invalid create estimate payload: ${body}`);
  }

  const root = payload as Record<string, unknown>;
  const data =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : root;
  const version =
    data.version && typeof data.version === "object"
      ? (data.version as Record<string, unknown>)
      : null;
  const versionId =
    (version && typeof version.id === "string" ? version.id : null) ??
    (typeof data.version_id === "string" ? data.version_id : null) ??
    (typeof data.versionId === "string" ? data.versionId : null) ??
    (typeof root.version_id === "string" ? root.version_id : null) ??
    (typeof root.versionId === "string" ? root.versionId : null) ??
    null;

  if (!versionId) {
    throw new Error(`Unable to extract created version id from payload: ${body}`);
  }

  return { versionId };
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
async function getAuthenticatedUserId() { return (await localClient()).userId; }

async function seedDpgfImport(input: {
  tenantId: string;
  projectId: string;
  userId: string;
  filename: string;
  rows: Array<{ rowIndex: number; unit: string; id?: string; quantity?: number }>;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const importId = randomUUID();

  const { error: importError } = await sb.from("dpgf_imports").insert({
    id: importId,
    tenant_id: input.tenantId,
    user_id: input.userId,
    filename: input.filename,
    source_format: input.filename.endsWith(".pdf") ? "pdf" : "xlsx",
    status: "completed",
    row_count: input.rows.length,
    parse_mode: "server",
    project_id: input.projectId,
  } as never);

  if (importError) {
    throw new Error(`Seed dpgf import failed: ${importError.message}`);
  }

  if (input.rows.length === 0) {
    return importId;
  }

  const { error: rowsError } = await sb.from("dpgf_rows_mapped").insert(
    input.rows.map((row) => ({
      id: row.id ?? randomUUID(),
      tenant_id: input.tenantId,
      import_id: importId,
      payload: {
        row_index: row.rowIndex,
        unit: row.unit,
        ...(row.quantity === undefined ? {} : { quantity: row.quantity }),
      },
      status: "mapped",
    })) as never
  );

  if (rowsError) {
    throw new Error(`Seed dpgf mapped rows failed: ${rowsError.message}`);
  }

  return importId;
}

async function seedEstimateLines(input: {
  tenantId: string;
  versionId: string;
  lines: SeededEstimateLine[];
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const sectionId = randomUUID();
  const { error } = await sb.from("estimate_items").insert(
    [
      {
        id: sectionId,
        tenant_id: input.tenantId,
        version_id: input.versionId,
        item_type: "section",
        position: 0,
        title: "DPGF seed",
        source_metadata: {},
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
      ...input.lines.map((line) => ({
      id: line.id,
      tenant_id: input.tenantId,
      version_id: input.versionId,
      parent_id: sectionId,
      item_type: "line",
      position: line.position,
      title: line.title,
      description: line.description ?? null,
      quantity: line.quantity,
      unit_price_ht_cents: line.unitPriceHtCents ?? 0,
      tax_rate_bp: 2000,
      k_fo: 1,
      h_mo: 0,
      h_mo_majoration: 1,
      k_mo: 1,
      pu_ht_cents: line.unitPriceHtCents ?? 0,
      line_total_ht_cents:
        line.unitPriceHtCents !== null && line.unitPriceHtCents !== undefined
          ? Math.round(line.unitPriceHtCents * line.quantity)
          : 0,
      line_tax_cents:
        line.unitPriceHtCents !== null && line.unitPriceHtCents !== undefined
          ? Math.round(line.unitPriceHtCents * line.quantity * 0.2)
          : 0,
      line_total_ttc_cents:
        line.unitPriceHtCents !== null && line.unitPriceHtCents !== undefined
          ? Math.round(line.unitPriceHtCents * line.quantity * 1.2)
          : 0,
      source_provider: "dpgf",
      source_file_name: line.sourceFileName,
      source_metadata: line.mappedRowId ? { mapped_row_id: line.mappedRowId } : { dpgf_source_quantity: line.quantity },
      source_page: line.sourcePage,
      })),
    ] as never
  );

  if (error) {
    throw new Error(`Seed estimate items failed: ${error.message}`);
  }
}

async function seedCompletedTakeoffJob(page: Page, input: {
  tenantId: string;
  versionId: string;
  sourceFileName: string;
  items: SeededTakeoffItem[];
}) {
  const { client: sb, tenantId } = await localTakeoffWorkerClient(page.army, input.versionId);
  expect(tenantId).toBe(input.tenantId);
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
    confidence: 0.84,
  });

  if (resultError) {
    throw new Error(`Seed takeoff result failed: ${resultError.message}`);
  }

  const itemIdsByDesignation = new Map<string, string>();
  const { error: itemsError } = await sb.from("takeoff_items").insert(
    input.items.map((item) => {
      const itemId = item.id ?? randomUUID();
      itemIdsByDesignation.set(item.designation, itemId);

      return {
        id: itemId,
        tenant_id: input.tenantId,
        job_id: jobId,
        result_id: resultId,
        designation: item.designation,
        quantity: item.quantity,
        unit: item.unit,
        confidence: item.confidence ?? null,
        evidence: item.evidence ?? null,
        source_file_name: item.sourceFileName,
        source_page: item.sourcePage ?? null,
        metadata: {},
        is_excluded: false,
        is_verified: false,
      };
    }) as never
  );

  if (itemsError) {
    throw new Error(`Seed takeoff items failed: ${itemsError.message}`);
  }

  return {
    jobId,
    itemIdsByDesignation,
  };
}

async function seedReviewDecision(input: {
  tenantId: string;
  versionId: string;
  jobId: string;
  estimateItemId: string;
  reviewReference: string;
  lineLabel: string;
  linePosition: number;
  sourceFileName: string;
  sourcePage: number;
  decision: "keep_dpgf" | "keep_takeoff" | "manual_fix" | "out_of_scope";
  reason: string;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const nowIso = new Date().toISOString();

  const { error } = await sb.from("takeoff_dpgf_review_decisions").insert({
    id: randomUUID(),
    tenant_id: input.tenantId,
    version_id: input.versionId,
    takeoff_job_id: input.jobId,
    estimate_item_id: input.estimateItemId,
    review_reference: input.reviewReference,
    line_label: input.lineLabel,
    line_position: input.linePosition,
    source_file_name: input.sourceFileName,
    source_page: input.sourcePage,
    decision: input.decision,
    reason: input.reason,
    decided_at: nowIso,
    updated_at: nowIso,
    decided_by: null,
  } as never);

  if (error) {
    throw new Error(`Seed takeoff review decision failed: ${error.message}`);
  }
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

async function readEstimateItemUnitPrice(input: {
  tenantId: string;
  versionId: string;
  estimateItemId: string;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const { data, error } = await sb
    .from("estimate_items")
    .select("unit_price_ht_cents")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .eq("id", input.estimateItemId)
    .single();

  if (error) {
    throw new Error(`Cannot read estimate item unit price: ${error.message}`);
  }

  return (data as { unit_price_ht_cents?: number | null }).unit_price_ht_cents ?? null;
}

async function readLatestAppliedPriceSuggestion(input: {
  tenantId: string;
  versionId: string;
  jobId: string;
  estimateItemId: string;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const { data, error } = await sb
    .from("takeoff_price_suggestions")
    .select("status, selected_action, selected_price_cents, review_note, target_cents")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .eq("takeoff_job_id", input.jobId)
    .eq("estimate_item_id", input.estimateItemId)
    .eq("status", "applied")
    .order("reviewed_at", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    throw new Error(`Cannot read applied price suggestion: ${error.message}`);
  }

  return data as {
    status: string;
    selected_action: string | null;
    selected_price_cents: number | null;
    review_note: string | null;
    target_cents: number;
  };
}

async function acquireDraftLockViaApi(page: Page, versionId: string, jobId: string) {
  const acquired = await page.browser.evaluate(async (id) => {
    const scope = globalThis as typeof globalThis & { __miaouffrageEstimateDraftLockSessions?: Map<string, string> };
    const sessions = scope.__miaouffrageEstimateDraftLockSessions ??= new Map<string, string>();
    const session = sessions.get(id) ?? sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${id}`) ?? crypto.randomUUID();
    sessions.set(id, session);
    sessionStorage.setItem(`__miaouffrageEstimateDraftLockSession:${id}`, session);
    const response = await fetch(`/api/estimates/${id}/lock`, { method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-estimate-draft-lock-session-id": session }, body: "{}" });
    const result = await response.json();
    return { status: response.status, current: result.data?.lock?.is_current_session === true };
  }, versionId);
  expect(acquired).toEqual({ status: 201, current: true });
  // Preserve the historical explicit lease fixture for takeoff/client requests.
  // The header stays inside the page and the central network guard still sees it.
  await page.browser.evaluate(({ versionId, jobId }) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (resource, init) => {
      const request = resource instanceof Request ? resource : null;
      const url = new URL(request?.url ?? String(resource), location.href);
      const method = init?.method ?? request?.method ?? "GET";
      if (url.origin === location.origin && method === "PATCH" &&
        url.pathname.startsWith(`/api/takeoff/jobs/${jobId}/price-suggestions/`)) {
        const session = sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${versionId}`);
        if (!session) throw new Error("The owned price-review lease is absent.");
        const headers = new Headers(init?.headers ?? request?.headers);
        headers.set("x-estimate-draft-lock-session-id", session);
        return originalFetch(resource, { ...init, headers });
      }
      return originalFetch(resource, init);
    };
    return true;
  }, { versionId, jobId });
}

function normalizeTakeoffCompareText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lineRef(line: Pick<SeededEstimateLine, "sourceFileName" | "sourcePage">) {
  return normalizeTakeoffCompareText(`${line.sourceFileName} row ${line.sourcePage}`);
}

async function waitForDpgfComparison(page: Page) {
  await expect(page.getByRole("heading", { name: "Comparaison DPGF explicable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Exceptions seulement" })).toBeVisible();
}

describe("V3-010 — DPGF review page", { session: "army", tags: ["critical", "extended"], timeout: 180_000 }, () => {
  test.beforeEach(async ({ ui: page }) => {
    await loginWithUi(page);
  });

  test("defaults to the affaire-first validation review with clear next steps", async ({ ui: page }) => {
    const dpgfFileName = `dpgf-validation-${Date.now()}.xlsx`;
    const takeoffFileName = `plans-validation-${Date.now()}.pdf`;
    const { versionId } = await createEstimateViaApi(page, {
      projectName: buildEstimateName("V3010-VALIDATION"),
      title: "V3-010 validation review affaire-first",
    });
    const projectId = await extractProjectId(page, versionId);
    const tenantId = await getTenantIdForVersion(versionId);
    const userId = await getAuthenticatedUserId();

    const cloisonLine: SeededEstimateLine = {
      id: randomUUID(),
      title: "Cloison BA13",
      quantity: 10,
      position: 1,
      sourcePage: 13,
      sourceFileName: dpgfFileName,
    };

    await seedDpgfImport({
      tenantId,
      projectId,
      userId,
      filename: dpgfFileName,
      rows: [{ rowIndex: cloisonLine.sourcePage, unit: "m2" }],
    });

    await seedEstimateLines({
      tenantId,
      versionId,
      lines: [cloisonLine],
    });

    const seededJob = await seedCompletedTakeoffJob(page, {
      tenantId,
      versionId,
      sourceFileName: takeoffFileName,
      items: [
        {
          designation: "Cloison BA13",
          quantity: 8,
          unit: "m2",
          confidence: 0.42,
          evidence: null,
          sourcePage: null,
          sourceFileName: takeoffFileName,
        },
      ],
    });

    await page.goto(
      `/dashboard/affaires/${projectId}/takeoff/${seededJob.jobId}/review?versionId=${versionId}`
    );

    await expect(
      page.getByRole("heading", { name: "Revue des exceptions & preuves" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Centre d'activité métrés" })
    ).toHaveAttribute("href", `/dashboard/affaires/${projectId}/takeoff`);
    await expect(
      page.getByRole("tab", { name: "Validation : Exceptions et couverture" })
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByText("Traitez d'abord les exceptions qui peuvent biaiser le chiffrage")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Revue détaillée" }).first()).toBeVisible();
    await expect(page.getByText("Cloison BA13")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Ouvrir les preuves|Ajouter une preuve/i })
    ).toBeVisible();
  });

  test("opens the controlled apply wizard with explicit strategy and provenance preview", async ({ ui: page }) => {
    const takeoffFileName = `plans-apply-${Date.now()}.pdf`;
    const { versionId } = await createEstimateViaApi(page, {
      projectName: buildEstimateName("V3010-APPLY"),
      title: "V3-010 apply wizard affaire-first",
    });
    const projectId = await extractProjectId(page, versionId);
    const tenantId = await getTenantIdForVersion(versionId);

    await seedEstimateLines({
      tenantId,
      versionId,
      lines: [],
    });

    const seededJob = await seedCompletedTakeoffJob(page, {
      tenantId,
      versionId,
      sourceFileName: takeoffFileName,
      items: [
        {
          designation: "Cloison BA13",
          quantity: 8,
          unit: "m2",
          confidence: 0.92,
          evidence: "Zone cloison",
          sourcePage: 7,
          sourceFileName: takeoffFileName,
        },
      ],
    });

    await page.goto(
      `/dashboard/affaires/${projectId}/takeoff/${seededJob.jobId}/review?versionId=${versionId}&reviewMode=production`
    );

    await expect(
      page.getByRole("button", { name: "Appliquer au chiffrage" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Appliquer au chiffrage" }).click();
    await expect(page.getByText("Cible d'application")).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Section cible" })
    ).toHaveValue(/.+/);

    await page.getByRole("button", { name: "Suivant" }).click();
    await expect(page.getByRole("radio", { name: /Fusionner avec l'existant/i })).toBeVisible();
    await page.getByRole("radio", { name: /Fusionner avec l'existant/i }).click();
    await page.getByRole("button", { name: "Suivant" }).click();

    await expect(page.getByText("Preview d'impact")).toBeVisible();
    await expect(page.getByText(`Source du métré : ${takeoffFileName}`)).toBeVisible();
    await expect(page.getByText(takeoffFileName).first()).toBeVisible();
    await expect(page.getByText("page 7")).toBeVisible();
    await expect(page.getByText("Hors mapping").first()).toBeVisible();
  });

  test("supports exceptions export and manual multi-linking", async ({ ui: page }) => {
    const dpgfFileName = `dpgf-current-${Date.now()}.xlsx`;
    const takeoffFileName = `plans-current-${Date.now()}.pdf`;
    const { versionId } = await createEstimateViaApi(page, {
      projectName: buildEstimateName("V3010-DPGF"),
      title: "V3-010 DPGF review current",
    });
    const projectId = await extractProjectId(page, versionId);
    const tenantId = await getTenantIdForVersion(versionId);
    const userId = await getAuthenticatedUserId();

    const fauxPlafondLine: SeededEstimateLine = {
      id: randomUUID(),
      title: "Faux plafond acoustique",
      quantity: 100,
      position: 1,
      sourcePage: 12,
      sourceFileName: dpgfFileName,
    };
    const cloisonLine: SeededEstimateLine = {
      id: randomUUID(),
      title: "Cloison BA13",
      quantity: 10,
      position: 2,
      sourcePage: 13,
      sourceFileName: dpgfFileName,
    };
    const moquetteLine: SeededEstimateLine = {
      id: randomUUID(),
      title: "Moquette",
      quantity: 5,
      position: 3,
      sourcePage: 14,
      sourceFileName: dpgfFileName,
    };

    await seedDpgfImport({
      tenantId,
      projectId,
      userId,
      filename: dpgfFileName,
      rows: [
        { rowIndex: fauxPlafondLine.sourcePage, unit: "m2" },
        { rowIndex: cloisonLine.sourcePage, unit: "m2" },
        { rowIndex: moquetteLine.sourcePage, unit: "m2" },
      ],
    });

    await seedEstimateLines({
      tenantId,
      versionId,
      lines: [fauxPlafondLine, cloisonLine, moquetteLine],
    });

    const seededJob = await seedCompletedTakeoffJob(page, {
      tenantId,
      versionId,
      sourceFileName: takeoffFileName,
      items: [
        {
          designation: "Faux plafond acoustique",
          quantity: 72,
          unit: "m2",
          confidence: 0.92,
          evidence: "Zone plafonds",
          sourcePage: 5,
          sourceFileName: takeoffFileName,
        },
        {
          designation: "Zone A separatif",
          quantity: 4,
          unit: "m2",
          confidence: 0.9,
          evidence: "Zone A",
          sourcePage: 3,
          sourceFileName: takeoffFileName,
        },
        {
          designation: "Zone B separatif",
          quantity: 6,
          unit: "m2",
          confidence: 0.88,
          evidence: "Zone B",
          sourcePage: 4,
          sourceFileName: takeoffFileName,
        },
        {
          designation: "Moquette",
          quantity: 5,
          unit: "m2",
          confidence: 0.91,
          evidence: "Zone moquette",
          sourcePage: 6,
          sourceFileName: takeoffFileName,
        },
      ],
    });

    await page.goto(
      `/dashboard/affaires/${projectId}/takeoff/${seededJob.jobId}/review?versionId=${versionId}&reviewMode=production&view=dpgf&dpgfView=exceptions_only`
    );
    await waitForDpgfComparison(page);

    await expect(page.getByRole("button", { name: /Faux plafond acoustique/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Cloison BA13/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Moquette/i })).toHaveCount(0);

    const download = await page.browser.waitForDownload(() => page.getByRole("button", "Export CSV", { exact: true }).click());
    const downloadPath = await resolveDownload(download);
    const csvContent = await fs.readFile(downloadPath, "utf8");
    await recordEvidence(page.army, "dpgf-exceptions-export", { versionId, jobId: seededJob.jobId, downloadPath, csvContent });

    expect(csvContent).toContain("Faux plafond acoustique");
    expect(csvContent).toContain("Cloison BA13");
    expect(csvContent).not.toContain("Moquette");

    const cloisonRow = page.getByRole("button", { name: /Cloison BA13/i });
    await cloisonRow.click();

    // Risk cards repeat these labels; assert the persisted proof groups of the selected line.
    const persistedProofs = page.locator("aside > div > div").filter({
      has: page.getByText("Traçabilité persistée", { exact: true }),
    });
    await expect(persistedProofs).toHaveCount(1);
    await expect(persistedProofs.getByText("Faits", { exact: true })).toBeVisible();
    await expect(persistedProofs.getByText("Hypothèses", { exact: true })).toBeVisible();
    await expect(persistedProofs.getByText("Inférences", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Recomposer les liens" }).click();
    const modal = page.getByRole("dialog", { name: /Lier manuellement des éléments de métré/i });
    await expect(modal).toBeVisible();

    await modal.getByRole("checkbox", /Zone A separatif/).check();
    await modal.getByRole("checkbox", /Zone B separatif/).check();
    await modal.getByRole("button", { name: "Enregistrer la sélection" }).click();

    await expect(page.getByText("Lien manuel mis à jour")).toBeVisible();
    await expect(
      page.getByText("Chargement de la comparaison DPGF vs métré…")
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Tout" }).click();
    await expect(page.browser).toHaveURL(new RegExp(
      `/dashboard/affaires/${projectId}/takeoff/${seededJob.jobId}/review\\?versionId=${versionId}&reviewMode=production&view=dpgf$`
    ));
    // Only the completed "all" payload contains Moquette; the old view can
    // still show Cloison before navigation replaces its selection state.
    await expect(page.getByRole("button", { name: /Moquette/i })).toBeVisible();
    await expect(cloisonRow).toBeVisible();

    await cloisonRow.click();
    await expect(page.getByText("Mode: manual")).toBeVisible();
    await expect(page.getByText("Agrégation", { exact: true })).toBeVisible();
    await expect(page.getByText("Somme de 2 items takeoff", { exact: true })).toBeVisible();

    const assertPersistedManualAggregation = async () => {
      const response = await page.request.get(
        `/api/takeoff/jobs/${seededJob.jobId}/dpgf-compare?version_id=${versionId}&view=all&page_size=50`
      );
      expect(response.status()).toBe(200);
      const payload = await response.json() as unknown as { data: TakeoffDpgfComparisonResponse };
      expect(payload.data).toMatchObject({ job_id: seededJob.jobId, version_id: versionId, view: "all" });
      const row = payload.data.rows.find((candidate) => candidate.dpgf.estimate_item_id === cloisonLine.id);
      expect(row).toMatchObject({
        matched_by: "manual", manual_link_count: 2,
        dpgf_quantity: 10, takeoff_quantity: 10, quantity_unit: "m2", delta_absolute: 0,
      });
      expect(row?.linked_takeoff_items.map(({ item_id, quantity }) => ({ item_id, quantity }))
        .sort((left, right) => left.item_id.localeCompare(right.item_id))).toEqual([
        { item_id: seededJob.itemIdsByDesignation.get("Zone A separatif")!, quantity: 4 },
        { item_id: seededJob.itemIdsByDesignation.get("Zone B separatif")!, quantity: 6 },
      ].sort((left, right) => left.item_id.localeCompare(right.item_id)));
      const formulas = row?.proofs.filter((proof) => proof.type === "formula");
      expect(formulas).toHaveLength(1);
      expect(formulas?.[0]).toMatchObject({
        type: "formula", kind: "inference",
        label: "Somme de 2 items takeoff", source: "Aggregation manuelle",
      });
      expect(formulas?.[0].proof_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      return formulas![0].proof_id;
    };
    const formulaId = await assertPersistedManualAggregation();

    await page.reload();
    await waitForDpgfComparison(page);
    await expect(page.getByRole("button", { name: /Moquette/i })).toBeVisible();
    await cloisonRow.click();
    await expect(page.getByText("Mode: manual")).toBeVisible();
    await expect(page.getByText("Agrégation", { exact: true })).toBeVisible();
    await expect(page.getByText("Somme de 2 items takeoff", { exact: true })).toBeVisible();
    expect(await assertPersistedManualAggregation()).toBe(formulaId);
  });

  test("keeps carried-over provenance visible while allowing a new explicit decision", async ({ ui: page }) => {
    const dpgfFileName = `dpgf-carry-${Date.now()}.pdf`;
    const takeoffFileName = `plans-carry-${Date.now()}.pdf`;
    const { versionId: sourceVersionId } = await createEstimateViaApi(page, {
      projectName: buildEstimateName("V3010-CARRY"),
      title: "V3-010 DPGF review carry-over",
    });
    const projectId = await extractProjectId(page, sourceVersionId);
    const tenantId = await getTenantIdForVersion(sourceVersionId);
    const userId = await getAuthenticatedUserId();

    const sourcePeintureLine: SeededEstimateLine = {
      id: randomUUID(),
      title: "Peinture",
      mappedRowId: randomUUID(),
      quantity: 20,
      position: 1,
      sourcePage: 3,
      sourceFileName: dpgfFileName,
    };
    const sourceMoquetteLine: SeededEstimateLine = {
      id: randomUUID(),
      title: "Moquette",
      mappedRowId: randomUUID(),
      quantity: 0,
      position: 2,
      sourcePage: 3,
      sourceFileName: dpgfFileName,
    };
    await seedDpgfImport({
      tenantId,
      projectId,
      userId,
      filename: dpgfFileName,
      rows: [
        { id: sourcePeintureLine.mappedRowId, rowIndex: 2, quantity: 20, unit: "m2" },
        { id: sourceMoquetteLine.mappedRowId, rowIndex: 3, quantity: 0, unit: "m2" },
      ],
    });

    await seedEstimateLines({
      tenantId,
      versionId: sourceVersionId,
      lines: [sourcePeintureLine, sourceMoquetteLine],
    });
    const seededJob = await seedCompletedTakeoffJob(page, {
      tenantId,
      versionId: sourceVersionId,
      sourceFileName: takeoffFileName,
      items: [
        {
          designation: "Moquette",
          quantity: 5,
          unit: "m2",
          confidence: 0.91,
          evidence: "Zone moquette",
          sourcePage: 6,
          sourceFileName: takeoffFileName,
        },
        {
          designation: "Peinture",
          quantity: 2,
          unit: "m2",
          confidence: 0.5,
          evidence: "Reserve",
          sourcePage: 8,
          sourceFileName: takeoffFileName,
        },
      ],
    });

    await seedReviewDecision({
      tenantId,
      versionId: sourceVersionId,
      jobId: seededJob.jobId,
      estimateItemId: sourcePeintureLine.id,
      reviewReference: lineRef(sourcePeintureLine),
      lineLabel: sourcePeintureLine.title,
      linePosition: sourcePeintureLine.position,
      sourceFileName: sourcePeintureLine.sourceFileName,
      sourcePage: sourcePeintureLine.sourcePage,
      decision: "keep_dpgf",
      reason: "Decision reprise tant que la reserve peinture n'est pas levee.",
    });

    // A legacy seed has no accepted quantity snapshot. Preserve its note, but
    // require a real review before that decision can authorize these quantities.
    const legacy = await page.request.get(`/api/takeoff/jobs/${seededJob.jobId}/dpgf-compare?version_id=${sourceVersionId}&view=all`);
    expect(legacy.status()).toBe(200);
    const { data: legacyComparison } = await legacy.json() as { data: TakeoffDpgfComparisonResponse };
    const legacyPeinture = legacyComparison.rows.find(row => row.line_id === sourcePeintureLine.id)!;
    expect(legacyPeinture.applied_decision).toBeNull();
    expect(legacyPeinture.proofs).toEqual(expect.arrayContaining([expect.objectContaining({
      type: "comment", note: "Decision reprise tant que la reserve peinture n'est pas levee.",
    })]));
    const reviewed = await page.request.patch(`/api/takeoff/jobs/${seededJob.jobId}/review-decision`, {
      data: { version_id: sourceVersionId, estimate_item_id: sourcePeintureLine.id,
        decision: "keep_dpgf", reason: "Decision reprise tant que la reserve peinture n'est pas levee." },
    });
    expect(reviewed.status()).toBe(200);

    const targetVersionId = await duplicateEstimateViaApi(page, sourceVersionId);
    const db = await getAuthenticatedSupabaseClient();
    const { data: targetDecision, error: duplicateError } = await db.from("takeoff_dpgf_review_decisions")
      .select("estimate_item_id, carried_over_from_version_id").eq("version_id", targetVersionId)
      .eq("takeoff_job_id", seededJob.jobId).single();
    expect(duplicateError).toBeNull();
    expect(targetDecision?.carried_over_from_version_id).toBe(sourceVersionId);
    const targetLineId = targetDecision!.estimate_item_id;

    await page.goto(
      `/dashboard/affaires/${projectId}/takeoff/${seededJob.jobId}/review?versionId=${targetVersionId}&reviewMode=production&view=dpgf&dpgfView=exceptions_only`
    );
    await waitForDpgfComparison(page);

    const compare = await page.request.get(`/api/takeoff/jobs/${seededJob.jobId}/dpgf-compare?version_id=${targetVersionId}&view=all`);
    const { data } = await compare.json() as unknown as { data: TakeoffDpgfComparisonResponse };
    expect(data.rows.find(row => row.line_label === "Moquette")).toMatchObject({
      applied_decision: null, dpgf_quantity: 0, takeoff_quantity: 5, dpgf: { unit: "m2" }, review_status: "significant_gap",
    });
    const readPeinture = async (versionId = targetVersionId, lineId = targetLineId) => {
      const response = await page.request.get(`/api/takeoff/jobs/${seededJob.jobId}/dpgf-compare?version_id=${versionId}&view=all`);
      expect(response.status()).toBe(200);
      const { data: snapshot } = await response.json() as { data: TakeoffDpgfComparisonResponse };
      return snapshot.rows.find(row => row.line_id === lineId);
    };
    expect(await readPeinture()).toMatchObject({ applied_decision: {
      source: "carried_over", decision: "keep_dpgf", quantity_snapshot: expect.any(Object),
    } });
    const mappedRowId = sourcePeintureLine.mappedRowId!;
    const revisions = [
      { mapped_row_id: mappedRowId, dpgf_source_unit: "ml", dpgf_source_quantity: 20 },
      { mapped_row_id: mappedRowId, dpgf_source_unit: "m2", dpgf_source_quantity: 25 },
      { mapped_row_id: randomUUID(), dpgf_source_unit: "m2", dpgf_source_quantity: 20 },
    ];
    for (const revision of revisions) {
      const { error } = await db.from("estimate_items").update({ source_metadata: revision })
        .eq("id", targetLineId).eq("version_id", targetVersionId);
      expect(error).toBeNull();
      expect(await readPeinture()).toMatchObject({
        dpgf_quantity: revision.dpgf_source_quantity, dpgf: { unit: revision.dpgf_source_unit }, applied_decision: null,
      });
      if (revision.dpgf_source_quantity === 25) {
        const thirdVersionId = await duplicateEstimateViaApi(page, targetVersionId);
        const { data: third, error } = await db.from("takeoff_dpgf_review_decisions")
          .select("estimate_item_id, carried_over_from_version_id").eq("version_id", thirdVersionId)
          .eq("takeoff_job_id", seededJob.jobId).single();
        expect(error).toBeNull();
        expect(third?.carried_over_from_version_id).toBe(targetVersionId);
        expect(await readPeinture(thirdVersionId, third!.estimate_item_id)).toMatchObject({
          dpgf_quantity: 25, applied_decision: null,
        });
      }
    }
    const { error: restoreError } = await db.from("estimate_items").update({ source_metadata: { mapped_row_id: mappedRowId } })
      .eq("id", targetLineId).eq("version_id", targetVersionId);
    expect(restoreError).toBeNull();
    expect(await readPeinture()).toMatchObject({ applied_decision: { source: "carried_over", decision: "keep_dpgf" } });

    const peintureRow = page.getByRole("button", { name: /Peinture/i });
    await expect(peintureRow).toBeVisible();
    await peintureRow.click();

    await expect(
      page
        .locator("blockquote")
        .filter({ hasText: "Decision reprise tant que la reserve peinture n'est pas levee." })
    ).toBeVisible();
    await expect(page.getByText(/Reprise v\d+/)).toBeVisible();

    // TI-680 protects the higher comparable quantity: a new decision must not
    // silently retain 2 m² when the documentary reference is 20 m².
    await expect(page.getByRole("button", { name: "Garder métré" })).toBeDisabled();
    const lowerQuantity = await page.request.patch(`/api/takeoff/jobs/${seededJob.jobId}/review-decision`, {
      data: { version_id: targetVersionId, estimate_item_id: targetLineId, decision: "keep_takeoff" },
    });
    expect(lowerQuantity.status()).toBe(409);
    await page.getByRole("button", { name: "Corriger manuellement" }).click();
    await expect(page.getByText("Vous devrez saisir la quantité corrigée manuellement.")).toBeVisible();

    const freshReason = "Verification terrain: la quantité doit être corrigée pour la version courante.";
    await page.getByLabel("Justification humaine").fill(freshReason);
    await page.getByRole("button", { name: "Enregistrer la décision" }).click();

    await expect(page.getByText("Décision enregistrée")).toBeVisible();
    await expect(page.locator("blockquote").filter({ hasText: freshReason })).toBeVisible();
    await expect(page.getByText(/Reprise v\d+/)).toBeVisible();
    expect(await readPeinture()).toMatchObject({ applied_decision: { decision: "manual_fix", reason: freshReason } });

    const { error: renameError } = await db.from("estimate_items").update({ title: "Étanchéité" })
      .eq("id", targetLineId).eq("version_id", targetVersionId);
    expect(renameError).toBeNull();
    expect(await readPeinture()).toMatchObject({ line_label: "Étanchéité", applied_decision: null });
    const freshDecision = await page.request.patch(`/api/takeoff/jobs/${seededJob.jobId}/review-decision`, {
      data: { version_id: targetVersionId, estimate_item_id: targetLineId,
        decision: "manual_fix", reason: "Reprendre les quantités de la nouvelle prestation." },
    });
    expect(freshDecision.status()).toBe(200);
    expect(await readPeinture()).toMatchObject({ line_label: "Étanchéité", applied_decision: {
      source: "current_version", carried_over_from_version_id: null, decision: "manual_fix",
    } });
  });

  // TI-721: « Rafraîchir » emptied the comparison (its loading state replaced the line being typed) and read it twice;
  // « Ouvrir la ligne » on a risk outside the view moved the review to the first line. Both dropped the decision typed
  // for the line shown, here the second exception.
  async function openTi721Review(page: Page, tag: string) {
    const dpgfFileName = `dpgf-${tag}-${Date.now()}.xlsx`;
    const takeoffFileName = `plans-${tag}-${Date.now()}.pdf`;
    const { versionId } = await createEstimateViaApi(page, { projectName: buildEstimateName(tag), title: "TI-721 decision being typed" });
    const projectId = await extractProjectId(page, versionId);
    const tenantId = await getTenantIdForVersion(versionId);
    const userId = await getAuthenticatedUserId();
    // Priced lines: an unpriced one raises « Prix atypique » risks that rank before the VAT one in the six shown.
    const line = (title: string, quantity: number, position: number): SeededEstimateLine => ({
      id: randomUUID(), title, quantity, position, sourcePage: 11 + position, sourceFileName: dpgfFileName, unitPriceHtCents: 2500,
    });
    const lines = { cloison: line("Cloison BA13", 10, 1), plafond: line("Faux plafond acoustique", 100, 2), moquette: line("Moquette", 5, 3) };
    await seedDpgfImport({ tenantId, projectId, userId, filename: dpgfFileName,
      rows: Object.values(lines).map((seeded) => ({ rowIndex: seeded.sourcePage, unit: "m2" })) });
    await seedEstimateLines({ tenantId, versionId, lines: Object.values(lines) });
    const measured = (designation: string, quantity: number, sourcePage: number) => ({
      designation, quantity, unit: "m2", confidence: 0.92, evidence: `Zone ${designation}`, sourcePage, sourceFileName: takeoffFileName,
    });
    const job = await seedCompletedTakeoffJob(page, { tenantId, versionId, sourceFileName: takeoffFileName,
      items: [measured("Cloison BA13", 4, 3), measured("Faux plafond acoustique", 72, 5), measured("Moquette", 5, 6)] });
    // A VAT rate the version does not use: the radar raises a risk on Moquette, a reliable line, so outside the
    // « Exceptions seulement » view.
    const db = await getAuthenticatedSupabaseClient();
    const { data: version, error: versionError } = await db.from("estimate_versions").select("tax_rate_bp").eq("id", versionId).single();
    expect(versionError).toBeNull();
    expect(version?.tax_rate_bp).toEqual(expect.any(Number));
    const { error: vatError } = await db.from("estimate_items").update({ tax_rate_bp: version!.tax_rate_bp === 550 ? 1000 : 550 })
      .eq("id", lines.moquette.id).eq("version_id", versionId);
    expect(vatError).toBeNull();
    const radar = await page.request.get(`/api/takeoff/jobs/${job.jobId}/risk-radar?version_id=${versionId}`);
    expect(radar.status()).toBe(200);
    const { data: radarData } = await radar.json() as { data: { items: Array<{ line_id: string | null; cause_code: string; status: string }> } };
    // « Signaux prioritaires » shows the first six risks to process.
    expect(radarData.items.filter((item) => item.status === "to_process").slice(0, 6)).toEqual(expect.arrayContaining([
      expect.objectContaining({ line_id: lines.moquette.id, cause_code: "vat_inconsistency" }),
    ]));

    await page.goto(
      `/dashboard/affaires/${projectId}/takeoff/${job.jobId}/review?versionId=${versionId}&reviewMode=production&view=dpgf&dpgfView=exceptions_only`
    );
    await waitForDpgfComparison(page);
    await expect(page.getByRole("button", { name: /Cloison BA13/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Moquette/i })).toHaveCount(0);
    await page.getByRole("button", { name: /Faux plafond acoustique/i }).click();
    const shownLine = page.locator("aside").filter({ hasText: "Revue détaillée" }).getByRole("heading", "Faux plafond acoustique");
    await expect(shownLine).toBeVisible();
    const reason = page.getByLabel("Justification humaine");
    await page.getByRole("button", { name: "Corriger manuellement" }).click();
    await reason.fill("Relevé sur site");
    const readPlafond = async () => {
      const response = await page.request.get(`/api/takeoff/jobs/${job.jobId}/dpgf-compare?version_id=${versionId}&view=all`);
      expect(response.status()).toBe(200);
      const { data } = await response.json() as { data: TakeoffDpgfComparisonResponse };
      return data.rows.find((row) => row.line_id === lines.plafond.id);
    };
    return { versionId, jobId: job.jobId, plafondId: lines.plafond.id, shownLine, reason, readPlafond };
  }

  test("TI-721 a refresh keeps the decision being typed and shows the decision the line holds now", async ({ ui: page }) => {
    const { versionId, jobId, plafondId, shownLine, reason, readPlafond } = await openTi721Review(page, "TI721R");
    // Another reviewer decides the line, then « Rafraîchir »: its comparison reads are held while the person types on.
    const decidedElsewhere = await page.request.patch(`/api/takeoff/jobs/${jobId}/review-decision`, {
      data: { version_id: versionId, estimate_item_id: plafondId, decision: "keep_dpgf", reason: "Validé par le bureau d'études" },
    });
    expect(decidedElsewhere.status()).toBe(200);
    const comparisonReads = new RegExp(`/api/takeoff/jobs/${jobId}/dpgf-compare\\?`);
    const held: string[] = [];
    const forwarded: Promise<void>[] = [];
    let holding = true;
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => { release = resolve; });
    await page.browser.route(comparisonReads, async (route) => {
      if (!holding || route.request.method !== "GET") return route.fallback();
      held.push(route.request.url);
      const handed = released.then(() => route.fallback());
      forwarded.push(handed);
      await handed;
    });
    try {
      await page.getByRole("button", { name: "Rafraîchir" }).click();
      await expect.poll(() => held.length).toBe(1);
      await expect(page.getByText(/actualisation…/)).toBeVisible();
      await expect(shownLine).toBeVisible();
      await expect(reason).toHaveValue("Relevé sur site");
      await reason.fill("Relevé sur site, cote sous plafond 2,40 m");
      holding = false;
      release();
      await Promise.all(forwarded);
      await expect(page.getByText(/actualisation…/)).toHaveCount(0);
      expect(held).toHaveLength(1);
    } finally {
      holding = false;
      release();
      await Promise.allSettled(forwarded);
      await page.browser.unroute(comparisonReads);
    }
    const refreshed = page.getByRole("status", { name: "Ligne actualisée pendant votre saisie" });
    await expect(refreshed).toContainText("Décision appliquée : Garder DPGF — « Validé par le bureau d'études »");
    await expect(shownLine).toBeVisible();
    await expect(reason).toHaveValue("Relevé sur site, cote sous plafond 2,40 m");

    await page.getByRole("button", { name: "Enregistrer la décision" }).click();
    await expect(page.getByText("Décision enregistrée")).toBeVisible();
    await expect(refreshed).toHaveCount(0);
    expect((await readPlafond())?.applied_decision).toMatchObject({
      decision: "manual_fix", reason: "Relevé sur site, cote sous plafond 2,40 m", source: "current_version",
    });
    await recordEvidence(page.army, "TI721-refresh-keeps-decision", { versionId, jobId, heldComparisonReads: held.length,
      boundary: "Comparison reads after « Rafraîchir » are held in the browser while the reviewer types; one read, the typed decision is saved." });
  });

  test("TI-721 opening a risk on a line outside the view keeps the line shown and its decision", async ({ ui: page }) => {
    const { versionId, jobId, shownLine, reason, readPlafond } = await openTi721Review(page, "TI721O");
    await page.locator("article").filter({ hasText: "TVA incoherente" }).getByRole("button", { name: "Ouvrir la ligne" }).click();
    await expect(page.getByText("Ligne hors de la vue affichée", { exact: true })).toBeVisible();
    await expect(shownLine).toBeVisible();
    await expect(reason).toHaveValue("Relevé sur site");

    await page.getByRole("button", { name: "Enregistrer la décision" }).click();
    await expect(page.getByText("Décision enregistrée")).toBeVisible();
    expect((await readPlafond())?.applied_decision).toMatchObject({ decision: "manual_fix", reason: "Relevé sur site" });
    await recordEvidence(page.army, "TI721-unlisted-risk-line", { versionId, jobId,
      boundary: "« Ouvrir la ligne » on a reliable line's VAT risk in « Exceptions seulement »; the second exception keeps its decision." });
  });

  test("calculates a seeded price suggestion and requires explicit human validation before apply", async ({ ui: page }) => {
    const dpgfFileName = `dpgf-est392-${Date.now()}.xlsx`;
    const takeoffFileName = `plans-est392-${Date.now()}.pdf`;
    const { versionId: sourceVersionId } = await createEstimateViaApi(page, {
      projectName: buildEstimateName("EST392-PRICE"),
      title: "EST-392 source history",
    });
    const projectId = await extractProjectId(page, sourceVersionId);
    const tenantId = await getTenantIdForVersion(sourceVersionId);
    const userId = await getAuthenticatedUserId();
    const targetVersionId = await duplicateEstimateViaApi(page, sourceVersionId);

    const targetLine: SeededEstimateLine = {
      id: randomUUID(),
      title: "Faux plafond acoustique",
      quantity: 100,
      position: 1,
      sourcePage: 21,
      sourceFileName: dpgfFileName,
      unitPriceHtCents: 0,
    };
    const zeroHistoryId = randomUUID();

    await seedDpgfImport({
      tenantId,
      projectId,
      userId,
      filename: dpgfFileName,
      rows: [{ rowIndex: targetLine.sourcePage, unit: "m2" }],
    });

    await seedEstimateLines({
      tenantId,
      versionId: sourceVersionId,
      lines: [
        {
          id: zeroHistoryId,
          title: "Poste historique hors lot",
          quantity: 0,
          position: 4,
          sourcePage: 14,
          sourceFileName: dpgfFileName,
          unitPriceHtCents: 1000,
        },
        {
          id: randomUUID(),
          title: "Faux plafond acoustique",
          quantity: 90,
          position: 1,
          sourcePage: 11,
          sourceFileName: dpgfFileName,
          unitPriceHtCents: 2800,
        },
        {
          id: randomUUID(),
          title: "Faux plafond acoustique bureaux",
          quantity: 95,
          position: 2,
          sourcePage: 12,
          sourceFileName: dpgfFileName,
          unitPriceHtCents: 2950,
        },
        {
          id: randomUUID(),
          title: "Faux plafond acoustique couloir",
          quantity: 105,
          position: 3,
          sourcePage: 13,
          sourceFileName: dpgfFileName,
          unitPriceHtCents: 3100,
        },
      ],
    });

    await seedEstimateLines({
      tenantId,
      versionId: targetVersionId,
      lines: [targetLine],
    });
    const historyClient = await getAuthenticatedSupabaseClient();
    const zeroHistory = await historyClient.from("estimate_items")
      .select("id, quantity, unit_price_ht_cents").eq("tenant_id", tenantId).eq("id", zeroHistoryId).single();
    expect(zeroHistory.error).toBe(null);
    expect(zeroHistory.data).toEqual({ id: zeroHistoryId, quantity: 0, unit_price_ht_cents: 1000 });
    await recordEvidence(page.army, "price-suggestion-zero-history", { sourceVersionId, targetVersionId,
      zeroHistory: zeroHistory.data, targetLineId: targetLine.id, expectedRelevantHistorySources: 3 });

    const seededJob = await seedCompletedTakeoffJob(page, {
      tenantId,
      versionId: sourceVersionId,
      sourceFileName: takeoffFileName,
      items: [
        {
          designation: "Faux plafond acoustique",
          quantity: 72,
          unit: "m2",
          confidence: 0.93,
          evidence: "Zone plafonds open space",
          sourcePage: 7,
          sourceFileName: takeoffFileName,
        },
      ],
    });

    await seedVersionLink({
      tenantId,
      jobId: seededJob.jobId,
      sourceVersionId,
      targetVersionId,
    });

    await page.goto(
      `/dashboard/affaires/${projectId}/takeoff/${seededJob.jobId}/review?versionId=${targetVersionId}&reviewMode=production&view=dpgf&dpgfView=exceptions_only`
    );
    await waitForDpgfComparison(page);

    const lineRow = page.getByRole("button", { name: /Faux plafond acoustique/i });
    await expect(lineRow).toBeVisible();
    await lineRow.click();

    await page.getByTestId("takeoff-dpgf-open-price-suggestion-button").click();

    const panel = page.getByRole("dialog", { name: /Suggestion de prix/i });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Aucune suggestion calculable pour cette ligne.")).toHaveCount(0);
    await expect(panel.getByText("Fourchette de prix")).toBeVisible();
    await expect(panel.getByText(/^Confiance$/)).toBeVisible();
    await expect(panel.getByText(/^Sources \(\d+\)$/)).toBeVisible();
    expect(await panel.getByText(/Historique projet v\d+/).count()).toBeGreaterThanOrEqual(3);

    const submitButton = panel.getByRole("button", { name: "Sélectionner une action" });
    await expect(submitButton).toBeDisabled();

    await panel.getByRole("button", { name: /^Prix cible \d/ }).click();
    await expect(
      panel.getByText("Une note est requise avant validation.")
    ).toBeVisible();

    const reviewNote =
      "Validation humaine: application du prix cible retenu apres comparaison des trois historiques du meme projet.";
    await panel.getByLabel("Note de revue (obligatoire)").fill(reviewNote);
    await acquireDraftLockViaApi(page, targetVersionId, seededJob.jobId);
    const reviewResponsePromise = page.browser.waitForResponse(
      `**/api/takeoff/jobs/${seededJob.jobId}/price-suggestions/*`, { timeout: 30_000 }
    );
    await panel.getByRole("button", { name: "Appliquer prix cible" }).click();
    const reviewResponse = await reviewResponsePromise;
    const reviewBody = await reviewResponse.text();
    expect(
      reviewResponse.status,
      `Price suggestion review should succeed. status=${reviewResponse.status} body=${reviewBody}`
    ).toBe(200);

    await expect(panel).toBeVisible();
    await expect(panel.getByText("Décision enregistrée : Appliquer prix cible")).toBeVisible();
    await expect(panel.getByText(`Note : ${reviewNote}`)).toBeVisible();
    await expect(panel.getByRole("button", { name: "Recalculer" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Fermer", exact: true })).toBeVisible();

    await panel.getByRole("button", { name: "Fermer", exact: true }).click();
    await expect(panel).toHaveCount(0);

    await page.getByTestId("takeoff-dpgf-open-price-suggestion-button").click();
    const reviewedPanel = page.getByRole("dialog", { name: /Suggestion de prix/i });
    await expect(reviewedPanel).toBeVisible();
    await expect(
      reviewedPanel.getByText("Décision enregistrée : Appliquer prix cible")
    ).toBeVisible();
    await expect(reviewedPanel.getByText(`Note : ${reviewNote}`)).toBeVisible();
    await expect(reviewedPanel.getByRole("button", { name: "Recalculer" })).toBeVisible();

    const activeSuggestion = await readLatestAppliedPriceSuggestion({
      tenantId,
      versionId: targetVersionId,
      jobId: seededJob.jobId,
      estimateItemId: targetLine.id,
    });
    expect(activeSuggestion.status).toBe("applied");
    expect(activeSuggestion.selected_action).toBe("apply_target");
    expect(activeSuggestion.review_note).toBe(reviewNote);
    expect(activeSuggestion.selected_price_cents).toBe(activeSuggestion.target_cents);

    const appliedUnitPrice = await readEstimateItemUnitPrice({
      tenantId,
      versionId: targetVersionId,
      estimateItemId: targetLine.id,
    });
    expect(appliedUnitPrice).toBe(activeSuggestion.target_cents);
  });
});
