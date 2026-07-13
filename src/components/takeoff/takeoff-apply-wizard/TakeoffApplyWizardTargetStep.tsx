"use client";

import {
  type SectionOption,
} from "./shared";

export function TakeoffApplyWizardTargetStep({
  targetVersionLabel,
  targetSectionId,
  sectionOptions,
  isLoadingSections,
  sectionsError,
  isSubmitting,
  onTargetSectionChange,
}: {
  targetVersionLabel?: string | null;
  targetSectionId: string | null;
  sectionOptions: SectionOption[];
  isLoadingSections: boolean;
  sectionsError: string | null;
  isSubmitting: boolean;
  onTargetSectionChange: (value: string | null) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--slate-500)]">
          Cible d&apos;application
        </p>
        <p className="mt-2 text-sm font-semibold text-[var(--slate-800)]">
          {targetVersionLabel
            ? `${targetVersionLabel} — brouillon actuellement ouvert`
            : "Brouillon actuellement ouvert"}
        </p>
        <p className="mt-1 text-sm text-[var(--slate-600)]">
          Les quantites seront injectees dans ce devis brouillon apres confirmation finale.
        </p>
      </div>

      <div>
        <label
          htmlFor="takeoff-target-section"
          className="block text-xs font-semibold text-[var(--slate-700)]"
        >
          Section cible
        </label>
        <select
          id="takeoff-target-section"
          className="form-input form-select mt-1 w-full"
          value={targetSectionId ?? ""}
          onChange={(event) => {
            onTargetSectionChange(event.target.value || null);
          }}
          disabled={isLoadingSections || isSubmitting || sectionOptions.length === 0}
        >
          <option value="" disabled>
            Choisir une section
          </option>
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
      {!isLoadingSections && !sectionsError && sectionOptions.length === 0 && (
        <div className="alert alert-info">
          Creez d&apos;abord un lot ou un chapitre dans le devis pour y rattacher les lignes du metre.
        </div>
      )}
    </div>
  );
}
