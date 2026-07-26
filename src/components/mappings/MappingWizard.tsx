"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ColumnMapper, type ColumnMapping } from "@/components/mappings/ColumnMapper";
import { DataPreview } from "@/components/mappings/DataPreview";
import { useUiMode } from "@/hooks/useUiMode";
import type {
  MappingAutoValidation,
  MappingSuggestionConfidence,
  MappingTemplateExactMatch,
} from "@/lib/mappings/server";

type ImportListItem = {
  id: string;
  filename: string;
  status: string;
  row_count: number;
  created_at: string;
};

type TemplateItem = {
  id: string;
  name: string;
  supplier_name: string | null;
  mapping: Record<string, string>;
  is_default: boolean;
  last_used_at: string | null;
};

type MappingValidation = {
  is_valid: boolean;
  missing_required_fields: string[];
  duplicate_target_assignments: Array<{ target: string; sources: string[] }>;
  mapped_sources_count: number;
  mapped_targets_count: number;
};

type MappingPreviewRow = {
  row_index: number;
  raw_row: Record<string, unknown>;
  mapped_row: Record<string, unknown>;
  missing_required_fields: string[];
};

type DuplicatesSummary = {
  total_groups: number;
  total_rows_impacted: number;
};

export function resolveSelectedImportId(
  importsData: ImportListItem[],
  importIdFromUrl: string | null,
  currentImportId: string
): string {
  if (importsData.length === 0) return "";

  if (importIdFromUrl) {
    const matchFromUrl = importsData.find((item) => item.id === importIdFromUrl);
    if (matchFromUrl) return matchFromUrl.id;
    return importsData[0].id;
  }

  const currentMatch = importsData.find((item) => item.id === currentImportId);
  if (currentMatch) return currentMatch.id;

  return importsData[0].id;
}

function resolveImportIdQueryValue(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const TARGET_FIELDS = [
  { value: "hex_code", label: "Référence article", required: true },
  { value: "designation", label: "Désignation", required: true },
  { value: "quantity", label: "Quantité" },
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toTemplateMapping(value: unknown): Record<string, string> {
  const raw = asRecord(value);
  if (!raw) return {};

  const result: Record<string, string> = {};

  for (const [source, target] of Object.entries(raw)) {
    if (typeof source !== "string" || typeof target !== "string") continue;

    const trimmedSource = source.trim();
    const trimmedTarget = target.trim();

    if (!trimmedSource || !trimmedTarget) continue;

    result[trimmedSource] = trimmedTarget;
  }

  return result;
}

export function filterMappingToSourceColumns(
  mapping: ColumnMapping,
  sourceColumns: string[]
): ColumnMapping {
  if (sourceColumns.length === 0 || Object.keys(mapping).length === 0) {
    return mapping;
  }

  const sourceSet = new Set(sourceColumns);
  const filteredMapping: ColumnMapping = {};
  let removedEntries = false;

  for (const [sourceColumn, targetField] of Object.entries(mapping)) {
    if (!sourceSet.has(sourceColumn)) {
      removedEntries = true;
      continue;
    }

    filteredMapping[sourceColumn] = targetField;
  }

  return removedEntries ? filteredMapping : mapping;
}

async function extractErrorMessage(response: Response, fallback: string) {
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const record = asRecord(payload);
  const errorRecord = asRecord(record?.error);
  const nestedMessage =
    errorRecord && typeof errorRecord.message === "string"
      ? errorRecord.message
      : null;
  const topLevelMessage =
    record && typeof record.message === "string" ? record.message : null;
  const message = nestedMessage ?? topLevelMessage;

  return message ?? `${fallback} (HTTP ${response.status})`;
}

async function fetchApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Requete API en echec."));
  }

  const payload = (await response.json()) as unknown;
  const record = asRecord(payload);

  if (!record || record.ok !== true) {
    const errorRecord = asRecord(record?.error);
    const message =
      errorRecord && typeof errorRecord.message === "string"
        ? errorRecord.message
        : "Reponse API invalide.";
    throw new Error(message);
  }

  return record.data as T;
}

