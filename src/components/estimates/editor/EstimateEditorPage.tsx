"use client";

import { memo, useMemo } from "react";

import { BulkSuggestDialog } from "@/components/estimates/BulkSuggestDialog";
import { EstimateEditorSkeleton } from "@/components/estimates/EstimateEditorSkeleton";
import { EstimateEditorTable } from "@/components/estimates/EstimateEditorTable";
import { ImportFromEstimateDialog } from "@/components/estimates/ImportFromEstimateDialog";
import { EstimateSendGatingDialog } from "@/components/estimates/EstimateSendGatingDialog";
import { EstimateSettingsSummaryBar } from "@/components/estimates/EstimateSettingsSummaryBar";
import { EstimateEditorAlerts } from "@/components/estimates/editor/EstimateEditorAlerts";
import { EstimateEditorDrawer } from "@/components/estimates/editor/EstimateEditorDrawer";
import { EstimateEditorToolbar } from "@/components/estimates/editor/EstimateEditorToolbar";
import { useEstimateEditorState } from "@/hooks/useEstimateEditorState";

type EstimateEditorPageProps = {
  versionId: string;
};

const MemoizedEstimateEditorAlerts = memo(EstimateEditorAlerts);
const MemoizedEstimateEditorDrawer = memo(EstimateEditorDrawer);
const MemoizedEstimateEditorTable = memo(EstimateEditorTable);

export function EstimateEditorPage({ versionId }: EstimateEditorPageProps) {
  const model = useEstimateEditorState({ versionId });
  const readyMeta = model.meta.kind === "ready" ? model.meta : null;
  const alertsRegion = useMemo(
    () => (readyMeta ? <MemoizedEstimateEditorAlerts {...readyMeta.alertsProps} /> : null),
    [readyMeta]
  );
  const tableRegion = useMemo(
    () =>
      readyMeta ? (
        <div className="mt-6">
          <MemoizedEstimateEditorTable {...readyMeta.editorTableProps} />
        </div>
      ) : null,
    [readyMeta]
  );
  const drawerRegion = useMemo(
    () => (readyMeta ? <MemoizedEstimateEditorDrawer {...readyMeta.drawerProps} /> : null),
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
    <div className="animate-fade-in">
      <EstimateEditorToolbar {...readyMeta.toolbarProps} />
      {alertsRegion}
      <EstimateSettingsSummaryBar {...readyMeta.summaryBarProps} />
      {tableRegion}
      {drawerRegion}
      <BulkSuggestDialog {...readyMeta.bulkSuggestDialogProps} />
      {readyMeta.importFromEstimateDialogProps ? (
        <ImportFromEstimateDialog {...readyMeta.importFromEstimateDialogProps} />
      ) : null}
      <EstimateSendGatingDialog {...readyMeta.sendGatingDialogProps} />
    </div>
  );
}
