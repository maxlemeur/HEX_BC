"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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
      return "Envoyee";
    case "accepted":
      return "Acceptee";
    case "archived":
      return "Archivee";
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

type MoreActionsDropdownProps = {
  onExportDpgf: () => void;
  onExportBdc: () => void;
  isExporting: boolean;
  isExportDisabled: boolean;
  activeExportMode: EstimateExportMode | "csv" | null;
  versionId: string;
  canArchive: boolean;
  onArchive: () => void;
  isArchiveDisabled: boolean;
};

function MoreActionsDropdown({
  onExportDpgf,
  onExportBdc,
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

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const menuItemClass =
    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-[var(--slate-700)] hover:bg-[var(--slate-50)] transition-colors";

  return (
    <div ref={containerRef} className="relative" data-testid="estimate-page-toolbar-more-actions">
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        data-testid="estimate-page-toolbar-more-actions-button"
      >
        Plus d&apos;actions
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
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-[var(--slate-200)] bg-surface p-2 shadow-lg z-50"
          data-testid="estimate-page-toolbar-more-actions-menu"
        >
          <button
            type="button"
            className={menuItemClass}
            onClick={() => {
              setIsOpen(false);
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
            className={menuItemClass}
            onClick={() => {
              setIsOpen(false);
              onExportBdc();
            }}
            disabled={isExportDisabled}
            data-testid="estimate-page-toolbar-export-bdc-button"
          >
            {isExporting && activeExportMode === "bdc"
              ? "Export BDC V1.1..."
              : "Exporter BDC V1.1"}
          </button>
          <div className="my-1">
            <EstimatePdfDownloadButton versionId={versionId} />
          </div>
          <div className="my-1">
            <SaveAsTemplateButton versionId={versionId} />
          </div>
          {canArchive ? (
            <>
              <div className="my-1 border-t border-[var(--slate-200)]" />
              <button
                type="button"
                className={`${menuItemClass} text-danger hover:bg-error-light`}
                onClick={() => {
                  setIsOpen(false);
                  onArchive();
                }}
                disabled={isArchiveDisabled}
                data-testid="estimate-page-toolbar-archive-button"
              >
                Archiver
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

type EstimateEditorToolbarProps = {
  projectName: string;
  versionNumber: number;
  status: EstimateStatus;
  autoSaveStatus: AutoSaveStatus;
  autoSaveStatusLabel: string;
  autoSaveStatusClassName: string;
  showAutoSaveStatus: boolean;
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
};

export function EstimateEditorToolbar({
  projectName,
  versionNumber,
  status,
  autoSaveStatus,
  autoSaveStatusLabel,
  autoSaveStatusClassName,
  showAutoSaveStatus,
  canSend,
  canAccept,
  canArchive,
  isStatusActionsDisabled,
  onSend,
  onAccept,
  onArchive,
  onExportExcel,
  onExportCSV,
  onExportDpgf,
  onExportBdc,
  onImportDpgfSource,
  showImportDpgfSource,
  onOpenVersionZeroDialog,
  versionZeroActionLabel = "Generer V0",
  isVersionZeroActionDisabled = false,
  isExportDisabled,
  isExporting,
  exportLoadingLabel,
  activeExportMode,
  isImportingDpgfSource,
  isImportDpgfSourceDisabled,
  versionId,
}: EstimateEditorToolbarProps) {
  return (
    <div
      className="page-header flex flex-wrap items-start justify-between gap-4"
      data-testid="estimate-page-toolbar"
    >
      <div data-testid="estimate-page-toolbar-heading">
        <h1 className="page-title" data-testid="estimate-page-toolbar-title">Éditer le chiffrage</h1>
        <p className="page-description">
          {projectName ? (
            <>
              {projectName}
              {" — "}
              <span className="font-semibold">V{versionNumber}</span>
            </>
          ) : (
            <span className="font-semibold">V{versionNumber}</span>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2" data-testid="estimate-page-toolbar-actions">
        <span className={estimateStatusClass(status)} data-testid="estimate-page-toolbar-status-badge">
          {estimateStatusLabel(status)}
        </span>
        {showAutoSaveStatus ? (
          <span className={autoSaveStatusClassName} data-testid="estimate-page-toolbar-autosave-status">
            {autoSaveStatus === "saving" ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                {autoSaveStatusLabel}
              </span>
            ) : autoSaveStatus === "saved" ? (
              <span className="inline-flex items-center gap-1.5">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
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
        {showImportDpgfSource ? (
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={onImportDpgfSource}
            disabled={isImportDpgfSourceDisabled}
            data-testid="estimate-page-toolbar-import-dpgf-source-button"
          >
            {isImportingDpgfSource
              ? "Importer le DPGF source..."
              : "Importer le DPGF source"}
          </button>
        ) : null}
        {onOpenVersionZeroDialog ? (
          <div className="inline-flex items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
              Aide adjacente
            </span>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={onOpenVersionZeroDialog}
              disabled={isVersionZeroActionDisabled}
              data-testid="estimate-page-toolbar-version-zero-button"
            >
              {versionZeroActionLabel}
            </button>
          </div>
        ) : null}
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
          onExportDpgf={onExportDpgf}
          onExportBdc={onExportBdc}
          isExporting={isExporting}
          isExportDisabled={isExportDisabled}
          activeExportMode={activeExportMode}
          versionId={versionId}
          canArchive={canArchive}
          onArchive={onArchive}
          isArchiveDisabled={isStatusActionsDisabled}
        />
        <Link
          className="btn btn-secondary btn-sm"
          href="/dashboard/estimates"
          data-testid="estimate-page-toolbar-back-to-list-link"
        >
          Retour à la liste
        </Link>
      </div>
    </div>
  );
}
