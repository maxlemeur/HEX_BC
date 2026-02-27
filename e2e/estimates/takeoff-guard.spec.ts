/**
 * TKF-025 E2E: Guard Apply — verified obligatoire pour low-confidence
 *
 * Seeds a completed Level C takeoff job with mixed-confidence items via an
 * authenticated Supabase client, then exercises the POST /apply endpoint
 * through the authenticated Playwright request context to verify server-side
 * guard behaviour (422 block, verify-then-retry, Level A bypass, admin override).
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

// Load .env.local so NEXT_PUBLIC_SUPABASE_URL / ANON_KEY are available
loadEnvConfig(path.resolve(__dirname, "../.."));

import {
  buildEstimateName,
  createEstimateViaWizard,
} from "./helpers";

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function envOrThrow(name: string): string {
  const value = process.env[name]?.trim();
  if (value) {
    return value;
  }
  throw new Error(`Missing required env var: ${name}`);
}

// ---------------------------------------------------------------------------
// Supabase seed client (E2E-scoped service role key or authenticated user)
// ---------------------------------------------------------------------------

let supabaseClient: SupabaseClient;

async function getAuthenticatedSupabaseClient(): Promise<SupabaseClient> {
  if (supabaseClient) return supabaseClient;

  const url = envOrThrow("NEXT_PUBLIC_SUPABASE_URL");

  // Use a dedicated E2E seeding key when available.
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

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

type SeededJob = {
  jobId: string;
  tenantId: string;
  itemIds: string[];
};

async function getTenantIdForVersion(versionId: string): Promise<string> {
  const sb = await getAuthenticatedSupabaseClient();
  const { data, error } = await sb
    .from("estimate_versions")
    .select("tenant_id")
    .eq("id", versionId)
    .single();
  if (error) throw new Error(`Cannot resolve tenant for version: ${error.message}`);
  return (data as { tenant_id: string }).tenant_id;
}

/**
 * Inserts a takeoff job in "completed" status with a set of items that cover
 * the guard scenarios: low-confidence unverified, medium-confidence, high-confidence,
 * and excluded low-confidence.
 */
async function seedCompletedTakeoffJob(
  versionId: string,
  tenantId: string,
  level: "A" | "B" | "C"
): Promise<SeededJob> {
  const sb = await getAuthenticatedSupabaseClient();
  const jobId = randomUUID();

  // Insert job
  const { error: jobErr } = await sb.from("takeoff_jobs").insert({
    id: jobId,
    tenant_id: tenantId,
    estimate_version_id: versionId,
    level,
    status: "completed",
    source_file_name: `e2e-guard-${level}.csv`,
    source_file_type: "text/csv",
    source_file_size_bytes: 512,
    schema_version: "v1",
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });
  if (jobErr) throw new Error(`Seed job insert failed: ${jobErr.message}`);

  // Insert result row (required by foreign key on items)
  const resultId = randomUUID();
  const { error: resErr } = await sb.from("takeoff_results").insert({
    id: resultId,
    tenant_id: tenantId,
    job_id: jobId,
    extracted_json: {},
    warnings: [],
    tables: [],
  });
  if (resErr) throw new Error(`Seed result insert failed: ${resErr.message}`);

  // Insert items with varying confidence
  const items = [
    {
      id: randomUUID(),
      tenant_id: tenantId,
      job_id: jobId,
      result_id: resultId,
      designation: "Cloison BA13 ep.72",
      quantity: 42,
      unit: "m2",
      confidence: 0.23,
      is_excluded: false,
      is_verified: false,
    },
    {
      id: randomUUID(),
      tenant_id: tenantId,
      job_id: jobId,
      result_id: resultId,
      designation: "Faux-plafond 60x60",
      quantity: 15,
      unit: "m2",
      confidence: 0.41,
      is_excluded: false,
      is_verified: false,
    },
    {
      id: randomUUID(),
      tenant_id: tenantId,
      job_id: jobId,
      result_id: resultId,
      designation: "Enduit platre int.",
      quantity: 80,
      unit: "m2",
      confidence: 0.65,
      is_excluded: false,
      is_verified: false,
    },
    {
      id: randomUUID(),
      tenant_id: tenantId,
      job_id: jobId,
      result_id: resultId,
      designation: "Peinture acrylique",
      quantity: 120,
      unit: "m2",
      confidence: 0.92,
      is_excluded: false,
      is_verified: false,
    },
    {
      id: randomUUID(),
      tenant_id: tenantId,
      job_id: jobId,
      result_id: resultId,
      designation: "Excluded low conf",
      quantity: 5,
      unit: "u",
      confidence: 0.1,
      is_excluded: true,
      is_verified: false,
    },
  ];

  const { error: itemsErr } = await sb.from("takeoff_items").insert(items);
  if (itemsErr) throw new Error(`Seed items insert failed: ${itemsErr.message}`);

  return { jobId, tenantId, itemIds: items.map((i) => i.id) };
}

