import type { ColumnMapping } from "@/components/mappings/ColumnMapper";
import type {
  MappingAutoValidation,
  MappingSuggestionConfidence,
  MappingTemplateExactMatch,
} from "@/lib/mappings/server";

export type Step = "upload" | "mapping" | "preview" | "confirmation" | "plans";

export const STEPPER_STEPS_BASE = ["upload", "mapping", "preview", "confirmation"] as const;
export const STEPPER_STEPS_WITH_PLANS = ["upload", "mapping", "preview", "confirmation", "plans"] as const;

export const STEP_LABELS: Record<Step, string> = {
  upload: "Upload",
  mapping: "Mapping",
  preview: "Apercu",
  confirmation: "Confirmation",
  plans: "Plans",
};

export const ACCEPTED_FILE_TYPES =
  ".csv,.xlsx,.xls,.pdf,text/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const VALID_EXTENSIONS = new Set(["csv", "xlsx", "xls", "pdf"]);

export const TARGET_FIELDS = [
  { value: "hex_code", label: "Référence article", required: true },
  { value: "designation", label: "Désignation", required: true },
  { value: "quantity", label: "Quantité" },
  { value: "unit", label: "Unite" },
  { value: "unit_price_ht", label: "Prix unitaire HT" },
  { value: "total_ht", label: "Montant HT" },
  { value: "category", label: "Categorie" },
  { value: "supply_type", label: "Type FO" },
  { value: "supplier_ref", label: "Reference fournisseur" },
  { value: "labor_hours", label: "Heures MO" },
  { value: "h_mo_majoration", label: "Majoration MO" },
  { value: "notes", label: "Notes" },
] as const;

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

export type PreviewStepResult = {
  rows: MappingPreviewRow[];
  validation: MappingValidation | null;
  duplicates: DuplicatesSummary | null;
};
