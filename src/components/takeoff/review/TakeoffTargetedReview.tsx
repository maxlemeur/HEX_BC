"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Target } from "lucide-react";

import { LoadingState } from "@/components/layout/loading-state";
import { TargetedReviewUnit } from "@/components/takeoff/review/TargetedReviewUnit";
import { TakeoffRulesRecovery } from "@/components/takeoff/review/TakeoffRulesRecovery";
import { VerificationJustificationDialog } from "@/components/takeoff/review/VerificationJustificationDialog";
import { requiresGasPeReason, requiresTechnicalJustification } from "@/lib/takeoff/rules/verification";
import { ExclusionReasonDialog } from "@/components/takeoff/review/ExclusionReasonDialog";
import { useTakeoffApplyConfirm, useTakeoffLowConfidenceThreshold } from "@/components/takeoff/review/useTakeoffReviewSupport";
import type { TakeoffApplyWizardSubmitPayload } from "@/components/takeoff/TakeoffApplyWizard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/feedback/toast-provider";
import { useUserContext } from "@/components/UserContext";
import { fetchTakeoffDpgfComparison, fetchTakeoffJobWithAllItems, isTakeoffApiError, patchTakeoffItems } from "@/lib/takeoff/client";
import { hasBlockingTakeoffDpgfExceptions } from "@/lib/takeoff/dpgf-review-guards";
import { APPLY_GUARD_REASON_LABELS, hasBlockingTakeoffAnomaly } from "@/lib/takeoff/guards";
import { TAKEOFF_RULE_LABELS } from "@/lib/takeoff/rules/labels";
import { withRuleStates } from "@/lib/takeoff/rules/rule-states";
import {
  acceptanceOf,
  duplicateExclusionReason,
  targetedReviewLines,
  zoneOverlapGuidance,
  type TargetedReviewLine,
  type ZoneOverlapGuidance,
} from "@/lib/takeoff/targeted-review";
import type { TakeoffApplyResponse, TakeoffItemPatchField, TakeoffJobDetailResponse, TakeoffJobItem } from "@/lib/takeoff/types";
import { cn } from "@/lib/utils";

// Targeted review of a takeoff job (TI-664 step 4), a « tool » screen (TI-658 « Mise en page outil »): only the lines
// the apply guard rejects or finds uncertain (lib/takeoff/targeted-review.ts), one decision at a time, each saved at
// once and read back with the rule state of its partners (PATCH rule_states). Left: the lines and their filters
// (« Règle en échec »), the application at the bottom. Centre: the plan and its vector reading (TI-662), the line in
// focus. Right: its reasons, the Z1/Z2 duplicate (length counted twice, the other zone's line) and its decisions:
// exclude (E, with a reason), correct (direct entry or F2), accept (V), enter a quantity the plan cannot show.

const TakeoffApplyWizard = dynamic(
  () => import("@/components/takeoff/TakeoffApplyWizard").then((module) => module.TakeoffApplyWizard),
  { ssr: false, loading: () => <LoadingState label="Chargement des options d’application…" /> }
);
const LazyTakeoffVectorViewer = dynamic(
  () => import("@/components/takeoff/review/TakeoffVectorViewer").then((mod) => ({ default: mod.TakeoffVectorViewer })),
  { ssr: false, loading: () => <LoadingState label="Chargement de la lecture vectorielle…" /> }
);

type Filter = "all" | "rule_failed" | "uncertain";
type Job = TakeoffJobDetailResponse["job"];
type Line = TargetedReviewLine<TakeoffJobItem>;

