"use client";

import { useId, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { CostingWorkbookColumn, CostingWorkbookColumnInspection } from "@/lib/catalogue/costing-workbook";
import { workbookCellAddress, workbookCellText } from "@/lib/catalogue/costing-workbook-edits";
import { missingColumnEffect } from "@/lib/catalogue/costing-workbook-review";
import { requestWorkbookSuggestions } from "@/lib/catalogue/costing-workbook-suggestions-client";
import {
  COSTING_WORKBOOK_SUGGESTION_LIMITS,
  type CostingWorkbookSuggestionsResponseOf,
} from "@/lib/catalogue/costing-workbook-suggestions-contract";
import { catalogueErrorMessage } from "@/lib/catalogue/supplier-items-client";

import { confidenceLabel, SuggestButton, SuggestionStatus, useWorkbookAssistant } from "./assistant";
import { useWorkbookEditor } from "./shared";

type ColumnSuggestion = NonNullable<CostingWorkbookSuggestionsResponseOf<"columns">["items"][number]["suggestion"]>;

/**
 * The columns the reader found in the sheet's header row, and those it did not (TI-711). A renamed header
 * (« PR FO » for « PR. FO ») is the usual cause: the office points the missing column to its header here, which
 * renames that header in the rows the screen holds, never in the Excel file.
 */

const columnLetter = (row: number, index: number) => workbookCellAddress(row, index).replace(/\d+$/, "");

function MissingColumn({ column, required, inspection, suggestion }: Readonly<{
  column: CostingWorkbookColumn;
  required: boolean;
  inspection: CostingWorkbookColumnInspection;
  /** The header proposed for this column, by the rules or by the AI source. */
  suggestion?: ColumnSuggestion;
}>) {
  const selectId = useId();
  const { busy, applyEdits } = useWorkbookEditor();
  const headerRow = inspection.headerRow;
  const effect = required ? "sans elle, le classeur ne peut pas être lu" : missingColumnEffect(column);
  const proposed = suggestion?.index === null || suggestion?.index === undefined
    ? undefined : inspection.unrecognised.find((header) => header.index === suggestion.index);
  return (
    <li className="grid gap-2 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="font-mono">{column}</span>
          <Badge variant={required ? "danger" : effect ? "warning" : "neutral"} size="sm">
            {required ? "obligatoire" : "absente"}
          </Badge>
        </p>
        {effect ? <p className="text-xs text-muted-foreground">{`Sans cette colonne, ${effect}.`}</p> : null}
        {headerRow !== null && proposed && suggestion ? (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span>
              {`Proposition : ${columnLetter(headerRow, proposed.index)} · ${proposed.text}`}
              {suggestion.source === "ai" ? ` (IA, ${confidenceLabel(suggestion.confidence)})` : ""}
            </span>
            <Button
              variant="outline"
              size="xs"
              disabled={busy}
              aria-label={`Lire ${proposed.text} comme ${column}`}
              onClick={() => applyEdits([{ row: headerRow, column: proposed.index, value: column }])}
            >
              Utiliser
            </Button>
          </p>
        ) : null}
      </div>
      {headerRow !== null && inspection.unrecognised.length > 0 ? (
        <div className="min-w-0">
          <label htmlFor={selectId} className="sr-only">{`En-tête du classeur à lire comme ${column}`}</label>
          <NativeSelect
            id={selectId}
            size="sm"
            value=""
            disabled={busy}
            onChange={(event) => {
              const index = Number(event.currentTarget.value);
              if (event.currentTarget.value !== "" && Number.isInteger(index)) {
                applyEdits([{ row: headerRow, column: index, value: column }]);
              }
            }}
          >
            <option value="">Lire une autre colonne…</option>
            {inspection.unrecognised.map(({ index, text }) => (
              <option key={index} value={index}>{`${columnLetter(headerRow, index)} · ${text}`}</option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
    </li>
  );
}

export function ColumnsPanel({ inspection }: Readonly<{ inspection: CostingWorkbookColumnInspection }>) {
  const { headerRow, found, missingRequired, missingOptional, unrecognised } = inspection;
  const { rows, busy } = useWorkbookEditor();
  const { provider } = useWorkbookAssistant();
  const [suggestions, setSuggestions] = useState<ReadonlyMap<string, ColumnSuggestion>>(new Map());
  const [outcome, setOutcome] = useState<{ status: CostingWorkbookSuggestionsResponseOf<"columns">["status"]; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = [...missingRequired, ...missingOptional];

  async function suggest() {
    if (headerRow === null) return;
    setLoading(true);
    setError(null);
    try {
      const answer = await requestWorkbookSuggestions({
        task: "columns",
        ...(provider ? { provider } : {}),
        missing,
        headers: unrecognised.slice(0, COSTING_WORKBOOK_SUGGESTION_LIMITS.headers).map(({ index, text }) => {
          // The first values under the header say what the column holds.
          const samples: string[] = [];
          for (let row = headerRow + 1; row <= rows.length && samples.length < COSTING_WORKBOOK_SUGGESTION_LIMITS.samples; row += 1) {
            const value = workbookCellText(rows, row, index);
            if (value) samples.push(value.slice(0, 255));
          }
          return { index, text: text.slice(0, 255), samples };
        }),
      });
      setSuggestions(new Map(answer.items.flatMap((item) => (item.suggestion ? [[item.column, item.suggestion] as const] : []))));
      setOutcome({ status: answer.status, message: answer.message });
    } catch (failure) {
      setError(catalogueErrorMessage(failure, "Les propositions de colonnes n’ont pas pu être demandées."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="costing-workbook-columns-title" className="space-y-4">
      <div className="space-y-1">
        <h3 id="costing-workbook-columns-title" className="typo-h3">Colonnes du classeur</h3>
        <p className="text-sm text-muted-foreground">
          {headerRow === null
            ? "Aucune ligne d’en-têtes n’a été trouvée dans les dix premières lignes."
            : `En-têtes lus à la ligne ${headerRow}. Une colonne renommée dans le classeur peut être désignée ici : le fichier Excel n’est pas modifié.`}
        </p>
      </div>

      {missingRequired.length > 0 ? (
        <Alert variant="danger">
          {`${missingRequired.length === 1 ? "Une colonne obligatoire manque" : "Des colonnes obligatoires manquent"} : ${missingRequired.join(", ")}.`}
        </Alert>
      ) : null}

      {missing.length > 0 && unrecognised.length > 0 ? (
        <div className="space-y-1">
          <SuggestButton label="Proposer les colonnes" withAi loading={loading} disabled={busy} onClick={() => void suggest()} />
          {error ? <p role="alert" className="text-xs font-medium text-danger">{error}</p> : null}
          {outcome ? <SuggestionStatus status={outcome.status} message={outcome.message} /> : null}
          {outcome && suggestions.size === 0 ? <p className="text-xs text-muted-foreground">Aucun en-tête du classeur ne correspond à une colonne absente.</p> : null}
        </div>
      ) : null}

      {missing.length > 0 ? (
        <ul aria-label="Colonnes absentes du classeur" className="divide-y divide-border rounded-md border border-border px-3">
          {missingRequired.map((column) => (
            <MissingColumn key={column} column={column} required inspection={inspection} suggestion={suggestions.get(column)} />
          ))}
          {missingOptional.map((column) => (
            <MissingColumn key={column} column={column} required={false} inspection={inspection} suggestion={suggestions.get(column)} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-success">Toutes les colonnes attendues sont présentes.</p>
      )}

      {headerRow !== null && found.length > 0 ? (
        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold">{`${found.length} colonnes reconnues`}</h4>
          <ul aria-label="Colonnes reconnues" className="flex flex-wrap gap-1.5">
            {found.map(({ column, index }) => (
              <li key={column} className="rounded border border-border bg-surface-subtle px-2 py-0.5 text-xs">
                <span className="font-mono text-muted-foreground">{columnLetter(headerRow, index)}</span> {column}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {headerRow !== null && unrecognised.length > 0 ? (
        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold">{`${unrecognised.length} ${unrecognised.length === 1 ? "colonne non lue" : "colonnes non lues"}`}</h4>
          <p className="break-words text-xs text-muted-foreground">
            {unrecognised.map(({ index, text }) => `${columnLetter(headerRow, index)} · ${text}`).join(" ; ")}
          </p>
        </div>
      ) : null}
    </section>
  );
}
