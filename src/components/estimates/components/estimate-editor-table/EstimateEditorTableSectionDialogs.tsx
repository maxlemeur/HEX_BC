"use client";

import {
  type RefObject,
  useLayoutEffect,
  useRef,
} from "react";

import { type UseEstimateSectionDialogsResult } from "@/components/estimates/hooks/useEstimateSectionDialogs";

type SectionContextMeta = {
  sectionLevel: number;
  hasChildren: boolean;
  canAddSection: boolean;
  canAddLine: boolean;
  addSectionLabel: string;
  addLineLabel: string;
};

const CONTEXT_MENU_VIEWPORT_PADDING = 8;

export function resolveSectionContextMenuTop(
  preferredTop: number,
  menuHeight: number,
  viewportHeight: number,
  viewportPadding = CONTEXT_MENU_VIEWPORT_PADDING
): number {
  const minimumTop = viewportPadding;
  const maximumTop = Math.max(
    minimumTop,
    viewportHeight - Math.max(0, menuHeight) - viewportPadding
  );

  return Math.max(minimumTop, Math.min(preferredTop, maximumTop));
}

type EstimateEditorTableSectionDialogsProps = {
  isViewerMode?: boolean;
  isReadOnly: boolean;
  isItemConversionPending: boolean;
  sectionContextMenu: UseEstimateSectionDialogsResult["sectionContextMenu"];
  sectionContextMeta: SectionContextMeta | null;
  onCloseSectionContextMenu: () => void;
  onAddLine: (sectionId: string) => void;
  onAddSection: (sectionId: string) => void;
  onConvertSectionToLine: (sectionId: string) => void;
  onDuplicateSectionInPlace: () => void | Promise<void>;
  onOpenDuplicateSectionDialog: () => void;
  onOpenSaveAsAssemblyDialog: () => void;
  onDeleteSection: (sectionId: string) => void;
  onDuplicateSection?: (sectionId: string) => Promise<void>;
  onDuplicateSectionToVersion?: (input: {
    sectionId: string;
    targetVersionId: string;
  }) => Promise<void>;
  availableSectionDuplicateTargets: Array<{
    versionId: string;
    label: string;
  }>;
  duplicateSectionDialogSectionId: UseEstimateSectionDialogsResult["duplicateSectionDialogSectionId"];
  duplicateSectionTargetVersionId: string;
  onDuplicateSectionTargetVersionIdChange: (value: string) => void;
  isDuplicateSectionPending: boolean;
  onCloseDuplicateSectionDialog: () => void;
  onConfirmDuplicateSectionToVersion: () => void | Promise<void>;
  saveAsAssemblyDialogSectionId: UseEstimateSectionDialogsResult["saveAsAssemblyDialogSectionId"];
  saveAsAssemblyName: string;
  onSaveAsAssemblyNameChange: (value: string) => void;
  saveAsAssemblyNameInputRef: RefObject<HTMLInputElement | null>;
  isSaveAsAssemblyPending: boolean;
  onCloseSaveAsAssemblyDialog: () => void;
  onConfirmSaveAsAssembly: () => void | Promise<void>;
};

