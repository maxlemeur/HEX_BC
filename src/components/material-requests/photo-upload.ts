import {
  completeMaterialRequestFiles,
  discardPreparedMaterialRequestFile,
  materialRequestErrorMessage,
  prepareMaterialRequestFiles,
  readRejectedFiles,
} from "@/lib/material-requests/client";
import {
  MATERIAL_REQUESTS_BUCKET,
  type MaterialRequestFile,
  type MaterialRequestFileRejection,
  type MaterialRequestFileUploads,
} from "@/lib/material-requests/contracts";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import { convertHeicToJpeg, isHeicPhoto } from "./heic-to-jpeg";

/**
 * Sending the photos of an original (TI-690). The application never carries the bytes: the server
 * prepares one signed upload per photo, the browser sends each photo to storage itself, and the server
 * then checks what arrived. A photo is listed on the request only after that last answer; anything
 * short of it leaves no photo behind, and the operator is told so.
 * A HEIC photo (iPhone) is converted to JPEG in the browser first: the JPEG is what is announced, sent
 * and kept.
 */

export type PhotoUploadStep =
  | { step: "converting"; index: number; total: number; fileName: string }
  | { step: "preparing"; total: number }
  | { step: "sending"; index: number; total: number; fileName: string }
  | { step: "checking"; total: number };

export type PhotoUploadResult =
  | { ok: true; files: MaterialRequestFile[] }
  | { ok: false; message: string; abandoned?: true };

const NOTHING_KEPT = "Aucune photo n’a été gardée : vous pouvez réessayer.";

/** Where the upload is, in words the operator reads while it runs. */
export function photoUploadStepLabel(progress: PhotoUploadStep): string {
  if (progress.step === "converting") {
    return progress.total > 1
      ? `Conversion en JPEG de la photo ${progress.index} sur ${progress.total} : ${progress.fileName}…`
      : `Conversion en JPEG de la photo ${progress.fileName}…`;
  }
  if (progress.step === "preparing") return "Préparation de l’envoi…";
  if (progress.step === "sending") {
    return `Envoi de la photo ${progress.index} sur ${progress.total} : ${progress.fileName}…`;
  }
  return progress.total > 1 ? "Vérification des photos reçues…" : "Vérification de la photo reçue…";
}

function rejectionMessage(
  rejected: readonly MaterialRequestFileRejection[],
  uploads: MaterialRequestFileUploads["uploads"],
): string {
  const names = new Map(uploads.map((upload) => [upload.file.id, upload.file.file_name]));
  const reasons = rejected.map(({ id, reason }) => {
    const name = `« ${names.get(id) ?? "une photo"} »`;
    if (reason === "size") return `${name} est arrivée incomplète`;
    if (reason === "type") return `${name} n’est pas une image JPEG, PNG ou WebP`;
    return `${name} n’est pas arrivée`;
  });
  const why = reasons.length > 0 ? `L’envoi a été refusé : ${reasons.join(" ; ")}.` : "L’envoi a été refusé.";
  return `${why} ${NOTHING_KEPT}`;
}

