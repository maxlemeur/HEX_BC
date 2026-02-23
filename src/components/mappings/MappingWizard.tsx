"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ColumnMapper, type ColumnMapping } from "@/components/mappings/ColumnMapper";
import { DataPreview } from "@/components/mappings/DataPreview";

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

const TARGET_FIELDS = [
  { value: "hex_code", label: "Code HEX", required: true },
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

export function MappingWizard() {
  // M-09: Accept ?import_id= query param
  const searchParams = useSearchParams();
  const importIdFromUrl = searchParams.get("import_id");

  const [imports, setImports] = useState<ImportListItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [selectedImportId, setSelectedImportId] = useState(importIdFromUrl ?? "");
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
  const previewRequestIdRef = useRef(0);

  const selectedImport = useMemo(
    () => imports.find((item) => item.id === selectedImportId) ?? null,
    [imports, selectedImportId]
  );

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

      // M-09: Pre-select from query param, or first import
      if (importIdFromUrl && importsData.some((item) => item.id === importIdFromUrl)) {
        setSelectedImportId(importIdFromUrl);
      } else if (importsData.length > 0) {
        setSelectedImportId((current) => current || importsData[0].id);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger les donnees de mapping."
      );
    } finally {
      setIsLoading(false);
    }
  }, [importIdFromUrl]);

  const refreshSuggestions = useCallback(async (importId: string) => {
    const data = await fetchApi<{
      suggestions: Record<string, string>;
      source_columns: string[];
      templates: TemplateItem[];
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
    setTemplates((previousTemplates) => {
      if (!data.templates || data.templates.length === 0) return previousTemplates;
      return data.templates;
    });

    setMapping((previousMapping) => {
      if (Object.keys(previousMapping).length > 0) return previousMapping;
      const suggestions = data.suggestions ?? {};
      // M-15: Track auto-mapped columns count
      const count = Object.keys(suggestions).length;
      setAutoMappedCount(count);
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
    void refreshPreview(selectedImportId, mapping, previewLimit);
  }, [selectedImportId, mapping, previewLimit, refreshPreview]);

  // M-10: Combined "Apercu" action (refresh + validate + doublons)
  async function handleRefreshAll() {
    if (!selectedImportId) return;
    setError(null);
    await refreshPreview(selectedImportId, mapping, previewLimit);
  }

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
          mapping,
          save_template: saveAsTemplate,
          template_name: saveAsTemplate ? templateName : null,
          supplier_name: saveAsTemplate ? templateSupplierName : null,
          template_id: selectedTemplateId || null,
        }),
      });

      setSuccess("Mapping enregistre avec succes. Vous pouvez passer a la liaison catalogue.");
      await loadBaseData();
      await refreshPreview(selectedImportId, mapping, previewLimit);
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

    setMapping(toTemplateMapping(selectedTemplate.mapping));
  }

  return (
    <div className="space-y-6">
      {/* M-15: Auto-mapping notification */}
      {autoMappedCount > 0 ? (
        <div className="rounded-xl border border-[var(--info)] bg-[var(--info-light)] px-4 py-3 text-sm text-[var(--info)]">
          {autoMappedCount} colonne(s) pre-mappee(s) automatiquement. Verifiez les associations ci-dessous.
        </div>
      ) : null}

      <section className="dashboard-card p-6">
        <div className="grid gap-4 lg:grid-cols-3">
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
              <option value="">Aucun</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.supplier_name ? ` - ${template.supplier_name}` : ""}
                  {template.is_default ? " (defaut)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3 text-sm">
            <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">Import selectionne</p>
            <p className="mt-1 font-semibold text-[var(--slate-800)]">
              {selectedImport ? selectedImport.filename : "-"}
            </p>
            <p className="mt-1 text-xs text-[var(--slate-500)]">
              {selectedImport ? `${selectedImport.row_count} lignes - statut ${selectedImport.status}` : ""}
            </p>
          </div>
        </div>

        {/* M-10: Consolidated to 2 buttons */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleRefreshAll()}
            disabled={!selectedImportId || isPreviewLoading}
          >
            {isPreviewLoading ? "Chargement..." : "Apercu et validation"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleCreateMapping()}
            disabled={isSubmitting || !selectedImportId}
          >
            {isSubmitting ? "Enregistrement..." : "Enregistrer le mapping"}
          </button>

          {/* M-09: Back to import button */}
          <Link
            href="/dashboard/imports"
            className="btn btn-secondary"
          >
            Retour a l&apos;import
          </Link>
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
        mapping={mapping}
        targetFields={[...TARGET_FIELDS]}
        onChange={setMapping}
        disabled={isLoading || !selectedImportId}
      />

      {/* M-13: Preview row count selector */}
      <div className="flex items-center gap-2">
        <label className="text-sm text-[var(--slate-600)]" htmlFor="preview-limit">
          Lignes d&apos;apercu :
        </label>
        <select
          id="preview-limit"
          className="form-input form-select form-input--sm w-auto"
          value={previewLimit}
          onChange={(event) => setPreviewLimit(Number(event.target.value))}
        >
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={200}>200</option>
        </select>
      </div>

      <DataPreview
        rows={previewRows}
        validation={validation}
        duplicates={duplicates}
        isLoading={isPreviewLoading}
      />
    </div>
  );
}
