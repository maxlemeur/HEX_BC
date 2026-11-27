"use client";

import { useEffect, useMemo, useState } from "react";

import { AssistantAiFeatureSettings, effectiveAiChoice, useAssistantAiSettings } from "@/components/ai/AssistantAiSettings";
import { LoadingState } from "@/components/layout/loading-state";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { AI_REQUEST_CEILINGS_NANO_USD } from "@/lib/ai/request-ceilings";
import { defaultAiRequestSettings, type AiRequestSettingsValue } from "@/lib/ai/request-settings";
import {
  arbitrateEstimatePriceReuse,
  previewEstimatePriceReuse,
} from "@/lib/estimates/price-reuse-client";
import { fetchEstimateImportSources } from "@/lib/estimates/section-copy-client";
import type { EstimateImportSourceVersion } from "@/lib/estimates/section-copy-contracts";
import {
  PRICE_REUSE_ARBITRATION_MAX_LINES,
  PRICE_REUSE_KEY_MAX_LINES,
  type PriceReusePreview,
  type PriceReusePreviewLine,
  type PriceReuseProvider,
  type PriceReuseReferenceView,
} from "@/lib/estimates/price-reuse-contracts";
import { formatEUR } from "@/lib/money";
import { plural } from "@/lib/text/plural";
import type { PriceReuseDialogProps } from "@/hooks/estimate-editor-view-props";

// Reprise des prix d'un devis de référence (docs/metier/reprise-des-prix.md) : le rapprochement propose, l'IA
// départage sur demande, l'utilisateur retient ; rien n'est écrit avant « Appliquer ».

type Origin = "identical" | "pending" | "manual" | PriceReuseProvider;
type RowState = { referenceId: string | null; checked: boolean; origin: Origin | null; confidence: number | null };
type Filter = "all" | PriceReusePreviewLine["status"];

const PROVIDER_LABELS: Record<PriceReuseProvider, string> = { decisions: "Decisions", chatgpt: "ChatGPT", personal_api_key: "Clé API OpenAI" };
const FILTER_LABELS: Record<Filter, string> = {
  all: "Toutes les lignes", identical: "Identiques", to_review: "À vérifier", new: "Sans correspondance",
};
const hours = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 });

function formatSourceLabel(source: EstimateImportSourceVersion) {
  return `V${source.versionNumber} - ${source.projectName} - ${source.title?.trim() || "Sans titre"}`;
}

function originLabel(row: RowState) {
  if (!row.origin) return "";
  if (row.origin === "identical") return "Identique";
  if (row.origin === "pending") return "À confirmer";
  if (row.origin === "manual") return "Choix manuel";
  const provider = PROVIDER_LABELS[row.origin];
  if (!row.referenceId) return `${provider} : aucun article`;
  return row.confidence === null ? provider : `${provider} · ${Math.round(row.confidence * 100)} %`;
}

function referenceLabel(reference: PriceReuseReferenceView | undefined) {
  if (!reference) return "Article introuvable";
  const section = reference.section_path.at(-1);
  return `${reference.title}${section ? ` — ${section}` : ""}`;
}

function initialRows(preview: PriceReusePreview): Record<string, RowState> {
  return Object.fromEntries(preview.lines.map((line) => [line.line_id, {
    referenceId: line.proposed_reference_line_id,
    checked: line.preselected,
    origin: line.status === "identical" ? "identical" : line.status === "to_review" ? "pending" : null,
    confidence: null,
  } satisfies RowState]));
}