export async function uploadMaterialRequestPhotos({
  projectId,
  requestId,
  files: picked,
  onStep,
  signal,
}: {
  projectId: string;
  requestId: string;
  files: readonly File[];
  onStep?: (progress: PhotoUploadStep) => void;
  /**
   * Aborted when the operator leaves the screen: no further photo is started, the one on its way is
   * awaited, and what was prepared is then dropped.
   */
  signal?: AbortSignal;
}): Promise<PhotoUploadResult> {
  const abandoned: PhotoUploadResult = {
    ok: false,
    abandoned: true,
    message: "Envoi interrompu. Aucune photo n’a été gardée.",
  };

  // HEIC photos first, one after the other (a 12-megapixel photo takes a moment and a lot of memory).
  // A photo that cannot be converted stops the batch before anything is prepared: a batch is all or nothing.
  const heicCount = picked.filter(isHeicPhoto).length;
  const files: File[] = [];
  let converted = 0;
  for (const file of picked) {
    if (!isHeicPhoto(file)) {
      files.push(file);
      continue;
    }
    converted += 1;
    onStep?.({ step: "converting", index: converted, total: heicCount, fileName: file.name });
    try {
      files.push(await convertHeicToJpeg(file));
    } catch {
      return {
        ok: false,
        message: `« ${file.name} » n’a pas pu être convertie en JPEG. Aucune photo n’a été gardée : enregistrez-la en JPEG sur le téléphone, puis déposez-la à nouveau.`,
      };
    }
    if (signal?.aborted) return abandoned;
  }

  const total = files.length;
  onStep?.({ step: "preparing", total });

  let uploads: MaterialRequestFileUploads["uploads"];
  try {
    const prepared = await prepareMaterialRequestFiles(projectId, requestId, {
      files: files.map((file) => ({ name: file.name, mime_type: file.type, byte_size: file.size })),
    });
    uploads = prepared.uploads;
  } catch (error) {
    // Refused before anything was sent (HEIC, too many, too large): the server's sentence is shown as is.
    return { ok: false, message: materialRequestErrorMessage(error, "Les photos n’ont pas pu être préparées.") };
  }

  const ids = uploads.map((upload) => upload.file.id);
  const discardAll = () =>
    Promise.all(ids.map((id) => discardPreparedMaterialRequestFile(projectId, requestId, id)));

  let settled = false;
  const left = () => signal?.aborted === true;
  // Leaving the screen: a photo already on its way cannot be called back, and its row must still exist
  // when its bytes land, or they would be stored with nothing pointing at them. So nothing is dropped
  // here; the loop below stops after the photo in flight has settled, then drops every prepared row.
  const dropAfterLeaving = async (): Promise<PhotoUploadResult> => {
    settled = true;
    await discardAll();
    return abandoned;
  };
  // The page itself is going away: there is no "after" to wait for. The rows are dropped at once, best
  // effort (keepalive requests). A photo still in flight may then reach storage without its row: the
  // storage rule on the server, which refuses bytes for a row that no longer exists, covers that case.
  const onPageHide = () => {
    if (settled) return;
    settled = true;
    void discardAll();
  };
  window.addEventListener("pagehide", onPageHide);

  try {
    if (uploads.length !== total) {
      settled = true;
      await discardAll();
      return { ok: false, message: `L’envoi n’a pas pu être préparé pour toutes les photos. ${NOTHING_KEPT}` };
    }

    for (const [index, upload] of uploads.entries()) {
      if (settled) return abandoned;
      if (left()) return await dropAfterLeaving();
      const file = files[index];
      onStep?.({ step: "sending", index: index + 1, total, fileName: file.name });
      // The type the server recorded, not the browser's guess: a photo the browser gives no type to
      // (decided by its extension on the server) would otherwise be refused by the bucket.
      const mimeType = upload.file.mime_type;
      const body = file.type === mimeType ? file : new File([file], file.name, { type: mimeType });
      let failed = false;
      try {
        // The browser client is one shared instance: asking for it per photo creates nothing new.
        const { error } = await createSupabaseBrowserClient()
          .storage.from(MATERIAL_REQUESTS_BUCKET)
          .uploadToSignedUrl(upload.path, upload.token, body, { contentType: mimeType });
        failed = Boolean(error);
      } catch {
        failed = true;
      }
      if (settled) return abandoned;
      if (left()) return await dropAfterLeaving();
      if (failed) {
        settled = true;
        await discardAll();
        return { ok: false, message: `L’envoi de « ${file.name} » a échoué. ${NOTHING_KEPT}` };
      }
    }

    onStep?.({ step: "checking", total });
    try {
      const saved = await completeMaterialRequestFiles(projectId, requestId, { ids });
      if (settled) return abandoned;
      // Checked and listed by the server: these photos are kept, even if the operator has just left.
      settled = true;
      return { ok: true, files: saved };
    } catch (error) {
      if (settled) return abandoned;
      settled = true;
      const rejected = readRejectedFiles(error);
      // A rejection already discarded the batch on the server.
      if (rejected) return { ok: false, message: rejectionMessage(rejected, uploads) };
      await discardAll();
      const reason = materialRequestErrorMessage(error, "Les photos n’ont pas pu être vérifiées.");
      return { ok: false, message: `${reason} ${NOTHING_KEPT}` };
    }
  } finally {
    window.removeEventListener("pagehide", onPageHide);
  }
}
