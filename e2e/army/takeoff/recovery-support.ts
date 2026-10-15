import { randomUUID } from "node:crypto";

import type { ArmyState } from "../critical/fixtures";
import { localTakeoffWorkerClient } from "./fixtures";
import { localClient } from "./native-ui";

async function getAuthenticatedSupabaseClient() { return (await localClient()).client; }

export async function seedPlanSetWithFile(input: {
  projectId: string;
  versionId: string;
  tenantId: string;
  planSetName: string;
  fileName: string;
}) {
  const sb = await getAuthenticatedSupabaseClient();
  const planSetId = randomUUID();
  const fileId = randomUUID();

  const { error: planSetError } = await sb.from("plan_sets").insert({
    id: planSetId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    estimate_version_id: input.versionId,
    name: input.planSetName,
    description: "E2E reprise affaire-first",
  });

  if (planSetError) {
    throw new Error(`Seed plan set failed: ${planSetError.message}`);
  }

  const { error: fileError } = await sb.from("plan_files").insert({
    id: fileId,
    tenant_id: input.tenantId,
    plan_set_id: planSetId,
    file_path: `${input.tenantId}/${planSetId}/${fileId}/${input.fileName}`,
    file_name: input.fileName,
    file_type: "application/pdf",
    file_size_bytes: 183_500,
    page_count: 2,
  });

  if (fileError) {
    throw new Error(`Seed plan file failed: ${fileError.message}`);
  }

  return { planSetId };
}

export async function seedTakeoffJob(army: ArmyState, input: {
  versionId: string;
  tenantId: string;
  sourceFileName: string;
  status: "completed" | "failed" | "processing";
  level?: "A" | "B" | "C";
  processingStrategy?: "sync" | "batch";
  providerBatchState?:
    | "submitted"
    | "pending"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "expired"
    | "unknown"
    | null;
  retryCount?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  createResult?: boolean;
}) {
  const { client: sb, tenantId } = await localTakeoffWorkerClient(army, input.versionId);
  if (tenantId !== input.tenantId) throw new Error("Recovery fixture tenant differs from the owned version.");
  const nowIso = new Date().toISOString();
  const jobId = randomUUID();

  const { error: jobError } = await sb.from("takeoff_jobs").insert({
    id: jobId,
    tenant_id: input.tenantId,
    estimate_version_id: input.versionId,
    level: input.level ?? "A",
    status: input.status,
    processing_strategy: input.processingStrategy ?? "sync",
    provider_batch_state: input.providerBatchState ?? null,
    provider_batch_id:
      input.providerBatchState && input.providerBatchState !== "unknown"
        ? randomUUID()
        : null,
    source_file_name: input.sourceFileName,
    source_file_type: "application/pdf",
    source_file_size_bytes: 2048,
    schema_version: "v1",
    retry_count: input.retryCount ?? 0,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ?? null,
    started_at: nowIso,
    completed_at: input.status === "processing" ? null : nowIso,
  });

  if (jobError) {
    throw new Error(`Seed takeoff job failed: ${jobError.message}`);
  }

  if (input.createResult) {
    const resultId = randomUUID();

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
      designation: "Tube cuivre 18",
      quantity: 12,
      unit: "u",
      confidence: 0.96,
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
  }

  return { jobId };
}

export async function seedVersionLink(input: {
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