const RIGHT_MIN = 340;
const metres = (value: number) => `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(value)} m`;
const quantityText = (value: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(value);

/** A shortcut shown on its button; the button names it with aria-keyshortcuts, so it is not read twice. */
function Kbd({ children }: Readonly<{ children: React.ReactNode }>) {
  return <kbd aria-hidden="true" className="ml-1.5 rounded border border-border bg-surface-subtle px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>;
}

/** A quantity as the field shows it: fr-FR decimal comma, no grouping. */
function quantityInput(value: number) {
  return String(value).replace(".", ",");
}

function hasToEnter(item: TakeoffJobItem) {
  return (item.rule_results ?? []).some((entry) => entry.rule === "non_observable");
}

/** A typed quantity: a positive number, with a comma or a dot. */
function parseQuantity(text: string) {
  const value = Number(text.trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) / 1000 : null;
}

export function TakeoffTargetedReview({ jobId, versionId, projectId }: Readonly<{ jobId: string; versionId: string; projectId: string }>) {
  const toast = useToast();
  const searchParams = useSearchParams();
  const { profile } = useUserContext();
  const isAdmin = profile?.tenant_role === "admin";
  const threshold = useTakeoffLowConfidenceThreshold();

  const [job, setJob] = useState<Job | null>(null);
  const [items, setItems] = useState<TakeoffJobItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dpgf, setDpgf] = useState<{ loading: boolean; error: string | null; blocking: boolean }>({ loading: true, error: null, blocking: false });
  // Read again after each saved decision: a quantity or an exclusion can open or close a DPGF gap.
  const [dpgfRead, setDpgfRead] = useState(0);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const savingRef = useRef(new Set<string>());
  const mutationRevision = useRef(0);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("line"));
  const lastIndex = useRef(0);
  const nextId = useRef<string | null>(null);
  const [exclusion, setExclusion] = useState<{ itemId: string; reason: string; key: number; expectedEvaluation?: string | null } | null>(null);
  const [draft, setDraft] = useState<{ itemId: string; text: string } | null>(null);
  const [justification, setJustification] = useState<{ item: TakeoffJobItem; gasPe: boolean } | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightWidth, setRightWidth] = useState(420);
  const resize = useRef<{ x: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchTakeoffJobWithAllItems(jobId, { signal: controller.signal }).then((detail) => {
      setJob(detail.job);
      setItems(detail.items.data);
    }, (error: unknown) => {
      if (!controller.signal.aborted) setLoadError(isTakeoffApiError(error) || error instanceof Error ? error.message : "Impossible de charger le métré.");
    });
    return () => controller.abort();
  }, [jobId]);

  useEffect(() => {
    const controller = new AbortController();
    setDpgf((previous) => ({ ...previous, loading: true }));
    // The application refuses DPGF links still to settle: read as the review reads them.
    void fetchTakeoffDpgfComparison(jobId, { version_id: versionId, page_size: 1, view: "all" }, { signal: controller.signal }).then((response) => {
      setDpgf({ loading: false, error: null, blocking: hasBlockingTakeoffDpgfExceptions(response.summary) });
    }, (error: unknown) => {
      if (!controller.signal.aborted) {
        setDpgf({ loading: false, error: isTakeoffApiError(error) ? error.message : "Impossible de valider le rapprochement DPGF.", blocking: false });
      }
    });
    return () => controller.abort();
  }, [dpgfRead, jobId, versionId]);

  // The keys act from the list once the lines are there.
  const loaded = job !== null;
  useEffect(() => {
    if (loaded) listRef.current?.focus();
  }, [loaded]);

  const level = job?.level ?? null;
  const review = useMemo(() => targetedReviewLines(items, threshold, level), [items, level, threshold]);
  const counts = useMemo(() => ({
    all: review.lines.length,
    rule_failed: review.lines.filter((line) => line.reasons.includes("rule_failed")).length,
    uncertain: review.lines.filter((line) => line.tier === "uncertain").length,
  }), [review.lines]);
  const visible = useMemo(() => review.lines.filter((line) => (filter === "all" ? true
    : filter === "uncertain" ? line.tier === "uncertain" : line.reasons.includes("rule_failed"))), [filter, review.lines]);

  // A decided line leaves the list: the selection goes to the line that followed it (or, gone too, the one now at
  // its place), and stays in view.
  const selectedIndex = visible.findIndex((line) => line.item.id === selectedId);
  useEffect(() => {
    if (!job) return;
    if (selectedIndex >= 0) {
      lastIndex.current = selectedIndex;
      nextId.current = visible[selectedIndex + 1]?.item.id ?? visible[selectedIndex - 1]?.item.id ?? null;
      return;
    }
    if (selectedId && savingRef.current.has(selectedId)) return;
    const next = (visible.some((line) => line.item.id === nextId.current) ? nextId.current : null)
      ?? visible[Math.min(lastIndex.current, visible.length - 1)]?.item.id ?? null;
    if (next !== selectedId) setSelectedId(next);
  }, [job, selectedId, selectedIndex, visible]);
  useEffect(() => {
    if (selectedId) document.getElementById(`targeted-line-${selectedId}`)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);
  const current: Line | null = review.lines.find((line) => line.item.id === selectedId) ?? null;
  const guidance = current ? zoneOverlapGuidance(current.item) : null;
  const acceptance = current ? acceptanceOf(current.item, level) : null;

  const applied = job?.status === "applied";
  const readOnly = !job || job.status !== "completed";
  // One decision at a time: a partner's guidance is read from the answer of the decision before it, never guessed.
  const busy = saving.size > 0;

  const decide = useCallback(async (item: TakeoffJobItem, fields: TakeoffItemPatchField, done: string, expectedEvaluation?: string | null) => {
    if (savingRef.current.size > 0) return false;
    mutationRevision.current += 1;
    savingRef.current.add(item.id);
    setSaving(new Set(savingRef.current));
    setLineErrors((previous) => {
      const next = { ...previous };
      delete next[item.id];
      return next;
    });
    try {
      if (expectedEvaluation === null) throw new Error("Rechargez les règles avant cette décision.");
      const response = await patchTakeoffItems(jobId, { items: [{ item_id: item.id, updated_at: item.updated_at, fields,
        ...(expectedEvaluation ? { expected_rules_evaluated_at: expectedEvaluation } : {}) }] });
      const result = response.results[0];
      if (response.rule_states_refresh_required) {
        const detail = await fetchTakeoffJobWithAllItems(jobId);
        setItems(detail.items.data);
      } else {
      // The saved line as the server holds it, its partners read again with it.
      setItems((previous) => withRuleStates(
        previous.map((line) => (result?.success && line.id === result.item_id ? result.item : line)), response.rule_states));
      }
      if (!result?.success) {
        setLineErrors((previous) => ({ ...previous, [item.id]: result?.error ?? "Enregistrement refusé." }));
      } else {
        toast.success({ title: done, durationMs: 2000 });
        setDpgfRead((value) => value + 1);
      }
      return result?.success === true;
    } catch (error) {
      setLineErrors((previous) => ({ ...previous, [item.id]: isTakeoffApiError(error) ? error.message : "Échec de l’enregistrement ou de sa relecture. Rechargez la revue." }));
      setItems((previous) => previous.map((line) => line.rules_evaluated_at ? { ...line, rules_stale: true } : line));
      return false;
    } finally {
      savingRef.current.delete(item.id);
      setSaving(new Set(savingRef.current));
    }
  }, [jobId, toast]);

  const focusList = () => listRef.current?.focus();
  const requestFocusList = () => setTimeout(focusList, 0);
  // The field takes the focus once the entry has rendered (an effect, never an animation frame: a page the browser
  // does not paint would hold it). Until then (entryFocus set), the keys typed on the list go to the entry. The
  // decision panel opens to show it.
  const entryFocus = useRef<"select" | "end" | null>(null);
  const startEntry = useCallback((text: string | null) => {
    if (!current || readOnly || busy) return;
    entryFocus.current = text === null ? "select" : "end";
    setRightOpen(true);
    setDraft({ itemId: current.item.id, text: text ?? quantityInput(current.item.quantity) });
  }, [busy, current, readOnly]);
  useEffect(() => {
    const input = quantityRef.current;
    if (!draft || !entryFocus.current || !input) return;
    input.focus();
    if (entryFocus.current === "select") input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
    entryFocus.current = null;
  }, [draft]);

  const commitQuantity = useCallback(() => {
    if (!current || !draft || draft.itemId !== current.item.id) return;
    const value = parseQuantity(draft.text);
    if (value === null) {
      setLineErrors((previous) => ({ ...previous, [current.item.id]: "Quantité invalide : un nombre positif est attendu." }));
      return;
    }
    const toEnter = hasToEnter(current.item);
    setDraft(null);
    focusList();
    // An unchanged quantity is saved only to attest it, or to compute rules left to compute again (any save does).
    if (value === current.item.quantity && !toEnter && !current.item.rules_stale) return;
    // A quantity the plan cannot show is entered: typed here, it is attested even when equal to the proposed one.
    void decide(current.item, { quantity: value, ...(toEnter ? { quantity_entered: true as const } : {}) },
      toEnter ? "Quantité saisie" : "Quantité corrigée");
  }, [current, decide, draft]);

  const openExclusion = useCallback((reason = "", guided = false) => {
    if (!current || readOnly || busy) return;
    setExclusion({ itemId: current.item.id, reason, key: Date.now(),
      ...(guided ? { expectedEvaluation: current.item.rules_evaluated_at ?? null } : {}) });
  }, [busy, current, readOnly]);

  const accept = useCallback(() => {
    if (!current || readOnly || busy || !acceptance?.enabled) return;
    if (requiresTechnicalJustification(current.item.rule_results)) {
      setJustification({ item: current.item, gasPe: requiresGasPeReason(current.item.rule_results) });
      return;
    }
    void decide(current.item, { is_verified: true }, "Ligne acceptée", current.item.rules_evaluated_at ?? undefined);
  }, [acceptance, busy, current, decide, readOnly]);

  const move = (delta: number) => {
    if (visible.length === 0) return;
    const index = selectedIndex < 0 ? 0 : Math.min(visible.length - 1, Math.max(0, selectedIndex + delta));
    setSelectedId(visible[index].item.id);
    setDraft(null);
  };

  // E, V, F2, a digit and the arrows act on the line in focus, from this screen (or a focus lost to the page after a
  // decision removed its button), never from a field, a dialog or the dashboard's own bar.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || exclusion || justification || wizardOpen) return;
    const target = event.target as HTMLElement;
    if (target !== document.body && !rootRef.current?.contains(target)) return;
    if (target.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
    const key = event.key;
    const entry = current && draft?.itemId === current.item.id && entryFocus.current !== null
      && (target === listRef.current || target === document.body) ? draft : null;
    if (entry) {
      // An entry started from the list whose field has not taken the focus yet: the keys typed meanwhile are its own.
      if (key === "Enter") {
        event.preventDefault();
        commitQuantity();
        return;
      }
      if (key === "Escape") {
        event.preventDefault();
        entryFocus.current = null;
        setDraft(null);
        return;
      }
      if (/^[0-9.,]$/.test(key)) {
        event.preventDefault();
        // F2 selects the quantity: the first key replaces it, as in the field.
        setDraft({ ...entry, text: entryFocus.current === "select" ? key : entry.text + key });
        entryFocus.current = "end";
        return;
      }
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      move(key === "ArrowDown" ? 1 : -1);
    } else if (key === "e" || key === "E") {
      event.preventDefault();
      openExclusion(guidance?.remove_line ? duplicateExclusionReason(guidance) : "", guidance?.remove_line === true);
    } else if (key === "v" || key === "V") {
      event.preventDefault();
      accept();
    } else if (key === "F2") {
      event.preventDefault();
      startEntry(null);
    } else if (/^[0-9]$/.test(key)) {
      event.preventDefault();
      startEntry(key);
    }
  };

  const keyHandler = useRef(onKeyDown);
  keyHandler.current = onKeyDown;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const handleApplied = useCallback((response: TakeoffApplyResponse) => {
    setWizardOpen(false);
    setJob((previous) => (previous ? { ...previous, status: "applied" } : previous));
    toast.success({ title: "Apply contrôlé terminé",
      description: `${response.summary.created_count} créé(s), ${response.summary.updated_count} mis à jour, ${response.summary.ignored_count} ignoré(s).` });
  }, [toast]);
  const apply = useTakeoffApplyConfirm({ jobId, versionId, onApplied: handleApplied });

  const included = items.filter((item) => !item.is_excluded);
  const applyBlocker = !job ? "Chargement du métré…"
    : applied ? "Ce métré a déjà été appliqué au chiffrage."
      : job.status !== "completed" ? "Le métré doit être terminé avant l’application."
        : saving.size > 0 ? "Enregistrement en cours…"
          : included.length === 0 ? "Aucune ligne retenue : réintégrez au moins une ligne dans la revue complète."
            : included.some(hasBlockingTakeoffAnomaly) ? "Corrigez les anomalies bloquantes (désignation vide, quantité nulle) dans la revue complète."
            : !review.guard.passed ? `${review.guard.blocked_items.length} ligne${review.guard.blocked_items.length > 1 ? "s" : ""} à trancher avant l’application.`
              : dpgf.loading ? "Chargement du rapprochement DPGF…"
                : dpgf.error ? "Rapprochement DPGF indisponible : rechargez la revue avant l’application."
                  : dpgf.blocking ? "Des rapprochements DPGF restent à trancher dans la revue complète." : null;

  const reviewHref = `/dashboard/affaires/${projectId}/takeoff/${jobId}/review?versionId=${encodeURIComponent(versionId)}`;
  const targetedHref = (otherJobId: string, itemId: string) =>
    `/dashboard/affaires/${projectId}/takeoff/${otherJobId}/review/targeted?versionId=${encodeURIComponent(versionId)}&line=${encodeURIComponent(itemId)}`;
  const focusIds = current ? [current.item.id, ...(guidance?.partners ?? []).filter((partner) => partner.job_id === jobId).map((partner) => partner.item_id)] : [];
  const rightMax = 720;
  const clampRight = (value: number) => Math.min(rightMax, Math.max(RIGHT_MIN, value));

  if (loadError) {
    return (
      <div className="flex h-full items-start justify-center overflow-auto p-8">
        <Alert variant="danger" className="max-w-xl">{loadError}</Alert>
      </div>
    );
  }

  return (
    <div ref={rootRef} tabIndex={-1} className="flex h-full min-h-0 flex-col bg-surface-subtle focus:outline-none">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <h1 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Target aria-hidden="true" className="size-4 text-primary" />
          Revue ciblée
        </h1>
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={job?.source_file_name ?? undefined}>
          {job?.source_file_name ?? "Métré"}{job?.version_number ? ` · V${job.version_number}` : ""}{level ? ` · niveau ${level}` : ""}
        </span>
        {job ? (
          <span className="flex items-center gap-1.5">
            <Badge size="sm" variant={counts.all - counts.uncertain > 0 ? "danger" : "success"}>
              {counts.all - counts.uncertain} rejetée{counts.all - counts.uncertain > 1 ? "s" : ""}
            </Badge>
            <Badge size="sm" variant={counts.uncertain > 0 ? "warning" : "neutral"}>
              {counts.uncertain} incertaine{counts.uncertain > 1 ? "s" : ""}
            </Badge>
          </span>
        ) : null}
        <nav aria-label="Métré" className="ml-auto flex items-center gap-2">
          <Link href={reviewHref} className={buttonVariants({ variant: "outline", size: "xs" })}>Revue complète</Link>
          <Link href={`/dashboard/affaires/${projectId}/takeoff`} className={buttonVariants({ variant: "ghost", size: "xs" })}>Métrés</Link>
        </nav>
      </header>
      <TakeoffRulesRecovery jobId={jobId} pending={items.some((item) => item.rules_stale)} disabled={readOnly || busy}
        beginRevision={() => ++mutationRevision.current}
        getRevision={() => mutationRevision.current}
        onRefreshed={(detail) => { setItems(detail.items.data); setDpgfRead((value) => value + 1); }} />

      <div className="flex min-h-0 flex-1">
        {leftOpen ? (
          <aside aria-label="Lignes à revoir" className="flex w-[340px] shrink-0 flex-col border-r border-border bg-surface">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lignes à revoir</span>
              <IconButton label="Replier les lignes" size="icon-xs" variant="ghost" icon={<PanelLeftClose />} onClick={() => { setLeftOpen(false); rootRef.current?.focus(); }} />
            </div>
            <div role="group" aria-label="Filtrer les lignes" className="flex shrink-0 flex-wrap gap-1 border-b border-border px-3 py-2">
              {([["all", "À revoir"], ["rule_failed", "Règle en échec"], ["uncertain", "Incertaines"]] as const).map(([value, label]) => (
                <Button key={value} size="xs" variant={filter === value ? "secondary" : "ghost"} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                  {label} <span className="tabular-nums text-muted-foreground">{counts[value]}</span>
                </Button>
              ))}
            </div>
            {!job ? (
              <p className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"><Spinner aria-label="Chargement" />Chargement des lignes…</p>
            ) : visible.length === 0 ? (
              <p role="status" className="px-3 py-3 text-sm text-muted-foreground">
                {counts.all === 0 ? "Aucune ligne à trancher : le contrôle du métré est complet." : "Aucune ligne pour ce filtre."}
              </p>
            ) : null}
            <ul ref={listRef} role="listbox" aria-label="Lignes à trancher" tabIndex={0} aria-keyshortcuts="ArrowUp ArrowDown E V F2"
              aria-activedescendant={current ? `targeted-line-${current.item.id}` : undefined}
              className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
              {visible.map((line) => {
                const selected = line.item.id === selectedId;
                const first = line.rule_failures[0];
                return (
                  <li key={line.item.id} id={`targeted-line-${line.item.id}`} role="option" aria-selected={selected}
                    className={cn("cursor-pointer px-3 py-2 text-xs", selected ? "bg-primary/10" : "hover:bg-surface-subtle")}
                    onClick={() => { setSelectedId(line.item.id); setDraft(null); focusList(); }}>
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground" title={line.item.designation}>{line.item.designation}</span>
                        <span className="block text-muted-foreground">
                          {first ? TAKEOFF_RULE_LABELS[first.rule]
                            : line.tier === "uncertain" ? "Confiance moyenne"
                              : line.reasons.map((reason) => APPLY_GUARD_REASON_LABELS[reason]).join(" · ")}
                          {line.rule_failures.length > 1 ? ` + ${line.rule_failures.length - 1}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono tabular-nums text-foreground">{quantityText(line.item.quantity)} {line.item.unit}</span>
                        {saving.has(line.item.id) ? <Spinner aria-label="Enregistrement" className="ml-auto size-3" />
                          : <Badge size="sm" variant={line.tier === "rejected" ? "danger" : "warning"}>{line.tier === "rejected" ? "Rejetée" : "Incertaine"}</Badge>}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="shrink-0 space-y-1.5 border-t border-border bg-surface p-3">
              <p className="text-[11px] text-muted-foreground">
                <Kbd>↑</Kbd><Kbd>↓</Kbd> ligne · <Kbd>E</Kbd> exclure · <Kbd>F2</Kbd> corriger · <Kbd>V</Kbd> accepter · <Kbd>Échap</Kbd> annuler
              </p>
              <Button className="w-full" size="lg" disabled={applyBlocker !== null} onClick={() => { apply.setError(null); setWizardOpen(true); }}>
                Appliquer au devis
              </Button>
              <p role="status" className="text-xs text-muted-foreground">{applyBlocker ?? "Le contrôle est complet : choisissez la section et la stratégie."}</p>
            </div>
          </aside>
        ) : (
          <div className="flex w-10 shrink-0 flex-col items-center border-r border-border bg-surface pt-1">
            <IconButton label="Déplier les lignes" size="icon-xs" variant="ghost" icon={<PanelLeftOpen />} onClick={() => { setLeftOpen(true); requestFocusList(); }} />
          </div>
        )}

        <main aria-label="Plan et lecture vectorielle" className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground">
            {current ? (
              <span className="min-w-0 truncate">
                <span className="font-medium text-foreground">{current.item.designation}</span>
                {current.item.source_file_name ? ` · ${current.item.source_file_name}` : ""}
                {current.item.source_page !== null ? ` · p. ${current.item.source_page}` : ""}
              </span>
            ) : <span>Aucune ligne choisie.</span>}
          </div>
          <div className="min-h-0 flex-1">
            {level === "C" ? (
              <LazyTakeoffVectorViewer jobId={jobId} planSetId={job?.plan_set_id ?? null} focusItemIds={focusIds} fill />
            ) : (
              <p className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
                {job ? "Pas de lecture vectorielle pour ce niveau : la ligne se contrôle sur sa preuve, à droite." : null}
              </p>
            )}
          </div>
        </main>

        {rightOpen ? (
          <>
            <div role="separator" aria-orientation="vertical" aria-label="Largeur du détail" tabIndex={0}
              aria-valuenow={Math.round(rightWidth)} aria-valuemin={RIGHT_MIN} aria-valuemax={rightMax}
              className="w-1.5 shrink-0 cursor-col-resize bg-border hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                resize.current = { x: event.clientX, width: rightWidth };
              }}
              onPointerMove={(event) => { if (resize.current) setRightWidth(clampRight(resize.current.width - (event.clientX - resize.current.x))); }}
              onPointerUp={() => { resize.current = null; }}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") { event.preventDefault(); setRightWidth((value) => clampRight(value + 40)); }
                if (event.key === "ArrowRight") { event.preventDefault(); setRightWidth((value) => clampRight(value - 40)); }
              }} />
            <section aria-label="Décision sur la ligne" className="flex min-w-0 shrink-0 flex-col bg-surface" style={{ width: rightWidth }}>
              <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Décision</span>
                <IconButton label="Replier le détail" size="icon-xs" variant="ghost" icon={<PanelRightClose />} className="ml-auto" onClick={() => { setRightOpen(false); focusList(); }} />
              </div>
              {current ? (
                <LineDecision key={current.item.id} line={current} level={level} guidance={guidance} acceptance={acceptance}
                  busy={busy} readOnly={readOnly} error={lineErrors[current.item.id] ?? null} jobId={jobId}
                  draft={draft?.itemId === current.item.id ? draft.text : null} quantityRef={quantityRef}
                  onDraft={(text) => setDraft({ itemId: current.item.id, text })}
                  onCancelEntry={() => { entryFocus.current = null; setDraft(null); focusList(); }}
                  onLeaveEntry={(text) => { if (text === quantityInput(current.item.quantity)) setDraft(null); }}
                  onSaveUnit={(unit) => decide(current.item, { unit }, "Unité corrigée")}
                  onCommit={commitQuantity} onStartEntry={() => startEntry(null)}
                  onExclude={() => openExclusion(guidance?.remove_line ? duplicateExclusionReason(guidance) : "", guidance?.remove_line === true)}
                  onAccept={() => { accept(); focusList(); }}
                  onReduce={(to) => {
                    focusList();
                    void decide(current.item, { quantity: to, ...(hasToEnter(current.item) ? { quantity_entered: true as const } : {}) }, "Longueur retirée", current.item.rules_evaluated_at ?? null);
                  }}
                  onSelectPartner={(itemId) => { setSelectedId(itemId); setFilter("all"); focusList(); }}
                  partnerListed={(itemId) => review.lines.some((line) => line.item.id === itemId)}
                  partnerHref={targetedHref} />
              ) : (
                <p className="px-3 py-3 text-sm text-muted-foreground">{job ? "Choisissez une ligne à gauche." : null}</p>
              )}
            </section>
          </>
        ) : (
          <div className="flex w-10 shrink-0 flex-col items-center border-l border-border bg-surface pt-1">
            <IconButton label="Déplier le détail" size="icon-xs" variant="ghost" icon={<PanelRightOpen />} onClick={() => { setRightOpen(true); focusList(); }} />
          </div>
        )}
      </div>

      {justification ? (
        <VerificationJustificationDialog gasPe={justification.gasPe} onClose={() => { setJustification(null); requestFocusList(); }}
          onConfirm={(value) => {
            void decide(justification.item, { is_verified: true, verification_justification: value }, "Ligne acceptée avec justification",
              justification.item.rules_evaluated_at ?? null);
            setJustification(null);
            requestFocusList();
          }} />
      ) : null}
      {exclusion ? (
        <ExclusionReasonDialog key={exclusion.key} open count={1} defaultReason={exclusion.reason}
          onOpenChange={(open) => { if (!open) { setExclusion(null); requestFocusList(); } }}
          onConfirm={(reason) => {
            const item = items.find((entry) => entry.id === exclusion.itemId);
            if (item) void decide(item, { is_excluded: true, exclusion_reason: reason }, "Ligne exclue", exclusion.expectedEvaluation);
          }} />
      ) : null}

      {wizardOpen && job ? (
        <TakeoffApplyWizard open={wizardOpen} jobId={jobId} versionId={versionId}
          targetVersionLabel={job.version_number ? `V${job.version_number}` : null}
          includedCount={included.length} excludedCount={items.length - included.length}
          isSubmitting={apply.submitting} submitError={apply.error} onOpenChange={setWizardOpen}
          onConfirm={(payload: TakeoffApplyWizardSubmitPayload) => apply.confirm(payload)} items={items}
          sourceFileName={job.source_file_name} jobLevel={level} confidenceThreshold={threshold} isAdmin={isAdmin}
          onReturnToReview={() => setWizardOpen(false)} />
      ) : null}
    </div>
  );
}

type LineDecisionProps = {
  line: Line;
  level: string | null;
  guidance: ZoneOverlapGuidance | null;
  acceptance: ReturnType<typeof acceptanceOf> | null;
  busy: boolean;
  readOnly: boolean;
  error: string | null;
  jobId: string;
  draft: string | null;
  quantityRef: React.RefObject<HTMLInputElement | null>;
  onDraft: (text: string) => void;
  onCancelEntry: () => void;
  /** The field lost the focus: an entry left unchanged ends (a field passed through by Tab keeps nothing). */
  onLeaveEntry: (text: string) => void;
  onSaveUnit: (unit: string) => Promise<boolean>;
  onCommit: () => void;
  onStartEntry: () => void;
  onExclude: () => void;
  onAccept: () => void;
  onReduce: (quantity: number) => void;
  onSelectPartner: (itemId: string) => void;
  partnerListed: (itemId: string) => boolean;
  partnerHref: (jobId: string, itemId: string) => string;
};

function LineDecision({ line, level, guidance, acceptance, busy, readOnly, error, jobId, draft, quantityRef, onDraft, onCancelEntry,
  onLeaveEntry, onSaveUnit, onCommit, onStartEntry, onExclude, onAccept, onReduce, onSelectPartner, partnerListed, partnerHref }: Readonly<LineDecisionProps>) {
  const { item } = line;
  const toEnter = line.rule_failures.some((failure) => failure.rule === "non_observable");
  const otherReasons = line.reasons.filter((reason) => reason !== "rule_failed");
  const disabled = busy || readOnly;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3 text-sm">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">{item.designation}</h2>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge size="sm" variant={line.tier === "rejected" ? "danger" : "warning"}>{line.tier === "rejected" ? "Rejetée" : "Incertaine"}</Badge>
            <span>Confiance {item.confidence === null ? "non évaluée" : `${Math.round(item.confidence * 100)} %`}</span>
            {item.source_page !== null ? <span>· p. {item.source_page}</span> : null}
            {item.is_verified ? <Badge size="sm" variant="info">Acceptée</Badge> : null}
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor={`targeted-quantity-${item.id}`} className="text-xs font-medium text-foreground-secondary">
            {toEnter ? "Quantité à saisir" : "Quantité"}
          </label>
          <div className="flex items-center gap-2">
            <Input id={`targeted-quantity-${item.id}`} ref={quantityRef} size="sm" inputMode="decimal" className="w-32 font-mono tabular-nums"
              value={draft ?? quantityInput(item.quantity)} readOnly={draft === null || disabled} aria-describedby={`targeted-quantity-hint-${item.id}`}
              onFocus={() => { if (draft === null && !disabled) onStartEntry(); }}
              onChange={(event) => onDraft(event.target.value)}
              onBlur={(event) => onLeaveEntry(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); onCommit(); }
                if (event.key === "Escape") { event.preventDefault(); onCancelEntry(); }
              }} />
            <TargetedReviewUnit designation={item.designation} unit={item.unit} busy={busy} error={error} save={onSaveUnit}
              disabled={disabled || (draft !== null && draft !== quantityInput(item.quantity))} />
            {/* Pressing it keeps the focus in the field: its blur would end an unchanged entry before the click (Codex #162). */}
            {draft !== null ? (
              <Button size="xs" onMouseDown={(event) => event.preventDefault()} onClick={onCommit} disabled={disabled} aria-keyshortcuts="Enter">
                Enregistrer<Kbd>Entrée</Kbd>
              </Button>
            ) : null}
          </div>
          <p id={`targeted-quantity-hint-${item.id}`} className="text-xs text-muted-foreground">
            {toEnter
              ? "Le plan ne montre pas cette quantité : saisissez-la, ou confirmez celle-ci (Entrée). Accepter (V) ne la règle pas."
              : item.rules_stale
                ? "Règles à recalculer : Entrée, même sans changer la quantité, relance le calcul."
                : "Saisie directe (un chiffre) ou F2, puis Entrée ; Échap annule. Les règles sont recalculées à l’enregistrement."}
          </p>
        </div>

        <section aria-label="Raisons" className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Raisons</h3>
          {line.tier === "uncertain" ? (
            <p className="text-foreground-secondary">Confiance moyenne : contrôlez la ligne, puis acceptez-la (V) ou corrigez-la.</p>
          ) : null}
          {otherReasons.map((reason) => (
            <p key={reason} className="text-foreground-secondary">{APPLY_GUARD_REASON_LABELS[reason]}</p>
          ))}
          <ul className="space-y-2">
            {line.rule_failures.map((failure) => (
              <li key={failure.rule} className="rounded-md border border-danger-border bg-danger-light px-2 py-1.5">
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-foreground">{TAKEOFF_RULE_LABELS[failure.rule]}</span>
                  <code className="rounded bg-surface px-1 font-mono text-[11px] text-muted-foreground">{failure.code}</code>
                </p>
                <p className="mt-0.5 text-xs text-foreground-secondary">{failure.reason}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{failure.acceptable ? failure.rule === "dn_network" ? "Accepter (V) exige un motif et la référence du système." : "Accepter (V) lève cet échec."
                  : failure.code === "DN_NETWORK_MATERIAL_BLOCKED" ? "Bloqué : V ne lève pas cet échec. Forçage administrateur uniquement."
                    : "À saisir : accepter (V) ne lève pas cet échec."}</p>
              </li>
            ))}
          </ul>
        </section>

        {guidance && guidance.kind !== "resolved" ? (
          <section aria-label="Doublon entre zones" className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Doublon entre zones</h3>
            {guidance.stale ? (
              <p role="status" className="text-xs text-warning">
                Règles à recalculer : ce doublon a peut-être déjà été réglé (longueur retirée, ligne exclue). Rien n’est proposé avant le nouveau calcul.
              </p>
            ) : null}
            {guidance.kind === "unregistered" ? (
              <p className="text-xs text-foreground-secondary">Les plans du niveau ne se superposent pas : aucun tronçon commun n’a pu être mesuré. Acceptez la ligne (V) une fois vérifiée, ou excluez-la.</p>
            ) : (
              <p className="text-foreground-secondary">
                {guidance.kind === "pair" ? "Longueur comptée deux fois" : "Longueur dessinée par les autres lignes"} :{" "}
                <span className="font-mono font-semibold tabular-nums text-foreground">{metres(guidance.overlap_m ?? 0)}</span>
              </p>
            )}
            {guidance.partners.length > 0 ? (
              <ul aria-label="Lignes des autres zones" className="space-y-1">
                {guidance.partners.map((partner) => (
                  <li key={partner.item_id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
                    <Badge size="sm" variant="outline">{partner.zone ?? "Autre page"}</Badge>
                    <span className="min-w-0 flex-1 truncate" title={partner.designation}>{partner.designation}</span>
                    <span className="shrink-0 font-mono tabular-nums">{metres(partner.overlap_m)}</span>
                    {partner.job_id === jobId ? (
                      partnerListed(partner.item_id)
                        ? <Button size="xs" variant="link" onClick={() => onSelectPartner(partner.item_id)}>Voir</Button>
                        : <span className="shrink-0 text-muted-foreground">tranchée</span>
                    ) : (
                      <Link href={partnerHref(partner.job_id, partner.item_id)} className="shrink-0 text-primary underline-offset-4 hover:underline">
                        Ouvrir {partner.zone ?? "l’autre zone"}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            {guidance.kind === "group" ? (
              <p className="text-xs text-foreground-secondary">
                Groupe de {guidance.group_size} lignes : une correction de quantité ne règle pas un groupe. Chaque ligne se tranche :
                {guidance.remove_line
                  ? " celle-ci est entièrement dessinée sur d’autres zones, retirez-la du métré."
                  : ` ${metres(guidance.own_m ?? 0)} de celle-ci ne sont dessinés sur aucune autre zone : ne l’excluez pas, acceptez-la (V) une fois vérifiée.`}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {guidance.reduce_to !== null ? (
                <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onReduce(guidance.reduce_to as number)}>
                  Retirer {metres(guidance.overlap_m ?? 0)} (→ {quantityText(guidance.reduce_to)} {item.unit})
                </Button>
              ) : null}
              {guidance.remove_line ? (
                <Button size="sm" variant="secondary" disabled={disabled} onClick={onExclude} aria-keyshortcuts="E">Retirer la ligne<Kbd>E</Kbd></Button>
              ) : null}
            </div>
          </section>
        ) : null}

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Résultats des règles (JSON)</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded-md border border-border bg-surface-subtle p-2 font-mono text-[11px] leading-snug">
            {JSON.stringify({ rule_results: item.rule_results ?? [], rules_stale: item.rules_stale ?? false, rules_evaluated_at: item.rules_evaluated_at ?? null }, null, 2)}
          </pre>
        </details>
      </div>

      <div className="shrink-0 space-y-2 border-t border-border bg-surface p-3">
        {error ? <Alert variant="danger" className="px-3 py-2 text-xs">{error}</Alert> : null}
        {readOnly ? <p className="text-xs text-muted-foreground">Métré appliqué ou non terminé : lecture seule.</p> : null}
        <div role="toolbar" aria-label="Décisions" className="flex flex-wrap gap-2">
          <Button size="sm" variant="danger" disabled={disabled} onClick={onExclude} aria-keyshortcuts="E">Exclure<Kbd>E</Kbd></Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={onStartEntry} aria-keyshortcuts="F2">{toEnter ? "Saisir" : "Corriger"}<Kbd>F2</Kbd></Button>
          <Button size="sm" variant="primary" disabled={disabled || !acceptance?.enabled} onClick={onAccept} aria-keyshortcuts="V">Accepter<Kbd>V</Kbd></Button>
        </div>
        {acceptance && !acceptance.enabled && acceptance.reason && level !== null ? (
          <p className="text-xs text-muted-foreground">{acceptance.reason}</p>
        ) : null}
      </div>
    </div>
  );
}
