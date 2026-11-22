import type {
  ImportLaborRoleCandidate,
  ImportLaborRoleResolution,
  ImportWorkbookParameters,
  InvalidImportFlowLineReason,
} from "@/lib/affaires/import-flow";
import type { ImportSaleCoefficients } from "@/lib/affaires/import-engine-server";
import type { ImportUnitPriceCheck } from "@/lib/imports/optima-profile";
import type { TakeoffCarryOverStatus } from "@/lib/takeoff/types";

export type ConfirmUnifiedImportFlowMode = "mapping_only" | "version_created";

export type ImportFlowCreationTotals = {
  totalHtCents: number;
  totalTaxCents: number;
  totalTtcCents: number;
};

export type ConfirmUnifiedImportFlowResult = {
  mode: ConfirmUnifiedImportFlowMode;
  importId: string;
  projectId: string | null;
  mappingId: string | null;
  versionId: string | null;
  redirectTo: string | null;
  takeoffCarryOver: TakeoffCarryOverStatus | null;
  totals: ImportFlowCreationTotals | null;
  stats: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    insertedRows: number;
    skippedRows: number;
    insertedSections: number;
    zeroPriceRows: number;
    ignoredRows: number;
    ignoredFooterRows: number;
  };
};

/**
 * A confirmation refused for a reason the member can act on (lot 4): returned, never thrown, so that its French message
 * and way forward reach the form (a Server Action's thrown message is replaced by a generic one in production).
 * mapping_changed: the import's rows are no longer those the member reviewed; decisions_not_recorded: the mapping is
 * saved, its structure decisions are not, confirming again records them.
 */
export type ConfirmUnifiedImportFlowRefusal = {
  mode: "refused";
  reason: "mapping_changed" | "decisions_not_recorded";
  importId: string;
  message: string;
};

export type ConfirmUnifiedImportFlowOutcome = ConfirmUnifiedImportFlowResult | ConfirmUnifiedImportFlowRefusal;

export type ImportFlowLinesPreview = {
  validLineCount: number;
  ignoredParameterRows: number;
  invalidLines: Array<{ rowIndex: number; reason: InvalidImportFlowLineReason }>;
  invalidLineCount: number;
  hours: {
    linesWithHours: number;
    convertedLines: number;
    totalLineHours: number;
    lines: Array<{
      rowIndex: number;
      title: string;
      quantity: number;
      hoursPerUnit: number | null;
      lineHours: number;
    }>;
  };
  workbookParameters: ImportWorkbookParameters | null;
  versionMarginMultiplier: number;
  laborRoles: ImportLaborRoleCandidate[];
  laborRole: {
    status: ImportLaborRoleResolution["status"];
    roleId: string | null;
    matchingRoleIds: string[];
  };
  unitPriceChecks: {
    checked: number;
    toleranceCents: number;
    outOfTolerance: ImportUnitPriceCheck[];
  };
  // Columns named as a duration per unit but read as the line's total hours (2.3 review, C-01).
  perUnitDurationsAsLineHours: string[];
  // Lot 2, sous-lot 2.8: engine of the estimate the import creates, and the v3 sale coefficients.
  engine: 2 | 3;
  saleCoefficients: ImportSaleCoefficients | null;
};
