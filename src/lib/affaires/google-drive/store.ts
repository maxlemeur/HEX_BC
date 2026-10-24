import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AFFAIRE_INTAKE_BUCKET, buildAffaireIntakeStoragePath, createEmptyAffaireIntakeExtractedMetadata } from "@/lib/affaires/intake";
import { readAllRows } from "@/lib/supabase/read-all";
import type { requireAffaireProjectOwnerOrAdmin } from "@/lib/affaires/intake-server";
import { driveProvenanceSchema, type DriveHistory, type DriveProvenance } from "./contracts";

// Kept free of Next so the owned native campaign loads this exact persistence code.
// server.ts maps it to the API error at the HTTP boundary.
export class DriveStoreError extends Error {
  constructor(readonly status: 409 | 500, message: string) {
    super(message);
    this.name = "DriveStoreError";
  }
}
const conflict = (message: string) => new DriveStoreError(409, message);
const internalError = (message: string) => new DriveStoreError(500, message);

type Access = Awaited<ReturnType<typeof requireAffaireProjectOwnerOrAdmin>>;
const documentSchema = z.object({ id: z.string(), upload_id: z.string(), upload_status: z.string(),
  storage_path: z.string().nullable(), file_name: z.string(), classification_status: z.string() });

// Stable keys are enforced by existing primary keys, including across processes.
function driveStableId(parts: unknown[]) {
  const hex = createHash("sha256").update(JSON.stringify(["google_drive", ...parts])).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function driveCopyId(tenantId: string, projectId: string, fileId: string, revision: string, kind = "document") {
  return driveStableId([tenantId, projectId, fileId, revision, kind]);
}
// A confirmed selection is one intake upload, like a local drop: the same lot replays to the same upload.
export function driveBatchUploadId(tenantId: string, projectId: string, selections: { id: string; version: string }[]) {
  return driveStableId([tenantId, projectId, "batch", selections.map(({ id, version }) => `${id}:${version}`).sort()]);
}

export async function readDriveHistory({ context, project }: Access): Promise<DriveHistory[]> {
  const { data, error } = await readAllRows(() => context.supabase.from("affaire_intake_events" as never)
    .select("id,event_type,document_id,upload_id,after_payload,affaire_intake_documents!inner(upload_status,upload_id)", { count: "exact" })
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).in("event_type", ["upload.created", "document.uploaded"])
    .eq("affaire_intake_documents.upload_status", "uploaded")
    .contains("after_payload", { drive: { provider: "google_drive" } })
    .order("created_at", { ascending: false }).order("id", { ascending: false }));
  if (error) throw internalError("Impossible de lire la provenance des copies Drive.");
  type Row = { id: string; event_type: string; document_id: string; upload_id: string; after_payload: unknown; affaire_intake_documents: unknown };
  const rows = (data ?? []) as Row[];
  const provenance = new Map(rows.filter((row) => row.event_type === "upload.created").map((row) => [row.id, row]));
  // Event metadata is untrusted. Bind it to the actual document, its parent and the immutable
  // provenance event: intake events are append-only, so the first written record is authoritative.
  return rows.flatMap((row) => {
    if (row.event_type !== "document.uploaded") return [];
    const payload = row.after_payload as { drive?: unknown } | null;
    const parsed = driveProvenanceSchema.safeParse(payload?.drive);
    const parent = z.object({ upload_id: z.string() }).safeParse(row.affaire_intake_documents);
    if (!parsed.success || !parent.success || parsed.data.tenantId !== context.tenantId || parsed.data.projectId !== project.id ||
      row.document_id !== driveCopyId(context.tenantId, project.id, parsed.data.fileId, parsed.data.revision) ||
      row.upload_id !== parent.data.upload_id) return [];
    const created = provenance.get(driveCopyId(context.tenantId, project.id, parsed.data.fileId, parsed.data.revision, "provenance"));
    if (created?.document_id !== row.document_id || created.upload_id !== parent.data.upload_id) return [];
    return [{ documentId: row.document_id, uploadId: parent.data.upload_id,
      source: { ...parsed.data, sourceUrl: `https://drive.google.com/file/d/${parsed.data.fileId}/view` } }];
  });
}

// Armed once per lot by the caller, after its last copy. A lot already classified ("ready")
// is rearmed too, so a piece retried later into it is classified with the whole lot.
export async function requeueDriveUpload(access: Access, uploadId: string) {
  const result = await access.context.supabase.from("affaire_intake_uploads" as never)
    .update({ status: "queued", attempt_count: 0, next_retry_at: null, completed_at: null, last_error: null,
      processing_lease_token: null, processing_lease_expires_at: null } as never)
    .eq("tenant_id", access.context.tenantId).eq("project_id", access.project.id).eq("id", uploadId)
    .in("status", ["failed", "partial_failure", "ready"]);
  if (result.error) throw internalError("Copie conservée, reprise du classement interrompue. Reprenez cette pièce.");
}
// Verifies an imported copy and reports whether its classification must resume.
export async function resumeDriveCopy(access: Access, history: DriveHistory) {
  const result = await access.context.supabase.from("affaire_intake_documents" as never)
    .select("id,upload_id,upload_status,storage_path,file_name,classification_status")
    .eq("tenant_id", access.context.tenantId).eq("project_id", access.project.id).eq("id", history.documentId).single();
  const document = documentSchema.safeParse(result.data);
  if (result.error || !document.success || document.data.upload_id !== history.uploadId || document.data.upload_status !== "uploaded") {
    throw conflict("La copie a changé. Actualisez le dossier.");
  }
  return document.data.classification_status === "queued";
}

