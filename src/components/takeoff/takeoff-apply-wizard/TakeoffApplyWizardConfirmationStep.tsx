"use client";

import type { ApplyGuardResult } from "@/lib/takeoff/guards";
import type { TakeoffPreviewConversionResponse } from "@/lib/takeoff/client";

import { GuardPanel } from "./GuardPanel";
import { PreviewImpactCard } from "./PreviewImpactCard";
import { strategyDescription, strategyLabel, type TakeoffApplyStrategy } from "./shared";

export function TakeoffApplyWizardConfirmationStep({
  guardBlocking,
  guardResult,
  isAdmin,
  canOverride,
  overrideJustification,
  onReturnToReview,
  reviewHref,
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
  isAdmin: boolean;
  canOverride: boolean;
  overrideJustification: string;
  onReturnToReview?: () => void;
  reviewHref?: string;
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
      {guardBlocking && guardResult && (
        <GuardPanel
          guardResult={guardResult}
          isAdmin={isAdmin}
          canOverride={canOverride}
          overrideJustification={overrideJustification}
          onReturnToReview={onReturnToReview}
          reviewHref={reviewHref}
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
              Confiance moyenne (non bloquante)
            </p>
            <p className="mt-1 text-xs text-[var(--slate-600)]">
              {guardResult.medium_items.length} item
              {guardResult.medium_items.length > 1 ? "s ont" : " a"} un score
              compris entre {Math.round(guardResult.threshold * 100)} % et moins
              de 80 %. Un contrôle humain reste recommandé.
            </p>
          </div>
        )}

      <div className="space-y-4">
        <div
          className={`rounded-xl border p-4 text-sm ${
            guardBlocking
              ? "border-[var(--warning)] bg-warning-light"
              : "border-[var(--success)]/20 bg-[var(--success)]/5"
          }`}
        >
          <p
            className={`text-xs font-semibold uppercase tracking-[0.16em] ${
              guardBlocking ? "text-[var(--warning)]" : "text-[var(--success)]"
            }`}
          >
            {guardBlocking ? "Impact avant dérogation" : "Confirmation finale"}
          </p>
          <p className="mt-2 text-sm font-semibold text-[var(--slate-800)]">
            Vérifiez une dernière fois l&apos;impact avant d&apos;écrire dans le devis.
          </p>
          <p className="mt-1 text-sm text-[var(--slate-600)]">
            {guardBlocking
              ? "Les blocages restent actifs. Cet aperçu décrit néanmoins l’impact exact d’une éventuelle dérogation."
              : "L’application reste manuelle. Rien n’est injecté tant que vous ne confirmez pas."}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <PreviewImpactCard
            label="Items retenus"
            value={previewData?.summary.included_count ?? includedCount}
            hint="lignes prêtes à partir dans le devis"
          />
          <PreviewImpactCard
            label="Items exclus"
            value={totalExcludedCount}
            hint="laissés hors application"
          />
          <PreviewImpactCard
            label="Ajustements"
            value={overrideCount}
            hint="modifications manuelles qui seront envoyées"
          />
          <PreviewImpactCard
            label="Ouvrages"
            value={previewData?.summary.assembly_insertions_count ?? 0}
            hint="insertions d’ouvrage détectées"
          />
        </div>

        <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4 text-sm">
          <p className="font-semibold text-[var(--slate-800)]">Récapitulatif</p>
          <p className="mt-2 text-[var(--slate-700)]">
            Version cible : {targetVersionLabel ?? "brouillon actuellement ouvert"}
            {targetVersionLabel ? " (brouillon)" : ""}
          </p>
          <p className="mt-1 text-[var(--slate-700)]">
            Section cible : {selectedSectionLabel}
          </p>
          <p className="mt-1 text-[var(--slate-700)]">
            Stratégie : {strategyLabel(strategy)} — {strategyDescription(strategy)}
          </p>
          <p className="mt-1 text-[var(--slate-700)]">
            Source du métré : <strong>{sourceFileName ?? "job de métré"}</strong>
          </p>
          <p className="mt-1 text-[var(--slate-700)]">
            Provenance attendue : fichier, preuve extraite et page source pour chaque item de niveau C.
          </p>
        </div>
      </div>

      {includedCount === 0 && (
        <div className="alert alert-info">
          Aucun item inclus n&apos;est disponible pour application.
        </div>
      )}

      {!hasPreviewReady && (
        <div className="alert alert-error" role="alert">
          Un aperçu d&apos;impact à jour est requis avant toute application ou dérogation.
        </div>
      )}
    </div>
  );
}
