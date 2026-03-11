"use client";

import {
  ROOT_SECTION_LABEL,
  ROOT_SECTION_VALUE,
  type SectionOption,
} from "./shared";

export function TakeoffApplyWizardTargetStep({
  versionId,
  targetSectionId,
  sectionOptions,
  isLoadingSections,
  sectionsError,
  isSubmitting,
  onTargetSectionChange,
}: {
  versionId: string;
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
          Brouillon actuellement ouvert
        </p>
        <p className="mt-1 text-sm text-[var(--slate-600)]">
          Les quantites seront injectees dans ce devis brouillon apres confirmation finale.
        </p>
        <code className="mt-3 block rounded-lg bg-white px-3 py-2 text-xs text-[var(--slate-700)]">
          {versionId}
        </code>
      </div>

      <div>
        <label className="block text-xs font-semibold text-[var(--slate-700)]">
          Section cible
        </label>
        <select
          className="form-input form-select mt-1 w-full"
          value={targetSectionId ?? ROOT_SECTION_VALUE}
          onChange={(event) => {
            const value = event.target.value;
            onTargetSectionChange(value === ROOT_SECTION_VALUE ? null : value);
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
  );
}
