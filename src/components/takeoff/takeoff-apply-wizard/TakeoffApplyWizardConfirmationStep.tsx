"use client";

import type { ApplyGuardResult } from "@/lib/takeoff/guards";
import type { TakeoffPreviewConversionResponse } from "@/lib/takeoff/client";
import type { TakeoffJobItem } from "@/lib/takeoff/types";

import { GuardPanel } from "./GuardPanel";
import { PreviewImpactCard } from "./PreviewImpactCard";
import { strategyDescription, strategyLabel, type TakeoffApplyStrategy } from "./shared";

export function TakeoffApplyWizardConfirmationStep({
  guardBlocking,
  guardResult,
  externalItems,
  isAdmin,
  isVerifying,
  overrideJustification,
  onVerifyAll,
  onVerifyItem,
  onReturnToReview,
  onOverrideJustificationChange,
  onOverrideConfirm,
  isLevelC,
  previewData,
  includedCount,
  totalExcludedCount,
  overrideCount,
  targetVersionLabel,
  selectedSectionLabel,
  strategy,
  sourceFileName,
  hasPreviewReady,
}: {
  guardBlocking: boolean;
  guardResult: ApplyGuardResult | null;
  externalItems?: TakeoffJobItem[];
  isAdmin: boolean;
  isVerifying: boolean;
  overrideJustification: string;
  onVerifyAll: () => void;
  onVerifyItem: (itemId: string) => void;
  onReturnToReview?: () => void;
  onOverrideJustificationChange: (value: string) => void;
  onOverrideConfirm: () => void;
  isLevelC: boolean;
  previewData: TakeoffPreviewConversionResponse | null;
  includedCount: number;
  totalExcludedCount: number;
  overrideCount: number;
  targetVersionLabel?: string | null;
  selectedSectionLabel: string;
  strategy: TakeoffApplyStrategy;
  sourceFileName?: string | null;
  hasPreviewReady: boolean;
}) {
  return (
    <div className="space-y-4">
      {guardBlocking && guardResult && externalItems && (
        <GuardPanel
          guardResult={guardResult}
          items={externalItems}
          isAdmin={isAdmin}
          isVerifying={isVerifying}
          overrideJustification={overrideJustification}
          onVerifyAll={onVerifyAll}
          onVerifyItem={onVerifyItem}
          onReturnToReview={onReturnToReview}
          onOverrideJustificationChange={onOverrideJustificationChange}
          onOverrideConfirm={onOverrideConfirm}
        />
      )}

      {isLevelC &&
        guardResult &&
        guardResult.passed &&
        guardResult.medium_items.length > 0 && (
          <div className="rounded-xl border border-[var(--info)] bg-info-light p-3">
            <p className="text-xs font-semibold text-[var(--info)]">
              Items confiance moyenne (non bloquants)
            </p>
            <p className="mt-1 text-xs text-[var(--slate-600)]">
              {guardResult.medium_items.length} item(s) ont une confiance
              moyenne (50-80%). Verification recommandee mais non obligatoire.
            </p>
          </div>
        )}

      {!guardBlocking && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--success)]/20 bg-[var(--success)]/5 p-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--success)]">
              Confirmation finale
            </p>
            <p className="mt-2 text-sm font-semibold text-[var(--slate-800)]">
              Verifiez une derniere fois l&apos;impact avant d&apos;ecrire dans le devis.
            </p>
            <p className="mt-1 text-sm text-[var(--slate-600)]">
              L&apos;application reste manuelle. Rien n&apos;est injecte tant que vous ne confirmez pas.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <PreviewImpactCard
              label="Items retenus"
              value={previewData?.summary.included_count ?? includedCount}
              hint="lignes pretes a partir dans le devis"
            />
            <PreviewImpactCard
              label="Items exclus"
              value={totalExcludedCount}
              hint="laisses hors apply"
            />
            <PreviewImpactCard
              label="Overrides"
              value={overrideCount}
              hint="ajustements manuels qui seront envoyes"
            />
            <PreviewImpactCard
              label="Assemblages"
              value={previewData?.summary.assembly_insertions_count ?? 0}
              hint="insertions d'assemblage detectees"
            />
          </div>

          <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4 text-sm">
            <p className="font-semibold text-[var(--slate-800)]">Recapitulatif</p>
            <p className="mt-2 text-[var(--slate-700)]">
              Version cible: {targetVersionLabel ?? "brouillon actuellement ouvert"}
              {targetVersionLabel ? " (brouillon)" : ""}
            </p>
            <p className="mt-1 text-[var(--slate-700)]">Section cible: {selectedSectionLabel}</p>
            <p className="mt-1 text-[var(--slate-700)]">
              Strategie: {strategyLabel(strategy)} - {strategyDescription(strategy)}
            </p>
            <p className="mt-1 text-[var(--slate-700)]">
              Source du metre: <strong>{sourceFileName ?? "job takeoff"}</strong>
            </p>
            <p className="mt-1 text-[var(--slate-700)]">
              Provenance visible: fichier source et page takeoff quand ils sont disponibles.
            </p>
          </div>
        </div>
      )}

      {includedCount === 0 && (
        <div className="alert alert-info">
          Aucun item inclus n&apos;est disponible pour application.
        </div>
      )}

      {!hasPreviewReady && !guardBlocking && (
        <div className="alert alert-error">
          Une preview valide est requise avant confirmation.
        </div>
      )}
    </div>
  );
}
