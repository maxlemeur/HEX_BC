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
