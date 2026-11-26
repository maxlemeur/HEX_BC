export const ASSISTANT_MAX_FILES = 3;
export const ASSISTANT_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const ASSISTANT_FILE_LIMIT_MESSAGE = "Vous pouvez joindre jusqu’à 3 fichiers, pour un total de 8 Mo.";
export const ASSISTANT_FILE_FORMAT_MESSAGE = "Formats acceptés : PDF, PNG, JPEG, WebP, TXT et CSV.";

const FILE_TYPES = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".csv": "text/csv",
} as const;

export const ASSISTANT_FILE_ACCEPT = Object.keys(FILE_TYPES).join(",");

export function assistantFileName(name: string) {
  return name.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim().slice(-180);
}

export function assistantFileType(fileName: string) {
  const extension = fileName.toLowerCase().match(/\.[a-z]+$/)?.[0];
  return extension && Object.hasOwn(FILE_TYPES, extension) ? FILE_TYPES[extension as keyof typeof FILE_TYPES] : null;
}
