import "server-only";

import { z } from "zod";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assertPreparationProjectAccess, preparationConflict } from "@/lib/takeoff/preparation-repository";

const RECEIPT_ACTION = "takeoff.preparation.version_created";
const receiptScopeSchema = z.object({
  projectId: z.string().uuid(), sourceVersionId: z.string().uuid(),
  targetVersionId: z.string().uuid(), preparationRevision: z.number().int().positive(),
});
type ReceiptScope = z.infer<typeof receiptScopeSchema>;
type Input = ReceiptScope & { context: AuthenticatedTenantContext };

/** Only the source-launch operation calls this with the ID returned by duplication. */
export async function recordTakeoffPreparationCopy(input: Input) {
  const scope = receiptScopeSchema.parse(input);
  await assertPreparationProjectAccess(input.context, scope.projectId, true);
  if (scope.sourceVersionId === scope.targetVersionId) preparationConflict("La copie doit être une nouvelle version de devis.");
  const { data, error } = await input.context.supabase.from("estimate_versions")
    .select("id,project_id,status").eq("tenant_id", input.context.tenantId).eq("project_id", scope.projectId)
    .in("id", [scope.sourceVersionId, scope.targetVersionId]).abortSignal(new AbortController().signal);
  if (error) throw mapSupabaseError(error, "Impossible de vérifier la provenance de la copie.");
  if (data?.length !== 2 || !data.some((version) => version.id === scope.sourceVersionId) ||
      !data.some((version) => version.id === scope.targetVersionId && version.status === "draft")) {
    preparationConflict("La copie et sa source doivent appartenir à cette affaire.");
  }
  // Authenticated audit inserts only allow invariant_violation. A browser cannot
  // mint or edit this receipt, which deliberately does not use variant parentage.
  const { error: receiptError } = await createServiceRoleClient().from("audit_logs").insert({
    tenant_id: input.context.tenantId, user_id: input.context.userId,
    table_name: "estimate_versions", record_id: scope.targetVersionId,
    estimate_version_id: scope.targetVersionId, action: RECEIPT_ACTION,
    after_data: {
      schema_version: 1, project_id: scope.projectId,
      source_version_id: scope.sourceVersionId, target_version_id: scope.targetVersionId,
      preparation_revision: scope.preparationRevision,
    },
  });
  if (receiptError) throw mapSupabaseError(receiptError, "Impossible d'enregistrer la provenance de la copie.");
}

/** Scope authorization stays with the caller; the service client reads proof only. */
export async function hasTakeoffPreparationCopyReceipt(input: Input): Promise<boolean> {
  const scope = receiptScopeSchema.parse(input);
  const { data, error } = await createServiceRoleClient().from("audit_logs")
    .select("id").eq("tenant_id", input.context.tenantId).eq("action", RECEIPT_ACTION)
    .eq("table_name", "estimate_versions").eq("record_id", scope.targetVersionId)
    .eq("estimate_version_id", scope.targetVersionId).not("user_id", "is", null)
    .eq("after_data->>schema_version", "1").eq("after_data->>project_id", scope.projectId)
    .eq("after_data->>source_version_id", scope.sourceVersionId)
    .eq("after_data->>target_version_id", scope.targetVersionId)
    .eq("after_data->>preparation_revision", String(scope.preparationRevision))
    .abortSignal(new AbortController().signal).limit(1).maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de vérifier le reçu de création du brouillon.");
  return data !== null;
}

/** Resume a copy whose receipt persisted before its first job/response did. */
export async function findTakeoffPreparationCopyReceipt(input: Omit<Input, "targetVersionId">): Promise<{ targetVersionId: string } | null> {
  const scope = receiptScopeSchema.omit({ targetVersionId: true }).parse(input);
  const { data, error } = await createServiceRoleClient().from("audit_logs")
    .select("record_id,estimate_version_id,after_data").eq("tenant_id", input.context.tenantId)
    .eq("action", RECEIPT_ACTION).eq("table_name", "estimate_versions").not("user_id", "is", null)
    .not("estimate_version_id", "is", null).eq("after_data->>schema_version", "1")
    .eq("after_data->>project_id", scope.projectId).eq("after_data->>source_version_id", scope.sourceVersionId)
    .eq("after_data->>preparation_revision", String(scope.preparationRevision))
    .abortSignal(new AbortController().signal).order("created_at", { ascending: false }).limit(10);
  if (error) throw mapSupabaseError(error, "Impossible de retrouver le brouillon déjà créé pour cette préparation.");
  for (const receipt of data ?? []) {
    const metadata = receipt.after_data as Record<string, unknown> | null;
    if (!receipt.estimate_version_id || receipt.record_id !== receipt.estimate_version_id ||
        metadata?.target_version_id !== receipt.record_id || receipt.record_id === scope.sourceVersionId) continue;
    const { data: target, error: targetError } = await input.context.supabase.from("estimate_versions")
      .select("id").eq("id", receipt.record_id).eq("tenant_id", input.context.tenantId)
      .eq("project_id", scope.projectId).abortSignal(new AbortController().signal).maybeSingle();
    if (targetError) throw mapSupabaseError(targetError, "Impossible de vérifier le brouillon de reprise.");
    if (target) return { targetVersionId: target.id };
  }
  return null;
}
