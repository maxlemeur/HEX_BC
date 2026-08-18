"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { ProductionRibbonHeader } from "@/components/dashboard/ProductionRibbon";
import { EstimatePdfDownloadButton } from "@/components/estimates/EstimatePdfDownloadButton";
import { SaveAsTemplateButton } from "@/components/estimates/SaveAsTemplateButton";
import { ExportDropdown } from "@/components/ExportDropdown";
import type { AutoSaveStatus } from "@/hooks/useAutoSave";
import type { EstimateExportMode } from "@/lib/estimates/client";
import type { Database } from "@/types/database";

type EstimateStatus = Database["public"]["Enums"]["estimate_status"];

function estimateStatusLabel(status: EstimateStatus) {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "sent":
      return "Envoyée";
    case "accepted":
      return "Acceptée";
    case "archived":
      return "Archivée";
    default:
      return status;
  }
}

function estimateStatusClass(status: EstimateStatus) {
  switch (status) {
    case "draft":
      return "status-badge status-draft";
    case "sent":
      return "status-badge status-sent";
    case "accepted":
      return "status-badge status-accepted";
    case "archived":
      return "status-badge status-archived";
    default:
      return "status-badge status-draft";
  }
}

function formatLastSavedAt(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  }).format(date);
}

type MoreActionsDropdownProps = {
  showAutoSaveControls: boolean;
  isAutoSaveEnabled: boolean;
  hasPendingChanges: boolean;
  lastSavedAt: string | null;
  isSaveNowDisabled: boolean;
  onAutoSaveEnabledChange: (enabled: boolean) => void;
  onSaveNow: () => void;
  canSend: boolean;
  canAccept: boolean;
  isStatusActionsDisabled: boolean;
  onSend: () => void;
  onAccept: () => void;
  onExportExcel: () => void;
  onExportCSV: () => void;
  onOpenExclusions: () => void;
  onExportDpgf: () => void;
  onExportBdc: () => void;
  onImportDpgfSource: () => void;
  showImportDpgfSource: boolean;
  onOpenVersionZeroDialog?: () => void;
  versionZeroActionLabel: string;
  isVersionZeroActionDisabled: boolean;
  isImportingDpgfSource: boolean;
  isImportDpgfSourceDisabled: boolean;
  isExporting: boolean;
  isExportDisabled: boolean;
  activeExportMode: EstimateExportMode | "csv" | null;
  versionId: string;
  canArchive: boolean;
  onArchive: () => void;
  isArchiveDisabled: boolean;
};

const MORE_ACTIONS_FOCUSABLE =
  "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])";

