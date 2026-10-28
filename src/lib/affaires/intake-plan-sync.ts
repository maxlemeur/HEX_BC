import { readAllRows } from "@/lib/supabase/read-all";
import { conflict } from "@/lib/estimates/errors";
import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AFFAIRE_INTAKE_BUCKET,
  getAffaireIntakeFileExtension,
} from "@/lib/affaires/intake";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { stableImportPlanSetId, stableIntakePlanFileId } from "@/lib/takeoff/default-import-plan-set-id";
import {
  AFFAIRE_INTAKE_PLAN_SET_METADATA,
  DEFAULT_IMPORT_PLAN_SET_NAME,
  selectProjectImportPlanSet,
} from "@/lib/takeoff/default-import-plan-set";
import {
  PLAN_FILE_ORIGINAL_NAME_KEY,
  normalizePlanFileOriginalName,
} from "@/lib/takeoff/plan-file-display-name";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;

type SyncProject = {
  id: string;
  tenant_id: string;
};

type SyncDocument = {
  id: string;
  upload_id: string;
  created_by: string | null;
  storage_path: string | null;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  upload_status: string;
  classification_status: string;
  document_kind: string;
  classified_at?: string | null;
  plan_copy_generation?: string | null;
};

type PlanSetRow = {
  id: string;
  estimate_version_id: string | null;
  name: string;
  metadata: Record<string, unknown>;
  updated_at: string;
  file_count: number;
};

type PlanFileRow = {
  id: string;
  file_path: string;
  metadata: Record<string, unknown>;
};

