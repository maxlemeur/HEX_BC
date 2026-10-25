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
