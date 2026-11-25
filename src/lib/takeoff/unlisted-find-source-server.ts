import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { readAffaireDocumentPreview } from "@/lib/affaires/intake-document-preview";
import { mapSupabaseError, notFound } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { asRecord } from "@/lib/value-guards";
import { parseTakeoffRequestManifest } from "./request-activity";

const creationMetadata = z.object({
  project_id: z.string().uuid(),
  launch_request_id: z.string().uuid(),
  launch_unit_key: z.string(),
});
const missing = () => notFound("Le plan d’origine n’est plus disponible.");

/** Fallback for the attested-plan route after its normal read returns 404. */
export async function readDismissedFindDossierPlan(
  projectId: string, decisionId: string, jobId: string, fileId: string, signal: AbortSignal,
): Promise<ArrayBuffer> {
  const { context, project } = await requireAffaireAccess(projectId, "read");
  const { data: decision, error } = await context.supabase.from("takeoff_find_decisions")
    .select("intake_document_id").eq("tenant_id", context.tenantId).eq("project_id", project.id)
    .eq("id", decisionId).eq("job_id", jobId).eq("plan_file_id", fileId)
    .is("undone_at", null).is("item_id", null).maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de lire la preuve de l’ouvrage.");
  if (!decision?.intake_document_id) throw missing();

  // Admission records the exact job-to-unit link even when the job and its answers have since been deleted.
  const service = createServiceRoleClient();
  const { data: audit, error: auditError } = await service.from("audit_logs").select("after_data")
    .eq("tenant_id", context.tenantId).eq("table_name", "takeoff_jobs").eq("record_id", jobId)
    .eq("action", "takeoff.job.created").maybeSingle();
  if (auditError) throw mapSupabaseError(auditError, "Impossible de vérifier la lecture du plan.");
  const metadata = creationMetadata.safeParse(asRecord(audit?.after_data)?.metadata);
  if (!metadata.success || metadata.data.project_id !== project.id) throw missing();
  const request = await service.from("takeoff_launch_requests").select("manifest")
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", metadata.data.launch_request_id).maybeSingle();
  if (request.error) throw mapSupabaseError(request.error, "Impossible de vérifier la lecture du plan.");
  const manifest = parseTakeoffRequestManifest(request.data?.manifest);
  const unit = manifest?.units.find(unit => unit.key === metadata.data.launch_unit_key);
  const plan = unit?.plans.length === 1 ? manifest?.plans.get(unit.plans[0]) : null;
  if (!plan?.contentSha256 || plan.planFileId !== fileId || plan.logicalId !== decision.intake_document_id
    || plan.documentId !== decision.intake_document_id) throw missing();

  const document = await readAffaireDocumentPreview(project.id, decision.intake_document_id, false, signal);
  if (document.mimeType !== "application/pdf"
    || createHash("sha256").update(document.bytes).digest("hex") !== plan.contentSha256) throw missing();
  return new Uint8Array(document.bytes).buffer;
}
