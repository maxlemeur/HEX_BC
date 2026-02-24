export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_SIZE_LABEL = "10 Mo";

export type FileValidationOptions = {
  maxFileSizeBytes?: number;
  maxFileSizeLabel?: string;
  allowedExtensions?: string[];
  allowedMimeTypes?: string[];
  allowEmptyMimeType?: boolean;
};

export type FileValidationResult =
  | { valid: true }
  | { valid: false; error: string };

function normalizeExtension(value: string | null) {
  if (!value) return "";
  return value.trim().toLowerCase().replace(/^\.+/, "");
}

function getFileExtension(filename: string) {
  const trimmed = filename.trim();
  if (trimmed.length === 0) return "";

  const lastDotIndex = trimmed.lastIndexOf(".");
  if (lastDotIndex <= 0 || lastDotIndex === trimmed.length - 1) {
    return "";
  }

  return normalizeExtension(trimmed.slice(lastDotIndex + 1));
}

export function validateFileForUpload(
  file: File | null | undefined,
  options: FileValidationOptions = {}
): FileValidationResult {
  const maxFileSizeBytes = options.maxFileSizeBytes ?? MAX_FILE_SIZE_BYTES;
  const maxFileSizeLabel = options.maxFileSizeLabel ?? MAX_FILE_SIZE_LABEL;

  if (!file) {
    return { valid: false, error: "Aucun fichier fourni." };
  }

  if (file.size <= 0) {
    return { valid: false, error: "Le fichier est vide." };
  }

  if (file.size > maxFileSizeBytes) {
    return {
      valid: false,
      error: `Le fichier depasse ${maxFileSizeLabel}.`,
    };
  }

  if (options.allowedExtensions && options.allowedExtensions.length > 0) {
    const extension = getFileExtension(file.name);
    const allowedExtensions = new Set(
      options.allowedExtensions.map((value) => normalizeExtension(value))
    );

    if (!allowedExtensions.has(extension)) {
      return {
        valid: false,
        error: "Extension de fichier non supportee.",
      };
    }
  }

  if (options.allowedMimeTypes && options.allowedMimeTypes.length > 0) {
    const mimeType = file.type.trim().toLowerCase();
    const allowEmptyMimeType = options.allowEmptyMimeType ?? true;

    if (!allowEmptyMimeType && mimeType.length === 0) {
      return {
        valid: false,
        error: "Le type MIME du fichier est requis.",
      };
    }

    if (mimeType.length > 0) {
      const allowedMimeTypes = new Set(
        options.allowedMimeTypes.map((value) => value.trim().toLowerCase())
      );

      if (!allowedMimeTypes.has(mimeType)) {
        return {
          valid: false,
          error: "Type MIME de fichier non supporte.",
        };
      }
    }
  }

  return { valid: true };
}
