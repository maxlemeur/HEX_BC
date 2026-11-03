"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Crop, PanelLeftClose, PanelLeftOpen, Play, Plus, RotateCcw, X } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useTakeoffLab } from "@/components/takeoff/lab/TakeoffLabShell";
import { ConfigStatusBadge, LabResultColumn, scoreText } from "@/components/takeoff/lab/LabResultColumn";
import { LabPdfCanvas } from "@/components/takeoff/lab/LabPdfCanvas";
import { errorMessage, formatInteger, formatLatency, labApi } from "@/components/takeoff/lab/lab-api";
import { renderDecisionsImage } from "@/components/takeoff/lab/lab-pdf";
import type { ChatGptAvailableModel, ChatGptReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";
import {
  configLabel, defaultCampaignName, LAB_CONFIG_IDS, LAB_MAX_CONFIGS, LAB_NAME_PATTERN, promptVersionLabel,
  type LabConfigInput, type LabProvider, type LabRun, type LabRunSummary, type LabTaskDescriptor,
} from "@/lib/takeoff/lab/contracts";
import type { NormalizedBox } from "@/lib/takeoff/lab/geometry";
import { cn } from "@/lib/utils";

const RESULTS_MIN = 320;

type DraftConfig = { provider: LabProvider; model: string; reasoningEffort: ChatGptReasoningEffort | null };

const EFFORT_LABELS: Record<ChatGptReasoningEffort, string> = {
  none: "aucun", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max",
};

function Step({ index, title, aside, children }: Readonly<{ index: number; title: string; aside?: React.ReactNode; children: React.ReactNode }>) {
  return (
    <section aria-labelledby={`lab-step-${index}`} className="space-y-2 border-b border-border px-4 py-3">
      <h2 id={`lab-step-${index}`} className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{index}</span>
        {title}
        {aside ? <span className="ml-auto text-xs font-normal text-muted-foreground">{aside}</span> : null}
      </h2>
      {children}
    </section>
  );
}

function boxLabel(box: NormalizedBox) {
  const pct = (value: number) => Math.round(value * 100);
  return `Zone ${pct(box.width)} × ${pct(box.height)} % à (${pct(box.x)} %, ${pct(box.y)} %)`;
}

export function LabEssaiScreen() {
  const { state, refresh } = useTakeoffLab();
  const [documentId, setDocumentId] = useState(state.documents[0]?.id ?? "");
  const document = state.documents.find((entry) => entry.id === documentId) ?? null;
  const [page, setPage] = useState(1);
  const [pageOnly, setPageOnly] = useState(false);
  const [box, setBox] = useState<NormalizedBox | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [campaign, setCampaign] = useState(() => (documentId ? defaultCampaignName(documentId, new Date()) : ""));
  const [campaignEdited, setCampaignEdited] = useState(false);
  const [taskId, setTaskId] = useState(state.tasks[0]?.id ?? "");
  const task = state.tasks.find((entry) => entry.id === taskId) ?? null;
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const prompt = task ? prompts[task.id] ?? task.defaultPrompt : "";
  const [promptOpen, setPromptOpen] = useState(false);
  const [models, setModels] = useState<ChatGptAvailableModel[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [configs, setConfigs] = useState<DraftConfig[]>([]);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [run, setRun] = useState<LabRun | null>(null);
  const [history, setHistory] = useState<LabRunSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [resultsWidth, setResultsWidth] = useState(620);
  const pdf = useRef<PDFDocumentProxy | null>(null);
  const fieldId = useId();
  const workArea = useRef<HTMLDivElement>(null);
  const [workWidth, setWorkWidth] = useState(0);
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
  const resize = useRef<{ x: number; width: number } | null>(null);

  const chatgptReady = state.chatgpt.connected && Boolean(state.chatgpt.model);
  useEffect(() => {
    if (!chatgptReady) return;
    let active = true;
    void labApi.models().then((result) => {
      if (active) setModels(result.models);
    }).catch((error) => {
      if (active) setModelsError(errorMessage(error));
    });
    return () => { active = false; };
  }, [chatgptReady]);

  const defaultConfig = useCallback((descriptor: LabTaskDescriptor | null): DraftConfig => {
    const providers = descriptor?.providers ?? ["chatgpt"];
    const provider = providers.find((entry) => entry !== "decisions" || state.decisions.available) ?? providers[0];
    const model = state.chatgpt.model ?? models?.[0]?.id ?? "";
    return { provider, model, reasoningEffort: provider === "chatgpt" ? state.chatgpt.reasoning_effort : null };
  }, [models, state.chatgpt.model, state.chatgpt.reasoning_effort, state.decisions.available]);

  useEffect(() => {
    setConfigs((current) => (current.length > 0 ? current : [defaultConfig(task)]));
  }, [defaultConfig, task]);

  const loadHistory = useCallback(async () => {
    if (!state.configured) return;
    try {
      setHistory(await labApi.runs());
    } catch {
      setHistory([]);
    }
  }, [state.configured]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  function chooseDocument(id: string) {
    setDocumentId(id);
    setPage(1);
    setBox(null);
    setCropMode(false);
    setPageOnly(false);
    if (!campaignEdited) setCampaign(defaultCampaignName(id, new Date()));
  }

  function chooseTask(id: string) {
    const next = state.tasks.find((entry) => entry.id === id) ?? null;
    setTaskId(id);
    // Another task starts from its own default configuration (Decisions first for a choice).
    setConfigs([defaultConfig(next)]);
  }

  function updateConfig(index: number, patch: Partial<DraftConfig>) {
    setConfigs((current) => current.map((config, position) => {
      if (position !== index) return config;
      const next = { ...config, ...patch };
      if (patch.provider === "chatgpt" && !next.model) next.model = state.chatgpt.model ?? models?.[0]?.id ?? "";
      if (patch.model !== undefined || patch.provider !== undefined) {
        const efforts = models?.find((model) => model.id === next.model)?.reasoningEfforts ?? [];
        if (next.reasoningEffort !== null && !efforts.includes(next.reasoningEffort)) next.reasoningEffort = null;
      }
      if (next.provider === "decisions") next.reasoningEffort = null;
      return next;
    }));
  }

  const modelOptions = useMemo(() => {
    const listed = models ?? [];
    const profile = state.chatgpt.model;
    return profile && !listed.some((model) => model.id === profile) ? [...listed, { id: profile, name: profile, reasoningEfforts: [], defaultReasoningEffort: null }] : listed;
  }, [models, state.chatgpt.model]);

  // Decisions reads one rendered page: on a multi-page document the essai names it for every configuration.
  const decisionsPage = configs.some((config) => config.provider === "decisions") && (document?.pages ?? 1) > 1;
  const crop = box ? { page, box } : (pageOnly || decisionsPage) && (document?.pages ?? 1) > 1 ? { page, box: null } : null;
  const blocked = !state.configured ? state.message ?? "Dataset non configuré."
    : !document ? "Choisissez un document."
    : !task ? "Choisissez une tâche."
    : !LAB_NAME_PATTERN.test(campaign) ? "Nom de campagne : lettres minuscules, chiffres et tirets."
    : prompt.trim().length === 0 ? "Le prompt est vide."
    : prompt.length > task.promptMax ? `Le prompt dépasse ${formatInteger(task.promptMax)} caractères.`
    : configs.some((config) => config.provider === "chatgpt") && !chatgptReady ? state.chatgpt.message ?? "ChatGPT n’est pas prêt."
    : configs.some((config) => config.provider === "chatgpt" && !config.model) ? modelsError ?? "Choisissez un modèle ChatGPT."
    : configs.some((config) => config.provider === "decisions") && !state.decisions.available ? state.decisions.message
    : null;

  async function launch() {
    if (blocked || !task || !document) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      const needsImage = configs.some((config) => config.provider === "decisions");
      if (needsImage && !pdf.current) throw new Error("Le plan n’est pas encore chargé.");
      const image = needsImage && pdf.current ? await renderDecisionsImage(pdf.current, page, box) : null;
      const body = {
        documentId: document.id, campaign, taskId: task.id, crop, prompt, image,
        configs: configs.map((config): LabConfigInput => config.provider === "decisions" ? { provider: "decisions" }
          : { provider: "chatgpt", model: config.model, reasoningEffort: config.reasoningEffort }),
      };
      const result = await labApi.launch(body);
      setRun(result);
      await Promise.all([refresh(), loadHistory()]);
    } catch (error) {
      setLaunchError(errorMessage(error));
    } finally {
      setLaunching(false);
    }
  }

  async function showRun(id: string) {
    try {
      setRun(await labApi.run(id));
    } catch (error) {
      setLaunchError(errorMessage(error));
    }
  }

  const promptEdited = task ? prompt !== task.defaultPrompt : false;
  const datasetDocuments = state.documents.filter((entry) => entry.source === "dataset");
  const fixtureDocuments = state.documents.filter((entry) => entry.source === "fixture");

  return (
    <div className="flex h-full min-h-0">
      {leftOpen ? (
        <aside aria-label="Configuration de l’essai" className="flex w-[340px] shrink-0 flex-col border-r border-border bg-surface">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Configuration</span>
            <IconButton label="Replier la configuration" size="icon-xs" variant="ghost" icon={<PanelLeftClose />} onClick={() => setLeftOpen(false)} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Step index={1} title="Document" aside={document ? `${document.pages} page${document.pages > 1 ? "s" : ""}` : undefined}>
              <div className="space-y-1 text-xs">
                <label htmlFor={`${fieldId}-document`} className="block font-medium text-foreground-secondary">Document</label>
                <NativeSelect id={`${fieldId}-document`} size="sm" value={documentId} onChange={(event) => chooseDocument(event.target.value)}>
                  {datasetDocuments.length > 0 ? (
                    <optgroup label="Dataset">{datasetDocuments.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</optgroup>
                  ) : null}
                  <optgroup label="Fixtures fictives">{fixtureDocuments.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</optgroup>
                </NativeSelect>
              </div>
              {document ? (
                <p className="text-xs text-muted-foreground">
                  {document.truth === "lines" ? "Vérité par lignes : précision et rappel." : document.truth === "keys" ? "Vérité du banc : clés dans la tolérance." : "Sans vérité : pas de score."}
                </p>
              ) : null}
              <div className="space-y-1.5 rounded-md border border-border-subtle bg-surface-subtle p-2 text-xs">
                <p className="font-medium text-foreground-secondary">Recadrage</p>
                {(document?.pages ?? 1) > 1 ? (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={pageOnly || decisionsPage || Boolean(box)} disabled={Boolean(box) || decisionsPage}
                      onChange={(event) => setPageOnly(event.target.checked)} />
                    Seulement la page {page}{decisionsPage ? " (Decisions lit une page)" : ""}
                  </label>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="xs" variant={cropMode ? "primary" : "outline"} leftIcon={<Crop />} aria-pressed={cropMode} onClick={() => setCropMode((value) => !value)} disabled={!document}>
                    {cropMode ? "Tracez la zone sur le plan" : "Dessiner une zone"}
                  </Button>
                  {box ? <Button size="xs" variant="ghost" leftIcon={<X />} onClick={() => setBox(null)}>Effacer la zone</Button> : null}
                </div>
                <p className="text-muted-foreground">{box ? `${boxLabel(box)}, page ${page}` : crop ? `Page ${page} seule` : "PDF entier"}</p>
              </div>
              <div className="space-y-1 text-xs">
                <label htmlFor={`${fieldId}-campaign`} className="block font-medium text-foreground-secondary">Campagne</label>
                <Input id={`${fieldId}-campaign`} size="sm" value={campaign} spellCheck={false} aria-invalid={!LAB_NAME_PATTERN.test(campaign) || undefined}
                  aria-describedby={`${fieldId}-campaign-hint`} onChange={(event) => { setCampaign(event.target.value); setCampaignEdited(true); }} />
                <p id={`${fieldId}-campaign-hint`} className="text-muted-foreground">Par défaut : document et date. Lettres minuscules, chiffres, tirets.</p>
              </div>
            </Step>
            <Step index={2} title="Tâche">
              <fieldset className="space-y-1.5">
                <legend className="sr-only">Tâche de l’essai</legend>
                {state.tasks.map((entry) => (
                  <label key={entry.id} className={cn("flex cursor-pointer gap-2 rounded-md border p-2 text-xs",
                    entry.id === taskId ? "border-primary bg-primary/5" : "border-border hover:bg-surface-subtle")}>
                    <input type="radio" name="lab-task" value={entry.id} checked={entry.id === taskId} onChange={() => chooseTask(entry.id)} className="mt-0.5" />
                    <span>
                      <span className="block font-medium text-foreground">{entry.label}</span>
                      <span className="block text-muted-foreground">{entry.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </Step>
            <Step index={3} title="Configurations" aside={`${configs.length} / ${LAB_MAX_CONFIGS}`}>
              {modelsError && chatgptReady ? <p className="text-xs text-danger">{modelsError}</p> : null}
              {!chatgptReady && task?.providers.includes("chatgpt") ? <p className="text-xs text-warning">{state.chatgpt.message}</p> : null}
              {configs.map((config, index) => {
                const efforts = modelOptions.find((model) => model.id === config.model)?.reasoningEfforts ?? [];
                const id = LAB_CONFIG_IDS[index];
                return (
                  <fieldset key={id} className="relative space-y-1.5 rounded-md border border-border p-2">
                    <legend className="px-1 text-xs font-semibold text-foreground">Configuration {id}</legend>
                    {configs.length > 1 ? (
                      // Outside the legend: the group keeps the name « Configuration X ».
                      <IconButton label={`Retirer la configuration ${id}`} size="icon-xs" variant="ghost" icon={<X />} className="absolute -top-3.5 right-1 bg-surface"
                        onClick={() => setConfigs((current) => current.filter((_, position) => position !== index))} />
                    ) : null}
                    {task && task.providers.length > 1 ? (
                      <div className="space-y-1 text-xs">
                        <label htmlFor={`${fieldId}-${id}-provider`} className="block text-muted-foreground">Fournisseur</label>
                        <NativeSelect id={`${fieldId}-${id}-provider`} size="sm" value={config.provider} onChange={(event) => updateConfig(index, { provider: event.target.value as LabProvider })}>
                          {task.providers.map((provider) => (
                            <option key={provider} value={provider} disabled={provider === "decisions" && !state.decisions.available}>
                              {provider === "decisions" ? `Decisions (${state.decisions.model})` : "ChatGPT local"}
                            </option>
                          ))}
                        </NativeSelect>
                      </div>
                    ) : null}
                    {config.provider === "chatgpt" ? (
                      <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-2">
                        <div className="space-y-1 text-xs">
                          <label htmlFor={`${fieldId}-${id}-model`} className="block text-muted-foreground">Modèle</label>
                          <NativeSelect id={`${fieldId}-${id}-model`} size="sm" value={config.model} onChange={(event) => updateConfig(index, { model: event.target.value })} disabled={!chatgptReady}>
                            {modelOptions.length === 0 ? <option value="">—</option> : null}
                            {modelOptions.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}
                          </NativeSelect>
                        </div>
                        <div className="space-y-1 text-xs">
                          <label htmlFor={`${fieldId}-${id}-effort`} className="block text-muted-foreground">Effort</label>
                          <NativeSelect id={`${fieldId}-${id}-effort`} size="sm" value={config.reasoningEffort ?? "auto"} disabled={!chatgptReady}
                            onChange={(event) => updateConfig(index, { reasoningEffort: event.target.value === "auto" ? null : event.target.value as ChatGptReasoningEffort })}>
                            <option value="auto">Automatique</option>
                            {efforts.map((effort) => <option key={effort} value={effort}>{EFFORT_LABELS[effort]}</option>)}
                          </NativeSelect>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono text-foreground">{state.decisions.model}</span> · sans effort.
                        {!state.decisions.available ? <span className="block text-warning">{state.decisions.message}</span> : null}
                      </p>
                    )}
                  </fieldset>
                );
              })}
              <Button size="xs" variant="outline" leftIcon={<Plus />} disabled={configs.length >= LAB_MAX_CONFIGS}
                onClick={() => setConfigs((current) => [...current, { ...(current.at(-1) ?? defaultConfig(task)) }])}>
                Ajouter une configuration
              </Button>
              <p className="text-xs text-muted-foreground">Même document et même prompt pour chaque configuration.</p>
            </Step>
            <Step index={4} title="Prompt" aside={task ? (promptEdited ? "modifié" : "par défaut") : undefined}>
              <Button size="xs" variant="ghost" aria-expanded={promptOpen} rightIcon={promptOpen ? <ChevronUp /> : <ChevronDown />} onClick={() => setPromptOpen((value) => !value)}>
                {promptOpen ? "Masquer le prompt" : "Modifier le prompt"}
              </Button>
              {promptOpen && task ? (
                <div className="space-y-1">
                  <Textarea aria-label="Prompt de l’essai" value={prompt} rows={12} spellCheck={false} className="font-mono text-[11px] leading-snug"
                    onChange={(event) => setPrompts((current) => ({ ...current, [task.id]: event.target.value }))} />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="tabular-nums">{formatInteger(prompt.length)} / {formatInteger(task.promptMax)} caractères</span>
                    {promptEdited ? (
                      <Button size="xs" variant="ghost" leftIcon={<RotateCcw />} onClick={() => setPrompts((current) => ({ ...current, [task.id]: task.defaultPrompt }))}>
                        Prompt par défaut
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {task?.kind === "choice" && task.question ? (
                <p className="text-xs text-muted-foreground">Choix fixés : {task.question.choices.map((choice) => choice.label).join(", ")}.</p>
              ) : null}
            </Step>
          </div>
          <div className="shrink-0 space-y-1.5 border-t border-border bg-surface p-3">
            {launchError ? <Alert variant="danger" className="px-3 py-2 text-xs">{launchError}</Alert> : null}
            <Button className="w-full" size="lg" leftIcon={<Play />} loading={launching} disabled={Boolean(blocked)} onClick={() => void launch()}>
              Lancer · {configs.length} configuration{configs.length > 1 ? "s" : ""}
            </Button>
            <p className="text-xs text-muted-foreground">
              {blocked ?? `${crop ? (box ? "Zone recadrée" : `Page ${page}`) : "PDF entier"} · campagne ${campaign}. Les configurations passent l’une après l’autre.`}
            </p>
          </div>
        </aside>
      ) : (
        <div className="flex w-10 shrink-0 flex-col items-center border-r border-border bg-surface pt-1">
          <IconButton label="Déplier la configuration" size="icon-xs" variant="ghost" icon={<PanelLeftOpen />} onClick={() => setLeftOpen(true)} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={workArea} className="flex min-h-0 flex-1">
          <LabPdfCanvas className="min-w-0 flex-1" label="Plan de l’essai" url={document ? labApi.documentUrl(document.id) : null}
            page={page} onPageChange={(next) => { setPage(next); setBox(null); }} onDocument={(value) => { pdf.current = value; }}
            box={box} cropMode={cropMode} onBoxChange={(next) => { setBox(next); setCropMode(false); }} />
          <div role="separator" aria-orientation="vertical" aria-label="Largeur des résultats" tabIndex={0}
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
          <section aria-label="Résultats bruts" className="flex min-w-0 shrink-0 flex-col bg-surface" style={{ width: Math.min(resultsWidth, resultsMax) }}>
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
              <span className="font-semibold uppercase tracking-wide text-muted-foreground">Résultats bruts</span>
              {run ? (
                <span className="min-w-0 truncate text-muted-foreground">
                  {new Date(run.created_at).toLocaleString("fr-FR")} · {run.document.id} · {promptVersionLabel(run.prompt.version)}
                </span>
              ) : null}
              {run?.status === "stopped" ? <Badge size="sm" variant="warning" className="ml-auto">Arrêté</Badge> : null}
            </div>
            {run?.stop ? <p role="status" className="shrink-0 border-b border-warning-border bg-warning-subtle px-3 py-1.5 text-xs text-warning">{run.stop.message}</p> : null}
            {run ? (
              <div className="flex min-h-0 flex-1 overflow-x-auto">
                {run.configs.map((config) => <LabResultColumn key={config.id} config={config} />)}
              </div>
            ) : (
              <p className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                Lancez un essai : une colonne par configuration, avec jetons, latence, score et JSON brut.
              </p>
            )}
          </section>
        </div>
        <section aria-label="Historique et comparaison" className={cn("flex shrink-0 flex-col border-t border-border bg-surface", historyOpen ? "h-56" : "h-10")}>
          <button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)}
            className="flex h-10 shrink-0 items-center gap-2 px-3 text-left text-sm font-medium text-foreground hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
            {historyOpen ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronUp aria-hidden="true" className="size-4" />}
            Historique et comparaison · {history.length} rapport{history.length > 1 ? "s" : ""}
          </button>
          {historyOpen ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface text-left text-muted-foreground">
                  <tr><th className="px-3 py-1 font-medium">Date</th><th className="px-3 py-1 font-medium">Campagne</th><th className="px-3 py-1 font-medium">Document</th>
                    <th className="px-3 py-1 font-medium">Tâche</th><th className="px-3 py-1 font-medium">Configurations</th><th className="px-3 py-1" /></tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {history.map((entry) => (
                    <tr key={entry.id} className={cn(run?.id === entry.id && "bg-primary/5")}>
                      <td className="px-3 py-1 whitespace-nowrap tabular-nums">{new Date(entry.created_at).toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-1 font-mono">{entry.campaign}</td>
                      <td className="px-3 py-1 font-mono">{entry.document.id}{entry.crop ? " (recadré)" : ""}</td>
                      <td className="px-3 py-1">{entry.task.label}</td>
                      <td className="px-3 py-1">
                        <ul className="space-y-0.5">
                          {entry.configs.map((config) => (
                            <li key={config.id} className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono">{config.id} · {configLabel(config)}</span>
                              <ConfigStatusBadge status={config.status} />
                              <span className="text-muted-foreground tabular-nums">
                                {config.usage ? `${formatInteger(config.usage.total)} jetons` : "—"} · {formatLatency(config.latency_ms)}
                                {scoreText(config.score) ? ` · ${scoreText(config.score)}` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-3 py-1 text-right"><Button size="xs" variant="ghost" onClick={() => void showRun(entry.id)}>Afficher</Button></td>
                    </tr>
                  ))}
                  {history.length === 0 ? <tr><td colSpan={6} className="px-3 py-3 text-muted-foreground">Aucun essai enregistré.</td></tr> : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
