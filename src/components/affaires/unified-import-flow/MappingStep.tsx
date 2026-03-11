"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import type { ColumnMapping } from "@/components/mappings/ColumnMapper";
import type {
  MappingAutoValidation,
  MappingSuggestionConfidence,
  MappingTemplateExactMatch,
} from "@/lib/mappings/server";

import { fetchApi } from "./api";
import {
  TARGET_FIELDS,
  type MappingStepResult,
  type SuggestionsData,
} from "./types";

const LazyColumnMapper = dynamic(
  () =>
    import("@/components/mappings/ColumnMapper").then((mod) => ({
      default: mod.ColumnMapper,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="dashboard-card p-8 text-center text-sm text-[var(--slate-500)]">
        Chargement du mapping…
      </div>
    ),
  },
);

type MappingStepProps = {
  importId: string;
  isSimplified: boolean;
  initialMapping?: ColumnMapping;
  forceShowMapping?: boolean;
  onBack?: () => void;
  onNext: (result: MappingStepResult) => void;
};

export function MappingStep({
  importId,
  isSimplified,
  initialMapping,
  forceShowMapping,
  onBack,
  onNext,
}: MappingStepProps) {
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>(initialMapping ?? {});
  const [sampleValues, setSampleValues] = useState<Record<string, string[]>>({});
  const [confidenceBySource, setConfidenceBySource] = useState<
    Record<string, MappingSuggestionConfidence>
  >({});
  const [templateExactMatch, setTemplateExactMatch] =
    useState<MappingTemplateExactMatch | null>(null);
  const [autoValidation, setAutoValidation] = useState<MappingAutoValidation | null>(null);
  const [autoAdvanced, setAutoAdvanced] = useState(false);
  const [showMapping] = useState(forceShowMapping ?? false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasInitialMapping = Object.keys(initialMapping ?? {}).length > 0;

  const isMappingValid = useMemo(() => {
    const values = Object.values(mapping);
    if (values.length === 0) {
      return false;
    }

    const requiredFields = TARGET_FIELDS.filter(
      (field) => "required" in field && field.required,
    ).map((field) => field.value);
    const mappedTargets = new Set(values);
    const hasAllRequired = requiredFields.every((requiredField) =>
      mappedTargets.has(requiredField),
    );

    const targetCounts = new Map<string, number>();
    for (const target of values) {
      targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1);
    }
    const hasDuplicates = Array.from(targetCounts.values()).some((count) => count > 1);

    return hasAllRequired && !hasDuplicates;
  }, [mapping]);

  useEffect(() => {
    let cancelled = false;

    fetchApi<SuggestionsData>("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "suggestions", import_id: importId }),
    })
      .then((data) => {
        if (cancelled) {
          return;
        }

        setSourceColumns(data.source_columns ?? []);
        setSampleValues(data.sample_values ?? {});
        setMapping(hasInitialMapping ? (initialMapping ?? {}) : (data.suggestions ?? {}));
        setConfidenceBySource(data.confidence_by_source ?? {});
        setTemplateExactMatch(data.template_exact_match ?? null);
        setAutoValidation(data.auto_validation ?? null);

        if (isSimplified && data.auto_validation?.can_auto_validate === true) {
          setAutoAdvanced(true);
        }
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : "Impossible de charger les suggestions.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasInitialMapping, importId, initialMapping, isSimplified]);

  useEffect(() => {
    if (autoAdvanced && !showMapping && !isLoading && isMappingValid) {
      onNext({
        mapping,
        autoAdvanced: true,
        templateExactMatch,
      });
    }
  }, [autoAdvanced, isLoading, isMappingValid, mapping, onNext, showMapping, templateExactMatch]);

  if (isLoading) {
    return (
      <div className="dashboard-card p-8 text-center">
        <div className="mx-auto flex items-center justify-center gap-2">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]" />
          <span className="text-sm text-[var(--slate-500)]">
            Analyse des colonnes…
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="alert alert-error">{error}</div>;
  }

  if (autoAdvanced && !showMapping) {
    return null;
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

      {autoAdvanced && showMapping && autoValidation?.can_auto_validate && (
        <div
          className="rounded-xl border border-[var(--info)]/20 bg-[var(--info)]/5 px-4 py-3 text-sm text-[var(--slate-700)]"
          role="status"
          aria-label="Mapping automatique applique"
        >
          <p className="font-medium">Mapping automatique applique</p>
          <p className="mt-0.5 text-xs text-[var(--slate-500)]">
            Vous avez choisi de modifier le mapping. Verifiez et ajustez les correspondances ci-dessous.
          </p>
        </div>
      )}

      <LazyColumnMapper
        sourceColumns={sourceColumns}
        mapping={mapping}
        targetFields={[...TARGET_FIELDS]}
        sampleValues={sampleValues}
        confidenceBySource={confidenceBySource}
        onChange={setMapping}
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
          disabled={!isMappingValid}
          onClick={() =>
            onNext({
              mapping,
              templateExactMatch,
            })
          }
        >
          <span className="flex items-center gap-2">
            Suivant : Apercu
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
