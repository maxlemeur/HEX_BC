import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AFFAIRE_INTAKE_BUCKET,
  getAffaireIntakeFileExtension,
} from "@/lib/affaires/intake";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import {
  AFFAIRE_INTAKE_PLAN_SET_METADATA,
  DEFAULT_IMPORT_PLAN_SET_NAME,
  hasDefaultImportPlanSetMarker,
} from "@/lib/takeoff/default-import-plan-set";
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
};

type PlanSetRow = {
  id: string;
  estimate_version_id: string | null;
  name: string;
  metadata: Record<string, unknown>;
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

async function findProjectPlanSet(input: {
  supabase: Supabase;
  project: SyncProject;
}) {
  const { data, error } = await input.supabase
    .from("plan_sets" as never)
    .select("id, estimate_version_id, name, metadata" as never)
    .eq("project_id" as never, input.project.id as never)
    .order("updated_at" as never, { ascending: false });

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
      } satisfies PlanSetRow;
    })
    .filter((row): row is PlanSetRow => row !== null);

  const canonicalPlanSet =
    planSets.find(
      (planSet) =>
        planSet.estimate_version_id === null &&
        hasDefaultImportPlanSetMarker(planSet.metadata)
    ) ??
    (() => {
      const namedMatches = planSets.filter(
        (planSet) =>
          planSet.estimate_version_id === null &&
          planSet.name.trim().toLowerCase() === DEFAULT_IMPORT_PLAN_SET_NAME.toLowerCase()
      );
      return namedMatches.length === 1 ? namedMatches[0] : null;
    })();

  if (canonicalPlanSet) {
    return canonicalPlanSet;
  }

  return null;
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
  } satisfies PlanSetRow;
}

async function listSyncedPlanFiles(input: {
  supabase: Supabase;
  planSetId: string;
}) {
  const { data, error } = await input.supabase
    .from("plan_files" as never)
    .select("id, file_path, metadata" as never)
    .eq("plan_set_id" as never, input.planSetId as never);

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
    return;
  }

  const storagePaths = input.files.map((file) => file.file_path);
  const { error: storageError } = await input.supabase.storage
    .from(PLAN_FILES_BUCKET)
    .remove(storagePaths);

  if (storageError) {
    throw storageError;
  }

  const { error: deleteError } = await input.supabase
    .from("plan_files" as never)
    .delete()
    .in(
      "id" as never,
      input.files.map((file) => file.id) as never
    );

  if (deleteError) {
    throw deleteError;
  }
}

async function createSyncedPlanFile(input: {
  supabase: Supabase;
  project: SyncProject;
  planSetId: string;
  document: SyncDocument;
}) {
  if (!input.document.storage_path) {
    return;
  }

  const { data: sourceBlob, error: downloadError } = await input.supabase.storage
    .from(AFFAIRE_INTAKE_BUCKET)
    .download(input.document.storage_path);

  if (downloadError || !sourceBlob) {
    throw downloadError ?? new Error("Unable to download intake document.");
  }

  const fileId = randomUUID();
  const fileName = sanitizePdfFilename(input.document.file_name);
  const filePath = buildPlanFileStoragePath({
    tenantId: input.project.tenant_id,
    setId: input.planSetId,
    fileId,
    fileName,
  });

  const { error: uploadError } = await input.supabase.storage
    .from(PLAN_FILES_BUCKET)
    .upload(filePath, sourceBlob, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  const metadata: IntakePlanFileMetadata = {
    source: "affaire-intake",
    intake_document_id: input.document.id,
    intake_upload_id: input.document.upload_id,
    intake_storage_path: input.document.storage_path,
  };

  const { error: insertError } = await input.supabase
    .from("plan_files" as never)
    .insert(
      {
        id: fileId,
        tenant_id: input.project.tenant_id,
        plan_set_id: input.planSetId,
        file_path: filePath,
        file_name: fileName,
        file_type: "application/pdf",
        file_size_bytes: input.document.size_bytes,
        page_count: null,
        file_hash: null,
        metadata,
        created_by: input.document.created_by,
      } as never
    );

  if (insertError) {
    await input.supabase.storage.from(PLAN_FILES_BUCKET).remove([filePath]);
    throw insertError;
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
    if (intakeDocumentId) {
      syncedByDocumentId.set(intakeDocumentId, file);
    }
  }

  const desiredDocumentIds = new Set(eligibleDocuments.map((document) => document.id));
  const staleFiles = syncedPlanFiles.filter((file) => {
    const intakeDocumentId = toIntakeDocumentId(file);
    return intakeDocumentId !== null && !desiredDocumentIds.has(intakeDocumentId);
  });

  await deleteSyncedPlanFiles({
    supabase: input.supabase,
    files: staleFiles,
  });

  const failures: Array<{ documentId: string; error: unknown }> = [];
  let syncedDocumentCount = 0;

  for (const document of eligibleDocuments) {
    if (syncedByDocumentId.has(document.id)) {
      continue;
    }

    try {
      await createSyncedPlanFile({
        supabase: input.supabase,
        project: input.project,
        planSetId: planSet.id,
        document,
      });
      syncedDocumentCount += 1;
    } catch (error) {
      failures.push({
        documentId: document.id,
        error,
      });
    }
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
    removedDocumentCount: staleFiles.length,
  };
}
