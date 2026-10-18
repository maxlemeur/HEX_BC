"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { memo, useCallback, useMemo, useRef, useState } from "react";

import { EstimateEditorSkeleton } from "@/components/estimates/EstimateEditorSkeleton";
import { EstimateEditorTable } from "@/components/estimates/EstimateEditorTable";
import {
  EstimateSettingsSummaryBar,
  type SettingsSection,
} from "@/components/estimates/EstimateSettingsSummaryBar";
import { EstimateEditorAlerts } from "@/components/estimates/editor/EstimateEditorAlerts";
import { EstimateEditorToolbar } from "@/components/estimates/editor/EstimateEditorToolbar";
import { EstimateV3GridProvider } from "@/components/estimates/v3/V3LineCells";
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

// Dialogs and the settings drawer only open on demand: they load after hydration instead of
// weighing on the editor's initial bundle (performance budget in config/performance-budgets.json).
const VersionZeroDraftDialog = dynamic(
  () =>
    import("@/components/estimates/VersionZeroDraftDialog").then((module) => ({
      default: module.VersionZeroDraftDialog,
    })),
  { ssr: false, loading: () => null }
);
const BulkSuggestDialog = dynamic(
  () =>
    import("@/components/estimates/BulkSuggestDialog").then((module) => ({
      default: module.BulkSuggestDialog,
    })),
  { ssr: false, loading: () => null }
);
const GeneratedOuvrageDialog = dynamic(
  () =>
    import("@/components/estimates/GeneratedOuvrageDialog").then((module) => ({
      default: module.GeneratedOuvrageDialog,
    })),
  { ssr: false, loading: () => null }
);
const EstimateStructureDraftDialog = dynamic(
  () =>
    import("@/components/estimates/EstimateStructureDraftDialog").then((module) => ({
      default: module.EstimateStructureDraftDialog,
    })),
  { ssr: false, loading: () => null }
);
const ImportFromEstimateDialog = dynamic(
  () =>
    import("@/components/estimates/ImportFromEstimateDialog").then((module) => ({
      default: module.ImportFromEstimateDialog,
    })),
  { ssr: false, loading: () => null }
);
const EstimateSendGatingDialog = dynamic(
  () =>
    import("@/components/estimates/EstimateSendGatingDialog").then((module) => ({
      default: module.EstimateSendGatingDialog,
    })),
  { ssr: false, loading: () => null }
);
const SupplierPreselectionDialog = dynamic(
  () =>
    import("@/components/estimates/SupplierPreselectionDialog").then((module) => ({
      default: module.SupplierPreselectionDialog,
    })),
  { ssr: false, loading: () => null }
);
const EstimateEditorDrawer = dynamic(
  () =>
    import("@/components/estimates/editor/EstimateEditorDrawer").then((module) => ({
      default: module.EstimateEditorDrawer,
    })),
  { ssr: false, loading: () => null }
);

const MemoizedEstimateEditorAlerts = memo(EstimateEditorAlerts);
const MemoizedEstimateEditorDrawer = memo(EstimateEditorDrawer);
const MemoizedEstimateEditorTable = memo(EstimateEditorTable);

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
  const v3Grid = readyMeta?.v3Grid ?? null;
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
  // Lot 2, sous-lot 2.6 : une v3 fournit à la grille les lignes de son moteur (cellules v3).
  const tableRegion = useMemo(
    () =>
      editorTableProps ? (
        <EstimateV3GridProvider value={v3Grid}>
          <div data-testid="estimate-editor-table-region">
            <MemoizedEstimateEditorTable
              {...editorTableProps}
              ribbonHeaderNode={ribbonHeader}
              ribbonAlertsNode={alertsRegion}
            />
          </div>
        </EstimateV3GridProvider>
      ) : null,
    [alertsRegion, editorTableProps, ribbonHeader, v3Grid]
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
