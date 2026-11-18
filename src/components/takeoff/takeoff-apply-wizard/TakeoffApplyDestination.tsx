"use client";

import { Alert } from "@/components/ui/alert";
import { NativeSelect } from "@/components/ui/native-select";

import type { SectionOption } from "./shared";

/** Where the takeoff's lines go: the section (the first one preselected) and what it receives. */
export function TakeoffApplyDestination({
  targetVersionLabel,
  targetSectionId,
  sectionOptions,
  isLoadingSections,
  sectionsError,
  isSubmitting,
  onTargetSectionChange,
  reconcilesDpgf,
}: {
  targetVersionLabel?: string | null;
  targetSectionId: string | null;
  sectionOptions: SectionOption[];
  isLoadingSections: boolean;
  sectionsError: string | null;
  isSubmitting: boolean;
  onTargetSectionChange: (value: string | null) => void;
  reconcilesDpgf: boolean;
}) {
  return (
    <section aria-labelledby="takeoff-apply-destination-title" className="space-y-3 rounded-xl border border-border bg-surface-subtle p-4">
      <div>
        <h3 id="takeoff-apply-destination-title" className="text-sm font-semibold text-foreground">
          Destination
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {targetVersionLabel ? `${targetVersionLabel} — brouillon actuellement ouvert` : "Brouillon actuellement ouvert"}
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
        <p className="mt-2 text-sm text-muted-foreground">
          {reconcilesDpgf
            ? "Les lignes DPGF rapprochées gardent leur place ; cette section reçoit les nouvelles lignes."
            : "Les lignes du métré arrivent dans cette section ; une page déjà mesurée met à jour ses lignes à leur place."}
        </p>
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
    </section>
  );
}
