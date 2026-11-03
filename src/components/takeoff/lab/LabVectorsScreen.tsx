"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ClipboardCopy, Eye, EyeOff, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Sparkles, Tags } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { useTakeoffLab } from "@/components/takeoff/lab/TakeoffLabShell";
import { ConfigStatusBadge, LabResultColumn } from "@/components/takeoff/lab/LabResultColumn";
import { LabPdfCanvas } from "@/components/takeoff/lab/LabPdfCanvas";
import { errorMessage, formatInteger, formatLatency, formatPercent, formatRatio, labApi } from "@/components/takeoff/lab/lab-api";
import {
  defaultCampaignName, LAB_NAME_PATTERN, LAB_VECTOR_TASK_ID, promptVersionLabel,
  type LabRun, type LabRunSummary, type LabVectorClassSource, type LabVectorGroup, type LabVectorPage,
} from "@/lib/takeoff/lab/contracts";
import { cn } from "@/lib/utils";

// Vectors page of the takeoff lab (TI-662), « mise en page outil »: on the
// left the document page and its layers and colours (one row per group of
// traces: shown or not, class, confidence and source, keyword guess, length and
// segments; Alt-click on a box shows that group alone), « Classer avec
// Decisions » at the bottom; in the centre the page with the visible groups
// drawn over it, the scale and detection badges and the measured networks; on
// the right the Decisions run (latency, tokens, probabilities, raw JSON). The
// checked groups are the selection « Copier la sélection » gives as the
// dataset's truth/groups JSON: the lab never writes the dataset.

const RESULTS_MIN = 320;
const PALETTE = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];
const SCALE_LABELS: Record<LabVectorPage["scale"]["status"], string> = {
  verified: "vérifiée par une cote", format: "format conforme", calibrated: "calibrée", unverified: "non vérifiée",
};
const SOURCE_LABELS: Record<LabVectorClassSource, string> = {
  keyword: "mots-clés", legend: "légende", label: "libellés", document: "document", user: "utilisateur", decisions: "Decisions",
};

function formatDenominator(denominator: number) {
  return Number.isInteger(denominator) ? String(denominator) : denominator.toFixed(1);
}

function classText(group: Pick<LabVectorGroup, "class" | "confidence" | "candidates">) {
  if (group.class === null) return group.candidates.length > 0 ? `${group.candidates.join(" ou ")} ?` : "à revoir";
  return group.confidence === null ? group.class : `${group.class} ${formatPercent(group.confidence)}`;
}

function lengthText(metres: number | null) {
  return metres === null ? "— m" : `${formatRatio(metres)} m`;
}

/** One SVG path per group: its segments as move / line pairs, in page points. */
function pathOf(geometry: readonly number[]) {
  let path = "";
  for (let index = 0; index + 3 < geometry.length; index += 4) {
    path += `M${geometry[index]} ${geometry[index + 1]}L${geometry[index + 2]} ${geometry[index + 3]}`;
  }
  return path;
}

function Step({ index, title, aside, children, grow = false }: Readonly<{ index: number; title: string; aside?: React.ReactNode; children: React.ReactNode; grow?: boolean }>) {
  return (
    <section aria-labelledby={`lab-vectors-step-${index}`} className={cn("flex flex-col gap-2 border-b border-border px-4 py-3", grow && "min-h-0 flex-1")}>
      <h2 id={`lab-vectors-step-${index}`} className="flex shrink-0 items-center gap-2 text-sm font-semibold text-foreground">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{index}</span>
        {title}
        {aside ? <span className="ml-auto text-xs font-normal text-muted-foreground">{aside}</span> : null}
      </h2>
      {children}
    </section>
  );
}

