"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { memo, useCallback, useMemo, useRef, useState } from "react";

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
import { EmptyState } from "@/components/layout/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { useUserContext } from "@/components/UserContext";
import { useEstimateEditorActivityController } from "@/hooks/useEstimateEditorActivityController";
import { useEstimateEditorHistoryController } from "@/hooks/useEstimateEditorHistoryController";
import { useEstimateEditorState } from "@/hooks/useEstimateEditorState";
import { CircleXIcon, FileSearchIcon } from "lucide-react";

const backToAffairesLink = (
  <Link
    href="/dashboard/affaires"
    className={buttonVariants({ variant: "outline", size: "lg" })}
  >
    Retour aux affaires
  </Link>
);

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
  const { profile } = useUserContext();
  const [historyError, setHistoryError] = useState<{
    message: string;
    key: number;
  } | null>(null);
  const historyErrorSequenceRef = useRef(0);
  const reportHistoryError = useCallback((message: string | null) => {
    if (message === null) {
      setHistoryError(null);
      return;
    }
    historyErrorSequenceRef.current += 1;
    setHistoryError({ message, key: historyErrorSequenceRef.current });
  }, []);
  const historyController = useEstimateEditorHistoryController({
    scopeKey: versionId,
    reportError: reportHistoryError,
  });
  const activityController = useEstimateEditorActivityController({
    routeVersionId: versionId,
    isAdmin: profile?.role === "admin",
  });
  const model = useEstimateEditorState({
    versionId,
    focusItemId,
    autoOpenVersionZero,
    autoOpenStructureDraft,
    autoOpenSettingsSection,
    historyController,
    activityController,
    externalActionError: historyError,
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
        <EmptyState
          headingLevel={1}
          icon={<FileSearchIcon />}
          title="Version introuvable"
          description="Ce lien ne correspond à aucune version de chiffrage. Ouvrez le chiffrage depuis son affaire."
          action={backToAffairesLink}
        />
      </div>
    );
  }

  if (model.meta.kind === "loading") {
    return <EstimateEditorSkeleton />;
  }

  if (model.meta.kind === "error") {
    return (
      <div className="animate-fade-in">
        <EmptyState
          headingLevel={1}
          icon={<CircleXIcon />}
          title="Impossible d’ouvrir le chiffrage"
          description={<span role="alert">{model.meta.message}</span>}
          action={
            <>
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={() => window.location.reload()}
              >
                Recharger la page
              </Button>
              {backToAffairesLink}
            </>
          }
        />
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
