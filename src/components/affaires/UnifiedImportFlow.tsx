"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  confirmUnifiedImportFlow,
  getUnifiedImportFlowTakeoffCarryOverPreview,
  type ConfirmUnifiedImportFlowResult,
} from "@/app/dashboard/affaires/_actions/import-flow";
import type { ColumnMapping } from "@/components/mappings/ColumnMapper";
import { useImportFlow } from "@/hooks/useImportFlow";
import { useUiMode } from "@/hooks/useUiMode";
import type {
  MappingAutoValidation,
  MappingSuggestionConfidence,
  MappingTemplateExactMatch,
} from "@/lib/mappings/server";
import type { TakeoffCarryOverSummary } from "@/lib/takeoff/types";

/* ------------------------------------------------------------------ */
/*  Dynamic imports for heavy sub-components (bundle-conditional)      */
/* ------------------------------------------------------------------ */

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

const LazyPlansStep = dynamic(
  () =>
    import("@/components/affaires/PlansStep").then((mod) => ({
      default: mod.PlansStep,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="dashboard-card p-8 text-center text-sm text-[var(--slate-500)]">
        Chargement…
      </div>
    ),
  },
);

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

type Step = "upload" | "mapping" | "preview" | "confirmation" | "plans";

const STEPPER_STEPS_BASE = ["upload", "mapping", "preview", "confirmation"] as const;
const STEPPER_STEPS_WITH_PLANS = ["upload", "mapping", "preview", "confirmation", "plans"] as const;

const STEP_LABELS: Record<Step, string> = {
  upload: "Upload",
  mapping: "Mapping",
  preview: "Apercu",
  confirmation: "Confirmation",
  plans: "Plans",
};

const ACCEPTED_FILE_TYPES =
  ".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const VALID_EXTENSIONS = new Set(["csv", "xlsx", "xls"]);

const TARGET_FIELDS = [
  { value: "hex_code", label: "Reference article", required: true },
  { value: "designation", label: "Designation", required: true },
  { value: "quantity", label: "Quantite" },
  { value: "unit", label: "Unite" },
  { value: "unit_price_ht", label: "Prix unitaire HT" },
  { value: "total_ht", label: "Montant HT" },
  { value: "category", label: "Categorie" },
  { value: "supply_type", label: "Type FO" },
  { value: "supplier_ref", label: "Reference fournisseur" },
  { value: "labor_hours", label: "Heures MO" },
  { value: "h_mo_majoration", label: "Majoration MO" },
  { value: "notes", label: "Notes" },
] as const;

const TERMINAL_IMPORT_STATUSES = new Set([
  "parsed",
  "imported",
  "completed",
]);

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type MappingPreviewRow = {
  row_index: number;
  raw_row: Record<string, unknown>;
  mapped_row: Record<string, unknown>;
  missing_required_fields: string[];
};

type MappingValidation = {
  is_valid: boolean;
  missing_required_fields: string[];
  duplicate_target_assignments: Array<{ target: string; sources: string[] }>;
  mapped_sources_count: number;
  mapped_targets_count: number;
};

type DuplicatesSummary = {
  total_groups: number;
  total_rows_impacted: number;
};

export type UnifiedImportFlowProps = {
  projectId: string;
  takeoffEnabled?: boolean;
  onCancel?: () => void;
  onComplete?: (result: ConfirmUnifiedImportFlowResult) => void;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getFileExtension(name: string): string | null {
  const ext = name.split(".").pop()?.trim().toLowerCase();
  return ext && ext.length > 0 ? ext : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getTakeoffCarryOverSourceLabel(summary: TakeoffCarryOverSummary): string | null {
  if (summary.sourceVersionNumber !== null) {
    return `V${summary.sourceVersionNumber}`;
  }

  if (summary.sourceVersionId) {
    return "version precedente";
  }

  return null;
}

function getTakeoffCarryOverPreviewCopy(summary: TakeoffCarryOverSummary): {
  toneClassName: string;
  title: string;
  description: string;
} {
  const sourceLabel = getTakeoffCarryOverSourceLabel(summary);

  if (summary.state === "not_applicable") {
    return {
      toneClassName: "border-[var(--slate-200)] bg-[var(--slate-50)]",
      title: "Aucun carry-over takeoff a reprendre",
      description:
        "Cette creation ne repart d'aucune version takeoff precedente.",
    };
  }

  if (summary.state === "empty") {
    return {
      toneClassName: "border-[var(--slate-200)] bg-[var(--slate-50)]",
      title: sourceLabel
        ? `Aucune analyse takeoff a reprendre depuis ${sourceLabel}`
        : "Aucune analyse takeoff a reprendre",
      description:
        "La version sera creee sans reprise takeoff existante.",
    };
  }

  if (summary.state === "unavailable") {
    return {
      toneClassName: "border-amber-200 bg-amber-50",
      title: "Etat de reprise takeoff indisponible",
      description:
        "Le carry-over n'est pas prouve ici. La version reste creable, mais la reprise devra etre verifiee apres creation.",
    };
  }

  if (summary.state === "ready") {
    return {
      toneClassName: "border-emerald-200 bg-emerald-50",
      title: sourceLabel
        ? `Carry-over takeoff pret depuis ${sourceLabel}`
        : "Carry-over takeoff pret",
      description:
        "Les analyses deja acquises restent visibles sur la nouvelle version.",
    };
  }

  return {
    toneClassName: "border-amber-200 bg-amber-50",
    title: sourceLabel
      ? `Carry-over takeoff a surveiller depuis ${sourceLabel}`
      : "Carry-over takeoff a surveiller",
    description:
      "Certaines analyses suivent, d'autres restent en cours ou devront etre relancees.",
  };
}

async function fetchApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = `Requete API en echec (HTTP ${response.status}).`;
    try {
      const payload = await response.json();
      const record = asRecord(payload);
      const nested = asRecord(record?.error);
      message =
        (nested && typeof nested.message === "string" ? nested.message : null) ??
        (record && typeof record.message === "string" ? record.message : null) ??
        message;
    } catch {
      /* keep default message */
    }
    throw new Error(message);
  }

  const payload = (await response.json()) as unknown;
  const record = asRecord(payload);
  if (!record || record.ok !== true) {
    const nested = asRecord(record?.error);
    const message =
      nested && typeof nested.message === "string"
        ? nested.message
        : "Reponse API invalide.";
    throw new Error(message);
  }
  return record.data as T;
}

type SuggestionsData = {
  suggestions: Record<string, string>;
  source_columns: string[];
  sample_values: Record<string, string[]>;
  confidence_by_source: Record<string, MappingSuggestionConfidence>;
  template_exact_match: MappingTemplateExactMatch | null;
  auto_validation: MappingAutoValidation;
};

type PreviewData = {
  source_columns: string[];
  validation: MappingValidation;
  rows: MappingPreviewRow[];
  duplicates: DuplicatesSummary;
};

/* ------------------------------------------------------------------ */
/*  Sub-component: Progress Header                                     */
/* ------------------------------------------------------------------ */

function ProgressHeader({ currentStep, steps }: { currentStep: Step; steps: readonly Step[] }) {
  const stepperIndex = steps.indexOf(currentStep);
  const currentIndex = stepperIndex >= 0 ? stepperIndex : steps.length;

  return (
    <nav className="flex items-center gap-1" aria-label="Progression import">
      {steps.map((step, index) => {
        const isDone = index < currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <div key={step} className="flex items-center gap-1">
            {index > 0 && (
              <div
                className={`hidden h-px w-6 sm:block ${
                  isDone ? "bg-[var(--success)]" : "bg-[var(--slate-200)]"
                }`}
              />
            )}
            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                isCurrent
                  ? "bg-[var(--brand-blue)] text-white"
                  : isDone
                    ? "bg-[var(--success)]/10 text-[var(--success)]"
                    : "bg-[var(--slate-100)] text-[var(--slate-400)]"
              }`}
            >
              {isDone ? (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <span>{index + 1}</span>
              )}
              <span className="hidden sm:inline">{STEP_LABELS[step]}</span>
              {step === "plans" && (
                <span className="ml-1 hidden text-[10px] font-normal opacity-70 sm:inline">
                  optionnel
                </span>
              )}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-component: Upload Step                                         */
/* ------------------------------------------------------------------ */

function UploadStep({
  projectId,
  onImportReady,
}: {
  projectId: string;
  onImportReady: (importId: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const {
    imports,
    isSubmitting,
    uploadProgress,
    isPolling,
    submitError,
    lastImportId,
    importFile,
  } = useImportFlow({ projectId });

  // Auto-advance when import is parsed/completed
  useEffect(() => {
    if (!lastImportId) return;
    const match = imports.find((i) => i.id === lastImportId);
    if (match && TERMINAL_IMPORT_STATUSES.has(match.status)) {
      onImportReady(lastImportId);
    }
  }, [lastImportId, imports, onImportReady]);

  const handleFileSelect = useCallback((file: File) => {
    setFileError(null);
    const ext = getFileExtension(file.name);
    if (!ext || !VALID_EXTENSIONS.has(ext)) {
      setFileError(
        `Le format .${ext ?? "inconnu"} n'est pas supporte. Utilisez CSV, XLSX ou XLS.`,
      );
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const handleSubmit = useCallback(async () => {
    if (!selectedFile || isSubmitting) return;
    const success = await importFile(selectedFile);
    if (success) {
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [selectedFile, isSubmitting, importFile]);

  const waitingForParse =
    Boolean(lastImportId) && !isSubmitting && isPolling;

  return (
    <div className="space-y-4">
      {/* Waiting for server parsing */}
      {waitingForParse ? (
        <div className="dashboard-card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-blue)]/10">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--brand-blue)]/30 border-t-[var(--brand-blue)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--slate-800)]">
                Traitement en cours…
              </p>
              <p className="mt-0.5 text-xs text-[var(--slate-500)]">
                Le serveur analyse votre fichier. Cela peut prendre quelques secondes.
              </p>
            </div>
          </div>
        </div>
      ) : (
        /* Dropzone */
        <div className="dashboard-card p-6">
          <div
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            className={`relative rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              isDragOver
                ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/5"
                : "border-[var(--slate-300)] bg-[var(--slate-50)] hover:border-[var(--slate-400)]"
            }`}
          >
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--slate-100)]">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--slate-400)"
                  strokeWidth="1.5"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <path d="m17 8-5-5-5 5" />
                  <path d="M12 3v12" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--slate-700)]">
                  Glissez-deposez votre fichier DPGF ici
                </p>
                <p className="mt-1 text-xs text-[var(--slate-500)]">
                  CSV, XLSX ou XLS — ou cliquez pour parcourir
                </p>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
              disabled={isSubmitting}
            />
          </div>

          {/* Selected file info */}
          {selectedFile && !fileError && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--slate-200)] px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--slate-800)]">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-[var(--slate-500)]">
                  {(selectedFile.size / 1024).toFixed(1)} Ko
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setSelectedFile(null);
                    setFileError(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  disabled={isSubmitting}
                >
                  Retirer
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleSubmit()}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Import…
                    </span>
                  ) : (
                    "Lancer l'import"
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Errors */}
      {fileError && <div className="alert alert-error">{fileError}</div>}
      {submitError && <div className="alert alert-error">{submitError}</div>}

      {/* Submitting progress */}
      {isSubmitting && (
        <div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--slate-200)]">
            {uploadProgress !== null ? (
              /* UX-6: Real progress bar for server uploads */
              <div
                className="h-full rounded-full bg-[var(--brand-blue)] transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            ) : (
              /* Indeterminate for worker/small files */
              <div
                className="h-full rounded-full bg-[var(--brand-blue)]"
                style={{
                  width: "100%",
                  animation: "uif-indeterminate 1.5s ease-in-out infinite",
                }}
              />
            )}
          </div>
          <p className="mt-2 text-xs text-[var(--slate-500)]">
            {uploadProgress !== null
              ? `Envoi en cours… ${uploadProgress}%`
              : "Envoi et traitement en cours…"}
          </p>
          {uploadProgress === null && (
            <style>{`@keyframes uif-indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-component: Mapping Step                                        */
/* ------------------------------------------------------------------ */

function MappingStep({
  importId,
  isSimplified,
  initialMapping,
  forceShowMapping,
  onBack,
  onNext,
}: {
  importId: string;
  isSimplified: boolean;
  initialMapping?: ColumnMapping;
  forceShowMapping?: boolean;
  onBack?: () => void;
  onNext: (result: {
    mapping: ColumnMapping;
    autoAdvanced?: boolean;
    templateExactMatch?: MappingTemplateExactMatch | null;
  }) => void;
}) {
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>(initialMapping ?? {});
  const [sampleValues, setSampleValues] = useState<Record<string, string[]>>(
    {},
  );
  const [confidenceBySource, setConfidenceBySource] = useState<
    Record<string, MappingSuggestionConfidence>
  >({});
  const [templateExactMatch, setTemplateExactMatch] =
    useState<MappingTemplateExactMatch | null>(null);
  const [autoValidation, setAutoValidation] =
    useState<MappingAutoValidation | null>(null);
  // UX2-010: track if user chose to edit after auto-advance
  const [autoAdvanced, setAutoAdvanced] = useState(false);
  const [showMapping] = useState(forceShowMapping ?? false);
  // Initial loading state = true (data fetched immediately on mount)
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasInitialMapping = Object.keys(initialMapping ?? {}).length > 0;

  // Validate mapping: required fields present + no duplicate targets
  const isMappingValid = useMemo(() => {
    const values = Object.values(mapping);
    if (values.length === 0) return false;

    const requiredFields = TARGET_FIELDS.filter(
      (f) => "required" in f && f.required,
    ).map((f) => f.value);
    const mappedTargets = new Set(values);
    const hasAllRequired = requiredFields.every((r) => mappedTargets.has(r));

    const targetCounts = new Map<string, number>();
    for (const target of values) {
      targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1);
    }
    const hasDuplicates = Array.from(targetCounts.values()).some((c) => c > 1);

    return hasAllRequired && !hasDuplicates;
  }, [mapping]);

  // Fetch suggestions on mount (isLoading already true at init)
  useEffect(() => {
    let cancelled = false;

    fetchApi<SuggestionsData>("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "suggestions", import_id: importId }),
    })
      .then((data) => {
        if (cancelled) return;
        setSourceColumns(data.source_columns ?? []);
        setSampleValues(data.sample_values ?? {});
        setMapping(hasInitialMapping ? (initialMapping ?? {}) : (data.suggestions ?? {}));
        setConfidenceBySource(data.confidence_by_source ?? {});
        setTemplateExactMatch(data.template_exact_match ?? null);
        setAutoValidation(data.auto_validation ?? null);

        // UX2-010: auto-advance in simplified mode when eligible
        if (
          isSimplified &&
          data.auto_validation?.can_auto_validate === true
        ) {
          setAutoAdvanced(true);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Impossible de charger les suggestions.",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [importId, isSimplified, hasInitialMapping, initialMapping]);

  // UX2-010: auto-advance to preview once loaded + eligible
  useEffect(() => {
    if (autoAdvanced && !showMapping && !isLoading && isMappingValid) {
      onNext({
        mapping,
        autoAdvanced: true,
        templateExactMatch,
      });
    }
  }, [autoAdvanced, showMapping, isLoading, isMappingValid, mapping, onNext, templateExactMatch]);

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

  // UX2-010: if auto-advanced, don't render the mapping step UI
  // (the useEffect above will call onNext)
  if (autoAdvanced && !showMapping) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* UX2-010: Template exact match banner */}
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

      {/* UX2-010: Auto-validation banner (shown when user clicked "Modifier le mapping") */}
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

      {/* Navigation buttons */}
      <div className="flex items-center justify-between">
        {onBack ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
            Retour
          </button>
        ) : <div />}
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

/* ------------------------------------------------------------------ */
/*  Sub-component: Preview Step                                        */
/* ------------------------------------------------------------------ */

function PreviewStep({
  importId,
  mapping,
  wasAutoAdvanced,
  templateExactMatch,
  onEditMapping,
  onBack,
  onNext,
}: {
  importId: string;
  mapping: ColumnMapping;
  wasAutoAdvanced?: boolean;
  templateExactMatch?: MappingTemplateExactMatch | null;
  onEditMapping?: () => void;
  onBack?: () => void;
  onNext: (data: {
    rows: MappingPreviewRow[];
    validation: MappingValidation | null;
    duplicates: DuplicatesSummary | null;
  }) => void;
}) {
  const [rows, setRows] = useState<MappingPreviewRow[]>([]);
  const [validation, setValidation] = useState<MappingValidation | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicatesSummary | null>(null);
  // Initial loading state = true (data fetched immediately on mount)
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewLimit, setPreviewLimit] = useState(50);
  const requestIdRef = useRef(0);

  // Reset loading when limit changes (event-driven, not in effect)
  const handlePreviewLimitChange = useCallback((limit: number) => {
    setPreviewLimit(limit);
    setIsLoading(true);
    setError(null);
  }, []);

  // Fetch preview on mount or when limit changes (isLoading already set)
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
        if (cancelled || requestIdRef.current !== requestId) return;
        setRows(data.rows ?? []);
        setValidation(data.validation ?? null);
        setDuplicates(data.duplicates ?? null);
      })
      .catch((err) => {
        if (cancelled || requestIdRef.current !== requestId) return;
        setError(
          err instanceof Error
            ? err.message
            : "Impossible de charger l'apercu.",
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

  if (error) {
    return <div className="alert alert-error">{error}</div>;
  }

  return (
    <div className="space-y-4">
      {/* UX2-010: keep template exact-match message visible after auto-advance */}
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

      {/* UX2-010: Auto-mapping banner with edit action */}
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
        ) : <div />}
        <button
          type="button"
          className="btn btn-primary"
          disabled={isLoading}
          onClick={() =>
            startTransition(() => onNext({ rows, validation, duplicates }))
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

/* ------------------------------------------------------------------ */
/*  Sub-component: Confirmation Step                                   */
/* ------------------------------------------------------------------ */

function ConfirmationStep({
  importId,
  projectId,
  mapping,
  validation,
  onBack,
  onSuccess,
}: {
  importId: string;
  projectId: string;
  mapping: ColumnMapping;
  validation: MappingValidation | null;
  onBack?: () => void;
  onSuccess: (result: ConfirmUnifiedImportFlowResult) => void;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [carryOverPreview, setCarryOverPreview] =
    useState<TakeoffCarryOverSummary | null>(null);
  const [isCarryOverPreviewLoading, setIsCarryOverPreviewLoading] = useState(true);
  const carryOverPreviewRequestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++carryOverPreviewRequestIdRef.current;

    setIsCarryOverPreviewLoading(true);

    void getUnifiedImportFlowTakeoffCarryOverPreview({ projectId })
      .then((result) => {
        if (cancelled || carryOverPreviewRequestIdRef.current !== requestId) {
          return;
        }

        setCarryOverPreview(result);
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
        });

        onSuccess(result);
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
    [importId, projectId, mapping, onSuccess],
  );

  const carryOverPreviewCopy =
    carryOverPreview !== null ? getTakeoffCarryOverPreviewCopy(carryOverPreview) : null;

  return (
    <div className="dashboard-card p-6">
      <h3 className="text-sm font-semibold text-[var(--slate-800)]">
        Confirmation
      </h3>
      <p className="mt-1 text-xs text-[var(--slate-500)]">
        Verifiez le resume avant de continuer.
      </p>

      {/* Stats summary */}
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

      {/* Error with retry */}
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

      {/* Action buttons */}
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
              "Creer le chiffrage"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main: UnifiedImportFlow                                            */
/* ------------------------------------------------------------------ */

export function UnifiedImportFlow({
  projectId,
  takeoffEnabled = false,
  onCancel,
  onComplete,
}: UnifiedImportFlowProps) {
  const { isSimplified } = useUiMode();
  const router = useRouter();

  const [step, setStep] = useState<Step>("upload");
  const [confirmResult, setConfirmResult] =
    useState<ConfirmUnifiedImportFlowResult | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [currentMapping, setCurrentMapping] = useState<ColumnMapping>({});
  // UX2-010: track whether mapping was auto-advanced (for banner in preview)
  const [wasAutoAdvanced, setWasAutoAdvanced] = useState(false);
  const [autoAppliedTemplateMatch, setAutoAppliedTemplateMatch] =
    useState<MappingTemplateExactMatch | null>(null);
  const [previewData, setPreviewData] = useState<{
    rows: MappingPreviewRow[];
    validation: MappingValidation | null;
    duplicates: DuplicatesSummary | null;
  } | null>(null);

  /* ---- Step transitions ---- */

  const handleImportReady = useCallback((id: string) => {
    setImportId(id);
    setCurrentMapping({});
    setWasAutoAdvanced(false);
    setAutoAppliedTemplateMatch(null);
    setPreviewData(null);
    startTransition(() => setStep("mapping"));
  }, []);

  const handleMappingNext = useCallback(
    (result: {
      mapping: ColumnMapping;
      autoAdvanced?: boolean;
      templateExactMatch?: MappingTemplateExactMatch | null;
    }) => {
      setCurrentMapping(result.mapping);
      setWasAutoAdvanced(result.autoAdvanced ?? false);
      setAutoAppliedTemplateMatch(result.templateExactMatch ?? null);
      startTransition(() => setStep("preview"));
    },
    [],
  );

  const handleEditMapping = useCallback(() => {
    setWasAutoAdvanced(false);
    setAutoAppliedTemplateMatch(null);
    startTransition(() => setStep("mapping"));
  }, []);

  const handlePreviewNext = useCallback(
    (data: {
      rows: MappingPreviewRow[];
      validation: MappingValidation | null;
      duplicates: DuplicatesSummary | null;
    }) => {
      setPreviewData(data);
      startTransition(() => setStep("confirmation"));
    },
    [],
  );

  const handleConfirmSuccess = useCallback(
    (result: ConfirmUnifiedImportFlowResult) => {
      setConfirmResult(result);

      const shouldShowPlans =
        takeoffEnabled &&
        result.mode === "version_created" &&
        result.projectId &&
        result.versionId;

      if (shouldShowPlans) {
        startTransition(() => setStep("plans"));
      } else if (result.redirectTo) {
        router.push(result.redirectTo);
        router.refresh();
      } else {
        onComplete?.(result);
      }
    },
    [takeoffEnabled, router, onComplete],
  );

  const skipPlansStep = useCallback(() => {
    if (!confirmResult) {
      return;
    }

    // Skip → go straight to editor so the chiffreur can work on the estimate
    if (confirmResult.redirectTo) {
      router.push(confirmResult.redirectTo);
      router.refresh();
      return;
    }

    if (onComplete) {
      onComplete(confirmResult);
      return;
    }

    if (confirmResult.projectId) {
      router.push(`/dashboard/affaires/${confirmResult.projectId}`);
      router.refresh();
    }
  }, [confirmResult, onComplete, router]);

  const finishPlansStep = useCallback(() => {
    if (!confirmResult?.projectId) {
      return;
    }

    if (onComplete) {
      onComplete(confirmResult);
      return;
    }

    router.push(`/dashboard/affaires/${confirmResult.projectId}`);
    router.refresh();
  }, [confirmResult, onComplete, router]);

  // UX-5: once an import is created, keep cancel guard active even if user navigates back to upload
  const hasStartedImport = importId !== null;
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const stepperSteps = useMemo(
    () => (takeoffEnabled ? STEPPER_STEPS_WITH_PLANS : STEPPER_STEPS_BASE),
    [takeoffEnabled],
  );

  const handleBack = useCallback(() => {
    // Plans step: no going back (confirmation already committed)
    if (step === "plans") return;

    const currentIndex = (stepperSteps as readonly Step[]).indexOf(step);
    if (currentIndex <= 0) {
      // UX-5: if import already started, confirm before canceling
      if (hasStartedImport) {
        setShowCancelConfirm(true);
        return;
      }
      onCancel?.();
      return;
    }
    startTransition(() => setStep(stepperSteps[currentIndex - 1]));
  }, [step, onCancel, hasStartedImport, stepperSteps]);

  const backButton = (
    <button
      type="button"
      onClick={handleBack}
      className="btn btn-secondary btn-sm inline-flex shrink-0 items-center gap-1.5"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
      {step === "upload" ? "Annuler" : "Retour"}
    </button>
  );

  return (
    <div className="animate-fade-in space-y-4">
      {/* UX-5: Cancel confirmation dialog */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-sm font-semibold text-[var(--slate-800)]">
              Annuler l&apos;import ?
            </h3>
            <p className="mt-2 text-xs text-[var(--slate-500)]">
              Votre progression sera perdue. Le fichier importe et le mapping en cours ne seront pas conserves.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowCancelConfirm(false)}
              >
                Continuer l&apos;import
              </button>
              <button
                type="button"
                className="btn btn-sm bg-red-600 text-white hover:bg-red-700"
                onClick={() => {
                  setShowCancelConfirm(false);
                  onCancel?.();
                }}
              >
                Annuler l&apos;import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress header */}
      <div className="flex items-center justify-between gap-3">
        <ProgressHeader currentStep={step} steps={stepperSteps} />
        {step !== "plans" && backButton}
      </div>

      {/* Step content */}
      {step === "upload" && (
        <UploadStep projectId={projectId} onImportReady={handleImportReady} />
      )}

      {step === "mapping" && importId && (
        <MappingStep
          importId={importId}
          isSimplified={isSimplified}
          initialMapping={currentMapping}
          forceShowMapping={Object.keys(currentMapping).length > 0}
          onBack={handleBack}
          onNext={handleMappingNext}
        />
      )}

      {step === "preview" && importId && (
        <PreviewStep
          importId={importId}
          mapping={currentMapping}
          wasAutoAdvanced={wasAutoAdvanced}
          templateExactMatch={autoAppliedTemplateMatch}
          onEditMapping={handleEditMapping}
          onBack={handleBack}
          onNext={handlePreviewNext}
        />
      )}

      {step === "confirmation" && importId && (
        <ConfirmationStep
          importId={importId}
          projectId={projectId}
          mapping={currentMapping}
          validation={previewData?.validation ?? null}
          onBack={handleBack}
          onSuccess={handleConfirmSuccess}
        />
      )}

      {step === "plans" && confirmResult?.projectId && confirmResult?.versionId && (
        <LazyPlansStep
          projectId={confirmResult.projectId}
          versionId={confirmResult.versionId}
          onSkip={skipPlansStep}
          onContinue={finishPlansStep}
          showSuccessBanner
        />
      )}
    </div>
  );
}
