import "server-only";

import { AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS, type AffaireIntakeDocumentKind } from "@/lib/affaires/intake";
import { readAffaireDocumentPreview } from "@/lib/affaires/intake-document-preview";
import { readAffaireBriefDraft, requireAffaireProjectReadAccess } from "@/lib/affaires/intake-server";
import { fetchAffaireRegisterPage } from "@/lib/affaires/register-server";
import { documentReadType, UNREADABLE_FORMAT } from "@/lib/assistant/document-reading";
import { AssistantToolError, withUserFacingRefusals } from "@/lib/assistant/loop";

const NO_ACCESS = "Vous n’avez pas accès aux pièces de cette affaire.";
const NOT_IN_AFFAIRE = "Cette pièce n’appartient pas à l’affaire de cette conversation, ou n’est plus disponible. Liste les pièces pour en choisir une.";
const KIND_ORDER: AffaireIntakeDocumentKind[] = ["cctp", "dpgf", "bpu_dqe", "plans", "annexes", "emails", "a_classer"];
const REGISTER_ENTRIES = 25;
const REGISTER_TEXT = 500;

function isClientError(error: unknown) {
  const status = (error as { status?: unknown } | null)?.status;
  return error instanceof Error && typeof status === "number" && status >= 400 && status < 500;
}

/** The member may still read the affaire (owner, admin or director): checked again by every read, with their own rights. */
async function affaireAccess(projectId: string) {
  try {
    return await requireAffaireProjectReadAccess(projectId);
  } catch (error) {
    if (isClientError(error)) throw new AssistantToolError(NO_ACCESS);
    throw error;
  }
}

const kindLabel = (kind: string) => AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS[kind as AffaireIntakeDocumentKind] ?? "À classer";

/** The affaire's documents that can be opened, as its document classification sorted them, principal ones first. */
export async function listAffaireDocuments(projectId: string) {
  const { context, project } = await affaireAccess(projectId);
  const { data, error } = await context.supabase.from("affaire_intake_documents")
    .select("id, file_name, mime_type, size_bytes, document_kind, document_priority, storage_path, drive_file_id")
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("upload_status", "uploaded")
    .is("deleted_at", null).is("deletion_token", null)
    // « primary » sorts before « secondary »: a large dossier keeps its principal pieces within the limit.
    .order("document_priority", { ascending: true }).order("created_at", { ascending: true }).limit(200);
  if (error) throw new AssistantToolError("Les pièces de cette affaire n’ont pas pu être lues.");
  const rank = (kind: string) => { const index = KIND_ORDER.indexOf(kind as AffaireIntakeDocumentKind); return index === -1 ? KIND_ORDER.length : index; };
  // A piece with neither a stored copy nor a Drive link cannot be opened: it is not offered.
  const rows = data.filter((row) => row.storage_path || row.drive_file_id).sort((left, right) =>
    Number(right.document_priority === "primary") - Number(left.document_priority === "primary")
    || rank(left.document_kind) - rank(right.document_kind) || left.file_name.localeCompare(right.file_name, "fr"));
  return {
    pieces: rows.map((row) => ({
      id: row.id, nom: row.file_name, type: kindLabel(row.document_kind), principale: row.document_priority === "primary",
      // Known once the document is read: nothing is extracted ahead of a question.
      pages: null, lisible: documentReadType(row.file_name, row.mime_type) !== null, taille_ko: Math.round(row.size_bytes / 1024),
    })),
  };
}

/**
 * One document of the conversation's affaire, with the member's rights. The
 * identifier the model gives is looked up within that affaire first: a document
 * of another affaire, even one the member may open, is refused before any byte
 * is read. The bytes come through the dossier's own preview read.
 */
export async function loadAffaireDocument(input: {
  projectId: string; documentId: string; signal?: AbortSignal;
  /** The bytes already downloaded by this answer, by document: access and the lookup are checked again all the same. */
  cache?: Map<string, Promise<Uint8Array>>;
}) {
  const { context, project } = await affaireAccess(input.projectId);
  const lookup = await context.supabase.from("affaire_intake_documents")
    .select("id, file_name, mime_type, document_kind")
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", input.documentId)
    .eq("upload_status", "uploaded").is("deleted_at", null).is("deletion_token", null)
    .maybeSingle();
  if (lookup.error) throw new AssistantToolError("La pièce n’a pas pu être lue.");
  const row = lookup.data;
  if (!row) throw new AssistantToolError(NOT_IN_AFFAIRE);
  // A format the assistant does not read is refused before its bytes are fetched (up to 50 MB, maybe from Drive).
  const mimeType = documentReadType(row.file_name, row.mime_type);
  if (mimeType === null) throw new AssistantToolError(UNREADABLE_FORMAT);
  const cache = input.cache;
  let download = cache?.get(row.id);
  if (!download) {
    const fetched = withUserFacingRefusals(() => readAffaireDocumentPreview(project.id, row.id, true, input.signal)).then((read) => read.bytes);
    download = fetched;
    if (cache) {
      cache.set(row.id, fetched);
      // A failed download is not kept: the next read tries again.
      fetched.catch(() => { if (cache.get(row.id) === fetched) cache.delete(row.id); });
    }
  }
  return { documentId: row.id, fileName: row.file_name, type: kindLabel(row.document_kind), mimeType, bytes: await download };
}

/** The affaire's brief and the latest entries of its register (questions, hypotheses, missing pieces), in short. */
export async function readAffaireBriefAndRegister(projectId: string) {
  const { project } = await affaireAccess(projectId);
  const [brief, register] = await withUserFacingRefusals(() => Promise.all([
    readAffaireBriefDraft(project.id),
    fetchAffaireRegisterPage({ projectId: project.id, size: REGISTER_ENTRIES }),
  ]));
  return {
    brief: brief ? {
      statut: brief.status, resume: brief.summary, objet: brief.projectObject, perimetre: brief.scope, lots: brief.lots,
      pieces_recues: brief.receivedPieces, hypotheses: brief.assumptions, points_de_vigilance: brief.vigilancePoints,
      elements_manquants: brief.missingElements, confirme_le: brief.confirmedAt,
    } : null,
    registre: {
      entrees: register.items.map((entry) => ({
        id: entry.id, type: entry.kind, code: entry.code, texte: entry.text.slice(0, REGISTER_TEXT), gravite: entry.severity,
        statut: entry.status, portee: entry.scopeLabel, piece_source: entry.sourceFileName, piece_source_id: entry.sourceDocumentId,
      })),
      autres_entrees: register.nextCursor !== null,
    },
  };
}
