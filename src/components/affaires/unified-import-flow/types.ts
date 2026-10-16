import type { ColumnMapping } from "@/components/mappings/ColumnMapper";
import { MAPPING_TARGET_FIELD_OPTIONS } from "@/lib/mappings/schemas";
import type {
  MappingAutoValidation,
  MappingSuggestionConfidence,
  MappingTemplateExactMatch,
} from "@/lib/mappings/server";
import type {
  ImportStructureDecision,
  ImportStructurePreview,
} from "@/lib/imports/structure";

export type Step = "upload" | "mapping" | "preview" | "confirmation" | "plans";

export const STEPPER_STEPS_BASE = ["upload", "mapping", "preview", "confirmation"] as const;
export const STEPPER_STEPS_WITH_PLANS = ["upload", "mapping", "preview", "confirmation", "plans"] as const;

export const STEP_LABELS: Record<Step, string> = {
  upload: "Upload",
  mapping: "Mapping",
  preview: "Aperçu",
  confirmation: "Confirmation",
  plans: "Plans",
};

export const ACCEPTED_FILE_TYPES =
  ".csv,.xlsx,.xls,.pdf,text/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const VALID_EXTENSIONS = new Set(["csv", "xlsx", "xls", "pdf"]);

// One list for every mapping UI, grouped by role (values, checks, parameters, unsupported).
export const TARGET_FIELDS = MAPPING_TARGET_FIELD_OPTIONS;

export const TERMINAL_IMPORT_STATUSES = new Set([
  "parsed",
  "imported",
  "completed",
]);

export type MappingPreviewRow = {
  row_index: number;
  raw_row: Record<string, unknown>;
  mapped_row: Record<string, unknown>;
  missing_required_fields: string[];
};

export type MappingValidation = {
  is_valid: boolean;
  missing_required_fields: string[];
  duplicate_target_assignments: Array<{ target: string; sources: string[] }>;
  mapped_sources_count: number;
  mapped_targets_count: number;
};

export type DuplicatesSummary = {
  total_groups: number;
  total_rows_impacted: number;
};

export type SuggestionsData = {
  suggestions: Record<string, string>;
  source_columns: string[];
  sample_values: Record<string, string[]>;
  confidence_by_source: Record<string, MappingSuggestionConfidence>;
  template_exact_match: MappingTemplateExactMatch | null;
  auto_validation: MappingAutoValidation;
};

export type PreviewData = {
  source_columns: string[];
  validation: MappingValidation;
  rows: MappingPreviewRow[];
  duplicates: DuplicatesSummary;
};

export type MappingStepResult = {
  mapping: ColumnMapping;
  autoAdvanced?: boolean;
  templateExactMatch?: MappingTemplateExactMatch | null;
};

export type StructureDecision = ImportStructureDecision;
export type StructurePreviewData = ImportStructurePreview;

export type PreviewStepResult = {
  rows: MappingPreviewRow[];
  validation: MappingValidation | null;
  duplicates: DuplicatesSummary | null;
  structurePreview: StructurePreviewData;
  structurePlan: { decisions: StructureDecision[] };
  // Labour role of the imported hours (sub-lot 2.3, E17); undefined lets the server resolve it.
  laborRoleId?: string | null;
};

/** Targets whose values the line preview explains: hours, majoration, parameters, controls. */
export function mappingNeedsLinesPreview(mapping: Record<string, string>) {
  return Object.values(mapping).some(
    (target) =>
      target === "labor_hours" ||
      target === "labor_hours_per_unit" ||
      target.startsWith("h_mo_majoration") ||
      target.startsWith("param_") ||
      target === "control_unit_price"
  );
}
