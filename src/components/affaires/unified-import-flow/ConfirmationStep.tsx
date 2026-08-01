"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  confirmUnifiedImportFlow,
  getUnifiedImportFlowTakeoffCarryOverPreview,
  type ConfirmUnifiedImportFlowResult,
} from "@/app/dashboard/affaires/_actions/import-flow";
import type { ColumnMapping } from "@/components/mappings/ColumnMapper";

import { getTakeoffCarryOverPreviewCopy } from "./takeoffPreview";
import type { MappingValidation } from "./types";

type ConfirmationStepProps = {
  importId: string;
  projectId: string;
  mapping: ColumnMapping;
  validation: MappingValidation | null;
  onBack?: () => void;
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
    [importId, mapping, onResultReady, previewSourceVersionId, projectId],
  );

  const carryOverPreviewCopy =
    carryOverPreview !== null ? getTakeoffCarryOverPreviewCopy(carryOverPreview) : null;

  if (confirmationResult) {
    const isVersionCreated = confirmationResult.mode === "version_created";
    const primaryCount = isVersionCreated
      ? confirmationResult.stats.insertedRows
      : confirmationResult.stats.validRows;
    const rejectedCount = isVersionCreated
      ? confirmationResult.stats.skippedRows
      : confirmationResult.stats.invalidRows;

    return (
      <div
        className="dashboard-card border border-[var(--success)]/25 p-6"
        role="status"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--slate-900)]">
              {isVersionCreated ? "Devis créé" : "Mapping enregistré"}
            </h3>
            <p className="mt-1 text-sm text-[var(--slate-600)]">
              Le résultat de l&apos;import est disponible avant de continuer.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
              {isVersionCreated ? "Lignes créées" : "Lignes prêtes"}
            </p>
            <p className="mt-1 text-2xl font-semibold text-emerald-800">
              {primaryCount}
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
              Lignes rejetées
            </p>
            <p className="mt-1 text-2xl font-semibold text-amber-800">
              {rejectedCount}
            </p>
          </div>
        </div>

        {isVersionCreated && (
          <p className="mt-4 text-xs text-[var(--slate-500)]">
            Les lignes sans quantité ou avec une quantité égale à 0 sont conservées.
            Leur total reste à 0 jusqu&apos;à la saisie d&apos;une quantité.
          </p>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onSuccess(confirmationResult)}
          >
            Continuer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-card p-6">
      <h3 className="text-sm font-semibold text-[var(--slate-800)]">
        Confirmation
      </h3>
      <p className="mt-1 text-xs text-[var(--slate-500)]">
        Verifiez le resume avant de continuer.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">
            Champs mappes
          </p>
          <p className="mt-1 text-lg font-semibold text-[var(--slate-800)]">
            {validation?.mapped_targets_count ?? "-"}
          </p>
        </div>
        <div
          className={`rounded-xl border px-4 py-3 ${
            validation?.is_valid
              ? "border-[var(--success)] bg-emerald-50"
              : "border-[var(--slate-200)] bg-[var(--slate-50)]"
          }`}
        >
          <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">
            Validation
          </p>
          <p
            className={`mt-1 text-sm font-semibold ${
              validation?.is_valid
                ? "text-emerald-700"
                : "text-[var(--slate-800)]"
            }`}
          >
            {validation?.is_valid ? "Pret" : "Mapping en cours…"}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">
            Champs manquants
          </p>
          <p className="mt-1 text-lg font-semibold text-[var(--slate-800)]">
            {validation?.missing_required_fields.length ?? "-"}
          </p>
        </div>
      </div>

      <div className="mt-4">
        {isCarryOverPreviewLoading ? (
          <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-4 text-sm text-[var(--slate-500)]">
            Analyse du carry-over takeoff…
          </div>
        ) : carryOverPreview ? (
          <div
            className={`rounded-xl border px-4 py-4 ${carryOverPreviewCopy?.toneClassName ?? ""}`}
          >
            <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">
              Carry-over takeoff
            </p>
            <p className="mt-1 text-sm font-semibold text-[var(--slate-900)]">
              {carryOverPreviewCopy?.title}
            </p>
            <p className="mt-1 text-sm text-[var(--slate-600)]">
              {carryOverPreviewCopy?.description}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-white/60 bg-white/70 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">
                  Acquis
                </p>
                <p className="mt-1 text-lg font-semibold text-[var(--slate-900)]">
                  {carryOverPreview.acquiredJobs}
                </p>
              </div>
              <div className="rounded-lg border border-white/60 bg-white/70 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">
                  En cours
                </p>
                <p className="mt-1 text-lg font-semibold text-[var(--slate-900)]">
                  {carryOverPreview.inProgressJobs}
                </p>
              </div>
              <div className="rounded-lg border border-white/60 bg-white/70 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">
                  A relancer
                </p>
                <p className="mt-1 text-lg font-semibold text-[var(--slate-900)]">
                  {carryOverPreview.actionRequiredJobs}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {confirmError && (
        <div className="alert alert-error mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{confirmError}</span>
            <button
              type="button"
              className="btn btn-sm font-medium underline underline-offset-2 hover:no-underline"
              onClick={() => setConfirmError(null)}
            >
              Reessayer
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {onBack && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={isConfirming}
            onClick={onBack}
          >
            Retour
          </button>
        )}
        <div className="flex flex-1 flex-wrap justify-end gap-3">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={isConfirming}
            onClick={() => void handleConfirm(false)}
          >
            Retour au hub
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={isConfirming || isCarryOverPreviewLoading}
            onClick={() => void handleConfirm(true)}
          >
            {isConfirming ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Creation…
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
