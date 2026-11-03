"use client";

import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import { Check, RefreshCw, SkipForward, Undo2, X } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { useTakeoffLab } from "@/components/takeoff/lab/TakeoffLabShell";
import { AnswerBars } from "@/components/takeoff/lab/LabResultColumn";
import { LabPdfCanvas } from "@/components/takeoff/lab/LabPdfCanvas";
import { errorMessage, labApi } from "@/components/takeoff/lab/lab-api";
import { configLabel, promptVersionLabel, type LabCampaignElement, type LabVerdict } from "@/lib/takeoff/lab/contracts";
import { cn } from "@/lib/utils";

type StateFilter = "todo" | "all" | "good" | "bad";

const TEXT_INPUTS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

/** « 78 / 156 évalués · 17 bons · 61 pas bons · 77 à parcourir »: évalués = bons + pas bons; « Passer » only leaves « à parcourir ». */
export function progressText(input: { total: number; good: number; bad: number; skipped: number }) {
  const judged = input.good + input.bad;
  const toBrowse = Math.max(0, input.total - judged - input.skipped);
  return `${judged} / ${input.total} évalués · ${plural(input.good, "bon", "bons")} · ${plural(input.bad, "pas bon", "pas bons")} · ${toBrowse} à parcourir`;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="ml-1 rounded border border-current/30 px-1 font-mono text-[10px] opacity-80">{children}</kbd>;
}

