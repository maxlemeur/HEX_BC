"use client";

import { useEffect, useMemo, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { fetchEstimateItemsForVersion } from "@/lib/estimates/client";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

type WizardStep = 1 | 2 | 3;

type SectionOption = {
  id: string;
  label: string;
  summaryLabel: string;
};

export type TakeoffApplyStrategy = "append" | "replace" | "merge";

export type TakeoffApplyWizardSubmitPayload = {
  targetSectionId: string | null;
  targetSectionLabel: string;
  strategy: TakeoffApplyStrategy;
};

type TakeoffApplyWizardProps = {
  open: boolean;
  versionId: string;
  includedCount: number;
  excludedCount: number;
  isSubmitting: boolean;
  submitError: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: TakeoffApplyWizardSubmitPayload) => Promise<void>;
};

const ROOT_SECTION_VALUE = "__takeoff_root_section__";
const ROOT_SECTION_LABEL = "Racine du devis";

const STRATEGY_OPTIONS: Array<{
  value: TakeoffApplyStrategy;
  label: string;
  description: string;
}> = [
  {
    value: "append",
    label: "Append",
    description: "Ajoute les lignes takeoff a la fin de la section cible.",
  },
  {
    value: "replace",
    label: "Replace",
    description: "Remplace le contenu existant de la section cible.",
  },
  {
    value: "merge",
    label: "Merge",
    description: "Fusionne avec les lignes existantes selon les regles serveur.",
  },
];

function toPosition(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return Number.MAX_SAFE_INTEGER;
}

function normalizeSectionTitle(title: string | null): string {
  const normalized = title?.trim();
  if (!normalized) return "Section sans titre";
  return normalized;
}

function compareSections(left: EstimateItem, right: EstimateItem): number {
  const positionDiff = toPosition(left.position) - toPosition(right.position);
  if (positionDiff !== 0) return positionDiff;

  const titleDiff = normalizeSectionTitle(left.title).localeCompare(
    normalizeSectionTitle(right.title),
    "fr-FR"
  );
  if (titleDiff !== 0) return titleDiff;

  return left.id.localeCompare(right.id);
}

function buildSectionOptions(items: EstimateItem[]): SectionOption[] {
  const sections = items.filter((item) => item.item_type === "section");
  const sectionIds = new Set(sections.map((section) => section.id));
  const childrenByParent = new Map<string | null, EstimateItem[]>();

  for (const section of sections) {
    const parentId =
      section.parent_id && sectionIds.has(section.parent_id)
        ? section.parent_id
        : null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(section);
    childrenByParent.set(parentId, siblings);
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort(compareSections);
  }

  const visited = new Set<string>();
  const ordered: SectionOption[] = [];

  const visit = (parentId: string | null, depth: number) => {
    const children = childrenByParent.get(parentId) ?? [];

    for (const section of children) {
      if (visited.has(section.id)) continue;
      visited.add(section.id);
      const summaryLabel = normalizeSectionTitle(section.title);
      const indent = depth > 0 ? `${"  ".repeat(depth)}- ` : "";
      ordered.push({
        id: section.id,
        label: `${indent}${summaryLabel}`,
        summaryLabel,
      });
      visit(section.id, depth + 1);
    }
  };

  visit(null, 0);

  for (const section of sections) {
    if (visited.has(section.id)) continue;
    ordered.push({
      id: section.id,
      label: normalizeSectionTitle(section.title),
      summaryLabel: normalizeSectionTitle(section.title),
    });
  }

  return ordered;
}

function strategyDescription(strategy: TakeoffApplyStrategy) {
  return STRATEGY_OPTIONS.find((option) => option.value === strategy)?.description ?? "-";
}

