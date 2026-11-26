"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ArrowUpIcon, ChevronDownIcon, Loader2Icon, Settings2Icon, SparklesIcon } from "lucide-react";

import { AssistantAiSettingsMenu, useAssistantAiSettings } from "@/components/ai/AssistantAiSettings";
import { useDashboardAssistant } from "@/components/assistant/dock-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { formatUsdCeiling } from "@/lib/ai/access/openai-pricing";
import { CHATGPT_REASONING_EFFORT_LABELS, chatGptReasoningEffortSchema } from "@/lib/ai/chatgpt-model-preferences";
import { AI_REQUEST_CEILINGS_NANO_USD } from "@/lib/ai/request-ceilings";
import { AI_REQUEST_SOURCE_LABELS } from "@/lib/ai/request-settings";
import type { CostingWorkbookColumnInspection } from "@/lib/catalogue/costing-workbook";
import { workbookCellText, workbookCellValue } from "@/lib/catalogue/costing-workbook-edits";
import type { CostingWorkbookRows } from "@/lib/catalogue/costing-workbook-file";
import { requestWorkbookSuggestions } from "@/lib/catalogue/costing-workbook-suggestions-client";
import { isZeroReliabilityCell, isZeroReliabilityCriterion, ZERO_RELIABILITY_CRITERION } from "@/lib/catalogue/workbook-reliability-filter";
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
  originalRows: CostingWorkbookRows;
  inspection: CostingWorkbookColumnInspection;
  disabled: boolean;
  visible?: boolean;
  onApply: (rows: readonly number[]) => boolean;
}>;

type Line = { row: number; description: string };
type Answer = CostingWorkbookSuggestionsResponseOf<"row_exclusions">;
type Proposal = {
  rows: CostingWorkbookRows;
  total: number;
  analysed: number;
  proposed: Line[];
  status: Answer["status"] | "running" | "stopped";
  message: string;
};
const BATCH_SIZE = COSTING_WORKBOOK_SUGGESTION_LIMITS.rowExclusions;

function batchesOf(rows: CostingWorkbookRows, headerRow: number | null): number[][] {
  if (headerRow === null) return [];
  const batches: number[][] = [];
  for (let index = headerRow; index < rows.length; index += 1) {
    if (rows[index].every((cell) => cell === null || String(cell).trim() === "")) continue;
    if (batches.length === 0 || batches[batches.length - 1].length === BATCH_SIZE) batches.push([]);
    batches[batches.length - 1].push(index + 1);
  }
  return batches;
}

function describeRows(rows: CostingWorkbookRows, { found, unrecognised }: CostingWorkbookColumnInspection) {
  const fields = [
    ...found.filter(({ column }) => column === "ID" || column === "Caractéristique"),
    ...found.filter(({ column }) => column !== "ID" && column !== "Caractéristique" && !column.endsWith("_URL")),
    ...unrecognised.map(({ index, text }) => ({ index, column: text.slice(0, 40) })),
  ];
  return (row: number): Line => {
    const description = fields.flatMap(({ index: column, column: label }) => {
      const value = workbookCellText(rows, row, column).slice(0, 160);
      return value ? [`${label}: ${value}`] : [];
    }).join(" · ").slice(0, COSTING_WORKBOOK_ROW_DESCRIPTION_MAX_LENGTH).trim();
    return { row, description: description || "Aucune valeur dans les colonnes nommées." };
  };
}

