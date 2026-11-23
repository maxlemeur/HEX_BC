import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { takeoffModuleDefault } from "@/lib/takeoff/feature-flags";
import { redistributionRequestSchema, redistributionResponseSchema, type RedistributionOption } from "@/lib/takeoff/item-redistribution-contracts";
import { itemSendMemberMayWrite } from "@/lib/takeoff/item-send-preview-server";
import { getAuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";

const refusals: Partial<Record<string, [403 | 409 | 422, string]>> = {
  REDISTRIBUTION_INVALID: [422, "Les paramètres de redistribution sont invalides."],
  REDISTRIBUTION_FORBIDDEN: [403, "Vous ne pouvez pas modifier les apports de cette affaire."],
  REDISTRIBUTION_SEALED: [409, "Ce devis a été émis ou scellé. Il est en lecture seule."],
  REDISTRIBUTION_OTHER_AMOUNTS: [409, "Le recalcul changerait le montant d’une autre ligne. Vérifiez les montants du brouillon dans l’éditeur."],
  REDISTRIBUTION_ENGINE: [422, "La redistribution demande un brouillon du moteur de calcul 3."],
  REDISTRIBUTION_EMPTY: [409, "Ce poste ne porte plus d’apport vivant dans ce devis."],
  REDISTRIBUTION_STALE: [409, "Le devis ou ses apports ont changé. Relisez l’aperçu puis confirmez de nouveau."],
  REDISTRIBUTION_PROTECTED: [409, "Des lignes demandent une décision dans l’éditeur. Relisez l’aperçu."],
  REDISTRIBUTION_REQUEST_CONFLICT: [409, "Cette confirmation a déjà servi pour une autre redistribution."],
  REDISTRIBUTION_LEASE: [409, "Le brouillon doit vous être réservé dans l’éditeur pour confirmer."],
};

function refusal(jobId: string, reason: string): never {
  const [status, message] = refusals[reason] ?? [500, "La redistribution n’a pas pu être vérifiée."];
  throw new TakeoffError({ status, code: status === 403 ? TakeoffErrorCode.FORBIDDEN : status === 500
    ? TakeoffErrorCode.INTERNAL_ERROR : TakeoffErrorCode.CONFLICT, message, jobId, retryable: status === 409 });
}

export async function redistributeTakeoffItem(rawJobId: string, body: unknown) {
  const ctx = await getAuthenticatedTakeoffContext();
  const jobId = parseWithSchema(takeoffJobIdSchema, rawJobId, "Identifiant de plan invalide.");
  const request = parseWithSchema(redistributionRequestSchema, body, "Demande de redistribution invalide.");
  const { data: job, error: jobError } = await ctx.supabase.from("takeoff_jobs").select("project_id, estimate_version_id")
    .eq("tenant_id", ctx.tenantId).eq("id", jobId).maybeSingle();
  if (jobError || !job?.project_id || !await itemSendMemberMayWrite({ ...ctx, tenantRole: ctx.tenantRole ?? "" }, job.project_id, jobId)) {
    refusal(jobId, "REDISTRIBUTION_FORBIDDEN");
  }
  if (request.action === "list") {
    const options = new Map<string, RedistributionOption>();
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await ctx.supabase.from("takeoff_item_send_targets")
        .select("id, version_id, item_id, estimate_items(title), estimate_versions!inner(version_number), takeoff_item_send_parts!inner()")
        .eq("tenant_id", ctx.tenantId).eq("project_id", job.project_id).eq("takeoff_item_send_parts.state", "live")
        .order("id").range(offset, offset + 499);
      if (error || !data) refusal(jobId, "read");
      for (const row of data) {
        options.set(`${row.version_id}/${row.item_id}`, { version_id: row.version_id, item_id: row.item_id,
          version_number: row.estimate_versions.version_number, title: row.estimate_items?.title ?? "Poste dont la ligne a été supprimée" });
      }
      if (data.length < 500) break;
    }
    return { action: "list" as const, options: [...options.values()].sort((a, b) =>
      Number(b.version_id === job.estimate_version_id) - Number(a.version_id === job.estimate_version_id)
      || b.version_number - a.version_number || a.title.localeCompare(b.title, "fr") || a.item_id.localeCompare(b.item_id)) };
  }
  const args = { p_tenant: ctx.tenantId, p_actor: ctx.userId, p_project: job.project_id, p_version: request.version_id,
    p_item: request.item_id, p_mode: request.breakdown, p_module: takeoffModuleDefault() };
  const service = createServiceRoleClient();
  const { data, error } = request.action === "preview"
    ? await service.rpc("preview_takeoff_item_redistribution", args)
    : await service.rpc("redistribute_takeoff_item", { ...args, p_request: request.request_id, p_digest: request.digest });
  if (error) refusal(jobId, error.message);
  return redistributionResponseSchema.parse(request.action === "preview" ? { action: "preview", preview: data }
    : { action: "confirm", ...(data && typeof data === "object" ? data : {}) });
}
