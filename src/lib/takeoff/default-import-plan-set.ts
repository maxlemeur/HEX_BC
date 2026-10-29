export const DEFAULT_IMPORT_PLAN_SET_NAME = "Plans import";

export const IMPORT_FLOW_PLAN_SET_METADATA = {
  source: "import-flow",
  default_import_plan_set: true,
} as const;

export const AFFAIRE_INTAKE_PLAN_SET_METADATA = {
  source: "affaire-intake",
  default_import_plan_set: true,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasDefaultImportPlanSetMarker(metadata: unknown) {
  return (
    isRecord(metadata) &&
    metadata.default_import_plan_set === true &&
    typeof metadata.source === "string"
  );
}


/** Select the affair-wide import set, leaving version-scoped historical sets untouched. */
export function selectProjectImportPlanSet<T extends {
  id: string;
  name: string;
  estimate_version_id: string | null;
  metadata: unknown;
  updated_at: string;
  file_count: number;
}>(sets: T[]): T | null {
  const projectSets = sets.filter((set) => set.estimate_version_id === null);
  const marked = projectSets.filter((set) => hasDefaultImportPlanSetMarker(set.metadata));
  if (marked.length > 0) {
    return [...marked].sort((left, right) =>
      Number(right.file_count > 0) - Number(left.file_count > 0) ||
      right.updated_at.localeCompare(left.updated_at) || left.id.localeCompare(right.id)
    )[0];
  }
  const named = projectSets.filter((set) => set.name.trim().toLowerCase() === DEFAULT_IMPORT_PLAN_SET_NAME.toLowerCase());
  return named.length === 1 ? named[0] : null;
}
