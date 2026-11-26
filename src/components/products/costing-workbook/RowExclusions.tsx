"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { SparklesIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatUsdCeiling } from "@/lib/ai/access/openai-pricing";
import { AI_REQUEST_CEILINGS_NANO_USD } from "@/lib/ai/request-ceilings";
import type { CostingWorkbookColumnInspection } from "@/lib/catalogue/costing-workbook";
import { workbookCellText } from "@/lib/catalogue/costing-workbook-edits";
import type { CostingWorkbookRows } from "@/lib/catalogue/costing-workbook-file";
import { requestWorkbookSuggestions } from "@/lib/catalogue/costing-workbook-suggestions-client";
import {
  COSTING_WORKBOOK_ROW_CRITERION_MAX_LENGTH,
  COSTING_WORKBOOK_ROW_DESCRIPTION_MAX_LENGTH,
  COSTING_WORKBOOK_SUGGESTION_LIMITS,
  type CostingWorkbookSuggestionsResponseOf,
} from "@/lib/catalogue/costing-workbook-suggestions-contract";

import { AssistantProviderSelect, SuggestionStatus, useWorkbookAssistant } from "./assistant";
import { boundedPage, DECISIONS_PER_PAGE, formatCount, plural, ReviewPager } from "./shared";

type Props = Readonly<{
  rows: CostingWorkbookRows;
  inspection: CostingWorkbookColumnInspection;
  disabled: boolean;
  onApply: (rows: readonly number[]) => boolean;
}>;

type Line = { row: number; description: string };
type Answer = CostingWorkbookSuggestionsResponseOf<"row_exclusions">;
type Proposal = { rows: CostingWorkbookRows; analysed: number; proposed: Line[]; status: Answer["status"]; message: string };
const BATCH_SIZE = COSTING_WORKBOOK_SUGGESTION_LIMITS.rowExclusions;

function batchesOf(rows: CostingWorkbookRows, inspection: CostingWorkbookColumnInspection): Line[][] {
  const { headerRow, found, unrecognised } = inspection;
  if (headerRow === null) return [];
  const fields = [
    ...found.filter(({ column }) => column === "ID" || column === "Caractéristique"),
    ...found.filter(({ column }) => column !== "ID" && column !== "Caractéristique" && !column.endsWith("_URL")),
    ...unrecognised.map(({ index, text }) => ({ index, column: text.slice(0, 40) })),
  ];
  const batches: Line[][] = [];
  for (let index = headerRow; index < rows.length; index += 1) {
    const row = index + 1;
    const cells = rows[index];
    if (cells.every((cell) => cell === null || String(cell).trim() === "")) continue;
    const description = fields.flatMap(({ index: column, column: label }) => {
      const value = workbookCellText(rows, row, column).slice(0, 160);
      return value ? [`${label}: ${value}`] : [];
    }).join(" · ").slice(0, COSTING_WORKBOOK_ROW_DESCRIPTION_MAX_LENGTH).trim();
    if (batches.length === 0 || batches[batches.length - 1].length === BATCH_SIZE) batches.push([]);
    batches[batches.length - 1].push({ row, description: description || "Aucune valeur dans les colonnes nommées." });
  }
  return batches;
}

