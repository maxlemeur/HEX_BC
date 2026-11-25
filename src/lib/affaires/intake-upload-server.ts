import { hashIntakeContent, releaseInterruptedAndFindDuplicateIntakeDocument } from "@/lib/affaires/intake-content-identity";
import { AFFAIRE_INTAKE_MAX_BATCH_FILES, AFFAIRE_INTAKE_MAX_BATCH_FILE_BYTES } from "@/lib/affaires/intake-limits";
import { randomUUID } from "node:crypto";
import { badRequest, internalError, mapSupabaseError } from "@/lib/http/api-response";
import { validateFileForUpload } from "@/lib/file-validation";
import {
  AFFAIRE_INTAKE_BUCKET,
  AFFAIRE_INTAKE_MAX_FILE_SIZE_BYTES,
  AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL,
  AFFAIRE_INTAKE_ALLOWED_EXTENSIONS,
  getAffaireIntakeAllowedMimeTypes,
  isAffaireIntakeCadDocument,
  buildAffaireIntakeStoragePath,
  createEmptyAffaireIntakeExtractedMetadata,
  inferAffaireIntakeMimeType,
} from "@/lib/affaires/intake";
import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { isRecord } from "@/lib/value-guards";
import { UPLOAD_SELECT, resolveSupabaseQuery, normalizeUploadRow, insertAffaireIntakeEvent } from "@/lib/affaires/intake-rows";

type UploadCreateResponseFile = {
  documentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: "uploaded" | "rejected";
  rejectionReason: string | null;
};

export type CreateAffaireIntakeUploadResult = {
  uploadId: string;
  files: UploadCreateResponseFile[];
};

function toSafeMimeType(file: File) {
  if (isAffaireIntakeCadDocument(file.name)) return "application/octet-stream";
  return file.type.trim().toLowerCase() || inferAffaireIntakeMimeType(file.name) || "application/octet-stream";
}

/**
 * What goes to the storage for a deposited file: its bytes under the type the
 * dossier records. The storage reads the type of the body, not the option
 * beside it, and the bucket only takes the types it lists.
 */
function toStoredUpload(file: File): { mimeType: string; body: File } {
  const mimeType = toSafeMimeType(file);
  return { mimeType, body: file.type === mimeType ? file : new File([file], file.name, { type: mimeType }) };
}

function collectFilesFromFormData(formData: FormData) {
  const batchEntries = formData.getAll("files");
  const fallback = batchEntries.length === 0 ? formData.get("file") : null;

  return [...batchEntries, ...(fallback ? [fallback] : [])].filter(
    (entry): entry is File => entry instanceof File
  );
}

function validateAffaireIntakeUploadBatch(files: File[]) {
  if (files.length > AFFAIRE_INTAKE_MAX_BATCH_FILES) {
    throw badRequest(
      `Un lot de pièces ne peut pas dépasser ${AFFAIRE_INTAKE_MAX_BATCH_FILES} fichiers.`
    );
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > AFFAIRE_INTAKE_MAX_BATCH_FILE_BYTES) {
    throw badRequest("Le volume cumule du lot intake depasse 100 Mo.");
  }
}

