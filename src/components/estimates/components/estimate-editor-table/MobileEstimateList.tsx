"use client";

import { useState, type ReactNode } from "react";

import { Modal } from "@/components/ui/Modal";
import type { ColumnPreset } from "@/hooks/useColumnVisibility";
import type { EstimateQualityFlagKey } from "@/lib/estimate-quality";
import {
  formatCurrency,
  type SupportedEstimateCurrency,
} from "@/lib/money";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

export type MobileEstimateListRow = {
  item: EstimateItem;
  depth: number;
  itemNumber: string | null;
  unitValue: string;
  qualityFlags: EstimateQualityFlagKey[];
  sectionTotalCents: number | null;
  isCollapsed: boolean;
  canAddLine: boolean;
  canAddSection: boolean;
  addLineLabel: string;
  addSectionLabel: string;
};

type QuickAddTarget = {
  parentId: string | null;
  label: string;
  canAddLine: boolean;
  canAddSection: boolean;
  addLineLabel: string;
  addSectionLabel: string;
};

type MobileEstimateListProps = {
  rows: MobileEstimateListRow[];
  currency: SupportedEstimateCurrency;
  lineCount: number;
  grandTotalCents: number;
  isReadOnly: boolean;
  showFullTable: boolean;
  columnPreset: ColumnPreset;
  columnPresetLabels: Record<ColumnPreset, string>;
  onShowFullTableChange: (show: boolean) => void;
  onColumnPresetChange: (preset: ColumnPreset) => void;
  onOpenLine: (itemId: string) => void;
  onToggleSection: (sectionId: string) => void;
  onExpandAllSections: () => void;
  onCollapseAllSections: () => void;
  onAddLine: (parentId: string | null) => void;
  onAddSection: (parentId: string | null) => void;
  rootAddSectionLabel: string;
};

function BottomSheet({
  open,
  onOpenChange,
  title,
  children,
  testId,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  testId: string;
}>) {
  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content
        containerClassName="!absolute inset-x-0 bottom-0 !w-full !max-w-none"
        className="max-h-[85dvh] overflow-hidden rounded-b-none rounded-t-[24px] border-x-0 border-b-0 p-0"
        data-testid={testId}
      >
        <Modal.Header className="mb-0 border-b border-border px-4 py-3">
          <Modal.Title className="text-lg">{title}</Modal.Title>
          <Modal.Close>Fermer</Modal.Close>
        </Modal.Header>
        <Modal.Body className="max-h-[calc(85dvh-64px)] overflow-y-auto p-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
          {children}
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}

