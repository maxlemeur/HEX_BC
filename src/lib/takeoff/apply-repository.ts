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
import type { ApplyGuardItem } from "@/lib/takeoff/guards";
import { takeoffApplyOverrideItemState, type TakeoffApplyOverrideItemState } from "@/lib/takeoff/apply-override-state";
import { TakeoffRuleResultsSchema } from "@/lib/takeoff/rules/contracts";
import type { DpgfApplyComposition, DpgfApplyQuantityLine } from "@/lib/takeoff/dpgf-apply-quantities";

/** A line the apply guard reads, with the state an admin override records when it lifts it (TI-677 PR D). */
export type TakeoffApplyGuardRow = ApplyGuardItem & { override_state: TakeoffApplyOverrideItemState };

/**
 * The guarded application, through public.apply_takeoff_job_with_page_decisions: the page decisions are recorded and
 * applied in one transaction, so that the application applies the decisions of its own request (TI-682 lot D), then the
 * guarded overload (with the DPGF authorization when there is one).
 */
export async function invokeApplyTakeoffRpc(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  args: ApplyTakeoffRpcArgs;
}) {
  return input.supabase.rpc(
    "apply_takeoff_job_with_page_decisions" as never,
    {
      p_job_id: input.args.job_id,
      p_strategy: input.args.strategy,
      p_target_section_id: input.args.target_section_id,
      p_mapping_plan: input.args.mapping_plan,
      p_page_decisions: input.args.page_decisions ?? [],
      p_dpgf_authorization_token: input.args.dpgf_authorization_token ?? null,
    } as never
  );
}

export async function issueTakeoffDpgfApplyAuthorization(input: {
  tenantId: string;
  userId: string;
  jobId: string;
  estimateVersionId: string;
  summary: TakeoffDpgfComparisonSummary;
  quantityPolicy?: DpgfApplyQuantityLine[];
  compositions?: DpgfApplyComposition[];
  quantitySources?: Array<{ id: string; updated_at: string; quantity: number; designation: string; unit: string; is_excluded: boolean }>;
  quantityComparisonStamp?: string;
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

/** Bind the whole documentary comparison, including excluded sources, manual links and review decisions. */
export async function loadTakeoffQuantityComparisonStamp(tenantId: string, estimateVersionId: string): Promise<string> {
  const { data, error } = await createServiceRoleClient().rpc("takeoff_rule_version_stamp",
    { p_tenant_id: tenantId, p_estimate_version_id: estimateVersionId });
  if (error || typeof data !== "string") throw new Error("Impossible de figer la révision des quantités examinées.");
  return data;
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

/**
 * Whether lines of other jobs are excluded now (TI-677): the partners a cross-line failure of the job names. A line
 * the read does not return stays unknown, and its failure keeps blocking.
 */
export async function listTakeoffRulePartnerExclusions(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  itemIds: readonly string[];
}): Promise<Map<string, boolean>> {
  const states = new Map<string, boolean>();
  for (let offset = 0; offset < input.itemIds.length; offset += 200) {
    const { data, error } = await input.supabase
      .from("takeoff_items" as never)
      .select("id, is_excluded" as never)
      .eq("tenant_id" as never, input.tenantId as never)
      .in("id" as never, input.itemIds.slice(offset, offset + 200) as never);
    if (error) {
      throw toTakeoffError(mapSupabaseError(error, "Impossible de vérifier les lignes partenaires pour le guard."), {});
    }
    for (const row of (data ?? []) as Array<{ id: string; is_excluded: boolean }>) states.set(row.id, row.is_excluded === true);
  }
  return states;
}

export async function listTakeoffApplyGuardItems(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  jobId: string;
}): Promise<TakeoffApplyGuardRow[]> {
  const { data, error } = await readAllRows(() => input.supabase
    .from("takeoff_items" as never)
    .select(
      ("id, designation, confidence, evidence, source_page, is_verified, is_excluded, rule_results, rules_stale, quantity, unit, "
        + "updated_at, quantity_entered_by") as never,
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

  // Rule results are written by the server (TI-664); one that no longer parses blocks as stale results would. The
  // override's state is read from the stored row, as the apply trigger reads it.
  return (data as Array<Record<string, unknown> & { id: string }>).map((row) => {
    const results = TakeoffRuleResultsSchema.safeParse(row.rule_results ?? []);
    return { ...row, rule_results: results.success ? results.data : [], rules_stale: row.rules_stale === true || !results.success,
      override_state: takeoffApplyOverrideItemState(row as Parameters<typeof takeoffApplyOverrideItemState>[0]) };
  }) as unknown as TakeoffApplyGuardRow[];
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
