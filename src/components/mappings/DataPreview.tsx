"use client";

import { EmptyTableRow } from "@/components/layout/empty-state";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

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

const PREVIEW_COLUMNS = 9;

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

export function DataPreview({
  rows,
  validation,
  duplicates,
  isLoading,
  previewLimit,
  onPreviewLimitChange,
}: {
  rows: MappingPreviewRow[];
  validation: MappingValidation | null;
  duplicates: DuplicatesSummary | null;
  isLoading: boolean;
  previewLimit?: number;
  onPreviewLimitChange?: (limit: number) => void;
}) {
  return (
    <section
      aria-labelledby="mapping-preview-title"
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
    >
      <div className="border-b border-border px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="mapping-preview-title" className="text-sm font-semibold text-foreground">
              Aperçu des données mappées
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Vérification rapide des champs requis et détection des doublons.
            </p>
          </div>

          {/* Preview limit selector — integrated into header */}
          {previewLimit !== undefined && onPreviewLimitChange ? (
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground" htmlFor="preview-limit">
                Lignes :
              </label>
              <NativeSelect
                id="preview-limit"
                size="sm"
                wrapperClassName="w-auto"
                value={previewLimit}
                onChange={(event) => onPreviewLimitChange(Number(event.target.value))}
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </NativeSelect>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 border-b border-border px-4 py-4 sm:grid-cols-3 sm:px-6">
        <div
          className={cn(
            "rounded-lg border px-4 py-3",
            validation?.is_valid ? "border-success-border bg-success-subtle" : "border-border bg-surface-subtle"
          )}
        >
          <p className="text-micro uppercase tracking-wide text-muted-foreground">Validation</p>
          <p
            className={cn(
              "mt-1 text-sm font-semibold",
              validation?.is_valid ? "text-success" : "text-foreground"
            )}
          >
            {validation ? (validation.is_valid ? "Prêt à enregistrer" : "Mapping en cours…") : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3">
          <p className="text-micro uppercase tracking-wide text-muted-foreground">Champs à compléter</p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {validation ? validation.missing_required_fields.length : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3">
          <p className="text-micro uppercase tracking-wide text-muted-foreground">Doublons</p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {duplicates ? duplicates.total_groups : "—"}
          </p>
        </div>
      </div>

      {validation && validation.missing_required_fields.length > 0 ? (
        <div className="px-4 pt-4 sm:px-6">
          <Alert variant="info">
            <AlertTitle>Champs requis à mapper</AlertTitle>
            <ul className="mt-1 list-inside list-disc text-sm text-foreground-secondary">
              {validation.missing_required_fields.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}

      {validation && validation.duplicate_target_assignments.length > 0 ? (
        <div className="px-4 pt-4 sm:px-6">
          <Alert variant="warning">
            <AlertTitle>Cibles dupliquées</AlertTitle>
            <ul className="mt-1 list-inside list-disc text-foreground-secondary">
              {validation.duplicate_target_assignments.map((entry) => (
                <li key={entry.target}>
                  <span className="font-medium">{entry.target}</span> assigné à : {entry.sources.join(", ")}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}

      <div
        className="table-scroll relative mt-4 overflow-x-auto border-t border-border-subtle"
        role="region"
        aria-label="Aperçu des lignes mappées"
        tabIndex={0}
      >
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Référence article</th>
              <th scope="col">Désignation</th>
              <th scope="col">Quantité</th>
              <th scope="col">Unité</th>
              <th scope="col">Prix fourniture</th>
              <th scope="col">Type FO</th>
              <th scope="col">Majoration MO</th>
              <th scope="col">État</th>
            </tr>
          </thead>
          <tbody aria-busy={isLoading || undefined}>
            {isLoading ? (
              <tr>
                <td colSpan={PREVIEW_COLUMNS} className="py-8 text-center text-sm text-muted-foreground">
                  <span role="status">Chargement de l’aperçu…</span>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <EmptyTableRow
                colSpan={PREVIEW_COLUMNS}
                variant="compact"
                title="Aucun aperçu disponible"
                description="Sélectionnez un import et mappez au moins une colonne."
              />
            ) : (
              rows.map((row) => {
                const hasMissingRequired = row.missing_required_fields.length > 0;

                return (
                  <tr key={row.row_index}>
                    <td>{row.row_index + 1}</td>
                    <td>{normalizeCell(row.mapped_row.hex_code)}</td>
                    <td>{normalizeCell(row.mapped_row.designation)}</td>
                    <td>{normalizeCell(row.mapped_row.quantity)}</td>
                    <td>{normalizeCell(row.mapped_row.unit)}</td>
                    <td>{normalizeCell(row.mapped_row.unit_price_ht)}</td>
                    <td>{normalizeCell(row.mapped_row.supply_type)}</td>
                    <td>{normalizeCell(row.mapped_row.h_mo_majoration)}</td>
                    <td>
                      <Badge variant={hasMissingRequired ? "warning" : "success"} size="sm">
                        {hasMissingRequired ? "À compléter" : "OK"}
                      </Badge>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {duplicates ? (
        <div className="border-t border-border px-4 py-4 text-xs text-muted-foreground sm:px-6">
          {duplicates.total_groups > 0
            ? `${plural(duplicates.total_groups, "groupe de doublons détecté", "groupes de doublons détectés")}, ${plural(duplicates.total_rows_impacted, "ligne impactée", "lignes impactées")}.`
            : "Aucun doublon détecté sur les lignes analysées."}
        </div>
      ) : null}
    </section>
  );
}
