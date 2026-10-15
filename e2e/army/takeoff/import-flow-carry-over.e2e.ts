import { nativeTest as test, describe, expect, buildEstimateName, createEstimateViaWizard, loginWithUi, localClient, outputPath, ensureMapping, type NativeUi as Page } from "./native-ui";
import type { Locator } from "e2e";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { ownEstimate, recordEvidence } from "../critical/fixtures";
import { localTakeoffWorkerClient } from "./fixtures";

async function getAuthenticatedSupabaseClient() { return (await localClient()).client; }

async function extractProjectId(page: Page, versionId: string) {
  const response = await page.request.get(`/api/estimates/${versionId}`, {
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as {
    data?: {
      version?: { project_id?: string; version_number?: number };
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
  const uploadResponse = await page.request.post(
    `/api/affaires/${input.projectId}/intake/files`,
    {
      multipart: {
        files: {
          name: path.basename(input.fixturePath),
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: fs.readFileSync(input.fixturePath),
        },
      },
      failOnStatusCode: false,
    }
  );

  expect(uploadResponse.status()).toBe(201);

  const uploadPayload = (await uploadResponse.json()) as {
    data?: {
      files?: Array<{ documentId?: string }>;
    };
  };

  const documentId = uploadPayload.data?.files?.[0]?.documentId ?? null;
  expect(documentId, "intake upload should return a document id").toBeTruthy();

  const { client } = await localClient();
  const nowIso = new Date().toISOString();
  const reclassified = await client.from("affaire_intake_documents").update({
    document_kind: "dpgf", classification_status: "classified", confidence: 0.99,
    issues: [], classification_source: "manual", classified_at: nowIso, manually_overridden_at: nowIso,
  }).eq("id", documentId).eq("project_id", input.projectId).select("id, document_kind, classification_status").single();
  if (reclassified.error) throw new Error(`Owned intake classification failed: ${reclassified.error.code}`);
  expect(reclassified.data).toMatchObject({ id: documentId, document_kind: "dpgf", classification_status: "classified" });

}

async function seedTakeoffJobsForCarryOver(page: Page, input: {
  versionId: string;
  tenantId: string;
}) {
  const { client: sb, tenantId } = await localTakeoffWorkerClient(page.army, input.versionId);
  expect(tenantId).toBe(input.tenantId);
  const nowIso = new Date().toISOString();

  const payload = [
    {
      tenant_id: input.tenantId,
      estimate_version_id: input.versionId,
      level: "A",
      status: "completed",
      source_file_name: "carry-over-ready.pdf",
      source_file_type: "application/pdf",
      source_file_size_bytes: 1024,
      schema_version: "v1",
      started_at: nowIso,
      completed_at: nowIso,
    },
    {
      tenant_id: input.tenantId,
      estimate_version_id: input.versionId,
      level: "A",
      status: "processing",
      source_file_name: "carry-over-processing.pdf",
      source_file_type: "application/pdf",
      source_file_size_bytes: 1024,
      schema_version: "v1",
      started_at: nowIso,
    },
    {
      tenant_id: input.tenantId,
      estimate_version_id: input.versionId,
      level: "A",
      status: "failed",
      source_file_name: "carry-over-failed.pdf",
      source_file_type: "application/pdf",
      source_file_size_bytes: 1024,
      schema_version: "v1",
      started_at: nowIso,
      completed_at: nowIso,
      error_code: "E2E_CARRY_OVER_FAILURE",
      error_message: "Seeded failed takeoff job for carry-over coverage.",
    },
  ];

  const { error } = await sb.from("takeoff_jobs").insert(payload);
  if (error) {
    throw new Error(`Seed takeoff jobs failed: ${error.message}`);
  }
}

async function fetchVersionNumber(page: Page, versionId: string) {
  const response = await page.request.get(`/api/estimates/${versionId}`, {
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as {
    data?: { version?: { version_number?: number } };
  };

  const versionNumber = payload.data?.version?.version_number ?? null;
  expect(typeof versionNumber).toBe("number");
  return versionNumber as number;
}

async function fetchLatestProjectVersion(projectId: string) {
  const sb = await getAuthenticatedSupabaseClient();
  const { data, error } = await sb
    .from("estimate_versions")
    .select("id, version_number")
    .eq("project_id", projectId)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    throw new Error(`Cannot resolve latest project version: ${error.message}`);
  }

  const latestVersion = data as { id?: string; version_number?: number };
  if (!latestVersion.id || typeof latestVersion.version_number !== "number") {
    throw new Error("Latest project version payload is incomplete.");
  }

  return {
    id: latestVersion.id,
    versionNumber: latestVersion.version_number,
  };
}

async function countCarryOverLinks(targetVersionId: string) {
  const sb = await getAuthenticatedSupabaseClient();
  const { count, error } = await sb
    .from("takeoff_version_links")
    .select("id", { count: "exact", head: true })
    .eq("target_version_id", targetVersionId);

  if (error) {
    throw new Error(`Cannot count carry-over links: ${error.message}`);
  }

  return count ?? 0;
}

async function expectMetricCardValue(page: Page, container: Locator, title: string, value: string) {
  const card = page.locator("div")
    .filter({ has: container.getByText(title, { exact: true }) })
    .last();

  await expect(card).toContainText(value);
}

function createMinimalDpgfWorkbook(filePath: string) {
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
  ]);

  XLSX.utils.book_append_sheet(workbook, sheet, "DPGF");
  fs.writeFileSync(filePath, XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }));
}

describe("VNEXT US-6.1 - import flow carry-over", { session: "army", tags: ["critical", "extended"], timeout: 180_000 }, () => {
  test("shows explicit carry-over before creating a new version from import and links source takeoff jobs", async ({ ui: page }) => {
    const fixturePath = outputPath(page, "dpgf-minimal.xlsx");
    createMinimalDpgfWorkbook(fixturePath);

    await loginWithUi(page);

    const { versionId: sourceVersionId } = await createEstimateViaWizard(page, {
      projectName: `${page.army.runPrefix}-${buildEstimateName("VNEXT-US61")}`,
      title: "US-6.1 source version",
    });

    const [projectId, tenantId] = await Promise.all([
      extractProjectId(page, sourceVersionId),
      getTenantIdForVersion(sourceVersionId),
    ]);

    await seedTakeoffJobsForCarryOver(page, {
      versionId: sourceVersionId,
      tenantId,
    });
    await uploadAndClassifyIntakeDpgf(page, {
      projectId,
      fixturePath,
    });

    await page.goto(`/dashboard/affaires/${projectId}`);
    await expect(
      page.getByRole("button", { name: /Lancer l'import structure/i })
    ).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /Lancer l'import structure/i }).click();

    const uploadStep = page.getByText("Glissez-déposez votre fichier DPGF ici");
    await expect(uploadStep).toBeVisible();

    await page.locator('input[type="file"]').first().setInputFiles(fixturePath);
    await page.getByRole("button", { name: "Lancer l'import" }).click();

    await expect(
      page.getByRole("button", { name: /Suivant : Aperçu/i })
    ).toBeVisible({ timeout: 60_000 });

    await ensureMapping(page, "hex_code", "hex_code");
    await ensureMapping(page, "designation", "designation");
    await ensureMapping(page, "quantity", "quantity");
    await ensureMapping(page, "unit", "unit");
    await ensureMapping(page, "unit_price_ht", "unit_price_ht");
    await ensureMapping(page, "total_ht", "total_ht");

    await page.getByRole("button", { name: /Suivant : Aperçu/i }).click();
    await page.getByRole("button", { name: /Suivant : Confirmation/i }).click();

    const carryOverCard = page
      .locator("div")
      .filter({ has: page.getByText("Carry-over takeoff", { exact: true }) })
      .first();

    await expect(carryOverCard).toContainText("Carry-over takeoff à surveiller depuis V1");
    await expect(carryOverCard).toContainText(
      "Certaines analyses suivent, d'autres restent en cours ou devront être relancees."
    );
    await expectMetricCardValue(page, carryOverCard, "Acquis", "1");
    await expectMetricCardValue(page, carryOverCard, "En cours", "1");
    await expectMetricCardValue(page, carryOverCard, "À relancer", "1");

    await page.getByRole("button", { name: "Créer le chiffrage" }).click();

    await expect.poll(async () => {
      const latestVersion = await fetchLatestProjectVersion(projectId);
      return latestVersion.versionNumber;
    }, {
      timeout: 60_000,
    }).toBe(2);

    const targetVersion = await fetchLatestProjectVersion(projectId);
    const targetVersionId = targetVersion.id;
    expect(targetVersionId).not.toBe(sourceVersionId);
    ownEstimate(page.army, { projectId, versionId: targetVersionId });

    const result = page.locator('[role="status"]').filter({
      has: page.getByRole("heading", { name: "Devis créé", exact: true }),
    });
    await expect(result).toBeVisible();
    await result.getByRole("button", { name: "Continuer", exact: true }).click();
    await expect(page.getByText("Chiffrage créé avec succès", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Continuer sans ajouter de plans", exact: true }).click();
    await expect(page.browser).toHaveURL(
      new RegExp(`/dashboard/estimates/${targetVersionId}/edit(?:[/?#].*)?$`, "i"),
      { timeout: 60_000 },
    );

    await expect(
      page.getByRole("heading", { name: /Éditer le chiffrage|Éditer le chiffrage/i })
    ).toBeVisible();

    await expect.poll(async () => fetchVersionNumber(page, targetVersionId), {
      timeout: 15_000,
    }).toBe(targetVersion.versionNumber);

    await expect.poll(async () => countCarryOverLinks(targetVersionId), {
      timeout: 15_000,
    }).toBe(3);
    await recordEvidence(page.army, "import-flow-carry-over", {
      projectId,
      sourceVersionId,
      targetVersionId,
      versionNumber: targetVersion.versionNumber,
      carryOverLinks: await countCarryOverLinks(targetVersionId),
      expectedPreview: { acquired: 1, processing: 1, relaunch: 1 },
    });
  });
});
