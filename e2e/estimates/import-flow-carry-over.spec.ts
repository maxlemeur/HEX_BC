import fs from "node:fs";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page } from "@playwright/test";
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
  if (supabaseClient) {
    return supabaseClient;
  }

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

function readSupabaseAuthCookieValue(
  cookies: Array<{
    name: string;
    value: string;
  }>
) {
  for (const cookie of cookies) {
    if (/^sb-.*-auth-token$/i.test(cookie.name)) {
      return cookie.value;
    }
  }

  return null;
}

function extractAccessTokenFromCookie(cookieValue: string) {
  const decoded = decodeURIComponent(cookieValue);
  const payload = decoded.startsWith("base64-")
    ? Buffer.from(decoded.slice("base64-".length), "base64").toString("utf8")
    : decoded;

  const parsed = JSON.parse(payload) as {
    access_token?: string;
  };

  if (typeof parsed.access_token !== "string" || parsed.access_token.length === 0) {
    throw new Error("Missing access token in Supabase auth cookie.");
  }

  return parsed.access_token;
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

  const reclassifyBody = await reclassifyResponse.text();
  expect(
    [200, 204].includes(reclassifyResponse.status()),
    `Intake reclassification failed. status=${reclassifyResponse.status()} body=${reclassifyBody}`
  ).toBe(true);
}

async function seedTakeoffJobsForCarryOver(input: {
  versionId: string;
  tenantId: string;
}) {
  const sb = await getAuthenticatedSupabaseClient();
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

async function expectMetricCardValue(container: Locator, title: string, value: string) {
  const card = container
    .locator("div")
    .filter({ has: container.getByText(title, { exact: true }) })
    .first();

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
  XLSX.writeFile(workbook, filePath, { bookType: "xlsx" });
}

test.describe("VNEXT US-6.1 - import flow carry-over", () => {
  test("shows explicit carry-over before creating a new version from import and links source takeoff jobs", async ({
    page,
  }, testInfo) => {
    const fixturePath = testInfo.outputPath("dpgf-minimal.xlsx");
    createMinimalDpgfWorkbook(fixturePath);

    await loginWithUi(page);

    const { versionId: sourceVersionId } = await createEstimateViaWizard(page, {
      projectName: buildEstimateName("VNEXT-US61"),
      title: "US-6.1 source version",
    });

    const [projectId, tenantId] = await Promise.all([
      extractProjectId(page, sourceVersionId),
      getTenantIdForVersion(sourceVersionId),
    ]);

    await seedTakeoffJobsForCarryOver({
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

    const uploadStep = page.getByText("Glissez-deposez votre fichier DPGF ici");
    await expect(uploadStep).toBeVisible();

    await page.locator('input[type="file"]').first().setInputFiles(fixturePath);
    await page.getByRole("button", { name: "Lancer l'import" }).click();

    await expect(
      page.getByRole("button", { name: /Suivant : Apercu/i })
    ).toBeVisible({ timeout: 60_000 });

    await ensureMapping(page, "hex_code", "hex_code");
    await ensureMapping(page, "designation", "designation");
    await ensureMapping(page, "quantity", "quantity");
    await ensureMapping(page, "unit", "unit");
    await ensureMapping(page, "unit_price_ht", "unit_price_ht");
    await ensureMapping(page, "total_ht", "total_ht");

    await page.getByRole("button", { name: /Suivant : Apercu/i }).click();
    await page.getByRole("button", { name: /Suivant : Confirmation/i }).click();

    const carryOverCard = page
      .locator("div")
      .filter({ has: page.getByText("Carry-over takeoff", { exact: true }) })
      .first();

    await expect(carryOverCard).toContainText("Carry-over takeoff a surveiller depuis V1");
    await expect(carryOverCard).toContainText(
      "Certaines analyses suivent, d'autres restent en cours ou devront etre relancees."
    );
    await expectMetricCardValue(carryOverCard, "Acquis", "1");
    await expectMetricCardValue(carryOverCard, "En cours", "1");
    await expectMetricCardValue(carryOverCard, "A relancer", "1");

    await page.getByRole("button", { name: "Creer le chiffrage" }).click();

    const importFinishedBanner = page.getByText("Import terminé");
    await expect.poll(async () => {
      const latestVersion = await fetchLatestProjectVersion(projectId);
      return latestVersion.versionNumber;
    }, {
      timeout: 60_000,
    }).toBe(2);

    const targetVersion = await fetchLatestProjectVersion(projectId);
    const targetVersionId = targetVersion.id;
    expect(targetVersionId).not.toBe(sourceVersionId);

    const plansSuccessBanner = page.getByText(/Chiffrage cree avec succes|Chiffrage créé avec succès/i);
    const continueWithoutPlans = page.getByRole("button", {
      name: /Continuer sans ajouter de plans/i,
    });

    if (
      await plansSuccessBanner
        .waitFor({ state: "visible", timeout: 20_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      await continueWithoutPlans.click();
      await expect(page).toHaveURL(
        new RegExp(`/dashboard/estimates/${targetVersionId}/edit(?:[/?#].*)?$`, "i"),
        {
          timeout: 60_000,
        }
      );
    } else {
      await expect(importFinishedBanner).toBeVisible({
        timeout: 15_000,
      });

      const editVersionLink = page.getByRole("link", {
        name: new RegExp(
          `Editer V${targetVersion.versionNumber}|Éditer V${targetVersion.versionNumber}`,
          "i"
        ),
      });
      await expect(editVersionLink).toBeVisible({ timeout: 60_000 });
      await editVersionLink.click();

      await expect(page).toHaveURL(
        new RegExp(`/dashboard/estimates/${targetVersionId}/edit(?:[/?#].*)?$`, "i"),
        {
          timeout: 60_000,
        }
      );
    }

    await expect(
      page.getByRole("heading", { name: /Editer le chiffrage|Éditer le chiffrage/i })
    ).toBeVisible();

    await expect.poll(async () => fetchVersionNumber(page, targetVersionId), {
      timeout: 15_000,
    }).toBe(targetVersion.versionNumber);

    await expect.poll(async () => countCarryOverLinks(targetVersionId), {
      timeout: 15_000,
    }).toBe(3);
  });
});
