"use client";

import dynamic from "next/dynamic";
import { memo, useMemo } from "react";

import { AffaireBreadcrumb } from "@/components/AffaireBreadcrumb";
import { BulkSuggestDialog } from "@/components/estimates/BulkSuggestDialog";
import { EstimateEditorSkeleton } from "@/components/estimates/EstimateEditorSkeleton";
import { GeneratedOuvrageDialog } from "@/components/estimates/GeneratedOuvrageDialog";
import { EstimateStructureDraftDialog } from "@/components/estimates/EstimateStructureDraftDialog";
import { EstimateEditorTable } from "@/components/estimates/EstimateEditorTable";
import { ImportFromEstimateDialog } from "@/components/estimates/ImportFromEstimateDialog";
import { EstimateSendGatingDialog } from "@/components/estimates/EstimateSendGatingDialog";
import { EstimateSettingsSummaryBar } from "@/components/estimates/EstimateSettingsSummaryBar";
import { SupplierPreselectionDialog } from "@/components/estimates/SupplierPreselectionDialog";
import { EstimateEditorAlerts } from "@/components/estimates/editor/EstimateEditorAlerts";
import { EstimateEditorDrawer } from "@/components/estimates/editor/EstimateEditorDrawer";
import { EstimateEditorToolbar } from "@/components/estimates/editor/EstimateEditorToolbar";
import { useEstimateEditorState } from "@/hooks/useEstimateEditorState";

type EstimateEditorPageProps = {
  versionId: string;
  focusItemId?: string | null;
  autoOpenVersionZero?: boolean;
};

const MemoizedEstimateEditorAlerts = memo(EstimateEditorAlerts);
const MemoizedEstimateEditorDrawer = memo(EstimateEditorDrawer);
const MemoizedEstimateEditorTable = memo(EstimateEditorTable);
const VersionZeroDraftDialog = dynamic(
  () =>
    import("@/components/estimates/VersionZeroDraftDialog").then((module) => ({
      default: module.VersionZeroDraftDialog,
    })),
  {
    ssr: false,
    loading: () => null,
  }
);

export function EstimateEditorPage({
  versionId,
  focusItemId = null,
  autoOpenVersionZero = false,
}: EstimateEditorPageProps) {
  const model = useEstimateEditorState({
    versionId,
    focusItemId,
    autoOpenVersionZero,
  });
  const readyMeta = model.meta.kind === "ready" ? model.meta : null;
  const alertsRegion = useMemo(
    () =>
      readyMeta ? (
        <div data-testid="estimate-editor-alerts-region">
          <MemoizedEstimateEditorAlerts {...readyMeta.alertsProps} />
        </div>
      ) : null,
    [readyMeta]
  );
  const tableRegion = useMemo(
    () =>
      readyMeta ? (
        <div className="mt-6" data-testid="estimate-editor-table-region">
          <MemoizedEstimateEditorTable {...readyMeta.editorTableProps} />
        </div>
      ) : null,
    [readyMeta]
  );
  const drawerRegion = useMemo(
    () =>
      readyMeta ? (
        <div data-testid="estimate-editor-drawer-region">
          <MemoizedEstimateEditorDrawer {...readyMeta.drawerProps} />
        </div>
      ) : null,
    [readyMeta]
  );

  if (model.meta.kind === "missing-version") {
    return (
      <div className="animate-fade-in">
        <div className="alert alert-error">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          Version introuvable.
        </div>
      </div>
    );
  }

  if (model.meta.kind === "loading") {
    return <EstimateEditorSkeleton />;
  }

  if (model.meta.kind === "error") {
    return (
      <div className="animate-fade-in">
        <div className="alert alert-error mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {model.meta.message}
        </div>
      </div>
    );
  }

  if (!readyMeta) {
    return null;
  }

  return (
    <div className="animate-fade-in" data-testid="estimate-editor-page">
      {readyMeta.projectId && (
        <AffaireBreadcrumb
          projectId={readyMeta.projectId}
          projectName={readyMeta.toolbarProps.projectName}
          versionNumber={readyMeta.toolbarProps.versionNumber}
          pageSuffix="Edition"
        />
      )}
      <EstimateEditorToolbar {...readyMeta.toolbarProps} />
      {alertsRegion}
      <div data-testid="estimate-editor-summary-bar">
        <EstimateSettingsSummaryBar {...readyMeta.summaryBarProps} />
      </div>
      {tableRegion}
      {drawerRegion}
      <div data-testid="estimate-editor-bulk-suggest-dialog-region">
        <BulkSuggestDialog {...readyMeta.bulkSuggestDialogProps} />
      </div>
      <div data-testid="estimate-editor-supplier-preselection-dialog-region">
        <SupplierPreselectionDialog {...readyMeta.supplierPreselectionDialogProps} />
      </div>
      {readyMeta.importFromEstimateDialogProps ? (
        <div data-testid="estimate-editor-import-from-estimate-dialog-region">
          <ImportFromEstimateDialog {...readyMeta.importFromEstimateDialogProps} />
        </div>
      ) : null}
      {readyMeta.estimateStructureDraftDialogProps ? (
        <div data-testid="estimate-editor-structure-draft-dialog-region">
          <EstimateStructureDraftDialog
            {...readyMeta.estimateStructureDraftDialogProps}
          />
        </div>
      ) : null}
      {readyMeta.generatedOuvrageDialogProps ? (
        <div data-testid="estimate-editor-generated-ouvrage-dialog-region">
          <GeneratedOuvrageDialog
            {...readyMeta.generatedOuvrageDialogProps}
          />
        </div>
      ) : null}
      {readyMeta.versionZeroDraftDialogProps ? (
        <div data-testid="estimate-editor-version-zero-dialog-region">
          <VersionZeroDraftDialog {...readyMeta.versionZeroDraftDialogProps} />
        </div>
      ) : null}
      <div data-testid="estimate-editor-send-gating-dialog-region">
        <EstimateSendGatingDialog {...readyMeta.sendGatingDialogProps} />
      </div>
    </div>
  );
}
