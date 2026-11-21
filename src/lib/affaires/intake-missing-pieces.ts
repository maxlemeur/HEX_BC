import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildAffaireIntakeMissingPieces } from "@/lib/affaires/intake";
import type { AffaireAccessProject } from "@/lib/affaires/access-server";
import { hasStoredIntakePlan, hasStoredStandalonePlan, type StandalonePlanRow } from "@/lib/affaires/plan-presence";
import type { AffaireIntakeDocumentRow, AffaireIntakeSupabaseClient } from "@/lib/affaires/intake-rows";

export async function getMissingPiecesForProject(input: {
  supabase: AffaireIntakeSupabaseClient;
  project: AffaireAccessProject;
  documents: AffaireIntakeDocumentRow[];
  /** The affaire's plan files when a portfolio read already holds them. */
  standalonePlanRows?: readonly StandalonePlanRow[];
}) {
  const activeDocuments = input.documents.filter((document) => !document.deletion_token);
  const candidatePlans = activeDocuments.filter((document) =>
    document.upload_status === "uploaded" && document.classification_status === "classified" && document.document_kind === "plans"
  );
  const hasIntakePlan = candidatePlans.length > 0 && await hasStoredIntakePlan({
    supabase: input.supabase as never, serverClient: () => createServiceRoleClient() as never,
    projectId: input.project.id, documents: candidatePlans,
  });
  const missing = buildAffaireIntakeMissingPieces(activeDocuments
    .filter((document) => hasIntakePlan || !candidatePlans.includes(document))
    .map((document) => ({
      uploadStatus: document.upload_status,
      classificationStatus: document.classification_status,
      documentKind: document.document_kind,
    })));
  if (!missing.some((piece) => piece.code === "missing_plans")) return missing;
  const hasPlan = await hasStoredStandalonePlan({
    // Project access has already been checked; use the server client so a
    // director with dossier read rights gets the same presence boolean.
    supabase: createServiceRoleClient() as never,
    projectId: input.project.id,
    tenantId: input.project.tenant_id,
    rows: input.standalonePlanRows,
  });
  return hasPlan ? missing.filter((piece) => piece.code !== "missing_plans") : missing;
}