export function PriceReuseDialog({ isOpen, targetVersionId, onClose, prepareComparison, onConfirm }: PriceReuseDialogProps) {
  const [sources, setSources] = useState<EstimateImportSourceVersion[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [referenceVersionId, setReferenceVersionId] = useState("");
  const [preview, setPreview] = useState<PriceReusePreview | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const common = useAssistantAiSettings();
  const [aiSelection, setAiSelection] = useState<AiRequestSettingsValue>();
  const [keyProgress, setKeyProgress] = useState<{ settings: string; answered: ReadonlySet<string> }>();
  const [arbitrating, setArbitrating] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setIsLoadingSources(true);
    setSourcesError(null);
    fetchEstimateImportSources({ excludeVersionId: targetVersionId })
      .then((items) => {
        if (!active) return;
        setSources(items);
        setReferenceVersionId((current) => current || items[0]?.id || "");
      })
      .catch((error: unknown) => {
        if (active) setSourcesError(error instanceof Error ? error.message : "Impossible de charger les devis.");
      })
      .finally(() => {
        if (active) setIsLoadingSources(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, targetVersionId]);

  const referencesById = useMemo(
    () => new Map((preview?.references ?? []).map((reference) => [reference.reference_line_id, reference])),
    [preview]
  );
  const toArbitrate = useMemo(
    () => (preview?.lines ?? []).filter((line) => line.status === "to_review" && line.candidates.length > 0),
    [preview]
  );
  const selections = useMemo(
    () => (preview?.lines ?? []).flatMap((line) => {
      const row = rows[line.line_id];
      return row?.checked && row.referenceId ? [{ line_id: line.line_id, reference_line_id: row.referenceId }] : [];
    }),
    [preview, rows]
  );
  const aiProposals = useMemo(
    () => Object.entries(rows).filter(([, row]) =>
      (row.origin === "decisions" || row.origin === "chatgpt" || row.origin === "personal_api_key") && row.referenceId && !row.checked)
      .map(([lineId]) => lineId),
    [rows]
  );
  const visibleLines = (preview?.lines ?? []).filter((line) => filter === "all" || line.status === filter);
  const aiSources = preview ? {
    chatgpt_plan: preview.arbiters.chatgpt, personal_api_key: preview.arbiters.personal_api_key, decisions: preview.arbiters.decisions,
  } : {};
  const aiSettings = effectiveAiChoice(aiSelection?.source === "decisions" ? undefined : common?.choice,
    aiSelection ?? defaultAiRequestSettings(preview?.default_billing_source ?? null, aiSources), aiSources);
  const settingsKey = JSON.stringify(aiSettings);
  const keyAnswered = keyProgress?.settings === settingsKey ? keyProgress.answered : undefined;
  const isBusy = isComparing || isSubmitting || arbitrating;
  // A row already retained or chosen by hand stays the user's choice.
  const eligibleLines = toArbitrate.filter((line) => !rows[line.line_id]?.checked && rows[line.line_id]?.origin !== "manual");
  const unansweredOnKey = keyAnswered ? eligibleLines.filter((line) => !keyAnswered.has(line.line_id)) : eligibleLines;
  const canContinueOnKey = aiSettings.source === "personal_api_key" && unansweredOnKey.length > 0
    && unansweredOnKey.length < eligibleLines.length;

  const updateRow = (lineId: string, patch: Partial<RowState>) =>
    setRows((current) => ({ ...current, [lineId]: { ...current[lineId], ...patch } }));

  async function compare() {
    if (!referenceVersionId) return;
    setIsComparing(true);
    setCompareError(null);
    setSubmitError(null);
    setAiStatus(null);
    setAiSelection(undefined);
    setKeyProgress(undefined);
    // A new comparison replaces the previous one: its rows are no longer shown nor selectable meanwhile.
    setPreview(null);
    setRows({});
    try {
      if (!(await prepareComparison())) {
        setPreview(null);
        setCompareError("Les modifications en cours doivent être enregistrées avant la comparaison. Réessayez.");
        return;
      }
      const result = await previewEstimatePriceReuse(targetVersionId, referenceVersionId);
      setPreview(result);
      setRows(initialRows(result));
      setFilter("all");
    } catch (error) {
      setPreview(null);
      setCompareError(error instanceof Error ? error.message : "Impossible de comparer avec le devis de référence.");
    } finally {
      setIsComparing(false);
    }
  }

  async function arbitrate(restart = false) {
    const { source, preferences } = aiSettings;
    if (!preview || !source || !aiSources[source]?.available || isBusy || toArbitrate.length === 0 || (source !== "decisions" && !preferences)) return;
    const provider = source === "chatgpt_plan" ? "chatgpt" : source;
    const label = PROVIDER_LABELS[provider];
    const continueOnKey = canContinueOnKey && !restart;
    const lines = continueOnKey ? unansweredOnKey : eligibleLines;
    if (lines.length === 0) {
      setAiStatus(`${label} : les lignes à vérifier sont déjà choisies.`);
      return;
    }
    const onKey = provider === "personal_api_key";
    const batchSize = onKey ? PRICE_REUSE_KEY_MAX_LINES : PRICE_REUSE_ARBITRATION_MAX_LINES;
    // On the key, one command sends one HTTP request so its server batches share a single ceiling.
    const requested = onKey ? lines.slice(0, batchSize) : lines;
    setArbitrating(true);
    setAiStatus(null);
    let proposals = 0;
    let answered = 0;
    let partialMessage: string | null = null;
    try {
      for (let start = 0; start < requested.length; start += batchSize) {
        const chunk = requested.slice(start, start + batchSize);
        const result = await arbitrateEstimatePriceReuse(targetVersionId, {
          reference_version_id: preview.reference.version_id, reference_updated_at: preview.reference.updated_at,
          provider, line_ids: chunk.map((line) => line.line_id),
          ...(preferences && { model: preferences.model, reasoning_effort: preferences.reasoningEffort }),
        });
        const replies = result.answers.filter((answer) => answer.reference_line_id !== null || answer.no_match || answer.confidence !== null);
        if (onKey) {
          const answeredIds = new Set(continueOnKey ? keyAnswered : undefined);
          for (const reply of replies) answeredIds.add(reply.line_id);
          setKeyProgress({ settings: settingsKey, answered: answeredIds });
        }
        setRows((current) => {
          const next = { ...current };
          for (const answer of replies) {
            const row = next[answer.line_id];
            if (!row || row.checked || row.origin === "manual") continue;
            next[answer.line_id] = { ...row, referenceId: answer.reference_line_id, origin: provider, confidence: answer.confidence };
          }
          return next;
        });
        answered += replies.length;
        proposals += replies.filter((answer) => answer.reference_line_id !== null).length;
        if (result.status !== "available") partialMessage = result.message;
        if (result.status === "unavailable" || result.status === "failed") break;
      }
      const summary = `${plural(proposals, "proposition")} pour ${plural(answered, "ligne")} à vérifier.`;
      const messages = [answered || !partialMessage ? summary : null, partialMessage];
      if (requested.length < lines.length) messages.push(`La demande est limitée aux ${PRICE_REUSE_KEY_MAX_LINES} premières lignes.`);
      setAiStatus(`${label} : ${messages.filter(Boolean).join(" ")}`);
    } catch (error) {
      setAiStatus(`${label} : ${error instanceof Error ? error.message : "l’arbitrage n’a pas abouti."}`);
    } finally {
      setArbitrating(false);
    }
  }

  async function apply() {
    if (!preview || selections.length === 0) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirm({
        reference_version_id: preview.reference.version_id, reference_updated_at: preview.reference.updated_at,
        target_updated_at: preview.target.updated_at, operation_key: crypto.randomUUID(), selections,
      });
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Impossible de reprendre les prix.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={isOpen} disablePointerDismissal onOpenChange={(open) => { if (!open && !isBusy) onClose(); }}>
      <DialogContent size="full" className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Reprendre les prix d’un devis de référence</DialogTitle>
          <DialogDescription>
            Les articles identiques (même désignation technique, mêmes cotes, même unité) reprennent le prix d’achat FO,
            les heures par unité et les coefficients de la référence. Les quantités et désignations de ce devis ne
            changent pas ; une ligne déjà chiffrée n’est jamais remplacée d’office.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[70vh] overflow-y-auto">
          {isLoadingSources ? <LoadingState label="Chargement des devis…" className="py-6" /> : null}
          {sourcesError ? <Alert variant="danger">{sourcesError}</Alert> : null}
          {!isLoadingSources && !sourcesError && sources.length === 0 ? (
            <Alert variant="info">Aucun autre devis de cette organisation ne peut servir de référence.</Alert>
          ) : null}
          {sources.length > 0 ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid min-w-72 flex-1 gap-2">
                <FieldLabel htmlFor="price-reuse-reference">Devis de référence</FieldLabel>
                <NativeSelect id="price-reuse-reference" value={referenceVersionId} disabled={isBusy}
                  onChange={(event) => { setReferenceVersionId(event.target.value); setPreview(null); setRows({}); }}>
                  {sources.map((source) => <option key={source.id} value={source.id}>{formatSourceLabel(source)}</option>)}
                </NativeSelect>
              </div>
              <Button type="button" variant="outline" onClick={() => void compare()} disabled={!referenceVersionId || isBusy}>
                Comparer
              </Button>
            </div>
          ) : null}
          {isComparing ? <LoadingState label="Comparaison des articles…" className="py-6" /> : null}
          {compareError ? <Alert variant="danger">{compareError}</Alert> : null}

          {preview ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p data-testid="price-reuse-summary" className="text-sm font-medium text-foreground">
                  Identiques : {preview.summary.identical} · À vérifier : {preview.summary.to_review} · Sans correspondance :{" "}
                  {preview.summary.new}
                </p>
                <div className="grid gap-1">
                  <FieldLabel htmlFor="price-reuse-filter">Afficher</FieldLabel>
                  <NativeSelect id="price-reuse-filter" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
                    {(Object.keys(FILTER_LABELS) as Filter[]).map((value) => <option key={value} value={value}>{FILTER_LABELS[value]}</option>)}
                  </NativeSelect>
                </div>
              </div>

              {preview.summary.to_review > 0 ? (
                <section aria-labelledby="price-reuse-ai-title" className="rounded-lg border border-border bg-surface-subtle p-3">
                  <h3 id="price-reuse-ai-title" className="text-sm font-medium text-foreground">Départager les lignes à vérifier</h3>
                  <p className="mt-1 text-xs text-foreground-secondary">
                    L’IA ne reçoit que ces lignes et leurs articles candidats ; sa réponse reste une proposition à retenir.
                  </p>
                  <div className="mt-2 flex flex-wrap items-start gap-3">
                    <AssistantAiFeatureSettings sources={aiSources} defaultSource={preview.default_billing_source}
                      value={aiSettings} sourcePicker={{ label: "Source d’IA" }} locked={isBusy}
                      onChange={(settings) => {
                        setAiSelection(settings);
                        setKeyProgress(undefined);
                        setAiStatus(null);
                      }}
                      keyCeiling={{ nanoUsd: AI_REQUEST_CEILINGS_NANO_USD.shortQuestion }} />
                    <div className="mt-6 flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="md" onClick={() => void arbitrate()}
                        disabled={!aiSettings.source || isBusy || toArbitrate.length === 0}>
                        {arbitrating ? "Arbitrage en cours…" : canContinueOnKey ? "Poursuivre le départage" : "Départager"}
                      </Button>
                      {canContinueOnKey ? (
                        <Button type="button" variant="ghost" size="md" disabled={isBusy} onClick={() => void arbitrate(true)}>
                          Recommencer le départage
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {aiStatus ? <p role="status" data-testid="price-reuse-ai-status" className="mt-2 text-sm text-foreground">{aiStatus}</p> : null}
                  {aiProposals.length > 0 ? (
                    <Button type="button" variant="outline" size="md" className="mt-2" disabled={isBusy}
                      onClick={() => setRows((current) => Object.fromEntries(Object.entries(current).map(([lineId, row]) =>
                        [lineId, aiProposals.includes(lineId) ? { ...row, checked: true } : row])))}>
                      Retenir les propositions de l’IA ({aiProposals.length})
                    </Button>
                  ) : null}
                </section>
              ) : null}

              <ul className="grid gap-2" aria-label="Lignes comparées">
                {visibleLines.map((line) => {
                  const row = rows[line.line_id] ?? { referenceId: null, checked: false, origin: null, confidence: null };
                  const selected = row.referenceId ? referencesById.get(row.referenceId) : undefined;
                  const candidate = line.candidates.find((entry) => entry.reference_line_id === row.referenceId);
                  return (
                    <li key={line.line_id} data-testid="price-reuse-row" data-line-id={line.line_id} data-status={line.status}
                      className="rounded-lg border border-border p-3">
                      <div className="flex items-start gap-3">
                        {line.candidates.length > 0 ? (
                          <input type="checkbox" className="mt-1 size-4 accent-primary" checked={row.checked}
                            disabled={!row.referenceId || isBusy} aria-label={`Reprendre le prix pour « ${line.title} »`}
                            onChange={(event) => updateRow(line.line_id, { checked: event.target.checked })} />
                        ) : <span aria-hidden="true" className="mt-1 size-4 shrink-0" />}
                        <div className="grid min-w-0 flex-1 gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-foreground">{line.title}</p>
                            {line.candidates.length > 0 ? (
                              <Badge data-testid="price-reuse-origin" size="sm"
                                variant={row.origin === "identical" ? "success" : row.origin === "pending" ? "warning" : "info"}>
                                {originLabel(row)}
                              </Badge>
                            ) : <Badge size="sm" variant="neutral">Sans correspondance</Badge>}
                          </div>
                          <p className="text-xs text-foreground-secondary">
                            {line.unit_code ?? "Sans unité"}
                            {line.section_path.length > 0 ? ` · ${line.section_path.join(" › ")}` : ""}
                            {line.current_unit_price_ht_cents || line.current_h_mo_per_unit
                              ? ` · Prix actuel : ${formatEUR(line.current_unit_price_ht_cents ?? 0)} FO, ` +
                                `${hours.format(line.current_h_mo_per_unit ?? 0)} h/u`
                              : ""}
                          </p>
                          {line.candidates.length > 0 ? (
                            <NativeSelect aria-label={`Article de référence pour « ${line.title} »`} value={row.referenceId ?? ""}
                              disabled={isBusy} onChange={(event) => updateRow(line.line_id, {
                                referenceId: event.target.value || null, origin: "manual", confidence: null,
                                checked: event.target.value ? row.checked : false })}>
                              {line.status !== "identical" ? <option value="">Aucun article</option> : null}
                              {line.candidates.map((entry) => (
                                <option key={entry.reference_line_id} value={entry.reference_line_id}>
                                  {referenceLabel(referencesById.get(entry.reference_line_id))}
                                </option>
                              ))}
                            </NativeSelect>
                          ) : null}
                          {selected ? (
                            <p className="text-xs text-foreground-secondary">
                              Référence : {formatEUR(selected.unit_price_ht_cents ?? 0)} FO · {hours.format(selected.h_mo_per_unit ?? 0)} h/u
                              {selected.labor_role_name ? ` (${selected.labor_role_name})` : ""}
                              {selected.supply_type_name ? ` · ${selected.supply_type_name}` : ""}
                              {selected.pu_ht_cents !== null ? ` · PU de vente ${formatEUR(selected.pu_ht_cents)}` : ""}
                            </p>
                          ) : null}
                          {candidate?.differences.map((difference) => (
                            <p key={difference} className="text-xs text-warning">{difference}</p>
                          ))}
                          {line.notes.map((note) => <p key={note} className="text-xs text-warning">{note}</p>)}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
          {submitError ? <Alert variant="danger">{submitError}</Alert> : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isBusy}>Annuler</Button>
          <Button type="button" onClick={() => void apply()} disabled={!preview || selections.length === 0 || isBusy}>
            {isSubmitting ? "Reprise en cours…" : `Appliquer ${selections.length} reprise${selections.length > 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
