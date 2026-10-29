import "server-only";

import { mapSupabaseError } from "@/lib/estimates/errors";
import { readAllRows } from "@/lib/supabase/read-all";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  buildTakeoffDpgfApplyAuthorizationRecord,
  hashTakeoffApplyAuthorizationToken,
  type ApplyTakeoffRpcArgs,
} from "@/lib/takeoff/apply-preparation";
import { logTakeoffAuditEvent, takeoffAuditMetadataBuilders } from "@/lib/takeoff/audit";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import type { AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import type { TakeoffDpgfComparisonSummary, TakeoffMappingPreviewItem } from "@/lib/takeoff/types";
import type { checkApplyGuard } from "@/lib/takeoff/guards";

export async function invokeApplyTakeoffRpc(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  args: ApplyTakeoffRpcArgs;
}) {
  if (input.args.dpgf_authorization_token) {
    return input.supabase.rpc(
      "apply_takeoff_job_guarded_atomic" as never,
      {
        p_job_id: input.args.job_id,
        p_strategy: input.args.strategy,
        p_target_section_id: input.args.target_section_id,
        p_mapping_plan: input.args.mapping_plan,
        p_dpgf_authorization_token: input.args.dpgf_authorization_token,
      } as never
    );
  }

  return input.supabase.rpc(
    "apply_takeoff_job_guarded_atomic" as never,
    {
      p_job_id: input.args.job_id,
      p_strategy: input.args.strategy,
      p_target_section_id: input.args.target_section_id,
      p_mapping_plan: input.args.mapping_plan,
    } as never
  );
}

export async function issueTakeoffDpgfApplyAuthorization(input: {
  tenantId: string;
  userId: string;
  jobId: string;
  estimateVersionId: string;
  summary: TakeoffDpgfComparisonSummary;
  authorizationToken: string;
  nowMs: number;
}) {
  const serviceRoleClient = createServiceRoleClient();
  const { error } = await serviceRoleClient
    .from("takeoff_apply_authorizations" as never)
    .insert(buildTakeoffDpgfApplyAuthorizationRecord(input) as never);

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(
        error,
        "Impossible de sécuriser l’autorisation d’application après la revue DPGF."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  return input.authorizationToken;
}

export async function revokeTakeoffDpgfApplyAuthorization(input: {
  authorizationToken: string;
  jobId: string;
}) {
  try {
    const serviceRoleClient = createServiceRoleClient();
    const { error } = await serviceRoleClient
      .from("takeoff_apply_authorizations" as never)
      .delete()
      .eq("job_id" as never, input.jobId as never)
      .eq(
        "authorization_token_hash" as never,
        hashTakeoffApplyAuthorizationToken(input.authorizationToken) as never
      );

    if (error) {
      console.error("Takeoff DPGF apply authorization cleanup failed", {
        jobId: input.jobId,
        code: error.code ?? null,
      });
    }
  } catch (error) {
    console.error("Takeoff DPGF apply authorization cleanup failed", {
      jobId: input.jobId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

export async function loadTakeoffApplyConcurrencyToken(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  estimateVersionId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_versions" as never)
    .select("id, updated_at" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.estimateVersionId as never)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(
        error,
        "Impossible de vérifier le verrou brouillon de la version cible."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  const row = (data ?? null) as { id: string; updated_at: string | null } | null;
  if (!row) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Version de chiffrage introuvable.",
      details: {
        estimate_version_id: input.estimateVersionId,
      },
      retryable: false,
    });
  }

  const concurrencyToken = row.updated_at;
  if (!concurrencyToken) {
    throw new TakeoffError({
      status: 500,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message: "Jeton de concurrence introuvable pour la version de chiffrage.",
      details: {
        estimate_version_id: input.estimateVersionId,
      },
      retryable: false,
    });
  }

  return concurrencyToken;
}

export async function listTakeoffApplyGuardItems(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  jobId: string;
}): Promise<Parameters<typeof checkApplyGuard>[0]> {
  const { data, error } = await readAllRows(() => input.supabase
    .from("takeoff_items" as never)
    .select(
      "id, designation, confidence, evidence, source_page, is_verified, is_excluded" as never,
      { count: "exact" }
    )
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("job_id" as never, input.jobId as never));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de vérifier les items pour le guard."),
      { jobId: input.jobId }
    );
  }

  return data as Parameters<typeof checkApplyGuard>[0];
}

export async function logTakeoffMappingApplyAuditEvents(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  userId: string;
  jobId: string;
  estimateVersionId: string;
  previewItems: TakeoffMappingPreviewItem[];
  estimateLineByItemId: Map<string, string | null>;
}) {
  for (const previewItem of input.previewItems) {
    if (previewItem.action === "none" || previewItem.original.is_excluded) {
      continue;
    }

    await logTakeoffAuditEvent({
      supabase: input.supabase,
      tenantId: input.tenantId,
      userId: input.userId,
      jobId: input.jobId,
      estimateVersionId: input.estimateVersionId,
      action: "takeoff.mapping.applied",
      metadata: takeoffAuditMetadataBuilders["takeoff.mapping.applied"]({
        job_id: input.jobId,
        item_id: previewItem.item_id,
        rule_id: previewItem.rule_id,
        action: previewItem.action,
        estimate_item_id: input.estimateLineByItemId.get(previewItem.item_id) ?? null,
      }),
      tableName: "takeoff_items",
      mode: "non-blocking",
    });
  }
}
