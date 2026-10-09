"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  confirmUnifiedImportFlow,
  getUnifiedImportFlowTakeoffCarryOverPreview,
  type ConfirmUnifiedImportFlowResult,
} from "@/app/dashboard/affaires/_actions/import-flow";
import type { ColumnMapping } from "@/components/mappings/ColumnMapper";

import { getTakeoffCarryOverPreviewCopy } from "./takeoffPreview";
import type {
  MappingValidation,
  StructureDecision,
  StructurePreviewData,
} from "./types";
import { CheckIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type ConfirmationStepProps = {
  importId: string;
  projectId: string;
  mapping: ColumnMapping;
  validation: MappingValidation | null;
  onBack?: () => void;
  structurePreview: StructurePreviewData | null;
  structurePlan: { decisions: StructureDecision[] };
  onResultReady?: (result: ConfirmUnifiedImportFlowResult) => void;
  onSuccess: (result: ConfirmUnifiedImportFlowResult) => void;
};

export function ConfirmationStep({
  importId,
  projectId,
  mapping,
  validation,
  onBack,
  onSuccess,
  structurePreview,
  structurePlan,
  onResultReady,
}: ConfirmationStepProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmationResult, setConfirmationResult] =
    useState<ConfirmUnifiedImportFlowResult | null>(null);
  const [carryOverPreview, setCarryOverPreview] = useState<Awaited<
    ReturnType<typeof getUnifiedImportFlowTakeoffCarryOverPreview>
  > | null>(null);
  const [previewSourceVersionId, setPreviewSourceVersionId] = useState<
    string | null | undefined
  >(undefined);
  const [isCarryOverPreviewLoading, setIsCarryOverPreviewLoading] = useState(true);
  const carryOverPreviewRequestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++carryOverPreviewRequestIdRef.current;

    setIsCarryOverPreviewLoading(true);
    setPreviewSourceVersionId(undefined);

    void getUnifiedImportFlowTakeoffCarryOverPreview({ projectId })
      .then((result) => {
        if (cancelled || carryOverPreviewRequestIdRef.current !== requestId) {
          return;
        }

        setCarryOverPreview(result);
        setPreviewSourceVersionId(result.sourceVersionId);
      })
      .catch(() => {
        if (cancelled || carryOverPreviewRequestIdRef.current !== requestId) {
          return;
        }

        setCarryOverPreview({
          sourceVersionId: null,
          sourceVersionNumber: null,
          state: "unavailable",
          totalJobs: 0,
          acquiredJobs: 0,
          inProgressJobs: 0,
          actionRequiredJobs: 0,
        });
        setPreviewSourceVersionId(undefined);
      })
      .finally(() => {
        if (!cancelled && carryOverPreviewRequestIdRef.current === requestId) {
          setIsCarryOverPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleConfirm = useCallback(
    async (createEstimate: boolean) => {
      setIsConfirming(true);
      setConfirmError(null);

      try {
        const result = await confirmUnifiedImportFlow({
          importId,
          projectId,
          mapping,
          createEstimate,
          previewSourceVersionId,
          structurePlan,
        });

        setConfirmationResult(result);
        onResultReady?.(result);
      } catch (err) {
        setConfirmError(
          err instanceof Error
            ? err.message
            : "Erreur lors de la confirmation.",
        );
      } finally {
        setIsConfirming(false);
      }
    },
    [importId, mapping, onResultReady, previewSourceVersionId, projectId, structurePlan],
  );

  const carryOverPreviewCopy =
    carryOverPreview !== null ? getTakeoffCarryOverPreviewCopy(carryOverPreview) : null;
  const selectedSectionCount = structurePlan.decisions.filter(
    (decision) => decision.kind === "section",
  ).length;

  if (confirmationResult) {
    const isVersionCreated = confirmationResult.mode === "version_created";
    const primaryCount = isVersionCreated
      ? confirmationResult.stats.insertedRows
      : confirmationResult.stats.validRows;
    const rejectedCount = confirmationResult.stats.invalidRows;
    const ignoredCount = confirmationResult.stats.ignoredRows ?? 0;

    return (
      <div
        className="rounded-lg border border-border bg-surface shadow-card border border-success/25 p-6"
        role="status"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success-light text-success">
            <CheckIcon strokeWidth="2.5" aria-hidden="true" size={18} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {isVersionCreated ? "Devis créé" : "Mapping enregistré"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Le résultat de l&apos;import est disponible avant de continuer.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border border-success-border bg-success-subtle px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-success">
              {isVersionCreated ? "Lignes créées" : "Lignes prêtes"}
            </p>
            <p className="mt-1 text-2xl font-semibold text-success">
              {primaryCount}
            </p>
          </div>
          <div className="rounded-xl border border-warning-border bg-warning-subtle px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-warning">
              Lignes rejetées
            </p>
            <p className="mt-1 text-2xl font-semibold text-warning">
              {rejectedCount}
            </p>
          </div>
          <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-orange-700">
              Lignes ignorées
            </p>
            <p className="mt-1 text-2xl font-semibold text-orange-800">
              {ignoredCount}
            </p>
          </div>
          <div className="rounded-xl border border-info-border bg-info-subtle px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-info">
              Sections créées
            </p>
            <p className="mt-1 text-2xl font-semibold text-info">
              {confirmationResult.stats.insertedSections ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface-subtle px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Lignes à 0 €
            </p>
            <p className="mt-1 text-2xl font-semibold text-foreground">
              {confirmationResult.stats.zeroPriceRows ?? 0}
            </p>
          </div>
        </div>

        {isVersionCreated && (
          <p className="mt-4 text-xs text-muted-foreground">
            Les lignes sans quantité ou avec une quantité égale à 0 sont conservées.
            Leur total reste à 0 jusqu&apos;à la saisie d&apos;une quantité.
          </p>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            className={buttonVariants({ variant: "primary", size: "lg" })}
            onClick={() => onSuccess(confirmationResult)}
          >
            Continuer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface shadow-card p-6">
      <h3 className="text-sm font-semibold text-foreground">
        Confirmation
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Vérifiez le résumé avant de continuer.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface-subtle px-4 py-3">
          <p className="text-micro uppercase tracking-wide text-muted-foreground">
            Champs mappes
          </p>
          <p className="mt-1 text-lg font-semibold text-foreground">
            {validation?.mapped_targets_count ?? "-"}
          </p>
        </div>
        <div
          className={`rounded-xl border px-4 py-3 ${
            validation?.is_valid
              ? "border-success bg-success-subtle"
              : "border-border bg-surface-subtle"
          }`}
        >
          <p className="text-micro uppercase tracking-wide text-muted-foreground">
            Validation
          </p>
          <p
            className={`mt-1 text-sm font-semibold ${
              validation?.is_valid
                ? "text-success"
                : "text-foreground"
            }`}
          >
            {validation?.is_valid ? "Prêt" : "Mapping en cours…"}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface-subtle px-4 py-3">
          <p className="text-micro uppercase tracking-wide text-muted-foreground">
            Champs manquants
          </p>
          <p className="mt-1 text-lg font-semibold text-foreground">
            {validation?.missing_required_fields.length ?? "-"}
          </p>
        </div>
      </div>

      <div className="mt-4">
        {structurePreview && (
          <div className="mt-4 rounded-xl border border-blue-100 bg-info-subtle/60 px-4 py-4">
            <p className="text-micro font-medium uppercase tracking-wide text-info">
              Structure source
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Sections retenues</p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {selectedSectionCount}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Lignes à 0 €</p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {structurePreview.summary.zero_price_rows}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pied de tableau ignoré</p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {structurePreview.summary.ignored_footer_rows}
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Le serveur revalidera les titres, leurs niveaux et les lignes de fin avant
              de créer la version.
            </p>
          </div>
        )}

        {isCarryOverPreviewLoading ? (
          <div className="rounded-xl border border-border bg-surface-subtle px-4 py-4 text-sm text-muted-foreground">
            Analyse du carry-over takeoff…
          </div>
        ) : carryOverPreview ? (
          <div
            className={`rounded-xl border px-4 py-4 ${carryOverPreviewCopy?.toneClassName ?? ""}`}
          >
            <p className="text-micro uppercase tracking-wide text-muted-foreground">
              Carry-over takeoff
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {carryOverPreviewCopy?.title}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {carryOverPreviewCopy?.description}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-white/60 bg-surface/70 px-3 py-2">
                <p className="text-micro uppercase tracking-wide text-muted-foreground">
                  Acquis
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {carryOverPreview.acquiredJobs}
                </p>
              </div>
              <div className="rounded-lg border border-white/60 bg-surface/70 px-3 py-2">
                <p className="text-micro uppercase tracking-wide text-muted-foreground">
                  En cours
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {carryOverPreview.inProgressJobs}
                </p>
              </div>
              <div className="rounded-lg border border-white/60 bg-surface/70 px-3 py-2">
                <p className="text-micro uppercase tracking-wide text-muted-foreground">
                  À relancer
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {carryOverPreview.actionRequiredJobs}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {confirmError && (
        <Alert variant="danger" className="mt-4">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-danger">
            <span>{confirmError}</span>
            <Button
              variant="link"
              size="sm"
              className="text-danger"
              onClick={() => setConfirmError(null)}
            >
              Réessayer
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {onBack && (
          <button
            type="button"
            className={cn(buttonVariants({ variant: "outline", size: "md" }))}
            disabled={isConfirming}
            onClick={onBack}
          >
            Retour
          </button>
        )}
        <div className="flex flex-1 flex-wrap justify-end gap-3">
          <button
            type="button"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
            disabled={isConfirming}
            onClick={() => void handleConfirm(false)}
          >
            Retour au hub
          </button>
          <button
            type="button"
            className={buttonVariants({ variant: "primary", size: "lg" })}
            disabled={isConfirming || isCarryOverPreviewLoading}
            onClick={() => void handleConfirm(true)}
          >
            {isConfirming ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Création…
              </span>
            ) : isCarryOverPreviewLoading ? (
              "Analyse du carry-over…"
            ) : (
              "Créer le chiffrage"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