type IntakePlanFileMetadata = {
  source: "affaire-intake";
  intake_document_id: string;
  intake_upload_id: string;
  intake_storage_path: string;
  intake_classified_at: string | null;
  intake_generation: string | null;
  [PLAN_FILE_ORIGINAL_NAME_KEY]?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeFilename(filename: string) {
  const normalized = filename
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized.length > 0 ? normalized : "plan";
}

function sanitizePdfFilename(filename: string) {
  const sanitized = sanitizeFilename(filename);

  if (sanitized.toLowerCase().endsWith(".pdf")) {
    return sanitized;
  }

  return `${sanitized}.pdf`;
}

function buildPlanFileStoragePath(input: {
  tenantId: string;
  setId: string;
  fileId: string;
  fileName: string;
}) {
  return `${input.tenantId}/${input.setId}/${input.fileId}/${input.fileName}`;
}

function isEligiblePlanDocument(document: SyncDocument) {
  if (
    document.upload_status !== "uploaded" ||
    document.classification_status !== "classified" ||
    document.document_kind !== "plans" ||
    !document.storage_path
  ) {
    return false;
  }

  if (document.mime_type?.toLowerCase() === "application/pdf") {
    return true;
  }

  return getAffaireIntakeFileExtension(document.file_name) === "pdf";
}

function normalizeMetadata(value: unknown) {
  return isRecord(value) ? value : {};
}

function toIntakeDocumentId(planFile: PlanFileRow) {
  const intakeDocumentId = planFile.metadata.intake_document_id;
  return typeof intakeDocumentId === "string" ? intakeDocumentId : null;
}

function isSameIntakePlanGeneration(file: PlanFileRow, document: SyncDocument) {
  if (file.metadata.intake_storage_path !== document.storage_path) return false;
  // Older copies predate the generation marker; keep them until a cleanup has
  // actually been reserved, rather than migrating or deleting user files.
  if ("intake_generation" in file.metadata) return file.metadata.intake_generation === (document.plan_copy_generation ?? null);
  return !("intake_classified_at" in file.metadata) || file.metadata.intake_classified_at === (document.classified_at ?? null);
}

async function findProjectPlanSet(input: {
  supabase: Supabase;
  project: SyncProject;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("plan_sets" as never)
    .select("id, estimate_version_id, name, metadata, updated_at, plan_files(count)" as never, { count: "exact" })
    .eq("project_id" as never, input.project.id as never)
    .order("updated_at" as never, { ascending: false }));

  if (error) {
    throw error;
  }

  const planSets = ((data ?? []) as unknown[])
    .map((row) => {
      if (!isRecord(row) || typeof row.id !== "string" || typeof row.name !== "string") {
        return null;
      }

      return {
        id: row.id,
        estimate_version_id:
          typeof row.estimate_version_id === "string" ? row.estimate_version_id : null,
        name: row.name,
        metadata: normalizeMetadata(row.metadata),
        updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
        file_count: Array.isArray(row.plan_files) && isRecord(row.plan_files[0]) && typeof row.plan_files[0].count === "number"
          ? row.plan_files[0].count : 0,
      } satisfies PlanSetRow;
    })
    .filter((row): row is PlanSetRow => row !== null);

  return selectProjectImportPlanSet(planSets);

}

async function createProjectPlanSet(input: {
  supabase: Supabase;
  project: SyncProject;
  createdBy: string | null;
}) {
  const response = await input.supabase
    .from("plan_sets" as never)
    .insert(
      {
        id: stableImportPlanSetId(input.project.tenant_id, input.project.id, null),
        tenant_id: input.project.tenant_id,
        project_id: input.project.id,
        estimate_version_id: null,
        name: DEFAULT_IMPORT_PLAN_SET_NAME,
        metadata: AFFAIRE_INTAKE_PLAN_SET_METADATA,
        created_by: input.createdBy,
      } as never
    )
    .select("id, estimate_version_id, name, metadata" as never)
    .single();
  const createdData = response.data as unknown;
  const insertError = response.error;

  if (insertError?.code === "23505") {
    const existing = await findProjectPlanSet(input);
    if (existing) return existing;
  }

  if (insertError || !createdData || !isRecord(createdData) || typeof createdData.id !== "string") {
    throw insertError ?? new Error("Unable to create intake plan set.");
  }

  return {
    id: createdData.id,
    estimate_version_id:
      typeof createdData.estimate_version_id === "string"
        ? createdData.estimate_version_id
        : null,
    name: typeof createdData.name === "string" ? createdData.name : DEFAULT_IMPORT_PLAN_SET_NAME,
    metadata: normalizeMetadata(createdData.metadata),
    updated_at: typeof createdData.updated_at === "string" ? createdData.updated_at : "",
    file_count: 0,
  } satisfies PlanSetRow;
}

async function listSyncedPlanFiles(input: {
  supabase: Supabase;
  planSetId: string;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("plan_files" as never)
    .select("id, file_path, metadata" as never, { count: "exact" })
    .eq("plan_set_id" as never, input.planSetId as never));

  if (error) {
    throw error;
  }

  return ((data ?? []) as unknown[])
    .map((row) => {
      if (!isRecord(row) || typeof row.id !== "string" || typeof row.file_path !== "string") {
        return null;
      }

      const metadata = normalizeMetadata(row.metadata);
      if (metadata.source !== "affaire-intake") {
        return null;
      }

      return {
        id: row.id,
        file_path: row.file_path,
        metadata,
      } satisfies PlanFileRow;
    })
    .filter((row): row is PlanFileRow => row !== null);
}

async function deleteSyncedPlanFiles(input: {
  supabase: Supabase;
  files: PlanFileRow[];
}) {
  if (input.files.length === 0) {
    return 0;
  }

  let removed = 0;
  for (const file of input.files) {
    // An older classifier snapshot cannot retire another import's eligible plan.
    // The database reserves cleanup under a lock; metadata remains for Storage RLS.
    const { data: path, error } = await input.supabase.rpc("delete_stale_intake_plan_file" as never,
      { p_file_id: file.id } as never);
    if (error) throw error;
    if (typeof path !== "string") continue;
    const { error: storageError } = await input.supabase.storage.from(PLAN_FILES_BUCKET).remove([path]);
    if (storageError) throw storageError;
    const remaining = await input.supabase.storage.from(PLAN_FILES_BUCKET).download(path);
    const status = Number((remaining.error as { statusCode?: string; status?: number } | null)?.statusCode
      ?? (remaining.error as { status?: number } | null)?.status);
    if (remaining.data || !remaining.error || ![400, 404].includes(status)) throw new Error("Plan cleanup storage removal was not confirmed");
    const { error: deleteError } = await input.supabase.from("plan_files" as never).delete()
      .eq("id", file.id).contains("metadata", { intake_cleanup_pending: true });
    if (deleteError) throw deleteError;
    removed += 1;
  }
  return removed;
}

class IntakePlanCopyRequiresReimport extends Error {}

async function createSyncedPlanFile(input: {
  supabase: Supabase;
  project: SyncProject;
  planSetId: string;
  document: SyncDocument;
  existing?: PlanFileRow;
}) {
  const sourcePath = input.document.storage_path;
  if (!sourcePath) return;
  // Legacy v4 paths are permitted temporarily for the old worker during rollout.
  // The new worker never uploads to them, so it cannot resurrect a removed row.
  if (input.existing && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.existing.id)) {
    throw new IntakePlanCopyRequiresReimport();
  }
  if (input.existing && !isSameIntakePlanGeneration(input.existing, input.document)) {
    throw new Error("The existing plan copy belongs to another intake generation.");
  }
  const { data: sourceBlob, error: downloadError } = await input.supabase.storage
    .from(AFFAIRE_INTAKE_BUCKET).download(sourcePath);
  if (downloadError || !sourceBlob) throw downloadError ?? new Error("Unable to download intake document.");
  if (sourceBlob.size !== input.document.size_bytes || sourceBlob.size === 0) {
    throw new Error("La copie du plan dans le dossier est incomplète.");
  }

  const fileId = input.existing?.id ?? stableIntakePlanFileId(
    input.project.tenant_id, input.planSetId, input.document.id, sourcePath, input.document.plan_copy_generation ?? null
  );
  const fileName = input.existing?.file_path.split("/").at(-1) ?? sanitizePdfFilename(input.document.file_name);
  const filePath = input.existing?.file_path ?? buildPlanFileStoragePath({
    tenantId: input.project.tenant_id, setId: input.planSetId, fileId, fileName,
  });
  const originalFileName = normalizePlanFileOriginalName(input.document.file_name);
  const metadata: IntakePlanFileMetadata = {
    source: "affaire-intake", intake_document_id: input.document.id,
    intake_upload_id: input.document.upload_id, intake_storage_path: sourcePath,
    intake_classified_at: input.document.classified_at ?? null,
    intake_generation: input.document.plan_copy_generation ?? null,
    ...(originalFileName ? { [PLAN_FILE_ORIGINAL_NAME_KEY]: originalFileName } : {}),
  };

  if (!input.existing) {
    // Persist the deterministic reservation before upload: Storage RLS can then
    // authorize the path and a later refresh can recover an interrupted upload.
    const { error: insertError } = await input.supabase.from("plan_files" as never).insert({
      id: fileId, tenant_id: input.project.tenant_id, plan_set_id: input.planSetId,
      file_path: filePath, file_name: fileName, file_type: "application/pdf",
      file_size_bytes: input.document.size_bytes, page_count: null, file_hash: null,
      metadata, created_by: input.document.created_by,
    } as never);
    if (insertError) {
      if (insertError.code !== "23505") throw insertError;
      const { data: existing, error } = await input.supabase.from("plan_files" as never)
        .select("id,file_path,metadata" as never).eq("id", fileId).maybeSingle();
      const row = existing as unknown as PlanFileRow | null;
      if (error || !row || row.file_path !== filePath || row.metadata?.intake_document_id !== input.document.id ||
          row.metadata?.intake_storage_path !== sourcePath || row.metadata?.intake_classified_at !== (input.document.classified_at ?? null) ||
          row.metadata?.intake_generation !== (input.document.plan_copy_generation ?? null) ||
          row.metadata?.source !== "affaire-intake") {
        throw insertError;
      }
    }
  }

  const storage = input.supabase.storage.from(PLAN_FILES_BUCKET);
  const { error: uploadError } = await storage.upload(filePath, sourceBlob, {
    contentType: "application/pdf", upsert: false,
  });
  if (uploadError) {
    // Another producer may have uploaded the same bytes after the reservation.
    const { data: stored, error: readError } = await storage.download(filePath);
    if (readError || !stored) throw uploadError;
    const digest = (buffer: ArrayBuffer) => createHash("sha256").update(Buffer.from(buffer)).digest("hex");
    if (digest(await stored.arrayBuffer()) !== digest(await sourceBlob.arrayBuffer())) {
      throw new IntakePlanCopyRequiresReimport();
    }
  }
}