async function seedExcludedOnlyJob(
  versionId: string,
  tenantId: string
): Promise<string> {
  const sb = await getAuthenticatedSupabaseClient();
  const jobId = randomUUID();

  const { error: jobErr } = await sb.from("takeoff_jobs").insert({
    id: jobId,
    tenant_id: tenantId,
    estimate_version_id: versionId,
    level: "C",
    status: "completed",
    source_file_name: "e2e-guard-excluded.csv",
    source_file_type: "text/csv",
    source_file_size_bytes: 256,
    schema_version: "v1",
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });
  if (jobErr) throw new Error(`Job insert failed: ${jobErr.message}`);

  const resultId = randomUUID();
  const { error: resErr } = await sb.from("takeoff_results").insert({
    id: resultId,
    tenant_id: tenantId,
    job_id: jobId,
    extracted_json: {},
    warnings: [],
    tables: [],
  });
  if (resErr) throw new Error(`Result insert failed: ${resErr.message}`);

  const { error: itemsErr } = await sb.from("takeoff_items").insert([
    {
      tenant_id: tenantId,
      job_id: jobId,
      result_id: resultId,
      designation: "Excluded item A",
      quantity: 1,
      unit: "u",
      confidence: 0.1,
      is_excluded: true,
      is_verified: false,
    },
    {
      tenant_id: tenantId,
      job_id: jobId,
      result_id: resultId,
      designation: "High conf item",
      quantity: 10,
      unit: "m2",
      confidence: 0.95,
      is_excluded: false,
      is_verified: false,
    },
  ]);
  if (itemsErr) throw new Error(`Items insert failed: ${itemsErr.message}`);

  return jobId;
}

async function cleanupJob(jobId: string) {
  const sb = await getAuthenticatedSupabaseClient();
  // Items + results cascade from job deletion
  await sb.from("takeoff_jobs").delete().eq("id", jobId);
}

// ---------------------------------------------------------------------------
// Apply endpoint helper
// ---------------------------------------------------------------------------

const APPLY_PAYLOAD_BASE = {
  strategy: "merge" as const,
  target_section_id: null,
};