export async function persistDriveCopy(access: Access, file: File, source: DriveProvenance, batchUploadId: string) {
  const { context, project } = access;
  const id = driveCopyId(context.tenantId, project.id, source.fileId, source.revision);
  const eventId = driveCopyId(context.tenantId, project.id, source.fileId, source.revision, "provenance");
  const lookup = async () => {
    const result = await context.supabase.from("affaire_intake_documents" as never)
      .select("id,upload_id,upload_status,storage_path,file_name,classification_status")
      .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", id).maybeSingle();
    if (result.error) throw internalError("Impossible de vérifier la copie Drive.");
    return result.data ? documentSchema.parse(result.data) : null;
  };
  let existing = await lookup();
  if (!existing) {
    const upload = await context.supabase.from("affaire_intake_uploads" as never).insert({
      id: batchUploadId, project_id: project.id, created_by: context.userId, status: "failed",
      last_error: "Transfert Drive en attente de confirmation.",
    } as never);
    if (upload.error && upload.error.code !== "23505") throw internalError("Impossible de préparer la copie Drive.");
    const storagePath = buildAffaireIntakeStoragePath({ tenantId: context.tenantId, projectId: project.id,
      uploadId: batchUploadId, documentId: id, fileName: file.name });
    const insert = await context.supabase.from("affaire_intake_documents" as never).insert({
      id, upload_id: batchUploadId, created_by: context.userId, storage_path: storagePath,
      file_name: file.name, mime_type: file.type, size_bytes: file.size, upload_status: "pending",
      classification_status: "queued", document_kind: "a_classer", issues: [],
      extracted_metadata: createEmptyAffaireIntakeExtractedMetadata(),
    } as never);
    if (insert.error && insert.error.code !== "23505") throw internalError("Impossible d'enregistrer la pièce Drive.");
    existing = await lookup();
  }
  if (!existing?.storage_path) throw internalError("Copie Drive incomplète. Reprenez cette pièce.");
  // A resumed piece keeps the upload of the lot that first created it.
  const uploadId = existing.upload_id;
  // Required, immutable provenance is persisted before any content is stored.
  const event = await context.supabase.from("affaire_intake_events" as never).insert({
    id: eventId, upload_id: uploadId, document_id: id, actor_user_id: context.userId,
    event_type: "upload.created", after_payload: { drive: source },
  } as never);
  if (event.error && event.error.code !== "23505") throw internalError("Provenance non enregistrée. Aucune nouvelle copie transférée.");
  if (event.error?.code === "23505") {
    const prior = await context.supabase.from("affaire_intake_events" as never).select("document_id,upload_id,after_payload")
      .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", eventId).single();
    const priorEvent = prior.data as { document_id?: string; upload_id?: string; after_payload?: { drive?: DriveProvenance } } | null;
    if (prior.error || priorEvent?.document_id !== id || priorEvent.upload_id !== uploadId) {
      throw conflict("La provenance Drive de cette révision ne correspond pas à cette copie. Actualisez la sélection.");
    }
    if (priorEvent.after_payload?.drive?.sha256 !== source.sha256) {
      throw conflict("La révision Drive a un contenu différent. Actualisez la sélection.");
    }
  }
  if (existing.upload_status === "uploaded") {
    return { documentId: id, uploadId, status: "already_imported" as const,
      shouldProcess: existing.classification_status === "queued" };
  }
  const storage = context.supabase.storage.from(AFFAIRE_INTAKE_BUCKET);
  const uploaded = await storage.upload(existing.storage_path, file, { contentType: file.type, upsert: false });
  if (uploaded.error) {
    // A competing request or a lost response may already have stored these bytes.
    // Verify the exact private copy; never overwrite a path on recovery.
    const prior = await storage.download(existing.storage_path);
    if (prior.error || !prior.data || prior.data.size > 50 * 1024 * 1024 ||
      createHash("sha256").update(Buffer.from(await prior.data.arrayBuffer())).digest("hex") !== source.sha256) {
      throw internalError("Copie non finalisée. Reprenez cette pièce ; les succès sont conservés.");
    }
  }
  const completedEvent = await context.supabase.from("affaire_intake_events" as never).insert({
    id: driveCopyId(context.tenantId, project.id, source.fileId, source.revision, "completed"),
    upload_id: uploadId, document_id: id, actor_user_id: context.userId, event_type: "document.uploaded",
    after_payload: { drive: { ...source, importedAt: new Date().toISOString() } },
  } as never);
  if (completedEvent.error && completedEvent.error.code !== "23505") {
    throw internalError("Copie stockée, provenance finale interrompue. Reprenez cette pièce.");
  }
  const final = await context.supabase.from("affaire_intake_documents" as never)
    .update({ upload_status: "uploaded" } as never).eq("tenant_id", context.tenantId)
    .eq("project_id", project.id).eq("id", id);
  if (final.error) throw internalError("Copie stockée, confirmation interrompue. Reprenez cette pièce.");
  return { documentId: id, uploadId, status: "imported" as const, shouldProcess: true };
}
