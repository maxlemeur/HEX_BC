import type { RefObject } from "react";

import type { ParsedImportRow } from "@/hooks/useFileParser";
import type {
  PriceBookColumnMapping,
  PriceBookLookups,
  PriceBookProfile,
  PriceBookValidationProgress,
  PriceBookValidationResult,
} from "@/lib/catalogue/csv-import";

export type BulkCreatePricesResponse = {
  created_count: number;
  mode: string;
};

export type CreateImportResponse = {
  id: string;
  filename: string;
  project_id?: string | null;
};

export type ResolveSuggestion = {
  type: "supplier" | "product";
  input: string;
  matches: Array<{
    confidence: number;
    id: string;
    value: string;
  }>;
};

export type ResolveImportResponse = {
  suggestions: ResolveSuggestion[];
};

export type CreateMissingResponse = {
  createdSuppliers: Array<{ id: string; name: string }>;
  createdProducts: Array<{ id: string; reference: string; designation: string }>;
};

export type ImportSummary = {
  imported: number;
  ignored: number;
  toFix: number;
  duplicatesSkipped: number;
};

export type PriceBookCsvImportProps = {
  onImported: () => Promise<void> | void;
  onLookupsUpdated?: () => Promise<PriceBookLookups | void> | PriceBookLookups | void;
  lookups: PriceBookLookups;
};

export type PriceBookWorkflowActionState = {
  isBusy: boolean;
  isParsing: boolean;
  isValidating: boolean;
  isSubmitting: boolean;
  isResolving: boolean;
  isCreatingMissing: boolean;
};

export type UsePriceBookCsvWorkflowResult = {
  fileInputRef: RefObject<HTMLInputElement | null>;
  selectedFile: File | null;
  rows: ParsedImportRow[];
  sourceColumns: string[];
  mapping: PriceBookColumnMapping;
  validation: PriceBookValidationResult | null;
  detectedProfile: PriceBookProfile | null;
  detectedEncoding: string | null;
  sourceImportId: string | null;
  importSummary: ImportSummary | null;
  progress: PriceBookValidationProgress | null;
  error: string | null;
  success: string | null;
  hasRows: boolean;
  canValidate: boolean;
  canSubmit: boolean;
  showProgress: boolean;
  canShowSummary: boolean;
  currentStep: number;
  autoMappedCount: number;
  unknownSuppliers: string[];
  unknownProducts: string[];
  actionState: PriceBookWorkflowActionState;
  setSelectedFile: (file: File | null) => void;
  setMapping: (nextMapping: PriceBookColumnMapping) => void;
  analyzeFile: () => Promise<void>;
  refreshPreview: () => Promise<void>;
  resolveAutomatically: () => Promise<void>;
  createMissing: () => Promise<void>;
  submitImport: () => Promise<void>;
  clearSelection: () => void;
  downloadCorrectionsCsv: () => void;
  downloadCsvTemplate: () => void;
};
