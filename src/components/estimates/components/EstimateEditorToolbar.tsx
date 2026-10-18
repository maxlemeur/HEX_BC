"use client";

import type {
  EstimateQualityFlagCounts,
  EstimateQualityFlagKey,
} from "@/lib/estimate-quality";
import type { EstimateOutlierMethod } from "@/lib/estimates/outlier-detection";
import type { Database } from "@/types/database";
import type { ColumnKey, ColumnPreset } from "@/hooks/useColumnVisibility";
import type { EstimateColumnId } from "@/hooks/useEstimateColumnWidths";
import { EstimateEditorCommandBar } from "@/components/estimates/components/EstimateEditorCommandBar";
import type { UiMode } from "@/lib/ui-mode";

type EstimateCategory = Database["public"]["Tables"]["estimate_categories"]["Row"];
type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];

export type EstimateQualityFilter =
  | "all_lines"
  | "with_anomalies"
  | EstimateQualityFlagKey;

type BulkMoveDestination = {
  id: string | null;
  label: string;
};

export type EstimateEditorToolbarProps = {
  uiMode: UiMode;
  isViewerMode?: boolean;
  qualityCounts: EstimateQualityFlagCounts;
  qualityFilter: EstimateQualityFilter;
  outlierDetectionMethod: EstimateOutlierMethod;
  outlierThreshold: number;
  isUndoRedoBusy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  bulkMoveDestinations: BulkMoveDestination[];
  categories: EstimateCategory[];
  laborRoles: LaborRole[];
  bulkSuggestionEligibleCount: number;
  supplierPreselectionEligibleCount: number;
  onQualityFilterChange: (value: EstimateQualityFilter) => void;
  onOutlierDetectionMethodChange: (value: EstimateOutlierMethod) => void;
  onOutlierThresholdChange: (value: number) => void;
  onUndo: () => Promise<void>;
  onRedo: () => Promise<void>;
  onApplyBulkMajoration: () => Promise<void>;
  onBulkDeleteSelection: () => Promise<void>;
  onApplyBulkMove: () => Promise<void>;
  onApplyBulkCategory: () => Promise<void>;
  onApplyBulkLaborRole: () => Promise<void>;
  onOpenBulkSuggestDialog: () => void;
  onOpenSupplierPreselectionDialog: () => void;
  onOpenAssemblyPicker: () => void;
  onOpenImportFromEstimateDialog?: () => void;
  onOpenEstimateStructureDraftDialog?: () => void;
  /** Sous-lot 2.10a (N3, D-g) : motif qui désactive la structure IA (moteur 3), sinon `null`. */
  estimateStructureDraftUnavailableReason?: string | null;
  onOpenGeneratedOuvrageDialog?: () => void;
  onExpandAllSections?: () => void;
  onCollapseAllSections?: () => void;
  onOpenSettings?: () => void;
  columnPreset: ColumnPreset;
  columnPresetLabels: Record<ColumnPreset, string>;
  onColumnPresetChange: (preset: ColumnPreset) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  columnVisibleColumns: Set<ColumnKey>;
  allAdvancedColumns: ColumnKey[];
  columnLabels: Record<ColumnKey, string>;
  onToggleColumn: (key: ColumnKey) => void;
  hiddenAdvancedCount: number;
  onToggleAdvancedColumns: () => void;
  columnOrder?: readonly EstimateColumnId[];
  onMoveColumn?: (id: EstimateColumnId, direction: -1 | 1) => void;
  onResetColumns?: () => void;
  isFinalizationPanelOpen?: boolean;
  onToggleFinalizationPanel?: () => void;
  isLaborSplitEnabled?: boolean;
  /* UX2-022: Quick insert pickers */
  isQuickTemplatePickerOpen?: boolean;
  onToggleQuickTemplatePicker?: () => void;
  isQuickAssemblyPickerOpen?: boolean;
  onToggleQuickAssemblyPicker?: () => void;
  quickTemplatePickerNode?: React.ReactNode;
  quickAssemblyPickerNode?: React.ReactNode;
};

export function EstimateEditorToolbar(props: EstimateEditorToolbarProps) {
  return <EstimateEditorCommandBar {...props} />;
}