export async function createAffaireIntakeUpload(
  projectId: string,
  formData: FormData
): Promise<CreateAffaireIntakeUploadResult> {
  const { context, project } = await requireAffaireAccess(projectId, "write");
  const files = collectFilesFromFormData(formData);

  if (files.length === 0) {
    throw badRequest("Aucun fichier fourni.");
  }
  validateAffaireIntakeUploadBatch(files);

  const { data: uploadData, error: uploadError } = await context.supabase
    .from("affaire_intake_uploads")
    .insert({
      project_id: project.id,
      created_by: context.userId,
      status: "deposited",
    } as never)
    .select(UPLOAD_SELECT as never)
    .single();

  if (uploadError) {
    throw mapSupabaseError(
      uploadError,
      "Impossible d'initialiser l'upload intake."
    );
  }

  const upload = normalizeUploadRow(uploadData);

  if (!upload) {
    throw internalError("L'upload intake retourne une réponse invalide.");
  }

  await insertAffaireIntakeEvent({
    supabase: context.supabase,
    uploadId: upload.id,
    actorUserId: context.userId,
    eventType: "upload.created",
    afterPayload: {
      status: upload.status,
      file_count: files.length,
    },
  });

  const responses: UploadCreateResponseFile[] = [];

  for (const file of files) {
    const documentId = randomUUID();
    const { mimeType, body: storedBody } = toStoredUpload(file);
    const storagePath = buildAffaireIntakeStoragePath({
      tenantId: project.tenant_id,
      projectId: project.id,
      uploadId: upload.id,
      documentId,
      fileName: file.name,
    });

    const validation = validateFileForUpload(file, {
      maxFileSizeBytes: AFFAIRE_INTAKE_MAX_FILE_SIZE_BYTES,
      maxFileSizeLabel: AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL,
      allowedExtensions: [...AFFAIRE_INTAKE_ALLOWED_EXTENSIONS],
      allowedMimeTypes: [...getAffaireIntakeAllowedMimeTypes(file.name)],
      allowEmptyMimeType: true,
    });

    const contentSha256 = validation.valid ? await hashIntakeContent(file) : null;
    const rejectDuplicate = (duplicate: { documentId: string; message: string }) => {
      responses.push({ documentId: duplicate.documentId, fileName: file.name, mimeType, sizeBytes: file.size,
        status: "rejected", rejectionReason: duplicate.message });
    };
    if (contentSha256) {
      const duplicate = await releaseInterruptedAndFindDuplicateIntakeDocument({ context, project }, contentSha256, file.size);
      if (duplicate) {
        rejectDuplicate(duplicate);
        continue;
      }
    }

    const { error: insertError } = await resolveSupabaseQuery<{
      error: unknown;
    }>(
      context.supabase
        .from("affaire_intake_documents")
        .insert({
          id: documentId,
          upload_id: upload.id,
          created_by: context.userId,
          storage_path: validation.valid ? storagePath : null,
          file_name: file.name,
          mime_type: mimeType,
          size_bytes: file.size,
          content_sha256: contentSha256,
          upload_status: validation.valid ? "pending" : "rejected",
          rejection_reason: validation.valid ? null : validation.error,
          classification_status: validation.valid ? "awaiting_launch" : "failed",
          document_kind: "a_classer",
          issues: validation.valid ? [] : [validation.error],
          extracted_metadata: createEmptyAffaireIntakeExtractedMetadata(),
        } as never)
    );

    if (insertError) {
      // The partial unique index arbitrates two requests that both passed the lookup.
      if (contentSha256 && isRecord(insertError) && insertError.code === "23505") {
        const duplicate = await releaseInterruptedAndFindDuplicateIntakeDocument({ context, project }, contentSha256, file.size);
        if (duplicate) {
          rejectDuplicate(duplicate);
          continue;
        }
      }
      throw internalError(
        "Impossible d'enregistrer le document intake.",
        insertError
      );
    }

    if (!validation.valid) {
      await insertAffaireIntakeEvent({
        supabase: context.supabase,
        uploadId: upload.id,
        documentId,
        actorUserId: context.userId,
        eventType: "document.rejected",
        reason: validation.error,
      });

      responses.push({
        documentId,
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
        status: "rejected",
        rejectionReason: validation.error,
      });
      continue;
    }

    const { error: storageError } = await context.supabase.storage
      .from(AFFAIRE_INTAKE_BUCKET)
      .upload(storagePath, storedBody, {
        contentType: mimeType,
        upsert: false,
      });

    if (storageError) {
      const { error: rejectError } = await resolveSupabaseQuery<{
        error: unknown;
      }>(
        context.supabase
          .from("affaire_intake_documents")
          .update({
            upload_status: "rejected",
            rejection_reason: "Impossible de téléverser le fichier dans le storage.",
            classification_status: "failed",
            issues: ["Impossible de téléverser le fichier dans le storage."],
          } as never)
          .eq("id", documentId)
      );

      if (rejectError) {
        console.error("Failed to mark intake document as rejected after storage failure", {
          documentId,
          error: rejectError,
        });
      }

      await insertAffaireIntakeEvent({
        supabase: context.supabase,
        uploadId: upload.id,
        documentId,
        actorUserId: context.userId,
        eventType: "document.rejected",
        reason: "Impossible de téléverser le fichier dans le storage.",
      });

      responses.push({
        documentId,
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
        status: "rejected",
        rejectionReason: "Impossible de téléverser le fichier dans le storage.",
      });
      continue;
    }

    const { error: uploadedError } = await resolveSupabaseQuery<{
      error: unknown;
    }>(
      context.supabase
        .from("affaire_intake_documents")
        .update({
          upload_status: "uploaded",
        } as never)
        .eq("id", documentId)
        .eq("upload_status", "pending")
        .select("id")
        .single()
    );

    if (uploadedError) {
      throw internalError(
        "Impossible de finaliser le document intake televerse.",
        uploadedError
      );
    }

    await insertAffaireIntakeEvent({
      supabase: context.supabase,
      uploadId: upload.id,
      documentId,
      actorUserId: context.userId,
      eventType: "document.uploaded",
      afterPayload: {
        file_name: file.name,
        mime_type: mimeType,
        size_bytes: file.size,
      },
    });

    responses.push({
      documentId,
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
      status: "uploaded",
      rejectionReason: null,
    });
  }

  return {
    uploadId: upload.id,
    files: responses,
  };
}

export const __securityTesting__ = {
  validateAffaireIntakeUploadBatch,
  toStoredUpload,
};