export function MappingWizard({ initialImportId = null }: { initialImportId?: string | null }) {
  const { isSimplified } = useUiMode();
  const searchParams = useSearchParams();
  const importIdFromSearchParams = useMemo(
    () => resolveImportIdQueryValue(searchParams.get("import_id")),
    [searchParams]
  );
  const preferredImportId = importIdFromSearchParams ?? initialImportId;

  const [imports, setImports] = useState<ImportListItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [selectedImportId, setSelectedImportId] = useState(initialImportId ?? "");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<MappingPreviewRow[]>([]);
  const [previewLimit, setPreviewLimit] = useState(20);
  const [validation, setValidation] = useState<MappingValidation | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicatesSummary | null>(null);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateSupplierName, setTemplateSupplierName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [autoMappedCount, setAutoMappedCount] = useState(0);
  const [autoMappedColumns, setAutoMappedColumns] = useState<Array<{ source: string; target: string }>>([]);
  const [sampleValues, setSampleValues] = useState<Record<string, string[]>>({});
  const [showAutoMapDetails, setShowAutoMapDetails] = useState(false);
  // UX2-010: confidence metadata
  const [confidenceBySource, setConfidenceBySource] = useState<
    Record<string, MappingSuggestionConfidence>
  >({});
  const [templateExactMatch, setTemplateExactMatch] =
    useState<MappingTemplateExactMatch | null>(null);
  const [autoValidation, setAutoValidation] =
    useState<MappingAutoValidation | null>(null);
  const previewRequestIdRef = useRef(0);

  const visibleMapping = useMemo(
    () => filterMappingToSourceColumns(mapping, sourceColumns),
    [mapping, sourceColumns]
  );

  // Compute whether the mapping is valid (required fields mapped, no duplicate targets)
  const isMappingValid = useMemo(() => {
    const mappedValues = Object.values(visibleMapping);
    if (mappedValues.length === 0) return false;

    const requiredFields = TARGET_FIELDS.filter((f) => "required" in f && f.required).map((f) => f.value);
    const mappedTargets = new Set(mappedValues);
    const hasAllRequired = requiredFields.every((r) => mappedTargets.has(r));

    // Check for duplicate targets
    const targetCounts = new Map<string, number>();
    for (const target of mappedValues) {
      targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1);
    }
    const hasDuplicates = Array.from(targetCounts.values()).some((count) => count > 1);

    return hasAllRequired && !hasDuplicates;
  }, [visibleMapping]);

  const loadBaseData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [importsData, mappingsData] = await Promise.all([
        fetchApi<ImportListItem[]>("/api/imports", {
          method: "GET",
          cache: "no-store",
        }),
        fetchApi<{ mappings: unknown[]; templates: TemplateItem[] }>(
          "/api/mappings?limit=50",
          {
            method: "GET",
            cache: "no-store",
          }
        ),
      ]);

      setImports(importsData);
      setTemplates(mappingsData.templates ?? []);

      setSelectedImportId((current) =>
        resolveSelectedImportId(importsData, preferredImportId, current)
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger les donnees de mapping."
      );
    } finally {
      setIsLoading(false);
    }
  }, [preferredImportId]);

  const refreshSuggestions = useCallback(async (importId: string) => {
    const data = await fetchApi<{
      suggestions: Record<string, string>;
      source_columns: string[];
      templates: TemplateItem[];
      sample_values: Record<string, string[]>;
      confidence_by_source: Record<string, MappingSuggestionConfidence>;
      template_exact_match: MappingTemplateExactMatch | null;
      auto_validation: MappingAutoValidation;
    }>("/api/mappings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "suggestions",
        import_id: importId,
      }),
    });

    setSourceColumns(data.source_columns ?? []);
    setSampleValues(data.sample_values ?? {});
    setConfidenceBySource(data.confidence_by_source ?? {});
    setTemplateExactMatch(data.template_exact_match ?? null);
    setAutoValidation(data.auto_validation ?? null);
    setTemplates((previousTemplates) => {
      if (!data.templates || data.templates.length === 0) return previousTemplates;
      return data.templates;
    });

    setMapping((previousMapping) => {
      if (Object.keys(previousMapping).length > 0) return previousMapping;
      const suggestions = data.suggestions ?? {};
      // M-15: Track auto-mapped columns count and details
      const count = Object.keys(suggestions).length;
      setAutoMappedCount(count);
      setAutoMappedColumns(
        Object.entries(suggestions).map(([source, target]) => ({ source, target }))
      );
      return suggestions;
    });
  }, []);

  const refreshPreview = useCallback(
    async (importId: string, nextMapping: ColumnMapping, limit: number) => {
      if (!importId) return;
      const requestId = previewRequestIdRef.current + 1;
      previewRequestIdRef.current = requestId;

      setIsPreviewLoading(true);

      try {
        const data = await fetchApi<{
          source_columns: string[];
          validation: MappingValidation;
          rows: MappingPreviewRow[];
          duplicates: DuplicatesSummary;
        }>("/api/mappings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "preview",
            import_id: importId,
            mapping: nextMapping,
            limit,
          }),
        });

        if (requestId !== previewRequestIdRef.current) return;

        setSourceColumns(data.source_columns ?? []);
        setValidation(data.validation ?? null);
        setPreviewRows(data.rows ?? []);
        setDuplicates(data.duplicates ?? null);
      } catch (previewError) {
        if (requestId !== previewRequestIdRef.current) return;
        setError(
          previewError instanceof Error
            ? previewError.message
            : "Impossible de charger l'apercu de mapping."
        );
      } finally {
        if (requestId !== previewRequestIdRef.current) return;
        setIsPreviewLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadBaseData();
  }, [loadBaseData]);

  useEffect(() => {
    if (!selectedImportId) return;

    setError(null);
    setSuccess(null);
    setMapping({});
    setPreviewRows([]);
    setValidation(null);
    setDuplicates(null);
    setAutoMappedCount(0);
    setAutoMappedColumns([]);
    setSampleValues({});
    setConfidenceBySource({});
    setTemplateExactMatch(null);
    setAutoValidation(null);

    void (async () => {
      try {
        await refreshSuggestions(selectedImportId);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Impossible de charger les suggestions de mapping."
        );
      }
    })();
  }, [selectedImportId, refreshSuggestions]);

  useEffect(() => {
    if (!selectedImportId) return;
    void refreshPreview(selectedImportId, visibleMapping, previewLimit);
  }, [selectedImportId, visibleMapping, previewLimit, refreshPreview]);

  useEffect(() => {
    if (sourceColumns.length === 0) return;
    setMapping((current) => filterMappingToSourceColumns(current, sourceColumns));
  }, [sourceColumns]);

  // M-10: Single "Enregistrer le mapping" action
  async function handleCreateMapping() {
    if (!selectedImportId) return;

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      await fetchApi<unknown>("/api/mappings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "create",
          import_id: selectedImportId,
          mapping: visibleMapping,
          save_template: saveAsTemplate,
          template_name: saveAsTemplate ? templateName : null,
          supplier_name: saveAsTemplate ? templateSupplierName : null,
          template_id: selectedTemplateId || null,
        }),
      });

      setSuccess("Mapping enregistre avec succes. Vous pouvez passer a la liaison catalogue.");
      await loadBaseData();
      await refreshPreview(selectedImportId, visibleMapping, previewLimit);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Impossible de creer le mapping."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function applyTemplate(templateId: string) {
    setSelectedTemplateId(templateId);

    const selectedTemplate = templates.find((template) => template.id === templateId);
    if (!selectedTemplate) {
      return;
    }

    setMapping(
      filterMappingToSourceColumns(toTemplateMapping(selectedTemplate.mapping), sourceColumns)
    );
  }

  return (
    <div className="space-y-6">
      {/* M-15: Auto-mapping notification — compact and collapsible */}
      {autoMappedCount > 0 ? (
        <div className="rounded-xl border border-[var(--success)] bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">
              {autoMappedCount} colonne(s) pre-mappee(s) automatiquement
            </p>
            <button
              type="button"
              className="text-xs underline underline-offset-2 hover:no-underline"
              onClick={() => setShowAutoMapDetails((prev) => !prev)}
            >
              {showAutoMapDetails ? "Masquer" : "Voir le detail"}
            </button>
          </div>
          {showAutoMapDetails ? (
            <div className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {autoMappedColumns.map(({ source, target }) => {
                const targetLabel = TARGET_FIELDS.find((f) => f.value === target)?.label ?? target;
                return (
                  <div key={source}>
                    <span className="font-medium">{source}</span>
                    {" "}&rarr;{" "}
                    <span>{targetLabel}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

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

      {/* UX2-010: Auto-validated state (simplified mode) */}
      {isSimplified && autoValidation?.can_auto_validate && (
        <div
          className="rounded-xl border border-[var(--info)]/20 bg-[var(--info)]/5 px-4 py-3 text-sm text-[var(--slate-700)]"
          role="status"
          aria-label="Mapping auto-valide"
        >
          <p className="font-medium">Mapping auto-valide</p>
          <p className="mt-0.5 text-xs text-[var(--slate-500)]">
            Tous les champs requis sont mappes avec une confiance elevee.
            Verifiez le mapping puis cliquez sur &laquo;Enregistrer le mapping&raquo;.
          </p>
        </div>
      )}

      <section className="dashboard-card p-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <label className="form-label" htmlFor="mapping-import-id">
              Import source
            </label>
            <select
              id="mapping-import-id"
              className="form-input form-select"
              value={selectedImportId}
              onChange={(event) => setSelectedImportId(event.target.value)}
              disabled={isLoading || imports.length === 0}
            >
              {imports.length === 0 ? (
                <option value="">Aucun import disponible</option>
              ) : (
                imports.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.filename} - {item.row_count} lignes
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="form-label" htmlFor="mapping-template-id">
              Template existant (optionnel)
            </label>
            <select
              id="mapping-template-id"
              className="form-input form-select"
              value={selectedTemplateId}
              onChange={(event) => applyTemplate(event.target.value)}
              disabled={isLoading || templates.length === 0}
            >
              <option value="">Pas de template - mapping manuel</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.supplier_name ? ` - ${template.supplier_name}` : ""}
                  {template.is_default ? " (defaut)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* M-14: Hide template save fields when checkbox unchecked */}
        <div className="mt-4">
          <label className="inline-flex items-center gap-2 text-sm text-[var(--slate-700)]">
            <input
              type="checkbox"
              checked={saveAsTemplate}
              onChange={(event) => setSaveAsTemplate(event.target.checked)}
            />
            Sauvegarder aussi comme template
          </label>

          {saveAsTemplate ? (
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <input
                className="form-input"
                placeholder="Nom du template"
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
              />

              <input
                className="form-input"
                placeholder="Fournisseur (optionnel)"
                value={templateSupplierName}
                onChange={(event) => setTemplateSupplierName(event.target.value)}
              />
            </div>
          ) : null}
        </div>

        {error ? <div className="alert alert-error mt-4">{error}</div> : null}
        {success ? (
          <div className="alert alert-success mt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{success}</span>
              {selectedImportId ? (
                <Link
                  href={`/dashboard/catalogue?import_id=${selectedImportId}`}
                  className="btn btn-primary btn-sm"
                >
                  Lier au catalogue
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <ColumnMapper
        sourceColumns={sourceColumns}
        mapping={visibleMapping}
        targetFields={[...TARGET_FIELDS]}
        sampleValues={sampleValues}
        confidenceBySource={confidenceBySource}
        onChange={setMapping}
        disabled={isLoading || !selectedImportId}
      />

      <DataPreview
        rows={previewRows}
        validation={validation}
        duplicates={duplicates}
        isLoading={isPreviewLoading}
        previewLimit={previewLimit}
        onPreviewLimitChange={setPreviewLimit}
      />

      {/* Spacer for sticky bottom bar */}
      <div className="h-20" />

      {/* Sticky bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--slate-200)] bg-white/95 px-6 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link
            href="/dashboard/imports"
            className="btn btn-secondary"
          >
            Retour a l&apos;import
          </Link>

          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-[var(--slate-500)] sm:inline">
              {(() => {
                const mappedValues = Object.values(visibleMapping);
                const mappedTargetSet = new Set(mappedValues);
                return `${mappedTargetSet.size}/${TARGET_FIELDS.length} champs mappes`;
              })()}
            </span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleCreateMapping()}
              disabled={isSubmitting || !selectedImportId || !isMappingValid}
              title={!isMappingValid ? "Mappez les champs requis (Référence article, Designation) et resolvez les conflits avant d'enregistrer." : undefined}
            >
              {isSubmitting ? "Enregistrement..." : "Enregistrer le mapping"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
