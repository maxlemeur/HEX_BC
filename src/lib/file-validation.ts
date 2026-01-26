export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_SIZE_LABEL = "10 Mo";

export type FileValidationResult =
  | { valid: true }
  | { valid: false; error: string };

export function validateFileForUpload(
  file: File | null | undefined
): FileValidationResult {
  if (!file) {
    return { valid: false, error: "Aucun fichier fourni." };
  }

  if (file.size <= 0) {
    return { valid: false, error: "Le fichier est vide." };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `Le fichier depasse ${MAX_FILE_SIZE_LABEL}.`,
    };
  }

  return { valid: true };
}