export function TakeoffApplyWizard({
  open,
  versionId,
  includedCount,
  excludedCount,
  isSubmitting,
  submitError,
  onOpenChange,
  onConfirm,
}: TakeoffApplyWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [targetSectionId, setTargetSectionId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<TakeoffApplyStrategy>("append");
  const [sectionOptions, setSectionOptions] = useState<SectionOption[]>([]);
  const [isLoadingSections, setIsLoadingSections] = useState(false);
  const [sectionsError, setSectionsError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let active = true;

    const loadSections = async () => {
      setStep(1);
      setTargetSectionId(null);
      setStrategy("append");
      setSectionOptions([]);
      setSectionsError(null);
      setIsLoadingSections(true);

      try {
        const estimateItems = await fetchEstimateItemsForVersion(versionId);
        if (!active) return;
        setSectionOptions(buildSectionOptions(estimateItems));
      } catch (error) {
        if (!active) return;
        setSectionsError(
          error instanceof Error
            ? error.message
            : "Impossible de charger les sections du devis."
        );
      } finally {
        if (!active) return;
        setIsLoadingSections(false);
      }
    };

    void loadSections();

    return () => {
      active = false;
    };
  }, [open, versionId]);

  const selectedSectionLabel = useMemo(() => {
    if (!targetSectionId) return ROOT_SECTION_LABEL;
    return (
      sectionOptions.find((option) => option.id === targetSectionId)?.summaryLabel ??
      "Section cible"
    );
  }, [sectionOptions, targetSectionId]);

  const canProceed = step < 3;
  const canGoBack = step > 1;
  const canConfirm = includedCount > 0 && !isSubmitting;

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  const handleClose = () => {
    handleOpenChange(false);
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;

    await onConfirm({
      targetSectionId,
      targetSectionLabel: selectedSectionLabel,
      strategy,
    });
  };

  return (
    <Modal.Root open={open} onOpenChange={handleOpenChange}>
      <Modal.Content className="max-w-2xl" closeOnOverlayClick={!isSubmitting}>
        <Modal.Header>
          <div>
            <Modal.Title>Appliquer au devis</Modal.Title>
            <p className="mt-1 text-sm text-[var(--slate-500)]">Etape {step} / 3</p>
          </div>
          <Modal.Close disabled={isSubmitting} />
        </Modal.Header>

        <Modal.Body>
          <div className="mb-2 flex items-center gap-2">
            {[1, 2, 3].map((value) => {
              const active = step === value;
              const done = step > value;
              return (
                <span
                  key={value}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                    active
                      ? "bg-[var(--info)] text-white"
                      : done
                        ? "bg-[var(--success)] text-white"
                        : "bg-[var(--slate-100)] text-[var(--slate-500)]"
                  }`}
                >
                  {value}
                </span>
              );
            })}
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <label className="block text-xs font-semibold text-[var(--slate-700)]">
                Version cible
                <input
                  className="form-input mt-1 w-full bg-[var(--slate-50)]"
                  value={versionId}
                  readOnly
                />
              </label>

              <div>
                <label className="block text-xs font-semibold text-[var(--slate-700)]">
                  Section cible
                </label>
                <select
                  className="form-input form-select mt-1 w-full"
                  value={targetSectionId ?? ROOT_SECTION_VALUE}
                  onChange={(event) => {
                    const value = event.target.value;
                    setTargetSectionId(
                      value === ROOT_SECTION_VALUE ? null : value
                    );
                  }}
                  disabled={isLoadingSections || isSubmitting}
                >
                  <option value={ROOT_SECTION_VALUE}>{ROOT_SECTION_LABEL}</option>
                  {sectionOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {isLoadingSections && (
                <div className="alert alert-info">Chargement des sections...</div>
              )}
              {sectionsError && <div className="alert alert-error">{sectionsError}</div>}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              {STRATEGY_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--slate-200)] p-3"
                >
                  <input
                    type="radio"
                    name="takeoff-apply-strategy"
                    value={option.value}
                    checked={strategy === option.value}
                    onChange={() => setStrategy(option.value)}
                    disabled={isSubmitting}
                  />
                  <span>
                    <span className="block text-sm font-semibold text-[var(--slate-800)]">
                      {option.label}
                    </span>
                    <span className="mt-1 block text-sm text-[var(--slate-600)]">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4 text-sm">
                <p className="font-semibold text-[var(--slate-800)]">Recapitulatif</p>
                <p className="mt-2 text-[var(--slate-700)]">Version: {versionId}</p>
                <p className="mt-1 text-[var(--slate-700)]">
                  Section: {selectedSectionLabel}
                </p>
                <p className="mt-1 text-[var(--slate-700)]">
                  Strategie: {strategy} - {strategyDescription(strategy)}
                </p>
                <p className="mt-1 text-[var(--slate-700)]">
                  Items inclus: <strong>{includedCount}</strong>
                </p>
                <p className="mt-1 text-[var(--slate-700)]">
                  Items exclus: <strong>{excludedCount}</strong>
                </p>
              </div>

              {includedCount === 0 && (
                <div className="alert alert-info">
                  Aucun item inclus n&apos;est disponible pour application.
                </div>
              )}
            </div>
          )}

          {submitError && (
            <div className="alert alert-error">
              {submitError}
            </div>
          )}
        </Modal.Body>

        <Modal.Footer>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Annuler
          </button>

          {canGoBack && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setStep((previous) => (previous - 1) as WizardStep)}
              disabled={isSubmitting}
            >
              Retour
            </button>
          )}

          {canProceed ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setStep((previous) => (previous + 1) as WizardStep)}
              disabled={isSubmitting}
            >
              Suivant
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void handleConfirm()}
              disabled={!canConfirm}
            >
              {isSubmitting ? "Application..." : "Confirmer l'application"}
            </button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