function MoreActionsDropdown({
  showAutoSaveControls,
  isAutoSaveEnabled,
  hasPendingChanges,
  lastSavedAt,
  isSaveNowDisabled,
  onAutoSaveEnabledChange,
  onSaveNow,
  canSend,
  canAccept,
  isStatusActionsDisabled,
  onSend,
  onAccept,
  onExportExcel,
  onExportCSV,
  onOpenExclusions,
  onExportDpgf,
  onExportBdc,
  onImportDpgfSource,
  showImportDpgfSource,
  onOpenVersionZeroDialog,
  versionZeroActionLabel,
  isVersionZeroActionDisabled,
  isImportingDpgfSource,
  isImportDpgfSourceDisabled,
  isExporting,
  isExportDisabled,
  activeExportMode,
  versionId,
  canArchive,
  onArchive,
  isArchiveDisabled,
}: MoreActionsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = "estimate-page-toolbar-more-actions-menu";

  useEffect(() => {
    if (!isOpen) return;

    const focusFrame = window.requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>(MORE_ACTIONS_FOCUSABLE)
        ?.focus();
    });
    const handlePointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const close = () => setIsOpen(false);
  const menuItemClass =
    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-[var(--slate-700)] transition-colors hover:bg-[var(--slate-50)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--brand-blue)] disabled:cursor-not-allowed disabled:opacity-50";
  const formattedLastSavedAt = formatLastSavedAt(lastSavedAt);

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(MORE_ACTIONS_FOCUSABLE)
    );
    if (focusable.length === 0) return;

    event.preventDefault();
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? focusable.length - 1
          : event.key === "ArrowDown"
            ? (currentIndex + 1 + focusable.length) % focusable.length
            : (currentIndex - 1 + focusable.length) % focusable.length;
    focusable[nextIndex]?.focus();
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      data-testid="estimate-page-toolbar-more-actions"
    >
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={panelId}
        aria-label="Plus d'actions"
        data-testid="estimate-page-toolbar-more-actions-button"
      >
        <span className="hidden sm:inline">Plus d&apos;actions</span>
        <span className="sm:hidden">Actions</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`ml-1 transition-transform ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen ? (
        <div
          ref={panelRef}
          id={panelId}
          role="menu"
          aria-label="Plus d'actions du chiffrage"
          className="estimate-toolbar-actions-panel absolute right-0 top-full z-50 mt-2 max-h-[min(640px,calc(100vh-100px))] w-64 overflow-y-auto rounded-xl border border-[var(--slate-200)] bg-surface p-2 shadow-xl"
          data-testid="estimate-page-toolbar-more-actions-menu"
          onKeyDown={handlePanelKeyDown}
        >
          {showAutoSaveControls ? (
            <div role="none">
              <p className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
                Synchronisation
              </p>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={isAutoSaveEnabled}
                aria-label="Sauvegarde automatique"
                className={menuItemClass}
                onClick={() => onAutoSaveEnabledChange(!isAutoSaveEnabled)}
                data-testid="estimate-page-toolbar-autosave-toggle"
              >
                <span className="min-w-0 flex-1">
                  <span className="block">Sauvegarde automatique</span>
                  <span className="block text-xs font-normal text-[var(--slate-500)]">
                    {isAutoSaveEnabled ? "Activée" : "Désactivée"}
                  </span>
                </span>
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
                    isAutoSaveEnabled
                      ? "bg-[var(--brand-blue)]"
                      : "bg-[var(--slate-300)]"
                  }`}
                  aria-hidden="true"
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                      isAutoSaveEnabled ? "translate-x-[18px]" : "translate-x-0.5"
                    }`}
                  />
                </span>
              </button>
              <p className="px-3 pb-1 text-xs leading-5 text-[var(--slate-500)]">
                {isAutoSaveEnabled
                  ? "Les lignes sont automatiques ; le paramétrage reste manuel."
                  : "Les modifications restent en attente jusqu’à une sauvegarde manuelle."}
              </p>
              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  close();
                  onSaveNow();
                }}
                disabled={isSaveNowDisabled}
                aria-keyshortcuts="Control+S Meta+S"
                data-testid="estimate-page-toolbar-save-now-button"
              >
                <span className="flex-1">Sauvegarder maintenant</span>
                <kbd className="text-xs font-normal text-[var(--slate-500)]">
                  Ctrl+S
                </kbd>
              </button>
              <p
                className="px-3 pb-2 text-xs text-[var(--slate-500)]"
                data-testid="estimate-page-toolbar-last-saved-at"
              >
                {formattedLastSavedAt
                  ? `Dernière sauvegarde : ${formattedLastSavedAt}`
                  : hasPendingChanges
                    ? "Aucune sauvegarde confirmée pour le moment."
                    : "Aucune modification en attente."}
              </p>
              <div
                className="my-1 border-t border-[var(--slate-200)]"
                role="separator"
              />
            </div>
          ) : null}
          <div className="estimate-toolbar-mobile-only" role="none">
            {canSend ? (
              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  close();
                  onSend();
                }}
                disabled={isStatusActionsDisabled}
              >
                Envoyer le chiffrage
              </button>
            ) : null}
            {canAccept ? (
              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  close();
                  onAccept();
                }}
                disabled={isStatusActionsDisabled}
              >
                Accepter le chiffrage
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                close();
                onExportExcel();
              }}
              disabled={isExportDisabled}
            >
              Exporter Excel
            </button>
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                close();
                onExportCSV();
              }}
              disabled={isExportDisabled}
            >
              Exporter CSV
            </button>
            <div className="my-1 border-t border-[var(--slate-200)]" role="separator" />
          </div>
          {showImportDpgfSource ? (
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                close();
                onImportDpgfSource();
              }}
              disabled={isImportDpgfSourceDisabled}
              data-testid="estimate-page-toolbar-import-dpgf-source-button"
            >
              {isImportingDpgfSource
                ? "Importer le DPGF source..."
                : "Importer le DPGF source"}
            </button>
          ) : null}
          {onOpenVersionZeroDialog ? (
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                close();
                onOpenVersionZeroDialog();
              }}
              disabled={isVersionZeroActionDisabled}
              data-testid="estimate-page-toolbar-version-zero-button"
            >
              {versionZeroActionLabel}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={menuItemClass}
            onClick={() => {
              close();
              onOpenExclusions();
            }}
            data-testid="estimate-page-toolbar-exclusions-button"
          >
            Exclusions
          </button>
          <div className="my-1 border-t border-[var(--slate-200)]" role="separator" />
          <button
            type="button"
            role="menuitem"
            className={menuItemClass}
            onClick={() => {
              close();
              onExportDpgf();
            }}
            disabled={isExportDisabled}
            data-testid="estimate-page-toolbar-export-dpgf-button"
          >
            {isExporting && activeExportMode === "dpgf"
              ? "Export DPGF..."
              : "Exporter DPGF"}
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItemClass}
            onClick={() => {
              close();
              onExportBdc();
            }}
            disabled={isExportDisabled}
            data-testid="estimate-page-toolbar-export-bdc-button"
          >
            {isExporting && activeExportMode === "bdc"
              ? "Export BDC V1.1..."
              : "Exporter BDC V1.1"}
          </button>
          <div role="none" className="my-1">
            <EstimatePdfDownloadButton versionId={versionId} />
          </div>
          <div role="none" className="my-1">
            <SaveAsTemplateButton versionId={versionId} />
          </div>
          {canArchive ? (
            <>
              <div className="my-1 border-t border-[var(--slate-200)]" role="separator" />
              <button
                type="button"
                role="menuitem"
                className={`${menuItemClass} text-danger hover:bg-error-light`}
                onClick={() => {
                  close();
                  onArchive();
                }}
                disabled={isArchiveDisabled}
                data-testid="estimate-page-toolbar-archive-button"
              >
                Archiver
              </button>
            </>
          ) : null}
          <div className="my-1 border-t border-[var(--slate-200)]" role="separator" />
          <Link
            role="menuitem"
            className={menuItemClass}
            href="/dashboard/estimates"
            onClick={close}
            data-testid="estimate-page-toolbar-back-to-list-link"
          >
            Retour à la liste
          </Link>
        </div>
      ) : null}
    </div>
  );
}

type EstimateEditorToolbarProps = {
  projectId?: string | null;
  projectName: string;
  versionNumber: number;
  status: EstimateStatus;
  autoSaveStatus: AutoSaveStatus;
  autoSaveStatusLabel: string;
  autoSaveStatusClassName: string;
  showAutoSaveStatus: boolean;
  isAutoSaveEnabled: boolean;
  hasPendingChanges: boolean;
  lastSavedAt: string | null;
  isSaveNowDisabled: boolean;
  onAutoSaveEnabledChange: (enabled: boolean) => void;
  onSaveNow: () => void;
  canSend: boolean;
  canAccept: boolean;
  canArchive: boolean;
  isStatusActionsDisabled: boolean;
  isUpdatingStatus: boolean;
  isDraftLockedByOther: boolean;
  isDraftLockAcquiring: boolean;
  isForcingDraftUnlock: boolean;
  onSend: () => void;
  onAccept: () => void;
  onOpenExclusions: () => void;
  onArchive: () => void;
  onExportExcel: () => void;
  onExportCSV: () => void;
  onExportDpgf: () => void;
  onExportBdc: () => void;
  onImportDpgfSource: () => void;
  showImportDpgfSource: boolean;
  onOpenVersionZeroDialog?: () => void;
  versionZeroActionLabel?: string;
  isVersionZeroActionDisabled?: boolean;
  isExportDisabled: boolean;
  isExporting: boolean;
  exportLoadingLabel: string;
  activeExportMode: EstimateExportMode | "csv" | null;
  isImportingDpgfSource: boolean;
  isImportDpgfSourceDisabled: boolean;
  versionId: string;
  summaryNode?: ReactNode;
};

export function EstimateEditorToolbar({
  projectId = null,
  projectName,
  versionNumber,
  status,
  autoSaveStatus,
  autoSaveStatusLabel,
  autoSaveStatusClassName,
  showAutoSaveStatus,
  isAutoSaveEnabled,
  hasPendingChanges,
  lastSavedAt,
  isSaveNowDisabled,
  onAutoSaveEnabledChange,
  onSaveNow,
  canSend,
  canAccept,
  canArchive,
  isStatusActionsDisabled,
  onSend,
  onAccept,
  onOpenExclusions,
  onArchive,
  onExportExcel,
  onExportCSV,
  onExportDpgf,
  onExportBdc,
  onImportDpgfSource,
  showImportDpgfSource,
  onOpenVersionZeroDialog,
  versionZeroActionLabel = "Préparer un brouillon IA",
  isVersionZeroActionDisabled = false,
  isExportDisabled,
  isExporting,
  exportLoadingLabel,
  activeExportMode,
  isImportingDpgfSource,
  isImportDpgfSourceDisabled,
  versionId,
  summaryNode,
}: EstimateEditorToolbarProps) {
  const formattedLastSavedAt = formatLastSavedAt(lastSavedAt);
  const autoSaveStatusDescription = `État de synchronisation : ${autoSaveStatusLabel}${
    formattedLastSavedAt
      ? `. Dernière sauvegarde : ${formattedLastSavedAt}`
      : ""
  }`;
  const breadcrumbs = projectId
    ? [
        { label: "Mes affaires", href: "/dashboard/affaires" },
        {
          label: projectName || "Affaire",
          href: `/dashboard/affaires/${projectId}`,
        },
        { label: `V${versionNumber} · Chiffrage` },
      ]
    : [
        { label: "Chiffrages", href: "/dashboard/estimates" },
        { label: `V${versionNumber} · Chiffrage` },
      ];

  return (
    <ProductionRibbonHeader
      breadcrumbs={breadcrumbs}
      title="Éditer le chiffrage"
      description={projectName ? `${projectName} · V${versionNumber}` : `Version ${versionNumber}`}
      metrics={summaryNode}
      testId="estimate-page-toolbar"
      titleTestId="estimate-page-toolbar-title"
      actions={
        <div
          className="flex items-center gap-2"
          data-testid="estimate-page-toolbar-actions"
        >
          <span
            className={estimateStatusClass(status)}
            data-testid="estimate-page-toolbar-status-badge"
          >
            {estimateStatusLabel(status)}
          </span>
          {showAutoSaveStatus ? (
            <span
              className={autoSaveStatusClassName}
              data-testid="estimate-page-toolbar-autosave-status"
              aria-live="polite"
              role="status"
              aria-label={autoSaveStatusDescription}
              title={autoSaveStatusDescription}
            >
              {autoSaveStatus === "saving" ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                    aria-hidden="true"
                  />
                  {autoSaveStatusLabel}
                </span>
              ) : autoSaveStatus === "saved" || autoSaveStatus === "idle" ? (
                <span className="inline-flex items-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                  {autoSaveStatusLabel}
                </span>
              ) : (
                autoSaveStatusLabel
              )}
            </span>
          ) : null}
          <ExportDropdown
            onExportExcel={onExportExcel}
            onExportCSV={onExportCSV}
            disabled={isExportDisabled}
            loading={isExporting}
            loadingLabel={exportLoadingLabel}
          />
          {canSend ? (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={onSend}
              disabled={isStatusActionsDisabled}
              data-testid="estimate-page-toolbar-send-button"
            >
              Envoyer
            </button>
          ) : null}
          {canAccept ? (
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={onAccept}
              disabled={isStatusActionsDisabled}
              data-testid="estimate-page-toolbar-accept-button"
            >
              Accepter
            </button>
          ) : null}
          <MoreActionsDropdown
            showAutoSaveControls={showAutoSaveStatus}
            isAutoSaveEnabled={isAutoSaveEnabled}
            hasPendingChanges={hasPendingChanges}
            lastSavedAt={lastSavedAt}
            isSaveNowDisabled={isSaveNowDisabled}
            onAutoSaveEnabledChange={onAutoSaveEnabledChange}
            onSaveNow={onSaveNow}
            canSend={canSend}
            canAccept={canAccept}
            isStatusActionsDisabled={isStatusActionsDisabled}
            onSend={onSend}
            onAccept={onAccept}
            onExportExcel={onExportExcel}
            onExportCSV={onExportCSV}
            onOpenExclusions={onOpenExclusions}
            onExportDpgf={onExportDpgf}
            onExportBdc={onExportBdc}
            onImportDpgfSource={onImportDpgfSource}
            showImportDpgfSource={showImportDpgfSource}
            onOpenVersionZeroDialog={onOpenVersionZeroDialog}
            versionZeroActionLabel={versionZeroActionLabel}
            isVersionZeroActionDisabled={isVersionZeroActionDisabled}
            isImportingDpgfSource={isImportingDpgfSource}
            isImportDpgfSourceDisabled={isImportDpgfSourceDisabled}
            isExporting={isExporting}
            isExportDisabled={isExportDisabled}
            activeExportMode={activeExportMode}
            versionId={versionId}
            canArchive={canArchive}
            onArchive={onArchive}
            isArchiveDisabled={isStatusActionsDisabled}
          />
        </div>
      }
    />
  );
}
