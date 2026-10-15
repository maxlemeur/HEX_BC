import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect } from "e2e";

import { recordEvidence, type ArmyState, type OwnedEstimate } from "../critical/fixtures";

export type TakeoffSeedItem = {
  designation: string;
  quantity: number;
  unit: string;
  confidence: number;
  is_excluded?: boolean;
  is_verified?: boolean;
  source_page?: number;
};

// Fixture preparation stays outside the browser and uses the account's RLS.
// No session token or response containing one enters Army evidence.
export async function localTakeoffFixture(army: ArmyState, ids: OwnedEstimate) {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (backend.protocol !== "http:" || backend.username || backend.password || backend.pathname !== "/" || backend.search || backend.hash ||
      !["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) ||
      backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST ||
      !army.ownedEstimates.some(item => item.versionId === ids.versionId && item.projectId === ids.projectId)) {
    throw new Error("Takeoff seeds require an owned ARMY estimate on allowlisted local Supabase.");
  }
  const client = createClient(backend.href, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const login = await client.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL!, password: process.env.E2E_LOGIN_PASSWORD! });
  if (login.error) throw new Error("Local ARMY fixture login failed.");
  const version = await client.from("estimate_versions").select("tenant_id, project_id").eq("id", ids.versionId).single();
  if (version.error || version.data.project_id !== ids.projectId) throw new Error("Owned fixture version unavailable.");
  const project = await client.from("estimate_projects").select("name").eq("id", ids.projectId).single();
  if (project.error || !project.data.name.startsWith(army.runPrefix)) throw new Error("Fixture project ownership differs.");
  const tenantId = String(version.data.tenant_id);
  const tenant = await client.from("tenants").select("name").eq("id", tenantId).single();
  if (tenant.error || !/^ARMY\b/.test(tenant.data.name)) throw new Error("A dedicated ARMY tenant is required.");
  return {
    client,
    tenantId,
    async seed(level: "A" | "B" | "C", items: TakeoffSeedItem[], source = "ARMY-revision.pdf") {
      const { client: worker } = await localTakeoffWorkerClient(army, ids.versionId);
      const jobId = randomUUID();
      const resultId = randomUUID();
      const itemIds = items.map(() => randomUUID());
      const now = new Date().toISOString();
      await recordEvidence(army, `takeoff-prerequisite-${jobId}`, { ids, tenantId, jobId, resultId, itemIds, level, source });
      const job = await worker.from("takeoff_jobs").insert({ id: jobId, tenant_id: tenantId, estimate_version_id: ids.versionId,
        level, status: "completed", source_file_name: source, source_file_type: level === "A" ? "text/csv" : "application/pdf",
        source_file_size_bytes: 512, schema_version: "v1", started_at: now, completed_at: now });
      if (job.error) throw new Error(`Owned takeoff job seed failed: ${job.error.code}`);
      const result = await worker.from("takeoff_results").insert({ id: resultId, tenant_id: tenantId, job_id: jobId, extracted_json: {}, warnings: [], tables: [] });
      if (result.error) throw new Error(`Owned takeoff result seed failed: ${result.error.code}`);
      const rows = items.map((item, index) => ({ id: itemIds[index], tenant_id: tenantId, job_id: jobId, result_id: resultId,
        ...item, evidence: `ARMY localized fixture: ${item.designation}`, source_file_name: source, source_page: item.source_page ?? 1, metadata: {},
        is_excluded: item.is_excluded ?? false, exclusion_reason: item.is_excluded ? "ARMY excluded fixture" : null,
        is_verified: item.is_verified ?? false, verified_at: item.is_verified ? now : null, verified_by: item.is_verified ? login.data.user!.id : null }));
      const inserted = await worker.from("takeoff_items").insert(rows);
      if (inserted.error) throw new Error(`Owned takeoff item seed failed: ${inserted.error.code}`);
      expect(rows).toHaveLength(items.length);
      return { jobId, resultId, items: rows };
    },
  };
}

// Completed/failed worker states cannot be forged by an authenticated operator.
// Prepare those prerequisites only on the explicitly allowlisted local backend,
// after proving ownership with the ordinary account. Never pass this client to
// browser.evaluate or evidence; all actions under test keep the user's session.
export async function localTakeoffWorkerClient(army: ArmyState, versionId: string) {
  const ids = army.ownedEstimates.find(item => item.versionId === versionId);
  if (!ids) throw new Error("Worker prerequisites require a newly owned ARMY version.");
  const fixture = await localTakeoffFixture(army, ids);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("Local worker prerequisite key is missing.");
  await recordEvidence(army, `local-worker-prerequisite-${versionId}`, {
    ...ids, tenantId: fixture.tenantId, backend: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin,
    boundary: "Local worker-state prerequisite only; UI and API assertions use the ordinary authenticated account.",
  });
  return { tenantId: fixture.tenantId, client: createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) };
}

export async function seedOwnedSupplyType(army: ArmyState, versionId: string) {
  const ids = army.ownedEstimates.find(item => item.versionId === versionId);
  if (!ids) throw new Error("Supply-type prerequisites require an owned ARMY version.");
  const fixture = await localTakeoffFixture(army, ids);
  const { data, error } = await fixture.client.from("supply_types").insert({
    tenant_id: fixture.tenantId, code: `${army.runPrefix}-SUPPLY`, name: `${army.runPrefix} supplies`,
  }).select("id").single();
  if (error || !data?.id) throw new Error(`Cannot prepare owned supply type: ${error?.code ?? "missing row"}`);
  await recordEvidence(army, "supply-type-prerequisite", { ids, supplyTypeId: data.id, tenantId: fixture.tenantId });
  return data.id as string;
}