export function EstimateEditorTableSectionDialogs({
  isViewerMode,
  isReadOnly,
  isItemConversionPending,
  sectionContextMenu,
  sectionContextMeta,
  onCloseSectionContextMenu,
  onAddLine,
  onAddSection,
  onConvertSectionToLine,
  onDuplicateSectionInPlace,
  onOpenDuplicateSectionDialog,
  onOpenSaveAsAssemblyDialog,
  onDeleteSection,
  onDuplicateSection,
  onDuplicateSectionToVersion,
  availableSectionDuplicateTargets,
  duplicateSectionDialogSectionId,
  duplicateSectionTargetVersionId,
  onDuplicateSectionTargetVersionIdChange,
  isDuplicateSectionPending,
  onCloseDuplicateSectionDialog,
  onConfirmDuplicateSectionToVersion,
  saveAsAssemblyDialogSectionId,
  saveAsAssemblyName,
  onSaveAsAssemblyNameChange,
  saveAsAssemblyNameInputRef,
  isSaveAsAssemblyPending,
  onCloseSaveAsAssemblyDialog,
  onConfirmSaveAsAssembly,
}: EstimateEditorTableSectionDialogsProps) {
  const sectionContextMenuRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const menu = sectionContextMenuRef.current;
    if (!sectionContextMenu || !menu) return;

    const top = resolveSectionContextMenuTop(
      sectionContextMenu.y,
      menu.getBoundingClientRect().height,
      window.innerHeight
    );

    menu.style.top = `${top}px`;
  }, [sectionContextMenu, sectionContextMeta?.canAddSection]);

  return (
    <>
      {sectionContextMenu && !isViewerMode ? (
        <div
          ref={sectionContextMenuRef}
          className="estimate-supplier-comparison-context-menu estimate-section-context-menu"
          role="menu"
          aria-label="Actions de section"
          data-testid="estimate-section-context-menu"
          style={{
            right: `${sectionContextMenu.right}px`,
            top: `${sectionContextMenu.y}px`,
          }}
        >
          <button
            type="button"
            className="estimate-supplier-comparison-context-menu__action"
            role="menuitem"
            onClick={() => {
              onCloseSectionContextMenu();
              onAddLine(sectionContextMenu.sectionId);
            }}
            disabled={isReadOnly || !sectionContextMeta?.canAddLine}
            data-testid="estimate-section-context-add-line-button"
          >
            {sectionContextMeta?.addLineLabel ?? "+ Ligne"}
          </button>
          {sectionContextMeta?.canAddSection ? (
            <button
              type="button"
              className="estimate-supplier-comparison-context-menu__action"
              role="menuitem"
              onClick={() => {
                onCloseSectionContextMenu();
                onAddSection(sectionContextMenu.sectionId);
              }}
              disabled={isReadOnly}
              data-testid="estimate-section-context-add-section-button"
            >
              {sectionContextMeta.addSectionLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="estimate-supplier-comparison-context-menu__action"
            role="menuitem"
            onClick={() => void onConvertSectionToLine(sectionContextMenu.sectionId)}
            disabled={
              isReadOnly ||
              isItemConversionPending ||
              Boolean(sectionContextMeta?.hasChildren)
            }
            title={
              sectionContextMeta?.hasChildren
                ? "Conversion impossible: la section contient des enfants."
                : undefined
            }
            data-testid="estimate-section-context-convert-to-line-button"
          >
            Convertir en ligne
          </button>
          <div className="estimate-section-context-menu__separator" />
          <button
            type="button"
            className="estimate-supplier-comparison-context-menu__action"
            role="menuitem"
            onClick={() => void onDuplicateSectionInPlace()}
            disabled={!onDuplicateSection}
            data-testid="estimate-section-context-duplicate-button"
          >
            Dupliquer la section
          </button>
          <button
            type="button"
            className="estimate-supplier-comparison-context-menu__action"
            role="menuitem"
            onClick={onOpenDuplicateSectionDialog}
            disabled={
              !onDuplicateSectionToVersion ||
              availableSectionDuplicateTargets.length === 0
            }
            data-testid="estimate-section-context-duplicate-to-version-button"
          >
            Dupliquer vers un autre devis
          </button>
          <button
            type="button"
            className="estimate-supplier-comparison-context-menu__action"
            role="menuitem"
            onClick={onOpenSaveAsAssemblyDialog}
            data-testid="estimate-section-context-save-as-assembly-button"
          >
            Enregistrer comme assemblage
          </button>
          <div className="estimate-section-context-menu__separator" />
          <button
            type="button"
            className="estimate-supplier-comparison-context-menu__action estimate-supplier-comparison-context-menu__action--danger"
            role="menuitem"
            onClick={() => {
              const confirmed = window.confirm(
                "Êtes-vous sûr de vouloir supprimer ce chapitre et toutes ses lignes ?"
              );
              onCloseSectionContextMenu();
              if (confirmed) {
                onDeleteSection(sectionContextMenu.sectionId);
              }
            }}
            disabled={isReadOnly}
            data-testid="estimate-section-context-delete-button"
          >
            Supprimer la section
          </button>
        </div>
      ) : null}

      {duplicateSectionDialogSectionId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,23,0.45)] p-4"
          data-testid="estimate-duplicate-section-dialog-backdrop"
        >
          <div
            className="dashboard-card w-full max-w-xl p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="duplicate-section-dialog-title"
            data-testid="estimate-duplicate-section-dialog"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2
                  id="duplicate-section-dialog-title"
                  className="text-lg font-semibold text-[var(--slate-800)]"
                >
                  Dupliquer vers un autre devis
                </h2>
                <p className="mt-1 text-sm text-[var(--slate-500)]">
                  Choisissez une version en brouillon.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onCloseDuplicateSectionDialog}
                disabled={isDuplicateSectionPending}
              >
                Fermer
              </button>
            </div>

            {availableSectionDuplicateTargets.length === 0 ? (
              <div className="alert alert-info">
                Aucun devis brouillon disponible en cible.
              </div>
            ) : (
              <label className="form-label block">
                Devis cible
                <select
                  className="input mt-2 w-full"
                  value={duplicateSectionTargetVersionId}
                  onChange={(event) =>
                    onDuplicateSectionTargetVersionIdChange(event.target.value)
                  }
                  disabled={isDuplicateSectionPending}
                >
                  {availableSectionDuplicateTargets.map((target) => (
                    <option key={target.versionId} value={target.versionId}>
                      {target.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onCloseDuplicateSectionDialog}
                disabled={isDuplicateSectionPending}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void onConfirmDuplicateSectionToVersion()}
                disabled={
                  isDuplicateSectionPending ||
                  !duplicateSectionTargetVersionId ||
                  availableSectionDuplicateTargets.length === 0
                }
              >
                {isDuplicateSectionPending ? "Duplication..." : "Dupliquer"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {saveAsAssemblyDialogSectionId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,23,0.45)] p-4"
          data-testid="estimate-save-as-assembly-dialog-backdrop"
        >
          <div
            className="dashboard-card w-full max-w-xl p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-as-assembly-dialog-title"
            data-testid="estimate-save-as-assembly-dialog"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2
                  id="save-as-assembly-dialog-title"
                  className="text-lg font-semibold text-[var(--slate-800)]"
                >
                  Enregistrer comme assemblage
                </h2>
                <p className="mt-1 text-sm text-[var(--slate-500)]">
                  Les lignes de cette section seront enregistrées comme assemblage réutilisable.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onCloseSaveAsAssemblyDialog}
                disabled={isSaveAsAssemblyPending}
              >
                Fermer
              </button>
            </div>

            <label className="form-label block">
              Nom de l&apos;assemblage
              <input
                ref={saveAsAssemblyNameInputRef}
                className="input mt-2 w-full"
                type="text"
                value={saveAsAssemblyName}
                onChange={(event) => onSaveAsAssemblyNameChange(event.target.value)}
                disabled={isSaveAsAssemblyPending}
              />
            </label>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onCloseSaveAsAssemblyDialog}
                disabled={isSaveAsAssemblyPending}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void onConfirmSaveAsAssembly()}
                disabled={isSaveAsAssemblyPending || !saveAsAssemblyName.trim()}
              >
                {isSaveAsAssemblyPending ? "Enregistrement..." : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
