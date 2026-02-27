/**
 * TKF E2E matrix (minimal anti-regression) for missing epics:
 * - E01 foundations
 * - E02 level A import
 * - E03 provenance & traceability
 * - E04 level B plan sets
 * - E06 async/list resilience
 * - E07 revision compare
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

loadEnvConfig(path.resolve(__dirname, "../.."));

import {
  buildEstimateName,
  createEstimateViaWizard,
} from "./helpers";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SeededTakeoffItemInput = {
  designation: string;
  quantity: number;
  unit: string;
  confidence?: number | null;
  evidence?: string | null;
  source_page?: number | null;
  source_file_name?: string | null;
  is_excluded?: boolean;
  exclusion_reason?: string | null;
  is_verified?: boolean;
  metadata?: Record<string, unknown>;
};

type SeedCompletedTakeoffJobInput = {
  versionId: string;
  tenantId: string;
  level: "A" | "B" | "C";
  sourceFileName: string;
  sourceFileType?: string;
  items: SeededTakeoffItemInput[];
};

function envOrThrow(name: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  throw new Error(`Missing required env var: ${name}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractPlanSets(data: unknown): Array<{ id: string }> {
  if (Array.isArray(data)) {
    return data.filter(isRecord).map((item) => ({
      id: String(item.id ?? ""),
    }));
  }

  if (isRecord(data) && Array.isArray(data.plan_sets)) {
    return data.plan_sets.filter(isRecord).map((item) => ({
      id: String(item.id ?? ""),
    }));
  }

  return [];
}

function extractPlanSetId(data: unknown): string | null {
  if (isRecord(data) && typeof data.id === "string") {
    return data.id;
  }

  if (isRecord(data) && isRecord(data.plan_set) && typeof data.plan_set.id === "string") {
    return data.plan_set.id;
  }

  return null;
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
  if (error) throw new Error(`Supabase sign-in failed: ${error.message}`);

  return supabaseClient;
}

async function getTenantIdForVersion(versionId: string): Promise<string> {
  const sb = await getAuthenticatedSupabaseClient();
  const { data, error } = await sb
    .from("estimate_versions")
    .select("tenant_id")
    .eq("id", versionId)
    .single();

  if (error) {
    throw new Error(`Cannot resolve tenant for version: ${error.message}`);
  }

  const tenantId = (data as { tenant_id?: unknown })?.tenant_id;
  if (typeof tenantId !== "string" || !UUID_REGEX.test(tenantId)) {
    throw new Error("Resolved tenant id is invalid.");
  }

  return tenantId;
}

async function seedCompletedTakeoffJob(input: SeedCompletedTakeoffJobInput) {
  const sb = await getAuthenticatedSupabaseClient();
  const nowIso = new Date().toISOString();
  const jobId = randomUUID();
  const resultId = randomUUID();
  const sourceFileType = input.sourceFileType ?? "application/pdf";

  const { error: jobError } = await sb.from("takeoff_jobs").insert({
    id: jobId,
    tenant_id: input.tenantId,
    estimate_version_id: input.versionId,
    level: input.level,
    status: "completed",
    source_file_name: input.sourceFileName,
    source_file_type: sourceFileType,
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

  const itemsPayload = input.items.map((item) => {
    const isExcluded = item.is_excluded ?? false;
    const isVerified = item.is_verified ?? false;

    return {
      id: randomUUID(),
      tenant_id: input.tenantId,
      job_id: jobId,
      result_id: resultId,
      designation: item.designation,
      quantity: item.quantity,
      unit: item.unit,
      confidence: item.confidence ?? null,
      evidence: item.evidence ?? null,
      source_page: item.source_page ?? null,
      source_file_name: item.source_file_name ?? input.sourceFileName,
      metadata: item.metadata ?? {},
      is_excluded: isExcluded,
      exclusion_reason: isExcluded ? item.exclusion_reason ?? "E2E exclusion" : null,
      is_verified: isVerified,
      verified_at: isVerified ? nowIso : null,
      verified_by: null,
    };
  });

  const { error: itemsError } = await sb.from("takeoff_items").insert(itemsPayload);
  if (itemsError) {
    throw new Error(`Seed takeoff items failed: ${itemsError.message}`);
  }

  return {
    jobId,
    resultId,
    itemIds: itemsPayload.map((item) => item.id),
  };
}

async function cleanupTakeoffJob(jobId: string) {
  const sb = await getAuthenticatedSupabaseClient();
  await sb.from("takeoff_jobs").delete().eq("id", jobId);
}

async function cleanupPlanSet(setId: string) {
  const sb = await getAuthenticatedSupabaseClient();
  await sb.from("plan_sets").delete().eq("id", setId);
}

test.describe("TKF e2e matrix - missing epic coverage", () => {
  let versionId = "";
  let tenantId = "";

  const createdJobIds = new Set<string>();
  const createdPlanSetIds = new Set<string>();

  test.beforeAll(async ({ browser }) => {
    const storageStateRelative =
      process.env.E2E_AUTH_STATE?.trim() ?? "e2e/.auth/playwright-user.json";
    const storageStatePath = path.resolve(process.cwd(), storageStateRelative);

    if (!existsSync(storageStatePath)) {
      throw new Error(
        `Missing auth state file: ${storageStatePath}. Run "npm run e2e:auth" or set E2E_AUTH_STATE.`
      );
    }

    const context = await browser.newContext({
      storageState: storageStatePath,
    });
    const page = await context.newPage();

    const estimate = await createEstimateViaWizard(page, {
      projectName: buildEstimateName("TKF-MATRIX"),
      title: "TKF Matrix E2E",
    });

    versionId = estimate.versionId;
    tenantId = await getTenantIdForVersion(versionId);

    await page.close();
    await context.close();
  });

  test.afterAll(async () => {
    for (const setId of createdPlanSetIds) {
      await cleanupPlanSet(setId).catch(() => {});
    }

    for (const jobId of createdJobIds) {
      await cleanupTakeoffJob(jobId).catch(() => {});
    }
  });

  test("E01 - health endpoint confirms foundations are reachable", async ({
    request,
  }) => {
    const response = await request.get("/api/takeoff/health");
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        tenant_id?: string;
        enabled?: boolean;
      };
    };

    expect(response.status()).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data?.enabled).toBe(true);
    expect(body.data?.tenant_id).toMatch(UUID_REGEX);
  });

  test("E02 - level A job can be created and listed", async ({ request }) => {
    const response = await request.post("/api/takeoff/jobs", {
      headers: {
        "idempotency-key": randomUUID(),
      },
      multipart: {
        estimate_version_id: versionId,
        level: "A",
        file: {
          name: `e02-${Date.now()}.csv`,
          mimeType: "text/csv",
          buffer: Buffer.from("designation;quantity;unit\nBloc beton;12;u", "utf8"),
        },
      },
    });
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        id?: string;
        status?: string;
        level?: string;
      };
    };

    expect(response.status()).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data?.id).toMatch(UUID_REGEX);
    expect(body.data?.status).toBe("pending");
    expect(body.data?.level).toBe("A");

    const createdJobId = String(body.data?.id);
    createdJobIds.add(createdJobId);

    await expect
      .poll(async () => {
        const listResponse = await request.get(
          `/api/takeoff/jobs?estimate_version_id=${versionId}&limit=20&offset=0`
        );
        if (listResponse.status() !== 200) return false;

        const listBody = (await listResponse.json()) as {
          ok: boolean;
          data?: { jobs?: Array<{ id?: string }> };
        };
        const jobs = listBody.data?.jobs ?? [];
        return jobs.some((job) => job.id === createdJobId);
      })
      .toBe(true);
  });

  test("E03 - provenance fields remain available and editable in review flow", async ({
    request,
  }) => {
    const seeded = await seedCompletedTakeoffJob({
      versionId,
      tenantId,
      level: "B",
      sourceFileName: "e03-provenance.pdf",
      items: [
        {
          designation: "Mur porteur",
          quantity: 32,
          unit: "m2",
          confidence: 0.86,
          source_page: 3,
          source_file_name: "e03-provenance.pdf",
        },
      ],
    });
    createdJobIds.add(seeded.jobId);

    const detailsResponse = await request.get(`/api/takeoff/jobs/${seeded.jobId}`);
    const detailsBody = (await detailsResponse.json()) as {
      ok: boolean;
      data?: {
        items?: {
          data?: Array<{
            id: string;
            designation: string;
            source_page: number | null;
            source_file_name: string | null;
            updated_at: string;
            is_excluded: boolean;
            exclusion_reason: string | null;
          }>;
        };
      };
    };

    expect(detailsResponse.status()).toBe(200);
    expect(detailsBody.ok).toBe(true);

    const item = detailsBody.data?.items?.data?.[0];
    expect(item).toBeDefined();
    expect(item?.source_page).toBe(3);
    expect(item?.source_file_name).toBe("e03-provenance.pdf");

    const patchResponse = await request.patch(`/api/takeoff/jobs/${seeded.jobId}/items`, {
      data: {
        items: [
          {
            item_id: item?.id,
            updated_at: item?.updated_at,
            fields: {
              is_excluded: true,
              exclusion_reason: "E2E provenance exclusion check",
            },
          },
        ],
      },
    });
    const patchBody = (await patchResponse.json()) as {
      ok: boolean;
      data?: { succeeded?: number; failed?: number };
    };

    expect(patchResponse.status()).toBe(200);
    expect(patchBody.ok).toBe(true);
    expect(patchBody.data?.succeeded).toBe(1);
    expect(patchBody.data?.failed).toBe(0);
  });

  test("E04 - plan set CRUD remains functional", async ({ request }) => {
    const createResponse = await request.post("/api/takeoff/plan-sets", {
      data: {
        estimate_version_id: versionId,
        name: `E04 plans ${Date.now()}`,
        description: "Plan set smoke",
        metadata: {
          source: "e2e-matrix",
        },
      },
    });
    const createBody = (await createResponse.json()) as {
      ok: boolean;
      data?: { id?: string };
    };

    expect([200, 201]).toContain(createResponse.status());
    expect(createBody.ok).toBe(true);
    const planSetId = extractPlanSetId(createBody.data);
    expect(planSetId).toMatch(UUID_REGEX);

    const setId = String(planSetId);
    createdPlanSetIds.add(setId);

    const listResponse = await request.get(
      `/api/takeoff/plan-sets?estimate_version_id=${versionId}`
    );
    const listBody = (await listResponse.json()) as {
      ok: boolean;
      data?: unknown;
    };

    expect(listResponse.status()).toBe(200);
    expect(listBody.ok).toBe(true);
    expect(extractPlanSets(listBody.data).some((planSet) => planSet.id === setId)).toBe(true);

    const deleteResponse = await request.delete(`/api/takeoff/plan-sets/${setId}`);
    const deleteBody = (await deleteResponse.json()) as { ok: boolean };

    expect(deleteResponse.status()).toBe(200);
    expect(deleteBody.ok).toBe(true);

    createdPlanSetIds.delete(setId);
  });

  test("E06 - list endpoint enforces offset ceiling for resilience", async ({ request }) => {
    const invalidResponse = await request.get(
      `/api/takeoff/jobs?estimate_version_id=${versionId}&limit=20&offset=10001`
    );
    const invalidBody = (await invalidResponse.json()) as {
      ok: boolean;
      error?: {
        code?: string;
      };
    };

    expect([400, 422]).toContain(invalidResponse.status());
    expect(invalidBody.ok).toBe(false);
    expect(["VALIDATION_ERROR", "BAD_REQUEST"]).toContain(
      invalidBody.error?.code ?? ""
    );
  });

  test("E07 - revision compare returns delta for two seeded jobs", async ({
    request,
  }) => {
    const base = await seedCompletedTakeoffJob({
      versionId,
      tenantId,
      level: "C",
      sourceFileName: "e07-revision.pdf",
      items: [
        {
          designation: "Mur BA13",
          quantity: 10,
          unit: "m2",
          confidence: 0.9,
          source_page: 1,
        },
        {
          designation: "Porte bois",
          quantity: 2,
          unit: "u",
          confidence: 0.88,
          source_page: 2,
        },
      ],
    });
    createdJobIds.add(base.jobId);

    const compareWith = await seedCompletedTakeoffJob({
      versionId,
      tenantId,
      level: "C",
      sourceFileName: "e07-revision.pdf",
      items: [
        {
          designation: "Mur BA13",
          quantity: 12,
          unit: "m2",
          confidence: 0.93,
          source_page: 1,
        },
        {
          designation: "Fenetre PVC",
          quantity: 1,
          unit: "u",
          confidence: 0.81,
          source_page: 3,
        },
      ],
    });
    createdJobIds.add(compareWith.jobId);

    const response = await request.get(
      `/api/takeoff/jobs/${base.jobId}/compare?with=${compareWith.jobId}`
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        base_job_id?: string;
        other_job_id?: string;
        summary?: {
          added?: number;
          removed?: number;
          changed?: number;
        };
      };
    };

    expect(response.status()).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data?.base_job_id).toBe(base.jobId);
    expect(body.data?.other_job_id).toBe(compareWith.jobId);
    expect(body.data?.summary?.changed).toBeGreaterThanOrEqual(1);
    expect(body.data?.summary?.added).toBeGreaterThanOrEqual(1);
    expect(body.data?.summary?.removed).toBeGreaterThanOrEqual(1);
  });
});
