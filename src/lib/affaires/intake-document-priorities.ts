import { readAllRows } from "@/lib/supabase/read-all";
import { internalError } from "@/lib/http/api-response";
import { isAffaireIntakePrimaryEligibleKind, type AffaireIntakeDocumentPriority } from "@/lib/affaires/intake";
import {
  type AffaireIntakeDocumentRow,
  type AffaireIntakeSupabaseClient,
  DOCUMENT_SELECT,
  resolveSupabaseQuery,
  getAffaireIntakeSelectTable,
  getAffaireIntakeUpdateTable,
  normalizeDocumentRow,
} from "@/lib/affaires/intake-rows";

function pickPrimaryDocumentForKind(
  documents: AffaireIntakeDocumentRow[],
  kind: "dpgf" | "cctp"
) {
  const docsForKind = documents.filter((document) => document.document_kind === kind);

  if (docsForKind.length === 0) {
    return null;
  }

  const existingPrimary =
    docsForKind.find((document) => document.document_priority === "primary") ?? null;

  if (existingPrimary) {
    return existingPrimary;
  }

  return [...docsForKind].sort((left, right) => {
    if (left.created_at !== right.created_at) {
      return left.created_at.localeCompare(right.created_at);
    }

    return left.id.localeCompare(right.id);
  })[0] ?? null;
}

function buildDocumentPriorityMap(documents: AffaireIntakeDocumentRow[]) {
  const nextPriorityById = new Map<string, AffaireIntakeDocumentPriority>();
  const primaryDpgf = pickPrimaryDocumentForKind(documents, "dpgf");
  const primaryCctp = pickPrimaryDocumentForKind(documents, "cctp");

  for (const document of documents) {
    if (!isAffaireIntakePrimaryEligibleKind(document.document_kind)) {
      nextPriorityById.set(document.id, "secondary");
      continue;
    }

    const primaryDocument =
      document.document_kind === "dpgf" ? primaryDpgf : primaryCctp;

    nextPriorityById.set(
      document.id,
      primaryDocument?.id === document.id ? "primary" : "secondary"
    );
  }

  return nextPriorityById;
}

export async function syncAffaireIntakeDocumentPriorities(input: {
  supabase: AffaireIntakeSupabaseClient;
  projectId: string;
}) {
  const { data, error } = await resolveSupabaseQuery<{
    data: unknown[];
    error: unknown;
  }>(
    readAllRows(() => getAffaireIntakeSelectTable(input.supabase, "affaire_intake_documents")
      .select(DOCUMENT_SELECT as never, { count: "exact" })
      .eq("project_id", input.projectId)
      .is("deleted_at", null).is("deletion_token", null)
      .order("created_at", { ascending: true }))
  );

  if (error) {
    throw internalError(
      "Impossible de recalculer les priorités documentaires intake.",
      error
    );
  }

  const documents = (data ?? [])
    .map(normalizeDocumentRow)
    .filter((row): row is AffaireIntakeDocumentRow => row !== null);
  const nextPriorityById = buildDocumentPriorityMap(documents);

  for (const document of documents) {
    const nextPriority =
      nextPriorityById.get(document.id) ?? "secondary";

    if (document.document_priority === nextPriority) {
      continue;
    }

    const { error: updateError } = await resolveSupabaseQuery<{
      error: unknown;
    }>(
      getAffaireIntakeUpdateTable(input.supabase, "affaire_intake_documents")
        .update({
          document_priority: nextPriority,
        } as never)
        .eq("id", document.id)
    );

    if (updateError) {
      throw internalError(
        "Impossible de synchroniser les priorités documentaires intake.",
        updateError
      );
    }
  }
}
