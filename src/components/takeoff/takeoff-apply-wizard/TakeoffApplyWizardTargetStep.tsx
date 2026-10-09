"use client";

import {
  type SectionOption,
} from "./shared";
import { NativeSelect } from "@/components/ui/native-select";
import { Alert } from "@/components/ui/alert";

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
      <div className="rounded-xl border border-border bg-surface-subtle p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Cible d&apos;application
        </p>
        <p className="mt-2 text-sm font-semibold text-foreground">
          {targetVersionLabel
            ? `${targetVersionLabel} — brouillon actuellement ouvert`
            : "Brouillon actuellement ouvert"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Les quantités seront injectées dans cette section après confirmation finale. La racine du devis n&apos;est jamais proposée comme cible.
        </p>
      </div>

      <div>
        <label
          htmlFor="takeoff-target-section"
          className="block text-xs font-semibold text-foreground-secondary"
        >
          Section cible
        </label>
        <NativeSelect
          id="takeoff-target-section"
          size="sm" className="mt-1 w-full"
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
        </NativeSelect>
      </div>

      {isLoadingSections && (
        <Alert variant="info">Chargement des sections…</Alert>
      )}
      {sectionsError && <Alert variant="danger">{sectionsError}</Alert>}
      {!isLoadingSections && !sectionsError && sectionOptions.length === 0 && (
        <Alert variant="info">
          Créez d&apos;abord un lot ou un chapitre dans le devis pour y rattacher les lignes du métré.
        </Alert>
      )}
    </div>
  );
}