export function RowExclusions({ rows, originalRows, inspection, disabled, visible = true, onApply }: Props) {
  const dock = useDashboardAssistant();
  const sharedAi = useAssistantAiSettings();
  const publish = dock?.setWorkbookStatus;
  const [open, setOpen] = useState(false);
  const id = useId();
  const { sources, provider, selection: settings, chooseSettings, requestOptions, settingsLocked, lockSettings, loadProviders } = useWorkbookAssistant();
  const [criterion, setCriterion] = useState("");
  const [scope, setScope] = useState("0");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const pending = useRef<AbortController | null>(null);
  const criterionInput = useRef<HTMLTextAreaElement>(null);
  const resultTrigger = useRef<HTMLButtonElement>(null);
  const headerRow = inspection.missingRequired.length === 0 ? inspection.headerRow : null;
  const batches = useMemo(() => batchesOf(rows, headerRow), [rows, headerRow]);
  const snapshot = useMemo(() => ({ rows, originalRows }), [rows, originalRows]);
  const activeScope = scope === "all" || batches[Number(scope)] ? scope : "0";
  const scopedBatch = batches[Number(activeScope)];
  const requests = activeScope === "all" ? batches : scopedBatch ? [scopedBatch] : [];
  const total = requests.reduce((sum, lines) => sum + lines.length, 0);
  const answer = proposal?.rows === rows ? proposal : null;
  const loading = answer?.status === "running";
  const useReliabilityFilter = isZeroReliabilityCriterion(criterion);
  const sourceOptions = typeof sources === "object" ? sources : null;
  const apiKey = sourceOptions?.providers.personal_api_key;
  const activeModel = provider === "chatgpt_plan" || provider === "personal_api_key"
    ? sourceOptions?.providers[provider].models.find(({ id }) => id === requestOptions.model)?.name
    : undefined;
  const activeEffort = chatGptReasoningEffortSchema.safeParse(requestOptions.reasoning_effort).data;
  const sourceLabel = provider ? AI_REQUEST_SOURCE_LABELS[provider] : null;
  const keyConnectionId = provider === "personal_api_key" ? sharedAi?.options?.keyConnectionId : null;
  const payerReady = !sharedAi || provider !== "personal_api_key" || Boolean(keyConnectionId && !sharedAi.pending);
  const canAnalyse = visible && !disabled && !settingsLocked && !loading && criterion.trim().length > 0 && total > 0
    && (useReliabilityFilter || (sourceOptions !== null && provider !== null && payerReady));
  const proposed = answer?.proposed ?? [];
  const currentPage = boundedPage(page, proposed.length);
  const start = currentPage * DECISIONS_PER_PAGE;

  useEffect(() => () => pending.current?.abort(), [rows]);

  function resetProposal() {
    setProposal(null);
    setPage(0);
    setSelected(new Set());
  }

  const previewReliabilityZero = useCallback((rowNumbers: readonly number[]) => {
    if (!visible || disabled || settingsLocked || pending.current) return false;
    const column = headerRow === null ? undefined : inspection.found.find(({ column }) => column === "Fiabilité (/10)");
    const describe = describeRows(originalRows, inspection);
    const proposed = column ? rowNumbers
      .filter((row) => isZeroReliabilityCell(workbookCellValue(originalRows, row, column.index)))
      .map(describe) : [];
    setProposal({
      rows, total: rowNumbers.length, analysed: column ? rowNumbers.length : 0, proposed,
      status: column ? "deterministic" : "unavailable",
      message: column ? "Filtre basé sur les valeurs de la colonne « Fiabilité (/10) » dans le fichier Excel d’origine."
        : headerRow === null ? "Associez les colonnes requises pour afficher l’aperçu."
          : "Associez la colonne « Fiabilité (/10) » pour afficher l’aperçu.",
    });
    setPage(0);
    setSelected(new Set());
    setOpen(true);
    return true;
  }, [visible, disabled, settingsLocked, headerRow, inspection, originalRows, rows]);

  const previewAllReliabilityZero = useCallback(() => {
    if (!previewReliabilityZero(batches.flat())) return false;
    setCriterion(ZERO_RELIABILITY_CRITERION);
    setScope("all");
    return true;
  }, [batches, previewReliabilityZero]);

  async function analyse() {
    if (!canAnalyse || pending.current) return;
    if (useReliabilityFilter) {
      previewReliabilityZero(requests.flat());
      return;
    }
    if (!provider) return;
    const releaseSettings = lockSettings();
    if (!releaseSettings) return;
    const controller = new AbortController();
    const session = sharedAi ? { ...sharedAi.owner, ...(keyConnectionId ? { keyConnectionId } : {}) } : undefined;
    pending.current = controller;
    resetProposal();
    let progress: Proposal = { rows, total, analysed: 0, proposed: [], status: "running", message: "" };
    let status: Answer["status"] = "available";
    let message = "";
    setProposal(progress);
    const describe = describeRows(rows, inspection);
    try {
      for (const batch of requests) {
        const lines = batch.map(describe);
        const answer = await requestWorkbookSuggestions<"row_exclusions">(
          { task: "row_exclusions", ...requestOptions, provider, criterion: criterion.trim(), lines },
          controller.signal,
          session,
        );
        if (controller.signal.aborted) return;
        const matches = new Set(answer.items.map(({ row }) => row));
        progress = {
          ...progress,
          analysed: progress.analysed + answer.analysed,
          proposed: [...progress.proposed, ...lines.filter(({ row }) => matches.has(row))],
        };
        setProposal(progress);
        status = answer.status;
        message = answer.message;
        if (status !== "available") break;
      }
    } catch (error) {
      status = "failed";
      message = error instanceof Error ? error.message : "L’analyse n’a pas abouti. Réessayez.";
    } finally {
      pending.current = null;
      releaseSettings();
      if (!controller.signal.aborted) setProposal({ ...progress, status, message });
    }
  }

  function stopAnalysis() {
    pending.current?.abort();
    setProposal((current) => current?.status === "running"
      ? { ...current, status: "stopped", message: "Analyse arrêtée. Les propositions reçues restent disponibles." }
      : current);
  }

  const selection = proposed.filter(({ row }) => selected.has(row)).map(({ row }) => row);
  const triggerLabel = answer?.status === "running"
    ? `Analyse IA en cours · ${formatCount(answer.analysed)} / ${formatCount(answer.total)}`
    : "Consulter les résultats de l’analyse IA";
  const resultAvailable = answer !== null && !loading;
  const statusLabel = answer ? triggerLabel : "Écarter des lignes";
  useEffect(() => {
    publish?.({ running: loading, result: resultAvailable, label: statusLabel, snapshot, prepare: setCriterion,
      previewReliabilityZero: previewAllReliabilityZero });
  }, [publish, loading, resultAvailable, statusLabel, snapshot, previewAllReliabilityZero]);
  useEffect(() => () => publish?.(null), [publish]);
  useEffect(() => { if (!visible) setOpen(false); }, [visible]);
  const workbookActive = dock?.workbookActive;
  useEffect(() => {
    if (visible && workbookActive) {
      const target = criterionInput.current?.disabled ? resultTrigger.current : criterionInput.current;
      target?.focus({ preventScroll: true });
    }
  }, [visible, workbookActive]);

  let scopeHelp = "L’IA applique la consigne à chaque ligne à partir d’un extrait de ses cellules.";
  if (headerRow === null) scopeHelp = "Associez les colonnes requises pour analyser les lignes.";
  else if (total === 0) scopeHelp = "Aucune ligne à analyser.";
  else if (useReliabilityFilter) scopeHelp = "Filtre direct sur la fiabilité dans le fichier Excel d’origine.";
  else if (sourceOptions && !provider) scopeHelp = "Choisissez une source dans Réglages IA pour analyser les lignes.";
  else if (!payerReady) scopeHelp = "Actualisez les sources IA pour vérifier la clé avant de lancer l’analyse.";
  else if (provider === "personal_api_key") {
    const ceiling = formatUsdCeiling(requests.length * AI_REQUEST_CEILINGS_NANO_USD.shortQuestion);
    scopeHelp = requests.length === 1 ? `${ceiling} au plus pour cette demande.`
      : `Jusqu’à ${formatCount(requests.length)} demandes et ${ceiling} au total.`;
  } else if (requests.length > 1) scopeHelp = `Jusqu’à ${formatCount(requests.length)} demandes successives.`;

  const composer = (
    <form aria-label="Assistant du classeur"
          className="pointer-events-auto mx-auto max-w-5xl rounded-[1.5rem] border border-(--workbook-composer-border) bg-(--workbook-composer-surface) p-2 text-(--workbook-composer-text) shadow-xl focus-within:border-(--workbook-composer-muted) sm:rounded-[1.75rem] sm:p-3"
          onSubmit={(event) => { event.preventDefault(); void analyse(); }}>
          <FieldLabel htmlFor={`${id}-criterion`} className="sr-only">Quelles lignes souhaitez-vous supprimer ?</FieldLabel>
          <Textarea ref={criterionInput} id={`${id}-criterion`} aria-describedby={`${id}-criterion-help`}
            value={criterion} maxLength={COSTING_WORKBOOK_ROW_CRITERION_MAX_LENGTH}
            placeholder="Décrivez les lignes à écarter de l’import…"
            className="min-h-16 max-h-40 resize-none border-0 bg-transparent px-3 py-2 leading-relaxed text-(--workbook-composer-text) placeholder:text-(--workbook-composer-muted) focus-visible:ring-0 disabled:bg-transparent sm:min-h-20 sm:px-4"
            disabled={loading}
            onChange={(event) => { setCriterion(event.target.value); resetProposal(); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-1 sm:px-2">
            {batches.length > 1 ? (
              <NativeSelect aria-label="Lignes à analyser" size="sm"
                wrapperClassName="w-auto max-w-full [&>svg]:text-(--workbook-composer-muted)"
                className="rounded-full border-(--workbook-composer-border) bg-(--workbook-composer-control) text-(--workbook-composer-text) [color-scheme:dark] hover:border-(--workbook-composer-muted) focus-visible:border-(--workbook-composer-muted) focus-visible:ring-0 disabled:bg-(--workbook-composer-control)"
                value={activeScope} disabled={loading}
                onChange={(event) => { setScope(event.target.value); resetProposal(); }}>
                <option value="all">Tout l’onglet</option>
                {batches.map((group, index) => <option key={group[0]} value={index}>
                  Lignes {formatCount(group[0])} à {formatCount(group[group.length - 1])}
                </option>)}
              </NativeSelect>
            ) : null}
            <p id={`${id}-criterion-help`} className="min-w-32 flex-1 text-xs leading-snug text-(--workbook-composer-muted)">
              {scopeHelp}
            </p>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {dock ? (
                <AssistantAiSettingsMenu contextOptions={dock.contextOptions} locked={settingsLocked} onRefresh={() => {
                  loadProviders(true);
                  sharedAi?.refresh();
                }} scopeChoices={sourceOptions ? {
                  sources: sourceOptions.providers, defaultSource: sourceOptions.defaultProvider,
                  choice: settings, onChange: chooseSettings, allowRulesOnly: true,
                } : undefined} keyCeiling={AI_REQUEST_CEILINGS_NANO_USD.shortQuestion} />
              ) : <Popover>
                <PopoverTrigger render={<Button type="button" aria-label="Réglages IA" variant="ghost" size="sm"
                  className="h-auto max-w-full rounded-full px-2.5 py-1.5 text-left text-(--workbook-composer-text) hover:bg-(--workbook-composer-control) hover:text-(--workbook-composer-text) aria-expanded:bg-(--workbook-composer-control) aria-expanded:text-(--workbook-composer-text)"
                  leftIcon={<Settings2Icon aria-hidden="true" />} rightIcon={<ChevronDownIcon aria-hidden="true" />} />}>
                  <span className="min-w-0">
                    <span className="block truncate">{activeModel ?? sourceLabel ?? "Réglages IA"}</span>
                    {activeModel && sourceLabel ? (
                      <span className="block truncate text-xs font-normal text-(--workbook-composer-muted)">
                        {sourceLabel} · {activeEffort ? CHATGPT_REASONING_EFFORT_LABELS[activeEffort] : "Automatique"}
                      </span>
                    ) : null}
                  </span>
                </PopoverTrigger>
                <PopoverContent align="start" side="top" sideOffset={8} className="w-[min(28rem,calc(100vw-1.5rem))] border border-border p-3">
                  <PopoverTitle>Réglages IA du classeur</PopoverTitle>
                  <AssistantProviderSelect />
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
                        <Button type="button" size="xs" variant="ghost" disabled={settingsLocked} onClick={() => loadProviders(true)}>
                          Actualiser les sources d’IA
                        </Button>
                      </div>
                    </>
                  ) : null}
                </PopoverContent>
              </Popover>}
              {answer ? (
                <DialogTrigger render={<Button ref={resultTrigger} type="button" variant="secondary" size="sm"
                  className="rounded-full border-(--workbook-composer-border) bg-(--workbook-composer-control) text-(--workbook-composer-text) hover:border-(--workbook-composer-muted) hover:bg-(--workbook-composer-control)"
                  leftIcon={loading ? <Loader2Icon aria-hidden="true" className="motion-safe:animate-spin" /> : <SparklesIcon aria-hidden="true" />} />}>
                  {triggerLabel}
                </DialogTrigger>
              ) : null}
              {!loading ? (
                <Button type="submit" size="icon-lg" disabled={!canAnalyse}
                  aria-label={`Analyser ${formatCount(total)} ${plural(total, "ligne", "lignes")}`}
                  className="size-11 shrink-0 rounded-full bg-(--workbook-composer-send) text-(--workbook-composer-send-text) shadow-none hover:bg-(--workbook-composer-send-hover) focus-visible:outline-(--workbook-composer-send-hover)">
                  <ArrowUpIcon aria-hidden="true" className="size-5" />
                </Button>
              ) : null}
            </div>
          </div>
    </form>
  );
  return (
    <Dialog open={visible && open} onOpenChange={setOpen}>
      {dock ? (dock.workbookControls ? createPortal(composer, dock.workbookControls) : null) : (
        <div className="pointer-events-none sticky bottom-0 z-20 mt-4 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          {composer}
        </div>
      )}
      <DialogContent size="lg" finalFocus={() => resultTrigger.current?.isConnected ? resultTrigger.current : criterionInput.current ?? true}>
        <DialogHeader>
          <DialogTitle>{useReliabilityFilter ? "Lignes dont la fiabilité Excel est à zéro" : "Supprimer des lignes avec l’IA"}</DialogTitle>
          <DialogDescription>Vérifiez les propositions puis choisissez les lignes à écarter de cet import.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {answer?.status === "running" ? (
            <p role="status" className="text-muted-foreground">{formatCount(answer.analysed)} sur {formatCount(answer.total)} lignes analysées…</p>
          ) : answer ? (
            <div className="space-y-2">
              <p role="status" className="font-medium">
                {formatCount(proposed.length)} {plural(proposed.length, "ligne proposée", "lignes proposées")} sur {formatCount(answer.analysed)} {plural(answer.analysed, "ligne analysée", "lignes analysées")}
              </p>
              {answer.analysed < answer.total ? (
                <p className="text-xs text-muted-foreground">L’analyse a couvert {formatCount(answer.analysed)} lignes sur les {formatCount(answer.total)} demandées.</p>
              ) : null}
              {answer.status !== "available" ? <SuggestionStatus status={answer.status === "stopped" ? "partial" : answer.status} message={answer.message} /> : null}
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
            {loading ? <Button variant="ghost" onClick={stopAnalysis}>Arrêter l’analyse</Button> : null}
            <DialogClose render={<Button variant="outline" />}>Fermer les résultats</DialogClose>
            <Button disabled={!visible || disabled || loading || selection.length === 0} onClick={() => {
              if (onApply(selection)) setOpen(false);
            }}>
              {selection.length > 0 ? `Écarter ${formatCount(selection.length)} ${plural(selection.length, "ligne", "lignes")} de l’import` : "Écarter les lignes sélectionnées"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
