"use client";

import dynamic from "next/dynamic";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import {
  previewUnifiedImportFlowLines,
  type ImportFlowLinesPreview,
} from "@/app/dashboard/affaires/_actions/import-flow";
import type { ColumnMapping } from "@/components/mappings/ColumnMapper";
import type { MappingTemplateExactMatch } from "@/lib/mappings/server";

import {
  buildDefaultStructureDecisions,
  getStructureReviewError,
  StructureReview,
} from "./StructureReview";
import { fetchApi } from "./api";
import { ImportLinesPreview } from "./ImportLinesPreview";
import {
  mappingNeedsLinesPreview,
  type DuplicatesSummary,
  type MappingPreviewRow,
  type MappingValidation,
  type PreviewData,
  type PreviewStepResult,
  type StructureDecision,
  type StructurePreviewData,
} from "./types";
import { ArrowRightIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

const LazyDataPreview = dynamic(
  () =>
    import("@/components/mappings/DataPreview").then((mod) => ({
      default: mod.DataPreview,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-lg border border-border bg-surface shadow-card p-8 text-center text-sm text-muted-foreground">
        Chargement de l&apos;aperçu…
      </div>
    ),
  },
);

type PreviewStepProps = {
  importId: string;
  projectId: string;
  mapping: ColumnMapping;
  wasAutoAdvanced?: boolean;
  templateExactMatch?: MappingTemplateExactMatch | null;
  onEditMapping?: () => void;
  onBack?: () => void;
  onNext: (data: PreviewStepResult) => void;
};

export function PreviewStep({
  importId,
  projectId,
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
  const needsLinesPreview = mappingNeedsLinesPreview(mapping);
  const [linesPreview, setLinesPreview] = useState<ImportFlowLinesPreview | null>(null);
  const [isLinesPreviewLoading, setIsLinesPreviewLoading] = useState(needsLinesPreview);
  const [linesPreviewError, setLinesPreviewError] = useState<string | null>(null);
  const [linesPreviewAttempt, setLinesPreviewAttempt] = useState(0);
  // undefined: the server resolves the role from the workbook rate; null: explicitly none.
  const [selectedLaborRoleId, setSelectedLaborRoleId] = useState<string | null | undefined>(undefined);
  const [selectedSaleCoefficients, setSelectedSaleCoefficients] = useState<
    { fo: number; mo: number } | undefined
  >(undefined);
  const linesRequestIdRef = useRef(0);

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

  useEffect(() => {
    if (!needsLinesPreview) {
      setLinesPreview(null);
      setIsLinesPreviewLoading(false);
      return;
    }

    let cancelled = false;
    const requestId = ++linesRequestIdRef.current;
    setIsLinesPreviewLoading(true);
    setLinesPreviewError(null);

    previewUnifiedImportFlowLines({
      importId,
      projectId,
      mapping,
      ...(selectedLaborRoleId === undefined ? {} : { laborRoleId: selectedLaborRoleId }),
      ...(selectedSaleCoefficients === undefined ? {} : { saleCoefficients: selectedSaleCoefficients }),
    })
      .then((data) => {
        if (cancelled || linesRequestIdRef.current !== requestId) return;
        setLinesPreview(data);
      })
      .catch((err) => {
        if (cancelled || linesRequestIdRef.current !== requestId) return;
        setLinesPreviewError(
          err instanceof Error ? err.message : "Impossible de calculer l'aperçu des lignes.",
        );
      })
      .finally(() => {
        if (!cancelled && linesRequestIdRef.current === requestId) {
          setIsLinesPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [importId, linesPreviewAttempt, mapping, needsLinesPreview, projectId, selectedLaborRoleId, selectedSaleCoefficients]);

  const roleChoiceRequired =
    needsLinesPreview && linesPreview?.laborRole.status === "choice_required";
  const resolvedLaborRoleId =
    selectedLaborRoleId !== undefined
      ? selectedLaborRoleId
      : linesPreview?.laborRole.status === "resolved"
        ? linesPreview.laborRole.roleId
        : undefined;
  // Sub-lot 2.8: the coefficients the preview priced with are those the v3 is created with.
  const resolvedSaleCoefficients =
    selectedSaleCoefficients ??
    (linesPreview?.saleCoefficients
      ? { fo: linesPreview.saleCoefficients.fo, mo: linesPreview.saleCoefficients.mo }
      : undefined);
  const isLinesPreviewBlocking =
    needsLinesPreview && (isLinesPreviewLoading || linesPreviewError !== null || roleChoiceRequired);

  const structureValidationError = getStructureReviewError(
    structurePreview,
    structureDecisions,
  );

  if (error || structureError) {
    return (
      <Alert variant="danger">
        <AlertDescription className="text-danger">{error ?? structureError}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {templateExactMatch && (
        <div
          className="rounded-xl border border-success/20 bg-success-subtle px-4 py-3 text-sm text-success"
          role="status"
          aria-label={`Mapping applique depuis le template ${templateExactMatch.name}`}
        >
          <p className="font-medium">
            Mapping applique depuis le template &laquo;{templateExactMatch.name}&raquo;
            {templateExactMatch.supplier_name && (
              <span className="ml-1 font-normal text-success">
                ({templateExactMatch.supplier_name})
              </span>
            )}
          </p>
        </div>
      )}

      {wasAutoAdvanced && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-info/20 bg-info/5 px-4 py-3 text-sm text-foreground-secondary"
          role="status"
          aria-label="Mapping automatique applique"
        >
          <div>
            <p className="font-medium">Mapping automatique applique</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Les colonnes ont été associées automatiquement avec une confiance élevée.
            </p>
          </div>
          {onEditMapping && (
            <button
              type="button"
              className={cn(buttonVariants({ variant: "outline", size: "md" }))}
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

      {needsLinesPreview ? (
        <ImportLinesPreview
          preview={linesPreview}
          isLoading={isLinesPreviewLoading}
          error={linesPreviewError}
          selectedLaborRoleId={selectedLaborRoleId}
          onLaborRoleChange={setSelectedLaborRoleId}
          onSaleCoefficientsChange={setSelectedSaleCoefficients}
          onRetry={() => setLinesPreviewAttempt((attempt) => attempt + 1)}
        />
      ) : null}

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
          <button type="button" className={cn(buttonVariants({ variant: "outline", size: "md" }))} onClick={onBack}>
            Retour
          </button>
        ) : (
          <div />
        )}
        <button
          type="button"
          className={buttonVariants({ variant: "primary", size: "lg" })}
          disabled={
            isLoading ||
            isStructureLoading ||
            structureValidationError !== null ||
            isLinesPreviewBlocking
          }
          onClick={() =>
            startTransition(() =>
              onNext({
                rows,
                validation,
                duplicates,
                structurePreview: structurePreview!,
                structurePlan: { decisions: structureDecisions },
                ...(resolvedLaborRoleId === undefined ? {} : { laborRoleId: resolvedLaborRoleId }),
                ...(resolvedSaleCoefficients === undefined ? {} : { saleCoefficients: resolvedSaleCoefficients }),
              }),
            )
          }
        >
          <span className="flex items-center gap-2">
            Suivant : Confirmation
            <ArrowRightIcon aria-hidden="true" size={16} />
          </span>
        </button>
      </div>
    </div>
  );
}