export function LabVerdictsScreen() {
  const fieldId = useId();
  const { state, refresh } = useTakeoffLab();
  const [campaign, setCampaign] = useState(state.latest_campaign ?? state.campaigns[0] ?? "");
  const [taskFilter, setTaskFilter] = useState("");
  const [configFilter, setConfigFilter] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("todo");
  const [elements, setElements] = useState<LabCampaignElement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  /** The campaign last asked for: a slower answer for another one is dropped. */
  const requested = useRef("");
  /**
   * The campaign whose elements are on screen. While another one loads, the previous elements are
   * cleared and every verdict action waits: a verdict would otherwise pair the new campaign with
   * an element of the old one, and « Annuler » would undo in a campaign not yet displayed.
   */
  const shown = useRef<string | null>(null);
  const [loadedCampaign, setLoadedCampaign] = useState<string | null>(null);

  const load = useCallback(async (name: string) => {
    requested.current = name;
    if (!name) return;
    if (shown.current !== name) {
      shown.current = null;
      setLoadedCampaign(null);
      setElements([]);
    }
    setLoading(true);
    setError(null);
    try {
      const campaignElements = (await labApi.campaign(name)).elements;
      if (requested.current === name) {
        setElements(campaignElements);
        shown.current = name;
        setLoadedCampaign(name);
      }
    } catch (cause) {
      if (requested.current !== name) return;
      setError(errorMessage(cause));
      setElements([]);
      shown.current = null;
      setLoadedCampaign(null);
    } finally {
      if (requested.current === name) setLoading(false);
    }
  }, []);
  const ready = loadedCampaign !== null && loadedCampaign === campaign;
  useEffect(() => { void load(campaign); }, [campaign, load]);

  const configKey = (element: LabCampaignElement) => configLabel(element);
  const filtered = useMemo(() => elements.filter((element) => (!taskFilter || element.task.id === taskFilter)
    && (!configFilter || configKey(element) === configFilter)), [elements, taskFilter, configFilter]);
  const queue = useMemo(() => filtered.filter((element) => stateFilter === "todo" ? element.verdict === null && !skipped.has(element.id)
    : stateFilter === "good" ? element.verdict === "good" : stateFilter === "bad" ? element.verdict === "bad" : true), [filtered, stateFilter, skipped]);
  const current = queue.find((element) => element.id === currentId) ?? queue[0] ?? null;
  const counts = useMemo(() => ({
    total: filtered.length,
    good: filtered.filter((element) => element.verdict === "good").length,
    bad: filtered.filter((element) => element.verdict === "bad").length,
    skipped: filtered.filter((element) => element.verdict === null && skipped.has(element.id)).length,
  }), [filtered, skipped]);
  const tasks = useMemo(() => [...new Map(elements.map((element) => [element.task.id, element.task.label])).entries()], [elements]);
  const configs = useMemo(() => [...new Set(elements.map(configKey))], [elements]);

  const next = useCallback((from: LabCampaignElement) => {
    const index = queue.findIndex((element) => element.id === from.id);
    return queue[index + 1] ?? null;
  }, [queue]);

  const judge = useCallback(async (verdict: LabVerdict) => {
    if (!ready || !current || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      await labApi.judge(campaign, current.id, verdict);
      const following = stateFilter === "todo" ? null : next(current)?.id ?? null;
      setElements((list) => list.map((element) => element.id === current.id ? { ...element, verdict, verdict_at: new Date().toISOString() } : element));
      setSkipped((set) => { const copy = new Set(set); copy.delete(current.id); return copy; });
      setCurrentId(following);
      setNotice(`${verdict === "good" ? "Bon" : "Pas bon"} : verdict enregistré.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }, [campaign, current, next, ready, stateFilter]);

  const skip = useCallback(() => {
    if (!ready || !current || saving.current) return;
    const following = next(current)?.id ?? null;
    setSkipped((set) => new Set(set).add(current.id));
    setCurrentId(following);
    setNotice("Passé : reste non évalué.");
  }, [current, next, ready]);

  const undo = useCallback(async () => {
    if (!ready || !campaign || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const undone = await labApi.undo(campaign);
      setElements((list) => list.map((element) => element.id === undone.element_id ? { ...element, verdict: null, verdict_at: null } : element));
      setSkipped((set) => { const copy = new Set(set); copy.delete(undone.element_id); return copy; });
      setStateFilter((value) => (value === "good" || value === "bad" ? "todo" : value));
      setCurrentId(undone.element_id);
      setNotice("Dernier verdict annulé.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }, [campaign, ready]);

  // An Effect Event runs the handlers of the last committed render: React updates it during the commit,
  // before any later event. A listener re-registered by a passive effect would keep the previous render's
  // handlers until that effect runs, after the paint, and a key pressed meanwhile would be dropped (campaign
  // still « loading ») or judge the element just judged instead of the one on screen. Like the buttons, the
  // shortcuts wait while busy: a verdict's answer releases `saving` before React renders the next element.
  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (busy || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const target = event.target as HTMLElement | null;
    if (target && (TEXT_INPUTS.has(target.tagName) || target.isContentEditable)) return;
    // Only for the verdict screen itself: never behind a dialog, a sheet or the menu drawer, and Escape
    // never while it may be closing a tooltip.
    const main = document.getElementById("dashboard-main-content");
    if (main?.hasAttribute("inert") || document.querySelector("[role=dialog], [role=alertdialog]")) return;
    if (target && target !== document.body && target !== main && !root.current?.contains(target)) return;
    if (event.key === "Escape" && document.querySelector("[data-slot=tooltip-content]")) return;
    const key = event.key.toLowerCase();
    if (key === "g") { event.preventDefault(); void judge("good"); }
    else if (key === "b") { event.preventDefault(); void judge("bad"); }
    else if (key === "s") { event.preventDefault(); skip(); }
    else if (event.key === "Escape") { event.preventDefault(); void undo(); }
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => onShortcut(event);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const judgedRatio = counts.total > 0 ? (counts.good + counts.bad) / counts.total : 0;
  const shownPage = current ? (current.crop ? current.crop.page : Math.min(Math.max(1, current.source_page ?? 1), current.document.pages)) : 1;

  return (
    <div ref={root} className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border bg-surface px-4 py-2">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Évaluation · campagne</p>
            <h2 className="text-base font-semibold text-foreground">Un résultat. Votre verdict.</h2>
          </div>
          <div className="w-56 space-y-0.5 text-xs">
            <label htmlFor={`${fieldId}-campaign`} className="block text-muted-foreground">Campagne</label>
            <NativeSelect id={`${fieldId}-campaign`} size="sm" value={campaign} onChange={(event) => { setCampaign(event.target.value); setSkipped(new Set()); setCurrentId(null); }}>
              {state.campaigns.length === 0 ? <option value="">Aucune campagne</option> : null}
              {state.campaigns.map((name) => <option key={name} value={name}>{name}</option>)}
            </NativeSelect>
          </div>
          <div className="w-48 space-y-0.5 text-xs">
            <label htmlFor={`${fieldId}-task`} className="block text-muted-foreground">Tâche</label>
            <NativeSelect id={`${fieldId}-task`} size="sm" value={taskFilter} onChange={(event) => { setTaskFilter(event.target.value); setCurrentId(null); }}>
              <option value="">Toutes les tâches</option>
              {tasks.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </NativeSelect>
          </div>
          <div className="w-56 space-y-0.5 text-xs">
            <label htmlFor={`${fieldId}-config`} className="block text-muted-foreground">Configuration</label>
            <NativeSelect id={`${fieldId}-config`} size="sm" value={configFilter} onChange={(event) => { setConfigFilter(event.target.value); setCurrentId(null); }}>
              <option value="">Toutes les configurations</option>
              {configs.map((label) => <option key={label} value={label}>{label}</option>)}
            </NativeSelect>
          </div>
          <div className="w-40 space-y-0.5 text-xs">
            <label htmlFor={`${fieldId}-state`} className="block text-muted-foreground">État</label>
            <NativeSelect id={`${fieldId}-state`} size="sm" value={stateFilter} onChange={(event) => { setStateFilter(event.target.value as StateFilter); setCurrentId(null); }}>
              <option value="todo">À évaluer</option>
              <option value="all">Tous</option>
              <option value="good">Bons</option>
              <option value="bad">Pas bons</option>
            </NativeSelect>
          </div>
          <Button size="sm" variant="outline" leftIcon={<RefreshCw />} className="ml-auto" onClick={() => { void refresh(); void load(campaign); }}>Actualiser</Button>
        </div>
        <div className="flex items-center gap-3">
          <p role="status" className="text-xs font-medium tabular-nums text-foreground">{progressText(counts)}</p>
          <div className="h-1.5 w-48 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${judgedRatio * 100}%` }} />
          </div>
        </div>
      </div>
      {error ? <Alert variant="danger" className="shrink-0 rounded-none border-x-0 border-t-0 px-4 py-2 text-xs">{error}</Alert> : null}
      {current ? (
        <article aria-label="Élément à juger" className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
          <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2 text-xs">
            <div className="min-w-0">
              <p className="font-semibold uppercase tracking-wide text-muted-foreground">{current.task.label}</p>
              <p className="truncate font-mono text-sm text-foreground">{current.document.id} · {current.label}</p>
            </div>
            <span className="ml-auto font-mono text-muted-foreground">{current.config_id} · {configLabel(current)} · {promptVersionLabel(current.prompt_version)}</span>
            <Badge size="sm" variant={current.verdict === "good" ? "success" : current.verdict === "bad" ? "danger" : "neutral"}>
              {current.verdict === "good" ? "Bon" : current.verdict === "bad" ? "Pas bon" : "À évaluer"}
            </Badge>
          </header>
          <div className="grid min-h-0 flex-1 grid-cols-2">
            <div className="flex min-h-0 flex-col border-r border-border">
              <p className="shrink-0 border-b border-border-subtle px-3 py-1.5 text-xs text-muted-foreground">
                Source : {current.crop?.box ? "zone recadrée" : `page ${shownPage}`}
                {current.source_page ? ` · source_page ${current.source_page}` : ""}
              </p>
              <LabPdfCanvas className="min-h-0 flex-1" label="Zone jugée" url={labApi.documentUrl(current.document.id, current.document.sha256)}
                page={shownPage} region={current.crop?.box ?? null} />
              {current.answer ? (
                <div className="max-h-[45%] shrink-0 overflow-auto border-t border-border-subtle p-3"><AnswerBars answer={current.answer} /></div>
              ) : null}
              {current.evidence ? (
                <p className="shrink-0 border-t border-border-subtle px-3 py-1.5 text-xs"><span className="text-muted-foreground">Preuve : </span>« {current.evidence} »</p>
              ) : null}
            </div>
            <div className="flex min-h-0 flex-col">
              {current.schema_error || current.config_message ? (
                <Alert variant={current.schema_error ? "danger" : "warning"} className="m-3 w-auto shrink-0 px-3 py-2 text-xs">{current.config_message ?? current.detail}</Alert>
              ) : null}
              <p className="shrink-0 px-3 pt-2 text-xs font-semibold text-muted-foreground">Réponse du modèle</p>
              <p className="shrink-0 px-3 text-sm text-foreground">{current.label}{current.detail && !current.schema_error ? ` · ${current.detail}` : ""}</p>
              <pre className="m-3 min-h-0 flex-1 overflow-auto rounded-md border border-border bg-surface-subtle p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
                {typeof current.json === "string" ? current.json : JSON.stringify(current.json, null, 2)}
              </pre>
            </div>
          </div>
        </article>
      ) : (
        <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {loading ? "Chargement de la campagne…" : !campaign ? "Aucune campagne : lancez un essai." : stateFilter === "todo" ? "Rien à parcourir dans cette sélection." : "Aucun élément dans cette sélection."}
        </p>
      )}
      <div className="flex shrink-0 flex-col items-center gap-1 border-t border-border bg-surface-subtle px-4 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="md" leftIcon={<Undo2 />} onClick={() => void undo()} disabled={busy || !ready || !campaign || !state.configured}>
            Annuler<Kbd>Échap</Kbd>
          </Button>
          <Button variant="danger" size="lg" leftIcon={<X />} onClick={() => void judge("bad")} disabled={busy || !ready || !current || !state.configured} className="min-w-36">
            Pas bon<Kbd>B</Kbd>
          </Button>
          <Button variant="outline" size="md" leftIcon={<SkipForward />} onClick={skip} disabled={busy || !ready || !current}>
            Passer<Kbd>S</Kbd>
          </Button>
          <Button variant="primary" size="lg" leftIcon={<Check />} onClick={() => void judge("good")} disabled={busy || !ready || !current || !state.configured} className="min-w-36">
            Bon<Kbd>G</Kbd>
          </Button>
        </div>
        <p className={cn("h-4 text-xs text-muted-foreground")} aria-live="polite">{notice ?? "B : pas bon · S : passer · G : bon · Échap : annuler le dernier verdict"}</p>
      </div>
    </div>
  );
}
