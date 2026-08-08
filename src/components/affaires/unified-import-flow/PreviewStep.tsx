"use client";

import dynamic from "next/dynamic";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import type { ColumnMapping } from "@/components/mappings/ColumnMapper";
import type { MappingTemplateExactMatch } from "@/lib/mappings/server";

import {
  buildDefaultStructureDecisions,
  getStructureReviewError,
  StructureReview,
} from "./StructureReview";
import { fetchApi } from "./api";
import type {
  DuplicatesSummary,
  MappingPreviewRow,
  MappingValidation,
  PreviewData,
  PreviewStepResult,
  StructureDecision,
  StructurePreviewData,
} from "./types";

const LazyDataPreview = dynamic(
  () =>
    import("@/components/mappings/DataPreview").then((mod) => ({
      default: mod.DataPreview,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="dashboard-card p-8 text-center text-sm text-[var(--slate-500)]">
        Chargement de l&apos;apercu…
      </div>
    ),
  },
);

type PreviewStepProps = {
  importId: string;
  mapping: ColumnMapping;
  wasAutoAdvanced?: boolean;
  templateExactMatch?: MappingTemplateExactMatch | null;
  onEditMapping?: () => void;
  onBack?: () => void;
  onNext: (data: PreviewStepResult) => void;
};

export function PreviewStep({
  importId,
  mapping,
  wasAutoAdvanced,
  templateExactMatch,
  onEditMapping,
  onBack,
  onNext,
}: PreviewStepProps) {
  const [rows, setRows] = useState<MappingPreviewRow[]>([]);
  const [validation, setValidation] = useState<MappingValidation | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicatesSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewLimit, setPreviewLimit] = useState(50);
  const requestIdRef = useRef(0);
  const [structurePreview, setStructurePreview] =
    useState<StructurePreviewData | null>(null);
  const [structureDecisions, setStructureDecisions] = useState<StructureDecision[]>([]);
  const [isStructureLoading, setIsStructureLoading] = useState(true);
  const [structureError, setStructureError] = useState<string | null>(null);
  const structureRequestIdRef = useRef(0);

  const handlePreviewLimitChange = useCallback((limit: number) => {
    setPreviewLimit(limit);
    setIsLoading(true);
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++requestIdRef.current;

    fetchApi<PreviewData>("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "preview",
        import_id: importId,
        mapping,
        limit: previewLimit,
      }),
    })
      .then((data) => {
        if (cancelled || requestIdRef.current !== requestId) {
          return;
        }

        setRows(data.rows ?? []);
        setValidation(data.validation ?? null);
        setDuplicates(data.duplicates ?? null);
      })
      .catch((err) => {
        if (cancelled || requestIdRef.current !== requestId) {
          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : "Impossible de charger l'aperçu.",
        );
      })
      .finally(() => {
        if (!cancelled && requestIdRef.current === requestId) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [importId, mapping, previewLimit]);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++structureRequestIdRef.current;

    setIsStructureLoading(true);
    setStructureError(null);

    fetchApi<StructurePreviewData>("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "structure-preview",
        import_id: importId,
        mapping,
      }),
    })
      .then((data) => {
        if (cancelled || structureRequestIdRef.current !== requestId) {
          return;
        }

        setStructurePreview(data);
        setStructureDecisions(buildDefaultStructureDecisions(data));
      })
      .catch((err) => {
        if (cancelled || structureRequestIdRef.current !== requestId) {
          return;
        }

        setStructureError(
          err instanceof Error
            ? err.message
            : "Impossible de charger la structure du DPGF.",
        );
      })
      .finally(() => {
        if (!cancelled && structureRequestIdRef.current === requestId) {
          setIsStructureLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [importId, mapping]);

  const structureValidationError = getStructureReviewError(
    structurePreview,
    structureDecisions,
  );

  if (error || structureError) {
    return <div className="alert alert-error">{error ?? structureError}</div>;
  }

  return (
    <div className="space-y-4">
      {templateExactMatch && (
        <div
          className="rounded-xl border border-[var(--success)]/20 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          role="status"
          aria-label={`Mapping applique depuis le template ${templateExactMatch.name}`}
        >
          <p className="font-medium">
            Mapping applique depuis le template &laquo;{templateExactMatch.name}&raquo;
            {templateExactMatch.supplier_name && (
              <span className="ml-1 font-normal text-emerald-600">
                ({templateExactMatch.supplier_name})
              </span>
            )}
          </p>
        </div>
      )}

      {wasAutoAdvanced && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--info)]/20 bg-[var(--info)]/5 px-4 py-3 text-sm text-[var(--slate-700)]"
          role="status"
          aria-label="Mapping automatique applique"
        >
          <div>
            <p className="font-medium">Mapping automatique applique</p>
            <p className="mt-0.5 text-xs text-[var(--slate-500)]">
              Les colonnes ont ete associees automatiquement avec une confiance elevee.
            </p>
          </div>
          {onEditMapping && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onEditMapping}
            >
              Modifier le mapping
            </button>
          )}
        </div>
      )}
      <StructureReview
        preview={structurePreview}
        decisions={structureDecisions}
        isLoading={isStructureLoading}
        onChange={setStructureDecisions}
      />

      <LazyDataPreview
        rows={rows}
        validation={validation}
        duplicates={duplicates}
        isLoading={isLoading}
        previewLimit={previewLimit}
        onPreviewLimitChange={handlePreviewLimitChange}
      />

      <div className="flex items-center justify-between">
        {onBack ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
            Retour
          </button>
        ) : (
          <div />
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={isLoading || isStructureLoading || structureValidationError !== null}
          onClick={() =>
            startTransition(() =>
              onNext({
                rows,
                validation,
                duplicates,
                structurePreview: structurePreview!,
                structurePlan: { decisions: structureDecisions },
              }),
            )
          }
        >
          <span className="flex items-center gap-2">
            Suivant : Confirmation
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </span>
        </button>
      </div>
    </div>
  );
}
