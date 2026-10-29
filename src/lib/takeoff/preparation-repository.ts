import "server-only";

import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { assertProjectAccessOrThrow } from "@/lib/affaires/import-flow-server";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { readAllRows } from "@/lib/supabase/read-all";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import type { TakeoffPreparationSource } from "@/lib/takeoff/preparation";
import { toPreparationPlanSource, toPreparationIntakeSource, type PreparationPlanFile, type PreparationIntakeDocument } from "@/lib/takeoff/preparation-sources";
import type { Json } from "@/types/database";

type Context = AuthenticatedTenantContext;
export type PreparationRecordRow = {
  revision: number;
  draft: Json;
  confirmed_snapshot: Json | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
};
const PREPARATION_SELECT = "revision, draft, confirmed_snapshot, confirmed_at, confirmed_by";

export function preparationConflict(message: string): never {
  throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, message, retryable: false });
}

function throwPreparationDatabaseError(error: { code?: string; message: string }): never {
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? "")) {
    throw new TakeoffError({
      status: 503, code: TakeoffErrorCode.INTERNAL_ERROR,
      message: "La préparation du métré nécessite la mise à jour de la base de données. Contactez l'administrateur.",
      details: { reason: "PREPARATION_SCHEMA_REQUIRED" },
      retryable: false,
    });
  }
  throw mapSupabaseError({ ...error, code: error.code ?? "UNKNOWN" }, "Impossible d'enregistrer la préparation du métré.");
}

export async function assertPreparationProjectAccess(context: Context, projectId: string, write = false) {
  if (write && context.tenantRole !== "admin" && context.tenantRole !== "engineer") {
    throw new TakeoffError({ status: 403, code: TakeoffErrorCode.FORBIDDEN, message: "Votre rôle ne permet pas de préparer un métré.", retryable: false });
  }
  await assertProjectAccessOrThrow({
    ...context, projectId, isTenantAdmin: context.tenantRole === "admin" || (!write && context.tenantRole === "director"),
  });
}

export async function readPreparationRecord(context: Context, projectId: string): Promise<PreparationRecordRow | null> {
  const { data, error } = await context.supabase.from("takeoff_preparations" as never)
    .select(PREPARATION_SELECT as never).eq("tenant_id" as never, context.tenantId as never)
    .eq("project_id" as never, projectId as never).abortSignal(new AbortController().signal).maybeSingle();
  if (error) throwPreparationDatabaseError(error);
  return data as PreparationRecordRow | null;
}

export async function readPreparationSources(context: Context, projectId: string): Promise<TakeoffPreparationSource[]> {
  const { data: sets, error: setError } = await readAllRows(() => context.supabase.from("plan_sets")
    .select("id", { count: "exact" }).eq("tenant_id", context.tenantId).eq("project_id", projectId).order("id").abortSignal(new AbortController().signal));
  if (setError) throw mapSupabaseError(setError, "Impossible de charger les jeux de plans.");
  const planFiles = sets?.length ? await readAllRows(() => context.supabase.from("plan_files")
    .select("id,plan_set_id,file_name,file_path,file_size_bytes,file_hash,page_count,updated_at,metadata", { count: "exact" })
    .eq("tenant_id", context.tenantId).in("plan_set_id", sets.map((set) => set.id)).order("id").abortSignal(new AbortController().signal)) : { data: [], error: null };
  if (planFiles.error) throw mapSupabaseError(planFiles.error, "Impossible de charger les sources du métré.");
  const intake = await readAllRows(() => context.supabase.from("affaire_intake_documents" as never)
    .select("id,file_name,storage_path,size_bytes,mime_type,document_kind,updated_at,extracted_metadata" as never, { count: "exact" })
    .eq("tenant_id" as never, context.tenantId as never).eq("project_id" as never, projectId as never)
    .eq("upload_status" as never, "uploaded" as never).is("deleted_at" as never, null).is("deletion_token" as never, null)
    .neq("document_kind" as never, "plans" as never).order("id" as never).abortSignal(new AbortController().signal));
  if (intake.error) throw mapSupabaseError(intake.error, "Impossible de charger les pièces de référence du métré.");
  return [
    ...(planFiles.data as PreparationPlanFile[] ?? []).map(toPreparationPlanSource),
    ...(intake.data as PreparationIntakeDocument[] ?? []).filter((document) => Boolean(document.storage_path) && document.document_kind !== "plan").map(toPreparationIntakeSource),
  ];
}

/** The authenticated client only reads: confirmations are server-owned records. */
export async function persistPreparationRecord(input: {
  context: Context; projectId: string; expectedRevision: number | null;
  revision: number; draft: Json; snapshot: Json | null; confirmedAt: string | null;
}) {
  const server = createServiceRoleClient();
  const row = {
    tenant_id: input.context.tenantId, project_id: input.projectId,
    revision: input.revision, draft: input.draft, confirmed_snapshot: input.snapshot,
    confirmed_at: input.confirmedAt, confirmed_by: input.confirmedAt ? input.context.userId : null,
    updated_by: input.context.userId,
  };
  const query = input.expectedRevision === null
    ? server.from("takeoff_preparations" as never).insert(row as never)
    : server.from("takeoff_preparations" as never).update(row as never)
      .eq("tenant_id" as never, input.context.tenantId as never).eq("project_id" as never, input.projectId as never)
      .eq("revision" as never, input.expectedRevision as never);
  const { data, error } = await query.select(PREPARATION_SELECT as never).maybeSingle();
  if (error?.code === "23505" || (!error && !data)) {
    preparationConflict("La préparation a changé dans une autre fenêtre. Rechargez-la avant de continuer.");
  }
  if (error) throwPreparationDatabaseError(error);
  return data as unknown as PreparationRecordRow;
}
