"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";

import { ColumnMapper, type ColumnMapping } from "@/components/mappings/ColumnMapper";
import { DataPreview } from "@/components/mappings/DataPreview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useUiMode } from "@/hooks/useUiMode";
import { MAPPING_TARGET_FIELD_OPTIONS } from "@/lib/mappings/schemas";
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

const TARGET_FIELDS = MAPPING_TARGET_FIELD_OPTIONS;
const VALUE_TARGET_FIELDS = TARGET_FIELDS.filter((field) => field.group === "value");

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
    throw new Error(await extractErrorMessage(response, "Requête API en échec."));
  }

  const payload = (await response.json()) as unknown;
  const record = asRecord(payload);

  if (!record || record.ok !== true) {
    const errorRecord = asRecord(record?.error);
    const message =
      errorRecord && typeof errorRecord.message === "string"
        ? errorRecord.message
        : "Réponse API invalide.";
    throw new Error(message);
  }

  return record.data as T;
}

type MappingSuggestionsResponse = {
  suggestions: Record<string, string>;
  source_columns: string[];
  templates: TemplateItem[];
  sample_values: Record<string, string[]>;
  confidence_by_source: Record<string, MappingSuggestionConfidence>;
  template_exact_match: MappingTemplateExactMatch | null;
  auto_validation: MappingAutoValidation;
};

/**
 * Read-only: `suggestions` and `preview` are RPC-style reads on POST /api/mappings (nothing is
 * written until "Enregistrer le mapping"). They stay POST because the preview carries the mapping.
 */
