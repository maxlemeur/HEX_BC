"use client";

import dynamic from "next/dynamic";
import { memo, useMemo } from "react";

import { BulkSuggestDialog } from "@/components/estimates/BulkSuggestDialog";
import { EstimateEditorSkeleton } from "@/components/estimates/EstimateEditorSkeleton";
import { GeneratedOuvrageDialog } from "@/components/estimates/GeneratedOuvrageDialog";
import { EstimateStructureDraftDialog } from "@/components/estimates/EstimateStructureDraftDialog";
import { EstimateEditorTable } from "@/components/estimates/EstimateEditorTable";
import { ImportFromEstimateDialog } from "@/components/estimates/ImportFromEstimateDialog";
import { EstimateSendGatingDialog } from "@/components/estimates/EstimateSendGatingDialog";
import {
  EstimateSettingsSummaryBar,
  type SettingsSection,
} from "@/components/estimates/EstimateSettingsSummaryBar";
import { SupplierPreselectionDialog } from "@/components/estimates/SupplierPreselectionDialog";
import { EstimateEditorAlerts } from "@/components/estimates/editor/EstimateEditorAlerts";
import { EstimateEditorDrawer } from "@/components/estimates/editor/EstimateEditorDrawer";
import { EstimateEditorToolbar } from "@/components/estimates/editor/EstimateEditorToolbar";
import { useEstimateEditorState } from "@/hooks/useEstimateEditorState";

type EstimateEditorPageProps = {
  versionId: string;
  focusItemId?: string | null;
  autoOpenVersionZero?: boolean;
  autoOpenStructureDraft?: boolean;
  autoOpenSettingsSection?: SettingsSection | null;
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
  autoOpenStructureDraft = false,
  autoOpenSettingsSection = null,
}: EstimateEditorPageProps) {
  const model = useEstimateEditorState({
    versionId,
    focusItemId,
    autoOpenVersionZero,
    autoOpenStructureDraft,
    autoOpenSettingsSection,
  });
  const readyMeta = model.meta.kind === "ready" ? model.meta : null;
  const alertsProps = readyMeta?.alertsProps ?? null;
  const toolbarProps = readyMeta?.toolbarProps ?? null;
  const summaryBarProps = readyMeta?.summaryBarProps ?? null;
  const projectId = readyMeta?.projectId ?? null;
  const editorTableProps = readyMeta?.editorTableProps ?? null;
  const drawerProps = readyMeta?.drawerProps ?? null;
  const alertsRegion = useMemo(
    () =>
      alertsProps ? (
        <div data-testid="estimate-editor-alerts-region">
          <MemoizedEstimateEditorAlerts {...alertsProps} />
        </div>
      ) : null,
    [alertsProps]
  );
  const ribbonHeader = useMemo(
    () =>
      toolbarProps && summaryBarProps ? (
        <EstimateEditorToolbar
          {...toolbarProps}
          projectId={projectId}
          summaryNode={
            <div data-testid="estimate-editor-summary-bar">
              <EstimateSettingsSummaryBar {...summaryBarProps} />
            </div>
          }
        />
      ) : null,
    [projectId, summaryBarProps, toolbarProps]
  );
  const tableRegion = useMemo(
    () =>
      editorTableProps ? (
        <div data-testid="estimate-editor-table-region">
          <MemoizedEstimateEditorTable
            {...editorTableProps}
            ribbonHeaderNode={ribbonHeader}
            ribbonAlertsNode={alertsRegion}
          />
        </div>
      ) : null,
    [alertsRegion, editorTableProps, ribbonHeader]
  );
  const drawerRegion = useMemo(
    () =>
      drawerProps ? (
        <div data-testid="estimate-editor-drawer-region">
          <MemoizedEstimateEditorDrawer {...drawerProps} />
        </div>
      ) : null,
    [drawerProps]
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