export function MobileEstimateList({
  rows,
  currency,
  lineCount,
  grandTotalCents,
  isReadOnly,
  showFullTable,
  columnPreset,
  columnPresetLabels,
  onShowFullTableChange,
  onColumnPresetChange,
  onOpenLine,
  onToggleSection,
  onExpandAllSections,
  onCollapseAllSections,
  onAddLine,
  onAddSection,
  rootAddSectionLabel,
}: Readonly<MobileEstimateListProps>) {
  const [quickAddTarget, setQuickAddTarget] = useState<QuickAddTarget | null>(
    null,
  );
  const [displaySheetOpen, setDisplaySheetOpen] = useState(false);

  const openRootQuickAdd = () => {
    setQuickAddTarget({
      parentId: null,
      label: "le chiffrage",
      canAddLine: false,
      canAddSection: true,
      addLineLabel: "+ Ligne",
      addSectionLabel: rootAddSectionLabel,
    });
  };

  const closeThen = (action: () => void) => {
    setQuickAddTarget(null);
    action();
  };

  return (
    <section
      className="estimate-mobile-list"
      aria-label="Vue mobile du chiffrage"
      data-testid="estimate-mobile-list"
      data-mobile-view={showFullTable ? "table" : "compact"}
    >
      <div className="estimate-mobile-list__toolbar">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {showFullTable ? "Contrôle détaillé" : `${lineCount} ligne${lineCount > 1 ? "s" : ""}`}
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
            {showFullTable ? "Tableau complet" : "Saisie mobile"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!showFullTable && !isReadOnly ? (
            <button
              type="button"
              className="btn btn-primary min-h-11 px-3 text-white"
              onClick={openRootQuickAdd}
              data-testid="estimate-mobile-quick-add-button"
            >
              Ajouter
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary min-h-11 px-3"
            onClick={() => setDisplaySheetOpen(true)}
            data-testid="estimate-mobile-display-button"
          >
            Affichage
          </button>
        </div>
      </div>

      {showFullTable ? (
        <button
          type="button"
          className="estimate-mobile-list__return"
          onClick={() => onShowFullTableChange(false)}
        >
          Revenir à la liste compacte
        </button>
      ) : (
        <>
          <div className="estimate-mobile-list__summary">
            <span>Total HT</span>
            <strong className="tabular-nums">
              {formatCurrency(grandTotalCents, currency)}
            </strong>
          </div>

          <div className="estimate-mobile-list__rows">
            {rows.length === 0 ? (
              <div className="estimate-empty">
                <p>Aucune ligne visible.</p>
              </div>
            ) : (
              rows.map((row) => {
                const { item } = row;
                if (item.item_type === "section") {
                  return (
                    <div
                      key={item.id}
                      className="estimate-mobile-section"
                      style={{ marginLeft: Math.min(row.depth * 12, 36) }}
                      data-testid={`estimate-mobile-section-${item.id}`}
                    >
                      <button
                        type="button"
                        className="estimate-mobile-section__toggle"
                        onClick={() => onToggleSection(item.id)}
                        aria-expanded={!row.isCollapsed}
                      >

                        <span className="min-w-0 flex-1 truncate text-left">
                          {row.itemNumber ? `${row.itemNumber} · ` : ""}
                          {item.title || "Section sans titre"}
                        </span>
                        <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">
                          {row.isCollapsed ? "Déplier" : "Replier"}
                        </span>
                        {row.sectionTotalCents !== null ? (
                          <span className="tabular-nums text-xs font-semibold text-muted-foreground">
                            {formatCurrency(row.sectionTotalCents, currency)}
                          </span>
                        ) : null}
                      </button>
                      {!isReadOnly && (row.canAddLine || row.canAddSection) ? (
                        <button
                          type="button"
                          className="estimate-mobile-section__add"
                          aria-label={`Ajouter dans ${item.title || "cette section"}`}
                          onClick={() =>
                            setQuickAddTarget({
                              parentId: item.id,
                              label: item.title || "cette section",
                              canAddLine: row.canAddLine,
                              canAddSection: row.canAddSection,
                              addLineLabel: row.addLineLabel,
                              addSectionLabel: row.addSectionLabel,
                            })
                          }
                        >
                          Ajouter
                        </button>
                      ) : null}
                    </div>
                  );
                }

                const anomalyCount = row.qualityFlags.length;
                const quantity = item.quantity ?? 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="estimate-mobile-line"
                    style={{ marginLeft: Math.min(row.depth * 12, 36) }}
                    onClick={() => onOpenLine(item.id)}
                    data-testid={`estimate-mobile-line-${item.id}`}
                    aria-label={`Modifier la ligne ${item.title || row.itemNumber || ""}`}
                  >
                    <span className="estimate-mobile-line__main">
                      <span className="estimate-mobile-line__title">
                        {row.itemNumber ? (
                          <span className="estimate-mobile-line__number">
                            {row.itemNumber}
                          </span>
                        ) : null}
                        <span className="truncate">
                          {item.title || "Ligne sans désignation"}
                        </span>
                      </span>
                      <span className="estimate-mobile-line__meta">
                        <span className="tabular-nums">
                          {quantity.toLocaleString("fr-FR")} × {row.unitValue || "u"}
                        </span>
                        {anomalyCount > 0 ? (
                          <span className="estimate-mobile-line__anomaly">
                            {anomalyCount} anomalie{anomalyCount > 1 ? "s" : ""}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="estimate-mobile-line__total">
                      {formatCurrency(item.line_total_ht_cents ?? 0, currency)}
                    </span>

                  </button>
                );
              })
            )}
          </div>
        </>
      )}

      <BottomSheet
        open={quickAddTarget !== null}
        onOpenChange={(open) => !open && setQuickAddTarget(null)}
        title={
          quickAddTarget ? `Ajouter dans ${quickAddTarget.label}` : "Ajouter"
        }
        testId="estimate-mobile-quick-add-sheet"
      >
        <div className="grid gap-2">
          {quickAddTarget?.canAddLine ? (
            <button
              type="button"
              className="btn btn-ghost min-h-12 w-full justify-start px-3 text-base"
              onClick={() =>
                closeThen(() => onAddLine(quickAddTarget.parentId))
              }
            >
              {quickAddTarget.addLineLabel.replace(/^\+\s*/, "")}
            </button>
          ) : null}
          {quickAddTarget?.canAddSection ? (
            <button
              type="button"
              className="btn btn-ghost min-h-12 w-full justify-start px-3 text-base"
              onClick={() =>
                closeThen(() => onAddSection(quickAddTarget.parentId))
              }
            >
              {quickAddTarget.addSectionLabel.replace(/^\+\s*/, "")}
            </button>
          ) : null}
        </div>
      </BottomSheet>

      <BottomSheet
        open={displaySheetOpen}
        onOpenChange={setDisplaySheetOpen}
        title="Options d’affichage"
        testId="estimate-mobile-display-sheet"
      >
        <section aria-labelledby="estimate-mobile-view-mode-title">
          <h3
            id="estimate-mobile-view-mode-title"
            className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground"
          >
            Mode
          </h3>
          <div className="mt-2 grid gap-2">
            <button
              type="button"
              className={`btn min-h-12 w-full justify-between px-3 text-base ${
                !showFullTable ? "btn-primary text-white" : "btn-secondary"
              }`}
              aria-pressed={!showFullTable}
              onClick={() => {
                onShowFullTableChange(false);
                setDisplaySheetOpen(false);
              }}
            >
              Liste compacte
              <span className="text-xs font-normal">Saisie rapide</span>
            </button>
            <button
              type="button"
              className={`btn min-h-12 w-full justify-between px-3 text-base ${
                showFullTable ? "btn-primary text-white" : "btn-secondary"
              }`}
              aria-pressed={showFullTable}
              onClick={() => {
                onShowFullTableChange(true);
                setDisplaySheetOpen(false);
              }}
            >
              Tableau complet
              <span className="text-xs font-normal">Contrôle détaillé</span>
            </button>
          </div>
        </section>

        <section className="mt-5 border-t border-border pt-4" aria-labelledby="estimate-mobile-columns-title">
          <h3
            id="estimate-mobile-columns-title"
            className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground"
          >
            Colonnes du tableau complet
          </h3>
          <div className="mt-2 grid gap-2">
            {(["essential", "standard", "full"] as ColumnPreset[]).map(
              (preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`btn min-h-12 w-full justify-between px-3 ${
                    columnPreset === preset ? "btn-primary text-white" : "btn-secondary"
                  }`}
                  aria-pressed={columnPreset === preset}
                  onClick={() => onColumnPresetChange(preset)}
                >
                  {columnPresetLabels[preset]}
                </button>
              ),
            )}
          </div>
        </section>

        <section className="mt-5 border-t border-border pt-4" aria-labelledby="estimate-mobile-structure-title">
          <h3
            id="estimate-mobile-structure-title"
            className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground"
          >
            Structure
          </h3>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn btn-secondary min-h-12"
              onClick={onExpandAllSections}
            >
              Tout déplier
            </button>
            <button
              type="button"
              className="btn btn-secondary min-h-12"
              onClick={onCollapseAllSections}
            >
              Tout replier
            </button>
          </div>
        </section>
      </BottomSheet>
    </section>
  );
}