export function RowExclusions({ rows, inspection, disabled, onApply }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" disabled={disabled} leftIcon={<SparklesIcon aria-hidden="true" />} />}>
        Supprimer des lignes avec l’IA
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Supprimer des lignes avec l’IA</DialogTitle>
          <DialogDescription>Vérifiez les propositions puis choisissez les lignes à écarter de cet import.</DialogDescription>
        </DialogHeader>
        {open ? <RowExclusionsForm rows={rows} inspection={inspection} disabled={disabled} onApply={(selection) => {
          if (!onApply(selection)) return false;
          setOpen(false);
          return true;
        }} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function RowExclusionsForm({ rows, inspection, disabled, onApply }: Props) {
  const id = useId();
  const { sources, provider, requestOptions, settingsLocked, lockSettings, loadProviders } = useWorkbookAssistant();
  const [criterion, setCriterion] = useState("");
  const [scope, setScope] = useState("0");
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const pending = useRef<AbortController | null>(null);
  const batches = useMemo(() => batchesOf(rows, inspection), [rows, inspection]);
  const scopedBatch = batches[Number(scope)];
  const requests = scope === "all" ? batches : scopedBatch ? [scopedBatch] : [];
  const total = requests.reduce((sum, lines) => sum + lines.length, 0);
  const answer = proposal?.rows === rows ? proposal : null;
  const sourceOptions = typeof sources === "object" ? sources : null;
  const apiKey = sourceOptions?.providers.personal_api_key;
  const canAnalyse = sourceOptions !== null && provider !== null && !disabled && !settingsLocked
    && criterion.trim().length > 0 && total > 0;
  const proposed = answer?.proposed ?? [];
  const currentPage = boundedPage(page, proposed.length);
  const start = currentPage * DECISIONS_PER_PAGE;

  useEffect(() => () => pending.current?.abort(), []);

  function resetProposal() {
    setProposal(null);
    setPage(0);
    setSelected(new Set());
    setFailure(null);
  }

  async function analyse() {
    if (!canAnalyse || !provider || pending.current) return;
    const releaseSettings = lockSettings();
    if (!releaseSettings) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    resetProposal();
    let analysed = 0;
    const proposed: Line[] = [];
    try {
      for (const lines of requests) {
        const answer = await requestWorkbookSuggestions<"row_exclusions">(
          { task: "row_exclusions", ...requestOptions, provider, criterion: criterion.trim(), lines },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        analysed += answer.analysed;
        const matches = new Set(answer.items.map(({ row }) => row));
        proposed.push(...lines.filter(({ row }) => matches.has(row)));
        setProposal({ rows, analysed, proposed: [...proposed], status: answer.status, message: answer.message });
        if (answer.status !== "available") break;
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setFailure(error instanceof Error ? error.message : "L’analyse n’a pas abouti. Réessayez.");
      }
    } finally {
      pending.current = null;
      releaseSettings();
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  const selection = proposed.filter(({ row }) => selected.has(row)).map(({ row }) => row);
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <FieldLabel htmlFor={`${id}-criterion`}>Quelles lignes souhaitez-vous supprimer ?</FieldLabel>
        <Textarea id={`${id}-criterion`} aria-describedby={`${id}-criterion-help`}
          value={criterion} maxLength={COSTING_WORKBOOK_ROW_CRITERION_MAX_LENGTH}
          placeholder="Par exemple, les articles en acier galvanisé"
          disabled={loading} onChange={(event) => { setCriterion(event.target.value); resetProposal(); }} />
        <p id={`${id}-criterion-help`} className="text-xs text-muted-foreground">
          L’IA applique le critère à chaque ligne à partir d’un extrait de ses cellules.
        </p>
      </div>
      <div className="space-y-2">
        <AssistantProviderSelect required />
        {sourceOptions && apiKey ? (
          <>
            {!apiKey.available && (provider !== null || sourceOptions.defaultProvider !== "personal_api_key") ? (
              <p className="text-xs text-muted-foreground">{apiKey.message}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <a href={settingsLocked ? undefined : "/dashboard/profile#section-cle-api"} target="_blank" rel="noopener noreferrer"
                aria-disabled={settingsLocked || undefined}
                className={buttonVariants({ variant: "outline", size: "xs", className: "aria-disabled:opacity-50" })}>
                {apiKey.available ? "Gérer la clé API" : "Configurer la clé API"}
                <span className="sr-only"> (nouvel onglet)</span>
              </a>
              <Button size="xs" variant="ghost" disabled={settingsLocked} onClick={() => loadProviders(true)}>
                Actualiser les sources d’IA
              </Button>
            </div>
          </>
        ) : null}
      </div>
      {batches.length > 1 ? (
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${id}-range`}>Lignes à analyser</FieldLabel>
          <NativeSelect id={`${id}-range`} value={scope} disabled={loading}
            onChange={(event) => { setScope(event.target.value); resetProposal(); }}>
            <option value="all">Tout l’onglet</option>
            {batches.map((group, index) => <option key={group[0].row} value={index}>
              {formatCount(group[0].row)} à {formatCount(group[group.length - 1].row)} ({formatCount(group.length)} lignes)
            </option>)}
          </NativeSelect>
        </div>
      ) : null}
      {requests.length > 1 && provider ? (
        <p className="text-xs text-muted-foreground">
          {provider === "personal_api_key"
            ? `Jusqu’à ${formatCount(requests.length)} demandes et ${formatUsdCeiling(requests.length * AI_REQUEST_CEILINGS_NANO_USD.shortQuestion)} au total.`
            : `Jusqu’à ${formatCount(requests.length)} demandes successives.`}
        </p>
      ) : null}
      <Button variant="secondary" loading={loading} disabled={!canAnalyse}
        onClick={() => void analyse()}>
        Analyser {formatCount(total)} {plural(total, "ligne", "lignes")}
      </Button>
      {total === 0 ? <p role="status" className="text-muted-foreground">Aucune ligne à analyser.</p> : null}
      {failure ? <SuggestionStatus status="failed" message={failure} /> : null}
      {loading ? (
        <p role="status" className="text-muted-foreground">{formatCount(answer?.analysed ?? 0)} sur {formatCount(total)} lignes analysées…</p>
      ) : answer ? (
        <div className="space-y-2">
          <p role="status" className="font-medium">
            {formatCount(proposed.length)} {plural(proposed.length, "ligne proposée", "lignes proposées")} sur {formatCount(answer.analysed)} {plural(answer.analysed, "ligne analysée", "lignes analysées")}
          </p>
          {answer.analysed < total ? (
            <p className="text-xs text-muted-foreground">L’analyse a couvert {formatCount(answer.analysed)} lignes sur les {formatCount(total)} demandées.</p>
          ) : null}
          {answer.status !== "available" ? <SuggestionStatus status={answer.status} message={answer.message} /> : null}
          {proposed.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="xs" variant="outline" onClick={() => setSelected(selection.length === proposed.length ? new Set() : new Set(proposed.map(({ row }) => row)))}>
                  {selection.length === proposed.length ? "Tout désélectionner" : "Tout sélectionner"}
                </Button>
                <ReviewPager page={currentPage} total={proposed.length} onSelect={setPage} />
              </div>
              <ul aria-label="Lignes proposées à la suppression" className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {proposed.slice(start, start + DECISIONS_PER_PAGE).map(({ row, description }) => (
                  <li key={row}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-subtle">
                      <input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary"
                        checked={selected.has(row)} onChange={(event) => {
                          const checked = event.target.checked;
                          setSelected((current) => {
                            const next = new Set(current);
                            if (checked) next.add(row);
                            else next.delete(row);
                            return next;
                          });
                        }} />
                      <span className="min-w-0 wrap-anywhere">
                        <strong className="block">Ligne Excel {formatCount(row)}</strong>
                        <span className="text-muted-foreground">{description}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Annuler</DialogClose>
        <Button disabled={disabled || loading || selection.length === 0} onClick={() => onApply(selection)}>
          {selection.length > 0 ? `Écarter ${formatCount(selection.length)} ${plural(selection.length, "ligne", "lignes")} de l’import` : "Écarter les lignes sélectionnées"}
        </Button>
      </DialogFooter>
    </div>
  );
}
