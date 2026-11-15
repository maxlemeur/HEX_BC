// The name a user gave a plan file is a provenance label, never a Storage key.
// plan_files.file_name stays the sanitized Storage basename (the bucket policies
// require file_name to equal it), so "Plan R+1.pdf" and "Plan R-1.pdf" share the
// stored name "Plan-R-1.pdf". The original name is kept in metadata, derived on
// the server from the name received at registration.
export const PLAN_FILE_ORIGINAL_NAME_KEY = "original_file_name";

const PLAN_FILE_ORIGINAL_NAME_MAX_LENGTH = 255;

type PlanFileNameSource = {
  file_name: string;
  metadata?: Record<string, unknown> | null;
};

// NFC so that the composed and decomposed forms of an accented name display alike.
export function normalizePlanFileOriginalName(fileName: string): string | null {
  const normalized = fileName.normalize("NFC").trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized.slice(0, PLAN_FILE_ORIGINAL_NAME_MAX_LENGTH);
}

// A caller-supplied value under the same key never survives: the label always
// comes from the received file name.
export function withPlanFileOriginalName(
  metadata: Record<string, unknown>,
  fileName: string
): Record<string, unknown> {
  const next = { ...metadata };
  delete next[PLAN_FILE_ORIGINAL_NAME_KEY];
  const originalName = normalizePlanFileOriginalName(fileName);
  if (originalName) {
    next[PLAN_FILE_ORIGINAL_NAME_KEY] = originalName;
  }

  return next;
}

export function getPlanFileDisplayName(file: PlanFileNameSource): string {
  const originalName = file.metadata?.[PLAN_FILE_ORIGINAL_NAME_KEY];
  if (typeof originalName === "string") {
    const normalized = normalizePlanFileOriginalName(originalName);
    if (normalized) {
      return normalized;
    }
  }

  return file.file_name;
}

function sanitizePlanFileName(filename: string) {
  const normalized = filename
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized.length > 0 ? normalized : "plan";
}

/** Storage basename of a plan file (`plan_files.file_name`): ASCII-safe, ending in `.pdf`. */
export function sanitizePlanPdfFilename(filename: string) {
  const sanitized = sanitizePlanFileName(filename);

  if (sanitized.toLowerCase().endsWith(".pdf")) {
    return sanitized;
  }

  return `${sanitized}.pdf`;
}

/** Key of a plan file in the plan-files bucket: `tenant/set/file/name`. */
export function buildPlanFileStoragePath(input: {
  tenantId: string;
  setId: string;
  fileId: string;
  fileName: string;
}) {
  return `${input.tenantId}/${input.setId}/${input.fileId}/${input.fileName}`;
}