function fetchMappingSuggestions(importId: string) {
  return fetchApi<MappingSuggestionsResponse>("/api/mappings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "suggestions",
      import_id: importId,
    }),
  });
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
  // The preview waits for the suggestions of the selected import: previewing the empty
  // mapping first only doubled the read requests on load.
  const [suggestionsImportId, setSuggestionsImportId] = useState<string | null>(null);
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
          : "Impossible de charger les données de mapping."
      );
    } finally {
      setIsLoading(false);
    }
  }, [preferredImportId]);

  const applySuggestions = useCallback((data: MappingSuggestionsResponse) => {
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
            : "Impossible de charger l'aperçu de mapping."
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
    setSuggestionsImportId(null);

    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchMappingSuggestions(selectedImportId);
        if (!cancelled) applySuggestions(data);
      } catch (loadError) {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Impossible de charger les suggestions de mapping."
        );
      } finally {
        if (!cancelled) setSuggestionsImportId(selectedImportId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedImportId, applySuggestions]);

  useEffect(() => {
    if (!selectedImportId || suggestionsImportId !== selectedImportId) return;
    void refreshPreview(selectedImportId, visibleMapping, previewLimit);
  }, [selectedImportId, suggestionsImportId, visibleMapping, previewLimit, refreshPreview]);

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

      setSuccess("Mapping enregistré avec succès. Vous pouvez passer à la liaison catalogue.");
      await loadBaseData();
      await refreshPreview(selectedImportId, visibleMapping, previewLimit);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Impossible de créer le mapping."
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

  const mappedTargetCount = new Set(
    Object.values(visibleMapping).filter((target) =>
      VALUE_TARGET_FIELDS.some((field) => field.value === target)
    )
  ).size;

  return (
    <div className="space-y-6">
      {/* M-15: Auto-mapping notification — compact and collapsible */}
      {autoMappedCount > 0 ? (
        <Alert variant="success">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              {autoMappedCount > 1
                ? `${autoMappedCount} colonnes pré-mappées automatiquement`
                : "1 colonne pré-mappée automatiquement"}
            </p>
            <Button
              variant="link"
              size="xs"
              className="text-success"
              aria-expanded={showAutoMapDetails}
              onClick={() => setShowAutoMapDetails((prev) => !prev)}
            >
              {showAutoMapDetails ? "Masquer le détail" : "Voir le détail"}
            </Button>
          </div>
          {showAutoMapDetails ? (
            <ul className="mt-2 grid gap-x-6 gap-y-1 text-xs text-foreground-secondary sm:grid-cols-2 lg:grid-cols-3">
              {autoMappedColumns.map(({ source, target }) => {
                const targetLabel = TARGET_FIELDS.find((f) => f.value === target)?.label ?? target;
                return (
                  <li key={source} className="min-w-0 break-words">
                    <span className="font-medium">{source}</span>
                    <span aria-hidden="true"> → </span>
                    <span className="sr-only"> associée à </span>
                    <span>{targetLabel}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      {/* UX2-010: Template exact match banner */}
      {templateExactMatch ? (
        <Alert variant="success">
          <p className="font-medium">
            Mapping appliqué depuis le modèle « {templateExactMatch.name} »
            {templateExactMatch.supplier_name ? (
              <span className="ml-1 font-normal text-foreground-secondary">
                ({templateExactMatch.supplier_name})
              </span>
            ) : null}
          </p>
        </Alert>
      ) : null}

      {/* UX2-010: Auto-validated state (simplified mode) */}
      {isSimplified && autoValidation?.can_auto_validate ? (
        <Alert variant="info">
          <AlertTitle>Mapping validé automatiquement</AlertTitle>
          <AlertDescription className="text-xs">
            Tous les champs requis sont mappés avec une confiance élevée. Vérifiez le mapping puis
            cliquez sur « Enregistrer le mapping ».
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <FieldLabel htmlFor="mapping-import-id">Import source</FieldLabel>
              <NativeSelect
                id="mapping-import-id"
                value={selectedImportId}
                onChange={(event) => setSelectedImportId(event.target.value)}
                disabled={isLoading || imports.length === 0}
              >
                {imports.length === 0 ? (
                  <option value="">Aucun import disponible</option>
                ) : (
                  imports.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.filename} — {item.row_count} lignes
                    </option>
                  ))
                )}
              </NativeSelect>
            </div>

            <div className="flex min-w-0 flex-col gap-2">
              <FieldLabel htmlFor="mapping-template-id">Modèle de mapping (optionnel)</FieldLabel>
              <NativeSelect
                id="mapping-template-id"
                value={selectedTemplateId}
                onChange={(event) => applyTemplate(event.target.value)}
                disabled={isLoading || templates.length === 0}
              >
                <option value="">Aucun modèle — mapping manuel</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                    {template.supplier_name ? ` — ${template.supplier_name}` : ""}
                    {template.is_default ? " (par défaut)" : ""}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          {/* M-14: Hide template save fields when checkbox unchecked */}
          <div>
            <label className="inline-flex min-h-9 items-center gap-2 text-sm text-foreground-secondary">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={saveAsTemplate}
                onChange={(event) => setSaveAsTemplate(event.target.checked)}
              />
              Enregistrer aussi comme modèle de mapping
            </label>

            {saveAsTemplate ? (
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-2">
                  <FieldLabel htmlFor="mapping-template-name">Nom du modèle</FieldLabel>
                  <Input
                    id="mapping-template-name"
                    placeholder="Ex. DPGF plomberie standard"
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <FieldLabel htmlFor="mapping-template-supplier">Fournisseur (optionnel)</FieldLabel>
                  <Input
                    id="mapping-template-supplier"
                    placeholder="Ex. Cedeo"
                    value={templateSupplierName}
                    onChange={(event) => setTemplateSupplierName(event.target.value)}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {error ? <Alert variant="danger">{error}</Alert> : null}
          {success ? (
            <Alert variant="success">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{success}</span>
                {selectedImportId ? (
                  <Link
                    href={`/dashboard/catalogue?import_id=${selectedImportId}`}
                    className={buttonVariants({ variant: "primary", size: "md" })}
                  >
                    Lier au catalogue
                    <ArrowRightIcon aria-hidden="true" />
                  </Link>
                ) : null}
              </div>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

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

      {/* Action bar, kept in view at the bottom of the content column */}
      <div className="sticky bottom-0 z-20 -mx-3 border-t border-border bg-surface/95 px-3 py-3 shadow-[0_-2px_8px_rgb(15_23_42/0.06)] backdrop-blur-sm sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/dashboard/imports"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            <ArrowLeftIcon aria-hidden="true" />
            Retour à l’import
          </Link>

          <div className="flex flex-wrap items-center gap-4">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {mappedTargetCount}/{VALUE_TARGET_FIELDS.length} champs mappés
            </span>
            <Button
              size="lg"
              onClick={() => void handleCreateMapping()}
              disabled={!selectedImportId || !isMappingValid}
              loading={isSubmitting}
              aria-describedby={!isMappingValid ? "mapping-save-hint" : undefined}
            >
              Enregistrer le mapping
            </Button>
          </div>
        </div>
        {!isMappingValid ? (
          <p id="mapping-save-hint" className="mt-2 text-xs text-muted-foreground">
            Mappez la Désignation et résolvez les conflits avant d’enregistrer.
          </p>
        ) : null}
      </div>
    </div>
  );
}