export function LabVectorsScreen() {
  const { state, refresh } = useTakeoffLab();
  const task = state.tasks.find((entry) => entry.id === LAB_VECTOR_TASK_ID) ?? null;
  const [documentId, setDocumentId] = useState(state.documents[0]?.id ?? "");
  const document = state.documents.find((entry) => entry.id === documentId) ?? null;
  const [page, setPage] = useState(1);
  const [campaign, setCampaign] = useState(() => (documentId ? defaultCampaignName(documentId, new Date()) : ""));
  const [campaignEdited, setCampaignEdited] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<LabRun | null>(null);
  const [reading, setReading] = useState<LabVectorPage | null>(null);
  const [readingError, setReadingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [copy, setCopy] = useState<{ status: "copied" | "refused"; json: string; count: number } | null>(null);
  const [history, setHistory] = useState<LabRunSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [resultsWidth, setResultsWidth] = useState(420);
  const fieldId = useId();
  const list = useRef<HTMLUListElement>(null);
  const workArea = useRef<HTMLDivElement>(null);
  const [workWidth, setWorkWidth] = useState(0);
  const resize = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    const element = workArea.current;
    if (!element) return;
    const measure = () => setWorkWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // The results panel leaves at least 40 % of the work area to the plan.
  const resultsMax = Math.max(RESULTS_MIN, workWidth * 0.6);
  const clampResults = (value: number) => Math.min(resultsMax, Math.max(RESULTS_MIN, value));

  useEffect(() => {
    if (!documentId) return;
    let active = true;
    setLoading(true);
    setReadingError(null);
    void labApi.vectors(documentId, page, runId).then((next) => {
      if (active) setReading(next);
    }).catch((error) => {
      if (active) setReadingError(errorMessage(error));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [documentId, page, runId]);

  const loadHistory = useCallback(async () => {
    if (!state.configured) return;
    try {
      setHistory((await labApi.runs()).filter((entry) => entry.task.id === LAB_VECTOR_TASK_ID));
    } catch {
      setHistory([]);
    }
  }, [state.configured]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);
  const documentHistory = history.filter((entry) => entry.document.id === documentId);

  function resetPage() {
    setReading(null);
    setRunId(null);
    setRun(null);
    setHidden(new Set());
    setCopy(null);
  }

  function chooseDocument(id: string) {
    setDocumentId(id);
    setPage(1);
    resetPage();
    if (!campaignEdited) setCampaign(defaultCampaignName(id, new Date()));
  }

  function choosePage(next: number) {
    setPage(next);
    resetPage();
  }

  async function showRun(id: string) {
    try {
      const shown = await labApi.run(id);
      if (shown.document.id !== documentId) chooseDocument(shown.document.id);
      setPage(shown.crop?.page ?? 1);
      setHidden(new Set());
      setRun(shown);
      setRunId(shown.id);
    } catch (error) {
      setLaunchError(errorMessage(error));
    }
  }

  const groups = useMemo(() => reading?.groups ?? [], [reading]);
  const colorOf = useMemo(() => new Map(groups.map((group, index) => [group.id, PALETTE[index % PALETTE.length]])), [groups]);
  const shownGroups = groups.filter((group) => !hidden.has(group.id));
  const pending = groups.filter((group) => group.visible && !group.near_white && group.class === null && group.candidates.length === 0).length;
  const networks = useMemo(() => {
    const totals = new Map<string, number | null>();
    for (const entry of reading?.networks ?? []) {
      const known = totals.get(entry.network);
      totals.set(entry.network, entry.length_m === null || known === null ? null : (known ?? 0) + entry.length_m);
    }
    return [...totals.entries()].sort(([left], [right]) => (left < right ? -1 : 1));
  }, [reading]);

  const toggle = (id: string, isolate: boolean) => setHidden((current) => {
    if (isolate) return new Set(groups.map((group) => group.id).filter((entry) => entry !== id));
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const showOnly = (keep: (group: LabVectorGroup) => boolean) => setHidden(new Set(groups.filter((group) => !keep(group)).map((group) => group.id)));

  async function copySelection() {
    if (!reading) return;
    const selected = shownGroups.filter((group) => group.class !== null);
    const json = JSON.stringify({ schema_version: 1, document: reading.document.id,
      groups: selected.map((group) => ({ page: reading.page, group: group.id, class: group.class })) }, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setCopy({ status: "copied", json, count: selected.length });
    } catch {
      setCopy({ status: "refused", json, count: selected.length });
    }
  }

  function moveFocus(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const boxes = [...(list.current?.querySelectorAll<HTMLInputElement>("input[type=checkbox]") ?? [])];
    const index = boxes.indexOf(event.currentTarget);
    const next = boxes[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  const blocked = !state.configured ? state.message ?? "Dataset non configuré."
    : !document ? "Choisissez un document."
    : !task ? "La tâche « classe de calque » est absente."
    : !LAB_NAME_PATTERN.test(campaign) ? "Nom de campagne : lettres minuscules, chiffres et tirets."
    : !state.decisions.available ? state.decisions.message
    : loading || !reading ? (readingError ?? "La page se lit…")
    : null;

  async function launch() {
    if (blocked || !task || !document) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      const result = await labApi.launch({
        documentId: document.id, campaign, taskId: task.id, crop: document.pages > 1 ? { page, box: null } : null,
        prompt: task.defaultPrompt, configs: [{ provider: "decisions" }], image: null,
      });
      setRun(result);
      setRunId(result.id);
      setRightOpen(true);
      await Promise.all([refresh(), loadHistory()]);
    } catch (error) {
      setLaunchError(errorMessage(error));
    } finally {
      setLaunching(false);
    }
  }

  const overlay = reading ? (
    <svg role="img" aria-label="Groupes de tracés affichés" className="block size-full" viewBox={`0 0 ${reading.size_pt[0]} ${reading.size_pt[1]}`}
      preserveAspectRatio="none">
      {shownGroups.filter((group) => group.geometry.length > 0).map((group) => (
        <path key={group.id} data-group={group.id} d={pathOf(group.geometry)} fill="none" stroke={colorOf.get(group.id)} strokeWidth={3}
          strokeOpacity={0.85} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  ) : null;
  const scale = reading?.scale ?? null;
  const config = run?.configs[0] ?? null;

  return (
    <div className="flex h-full min-h-0">
      {leftOpen ? (
        <aside aria-label="Calques et couleurs" className="flex w-[360px] shrink-0 flex-col border-r border-border bg-surface">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Page et calques</span>
            <IconButton label="Replier les calques" size="icon-xs" variant="ghost" icon={<PanelLeftClose />} onClick={() => setLeftOpen(false)} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <Step index={1} title="Document" aside={document ? `${document.pages} page${document.pages > 1 ? "s" : ""}` : undefined}>
              <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2 text-xs">
                <div className="space-y-1">
                  <label htmlFor={`${fieldId}-document`} className="block font-medium text-foreground-secondary">Document</label>
                  <NativeSelect id={`${fieldId}-document`} size="sm" value={documentId} onChange={(event) => chooseDocument(event.target.value)}>
                    {state.documents.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <label htmlFor={`${fieldId}-page`} className="block font-medium text-foreground-secondary">Page</label>
                  <NativeSelect id={`${fieldId}-page`} size="sm" value={String(page)} onChange={(event) => choosePage(Number(event.target.value))}>
                    {Array.from({ length: Math.min(document?.pages ?? 1, 500) }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}
                  </NativeSelect>
                </div>
              </div>
              <div className="space-y-1 text-xs">
                <label htmlFor={`${fieldId}-campaign`} className="block font-medium text-foreground-secondary">Campagne</label>
                <Input id={`${fieldId}-campaign`} size="sm" value={campaign} spellCheck={false} aria-invalid={!LAB_NAME_PATTERN.test(campaign) || undefined}
                  onChange={(event) => { setCampaign(event.target.value); setCampaignEdited(true); }} />
              </div>
            </Step>
            <Step index={2} title="Calques et couleurs" grow aside={reading ? `${shownGroups.length} / ${groups.length}` : undefined}>
              <div role="toolbar" aria-label="Sélection des groupes" className="flex shrink-0 flex-wrap gap-1">
                <Button size="xs" variant="outline" leftIcon={<EyeOff />} disabled={!reading} onClick={() => setHidden(new Set(groups.map((group) => group.id)))}>Tout masquer</Button>
                <Button size="xs" variant="outline" leftIcon={<Eye />} disabled={!reading} onClick={() => setHidden(new Set())}>Tout afficher</Button>
                <Button size="xs" variant="outline" leftIcon={<Sparkles />} disabled={!reading} title="N’afficher que les groupes classés par Decisions"
                  onClick={() => showOnly((group) => group.source === "decisions")}>Choix du modèle</Button>
                <Button size="xs" variant="outline" leftIcon={<Tags />} disabled={!reading} title="N’afficher que les groupes que les mots-clés classent"
                  onClick={() => showOnly((group) => group.keyword.class !== null)}>Mots-clés</Button>
                <Button size="xs" variant="outline" leftIcon={<ClipboardCopy />} disabled={!reading} title="Copier le JSON truth/groups des groupes cochés"
                  onClick={() => void copySelection()}>Copier la sélection</Button>
              </div>
              {copy ? (
                <div role="status" className="shrink-0 space-y-1 text-xs">
                  <p className={copy.status === "copied" ? "text-success" : "text-warning"}>
                    {copy.status === "copied" ? `Sélection copiée : ${copy.count} groupe${copy.count > 1 ? "s" : ""} (truth/groups).`
                      : "Copie refusée par le navigateur : le JSON est ci-dessous."}
                  </p>
                  {copy.status === "refused" ? (
                    <textarea readOnly aria-label="JSON de la sélection" value={copy.json} rows={4}
                      className="w-full rounded-md border border-border bg-surface-subtle p-1 font-mono text-[11px]" />
                  ) : null}
                </div>
              ) : null}
              {loading && !reading ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner aria-label="Lecture vectorielle" />Lecture vectorielle…</p> : null}
              {readingError ? <Alert variant="danger" className="shrink-0 px-3 py-2 text-xs">{readingError}</Alert> : null}
              {reading && groups.length === 0 ? <p className="text-xs text-muted-foreground">Aucun tracé sur cette page.</p> : null}
              <ul ref={list} aria-label="Groupes de tracés" className="-mx-2 min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto">
                {groups.map((group) => {
                  const checked = !hidden.has(group.id);
                  const changed = group.keyword.class !== group.class;
                  return (
                    <li key={group.id} className="flex items-start gap-2 px-2 py-1.5 text-xs" title="Alt-clic sur la case : n’afficher que ce groupe">
                      {/* One handler: Alt is read from the change's click, as the review viewer does. */}
                      <input type="checkbox" checked={checked} aria-label={`Afficher ${group.name}`} onKeyDown={moveFocus}
                        className="mt-0.5 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        onChange={(event) => toggle(group.id, (event.nativeEvent as MouseEvent).altKey === true)} />
                      <span aria-hidden="true" className="mt-0.5 inline-block size-3 shrink-0 rounded-sm" style={{ background: colorOf.get(group.id) }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground" title={group.name}>{group.name}</span>
                        <span className={cn("block", group.class === null ? "text-warning" : "text-foreground-secondary")}>
                          <span className="font-semibold">{classText(group)}</span>
                          {group.source ? <span className="text-muted-foreground"> · {SOURCE_LABELS[group.source]}</span> : null}
                          {changed ? <span className="text-muted-foreground"> · mots-clés : {group.keyword.class ?? "—"}</span> : null}
                        </span>
                        {!group.visible ? <span className="block text-muted-foreground">Calque masqué par le document : non lu</span> : null}
                        {group.near_white ? <span className="block text-muted-foreground">Quasi blanc : jamais mesuré</span> : null}
                      </span>
                      <span className="shrink-0 text-right font-mono tabular-nums text-muted-foreground">
                        <span className="block">{lengthText(group.length_m)}</span>
                        <span className="block">{formatInteger(group.segments)} segment{group.segments > 1 ? "s" : ""}{group.geometry_capped ? " (coupé)" : ""}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Step>
          </div>
          <div className="shrink-0 space-y-1.5 border-t border-border bg-surface p-3">
            {launchError ? <Alert variant="danger" className="px-3 py-2 text-xs">{launchError}</Alert> : null}
            <Button className="w-full" size="lg" leftIcon={<Sparkles />} loading={launching} disabled={Boolean(blocked)} onClick={() => void launch()}>
              Classer avec Decisions
            </Button>
            <p className="text-xs text-muted-foreground">
              {blocked ?? `${pending} groupe${pending > 1 ? "s" : ""} sans classe par mots-clés · page ${page} · campagne ${campaign}.`}
            </p>
          </div>
        </aside>
      ) : (
        <div className="flex w-10 shrink-0 flex-col items-center border-r border-border bg-surface pt-1">
          <IconButton label="Déplier les calques" size="icon-xs" variant="ghost" icon={<PanelLeftOpen />} onClick={() => setLeftOpen(true)} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={workArea} className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-1.5 text-xs">
              {scale ? (
                <Badge size="sm" variant={scale.status === "unverified" ? "warning" : "neutral"}>
                  Échelle {scale.denominator ? `1/${formatDenominator(scale.denominator)} ` : ""}{SCALE_LABELS[scale.status]}
                </Badge>
              ) : null}
              {reading?.detection != null ? <Badge size="sm" variant="info">Détection {Math.round(reading.detection * 100)} %</Badge> : null}
              {reading ? (
                <span aria-live="polite" className="tabular-nums text-muted-foreground">{shownGroups.length} / {groups.length} éléments affichés</span>
              ) : null}
              {reading?.segments.capped ? (
                <span className="text-warning">Géométrie coupée : {formatInteger(reading.segments.shown)} / {formatInteger(reading.segments.total)} segments</span>
              ) : null}
              <ul aria-label="Longueurs mesurées" className="ml-auto flex flex-wrap items-center gap-1.5">
                {networks.map(([network, metres]) => (
                  <li key={network} className="rounded-md border border-border px-1.5 py-0.5 font-mono tabular-nums text-foreground">{network} {lengthText(metres)}</li>
                ))}
                {reading && networks.length === 0 ? <li className="text-muted-foreground">Aucun réseau mesuré</li> : null}
              </ul>
            </div>
            {scale?.status === "unverified" ? (
              <p className="shrink-0 border-b border-warning-border bg-warning-subtle px-3 py-1 text-xs text-warning">
                Échelle non vérifiée ({scale.reason ?? "raison inconnue"}) : ni longueur ni surface sur cette page.
              </p>
            ) : null}
            <LabPdfCanvas className="min-h-0 flex-1" label="Plan et groupes de tracés" url={document ? labApi.documentUrl(document.id) : null}
              page={page} onPageChange={choosePage} overlay={overlay} />
          </div>
          {rightOpen ? (
            <>
              <div role="separator" aria-orientation="vertical" aria-label="Largeur du classement" tabIndex={0}
                aria-valuenow={Math.round(resultsWidth)} aria-valuemin={RESULTS_MIN} aria-valuemax={Math.round(resultsMax)}
                className="w-1.5 shrink-0 cursor-col-resize bg-border hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const panel = event.currentTarget.nextElementSibling?.getBoundingClientRect().width ?? resultsWidth;
                  resize.current = { x: event.clientX, width: panel };
                }}
                onPointerMove={(event) => { if (resize.current) setResultsWidth(clampResults(resize.current.width - (event.clientX - resize.current.x))); }}
                onPointerUp={() => { resize.current = null; }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") setResultsWidth((value) => clampResults(value + 40));
                  if (event.key === "ArrowRight") setResultsWidth((value) => clampResults(value - 40));
                }} />
              <section aria-label="Classement Decisions" className="flex min-w-0 shrink-0 flex-col bg-surface" style={{ width: Math.min(resultsWidth, resultsMax) }}>
                <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
                  <span className="shrink-0 whitespace-nowrap font-semibold uppercase tracking-wide text-muted-foreground">Classement Decisions</span>
                  {run ? <span className="min-w-0 truncate text-muted-foreground">{new Date(run.created_at).toLocaleString("fr-FR")} · {promptVersionLabel(run.prompt.version)}</span> : null}
                  <IconButton label="Replier le classement" size="icon-xs" variant="ghost" icon={<PanelRightClose />} className="ml-auto" onClick={() => setRightOpen(false)} />
                </div>
                {run?.stop ? <p role="status" className="shrink-0 border-b border-warning-border bg-warning-subtle px-3 py-1.5 text-xs text-warning">{run.stop.message}</p> : null}
                {reading?.run ? (
                  <p className="shrink-0 border-b border-border-subtle px-3 py-1 text-xs text-muted-foreground">
                    {reading.run.applied} / {reading.run.answers} réponse{reading.run.answers > 1 ? "s" : ""} appliquée{reading.run.applied > 1 ? "s" : ""} à la lecture (réseau Decisions mesuré à 80 % et plus).
                  </p>
                ) : null}
                {config ? (
                  <div className="flex min-h-0 flex-1"><LabResultColumn config={config} /></div>
                ) : (
                  <p className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                    « Classer avec Decisions » demande une classe pour chaque groupe que les mots-clés laissent : latence, jetons, probabilités et JSON brut ici.
                  </p>
                )}
              </section>
            </>
          ) : (
            <div className="flex w-10 shrink-0 flex-col items-center border-l border-border bg-surface pt-1">
              <IconButton label="Déplier le classement" size="icon-xs" variant="ghost" icon={<PanelRightOpen />} onClick={() => setRightOpen(true)} />
            </div>
          )}
        </div>
        <section aria-label="Historique et comparaison" className={cn("flex shrink-0 flex-col border-t border-border bg-surface", historyOpen ? "h-48" : "h-10")}>
          <button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)}
            className="flex h-10 shrink-0 items-center gap-2 px-3 text-left text-sm font-medium text-foreground hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
            {historyOpen ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronUp aria-hidden="true" className="size-4" />}
            Historique et comparaison · {documentHistory.length} rapport{documentHistory.length > 1 ? "s" : ""}
          </button>
          {historyOpen ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface text-left text-muted-foreground">
                  <tr><th className="px-3 py-1 font-medium">Date</th><th className="px-3 py-1 font-medium">Campagne</th><th className="px-3 py-1 font-medium">Page</th>
                    <th className="px-3 py-1 font-medium">Statut</th><th className="px-3 py-1 font-medium">Groupes</th><th className="px-3 py-1 font-medium">Jetons · latence</th><th className="px-3 py-1" /></tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {documentHistory.map((entry) => {
                    const summary = entry.configs[0];
                    return (
                      <tr key={entry.id} className={cn(runId === entry.id && "bg-primary/5")}>
                        <td className="px-3 py-1 whitespace-nowrap tabular-nums">{new Date(entry.created_at).toLocaleString("fr-FR")}</td>
                        <td className="px-3 py-1 font-mono">{entry.campaign}</td>
                        <td className="px-3 py-1 tabular-nums">{entry.crop?.page ?? 1}</td>
                        <td className="px-3 py-1">{summary ? <ConfigStatusBadge status={summary.status} /> : null}</td>
                        <td className="px-3 py-1 tabular-nums">{summary?.elements ?? 0}</td>
                        <td className="px-3 py-1 tabular-nums text-muted-foreground">
                          {summary?.usage ? `${formatInteger(summary.usage.total)} jetons` : "—"} · {formatLatency(summary?.latency_ms ?? null)}
                        </td>
                        <td className="px-3 py-1 text-right"><Button size="xs" variant="ghost" onClick={() => void showRun(entry.id)}>Afficher</Button></td>
                      </tr>
                    );
                  })}
                  {documentHistory.length === 0 ? <tr><td colSpan={7} className="px-3 py-3 text-muted-foreground">Aucun classement de ce document.</td></tr> : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