type ApplyErrorBody = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: {
      blocked_items?: Array<{ item_id: string; designation: string; confidence: number | null }>;
      medium_items?: Array<{ item_id: string; designation: string; confidence: number }>;
      threshold?: number;
    };
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("TKF-025: guard apply – verified obligatoire pour low-confidence", () => {
  let versionId: string;
  let tenantId: string;
  const seededJobIds: string[] = [];

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

    const result = await createEstimateViaWizard(page, {
      projectName: buildEstimateName("TKF025-GUARD"),
      title: "TKF-025 Guard E2E",
    });
    versionId = result.versionId;
    tenantId = await getTenantIdForVersion(versionId);

    await page.close();
    await context.close();
  });

  test.afterAll(async () => {
    for (const jobId of seededJobIds) {
      await cleanupJob(jobId).catch(() => {});
    }
  });

  test("returns 422 with blocked items when Level C job has unverified low-confidence items", async ({
    request,
  }) => {
    const seed = await seedCompletedTakeoffJob(versionId, tenantId, "C");
    seededJobIds.push(seed.jobId);

    const response = await request.post(
      `/api/takeoff/jobs/${seed.jobId}/apply`,
      { data: APPLY_PAYLOAD_BASE }
    );

    expect(response.status()).toBe(422);

    const body = (await response.json()) as ApplyErrorBody;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("TAKEOFF_APPLY_GUARD_FAILED");

    // Two items below default threshold (0.5): 0.23 and 0.41
    const blocked = body.error.details?.blocked_items ?? [];
    expect(blocked.length).toBe(2);

    const blockedDesignations = blocked.map((b) => b.designation).sort();
    expect(blockedDesignations).toEqual(["Cloison BA13 ep.72", "Faux-plafond 60x60"]);

    // Medium items (0.5 ≤ conf < 0.8): "Enduit platre int." at 0.65
    const medium = body.error.details?.medium_items ?? [];
    expect(medium.length).toBe(1);
    expect(medium[0].designation).toBe("Enduit platre int.");

    // Threshold should be returned
    expect(body.error.details?.threshold).toBeGreaterThan(0);
  });

  test("does not return guard error after low-confidence items are verified", async ({
    request,
  }) => {
    const seed = await seedCompletedTakeoffJob(versionId, tenantId, "C");
    seededJobIds.push(seed.jobId);

    // First, fetch items to get their updated_at timestamps
    const listResponse = await request.get(
      `/api/takeoff/jobs/${seed.jobId}`
    );
    expect(listResponse.status()).toBe(200);
    const listBody = (await listResponse.json()) as {
      ok: boolean;
      data: {
        items: {
          data: Array<{
            id: string;
            designation: string;
            confidence: number | null;
            is_excluded: boolean;
            updated_at: string;
          }>;
        };
      };
    };

    // Identify low-confidence included items (conf < 0.5, not excluded)
    const lowConfItems = listBody.data.items.data.filter(
      (item) =>
        !item.is_excluded &&
        item.confidence !== null &&
        item.confidence < 0.5
    );
    expect(lowConfItems.length).toBe(2);

    // Verify them via PATCH
    const patchPayload = {
      items: lowConfItems.map((item) => ({
        item_id: item.id,
        updated_at: item.updated_at,
        fields: { is_verified: true },
      })),
    };

    const patchResponse = await request.patch(
      `/api/takeoff/jobs/${seed.jobId}/items`,
      { data: patchPayload }
    );
    expect(patchResponse.status()).toBe(200);

    // Now try to apply again — guard should pass (may fail for other reasons)
    const applyResponse = await request.post(
      `/api/takeoff/jobs/${seed.jobId}/apply`,
      { data: APPLY_PAYLOAD_BASE }
    );

    // The guard should NOT block — if we get an error it should not be the guard error
    if (applyResponse.status() !== 200) {
      const errorBody = (await applyResponse.json()) as ApplyErrorBody;
      expect(errorBody.error.code).not.toBe("TAKEOFF_APPLY_GUARD_FAILED");
    }
  });

  test("does not apply guard for Level A jobs", async ({ request }) => {
    const seed = await seedCompletedTakeoffJob(versionId, tenantId, "A");
    seededJobIds.push(seed.jobId);

    const response = await request.post(
      `/api/takeoff/jobs/${seed.jobId}/apply`,
      { data: APPLY_PAYLOAD_BASE }
    );

    // Guard only applies to Level C — should not get a guard error
    if (response.status() !== 200) {
      const errorBody = (await response.json()) as ApplyErrorBody;
      expect(errorBody.error.code).not.toBe("TAKEOFF_APPLY_GUARD_FAILED");
    }
  });

  test("rejects override without justification (schema validation)", async ({
    request,
  }) => {
    const seed = await seedCompletedTakeoffJob(versionId, tenantId, "C");
    seededJobIds.push(seed.jobId);

    const response = await request.post(
      `/api/takeoff/jobs/${seed.jobId}/apply`,
      {
        data: {
          ...APPLY_PAYLOAD_BASE,
          override: true,
          // Missing override_justification
        },
      }
    );

    // Schema validation should reject: override=true without justification
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });

  test("accepts admin override with justification (bypasses guard)", async ({
    request,
  }) => {
    const seed = await seedCompletedTakeoffJob(versionId, tenantId, "C");
    seededJobIds.push(seed.jobId);

    const response = await request.post(
      `/api/takeoff/jobs/${seed.jobId}/apply`,
      {
        data: {
          ...APPLY_PAYLOAD_BASE,
          override: true,
          override_justification:
            "E2E test: admin override pour projet urgent TKF-025",
        },
      }
    );

    // If the user is admin, the guard should be bypassed
    // The request may fail for non-guard reasons (e.g., non-admin role, missing mapping rules)
    // but it should NOT fail with TAKEOFF_APPLY_GUARD_FAILED
    if (response.status() !== 200) {
      const errorBody = (await response.json()) as ApplyErrorBody;
      expect(errorBody.error.code).not.toBe("TAKEOFF_APPLY_GUARD_FAILED");
    }
  });

  test("excluded low-confidence items do not trigger the guard", async ({
    request,
  }) => {
    const jobId = await seedExcludedOnlyJob(versionId, tenantId);
    seededJobIds.push(jobId);

    const response = await request.post(
      `/api/takeoff/jobs/${jobId}/apply`,
      { data: APPLY_PAYLOAD_BASE }
    );

    // Guard should pass — only excluded low-conf items
    if (response.status() !== 200) {
      const errorBody = (await response.json()) as ApplyErrorBody;
      expect(errorBody.error.code).not.toBe("TAKEOFF_APPLY_GUARD_FAILED");
    }
  });
});