export async function syncTakeoffPlanSetFromAffaireIntake(input: {
  supabase: Supabase;
  project: SyncProject;
  documents: SyncDocument[];
}) {
  const enabled = await isTakeoffEnabled(input.project.tenant_id, {
    supabase: input.supabase,
  });

  if (!enabled) {
    return {
      syncedDocumentCount: 0,
      removedDocumentCount: 0,
    };
  }

  const eligibleDocuments = input.documents.filter(isEligiblePlanDocument);
  let planSet = await findProjectPlanSet({
    supabase: input.supabase,
    project: input.project,
  });

  if (!planSet && eligibleDocuments.length === 0) {
    return {
      syncedDocumentCount: 0,
      removedDocumentCount: 0,
    };
  }

  if (!planSet) {
    planSet = await createProjectPlanSet({
      supabase: input.supabase,
      project: input.project,
      createdBy: eligibleDocuments[0]?.created_by ?? null,
    });
  }

  const syncedPlanFiles = await listSyncedPlanFiles({
    supabase: input.supabase,
    planSetId: planSet.id,
  });

  const syncedByDocumentId = new Map<string, PlanFileRow>();
  for (const file of syncedPlanFiles) {
    const intakeDocumentId = toIntakeDocumentId(file);
    if (intakeDocumentId && file.metadata.intake_cleanup_pending !== true) {
      syncedByDocumentId.set(intakeDocumentId, file);
    }
  }

  const desiredDocuments = new Map(eligibleDocuments.map((document) => [document.id, document]));
  const staleFiles = syncedPlanFiles.filter((file) => {
    const intakeDocumentId = toIntakeDocumentId(file);
    const document = intakeDocumentId ? desiredDocuments.get(intakeDocumentId) : undefined;
    return intakeDocumentId !== null && (file.metadata.intake_cleanup_pending === true || !document || !isSameIntakePlanGeneration(file, document));
  });
  for (const file of staleFiles) {
    const documentId = toIntakeDocumentId(file);
    if (documentId && syncedByDocumentId.get(documentId)?.id === file.id) syncedByDocumentId.delete(documentId);
  }

  const removedDocumentCount = await deleteSyncedPlanFiles({
    supabase: input.supabase,
    files: staleFiles,
  });

  const failures: Array<{ documentId: string; error: unknown }> = [];
  let syncedDocumentCount = 0;

  for (const document of eligibleDocuments) {
    const existing = syncedByDocumentId.get(document.id);
    try {
      if (existing && isSameIntakePlanGeneration(existing, document)) {
        const { data: object, error } = await input.supabase.storage.from(PLAN_FILES_BUCKET).info(existing.file_path);
        if (!error && object?.size === document.size_bytes && document.size_bytes > 0) continue;
        const status = Number(error?.statusCode ?? error?.status);
        if (error && status !== 400 && status !== 404) throw error;
      }
      await createSyncedPlanFile({
        supabase: input.supabase,
        project: input.project,
        planSetId: planSet.id,
        document,
        existing,
      });
      syncedDocumentCount += 1;
    } catch (error) {
      failures.push({
        documentId: document.id,
        error,
      });
    }
  }

  if (failures.some((failure) => failure.error instanceof IntakePlanCopyRequiresReimport)) {
    throw conflict("Une copie de plan est incomplète. Supprimez sa pièce source du dossier puis importez-la à nouveau.");
  }
  if (failures.length > 0) {
    throw new Error(
      `Intake plan sync failed for ${failures.length} document(s): ${failures
        .map((failure) => failure.documentId)
        .join(", ")}`
    );
  }

  return {
    syncedDocumentCount,
    removedDocumentCount,
  };
}
