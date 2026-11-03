"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTakeoffLab } from "@/components/takeoff/lab/TakeoffLabShell";
import { errorMessage, formatInteger, formatLatency, formatPercent, labApi } from "@/components/takeoff/lab/lab-api";
import { promptVersionLabel, type LabBenchReportSummary, type LabStats, type LabStatsGroup } from "@/lib/takeoff/lab/contracts";
import { interestZone, paretoFrontier, type ChartPoint } from "@/lib/takeoff/lab/geometry";
import { cn } from "@/lib/utils";

type Axis = "tokens" | "latency";

function groupName(group: LabStatsGroup) {
  return `${group.label} · ${promptVersionLabel(group.prompt_version)}`;
}

/** Ranked bars, one hue: share judged good, with n under each label. */
function RateBars({ groups }: { groups: LabStatsGroup[] }) {
  return (
    <ul aria-label="Part jugée bonne par configuration" className="space-y-2">
      {groups.map((group) => (
        <li key={group.id} className="grid grid-cols-[minmax(0,16rem)_1fr_7rem] items-center gap-3 text-xs">
          <span className="min-w-0">
            <span className="block truncate font-mono text-foreground" title={groupName(group)}>{group.label}</span>
            <span className="block truncate text-muted-foreground">{group.task.label} · {promptVersionLabel(group.prompt_version)}</span>
          </span>
          <span className="h-3 overflow-hidden rounded-r bg-muted" aria-hidden="true">
            {group.rate !== null ? <span className="block h-full rounded-r bg-primary" style={{ width: `${Math.max(group.rate * 100, 0.5)}%` }} /> : null}
          </span>
          <span className="text-right tabular-nums text-foreground">
            {group.rate === null ? "—" : formatPercent(group.rate)} <span className="text-muted-foreground">· n = {group.judged}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const CHART = { width: 720, height: 340, left: 56, right: 24, top: 16, bottom: 44 };
const CHART_MAX_HEIGHT = 360;

/** 1-2-5 ticks of each decade inside [10^lo, 10^hi]; the extreme values when fewer than two fall inside. */
function logTicks(lo: number, hi: number, values: readonly number[]) {
  const ticks: number[] = [];
  for (let decade = Math.floor(lo); decade <= Math.ceil(hi); decade += 1) {
    for (const step of [1, 2, 5]) {
      const value = step * 10 ** decade;
      if (Math.log10(value) >= lo && Math.log10(value) <= hi) ticks.push(value);
    }
  }
  return ticks.length >= 2 ? ticks : [...new Set([Math.min(...values), Math.max(...values)])];
}

function ParetoChart({ groups, axis }: { groups: LabStatsGroup[]; axis: Axis }) {
  const points = groups.flatMap((group): Array<ChartPoint & { group: LabStatsGroup }> => {
    const x = axis === "tokens" ? group.mean_tokens : group.mean_latency_ms;
    return group.rate !== null && x !== null ? [{ id: group.id, x: Math.max(x, 1), y: group.rate, group }] : [];
  });
  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Aucune configuration jugée : rendez des verdicts pour placer les points.</p>;
  }
  const frontier = paretoFrontier(points);
  const onFrontier = new Set(frontier.map((point) => point.id));
  const zone = interestZone(points);
  const xs = points.map((point) => point.x);
  const lo = Math.log10(Math.min(...xs) / 2);
  const hi = Math.log10(Math.max(...xs) * 2);
  const plotWidth = CHART.width - CHART.left - CHART.right;
  const plotHeight = CHART.height - CHART.top - CHART.bottom;
  const sx = (value: number) => CHART.left + ((Math.log10(value) - lo) / (hi - lo)) * plotWidth;
  const sy = (value: number) => CHART.top + (1 - value) * plotHeight;
  const ticks = logTicks(lo, hi, xs);
  const unit = axis === "tokens" ? "jetons" : "latence";
  const tickLabel = (value: number) => axis === "tokens" ? formatInteger(value) : formatLatency(value);
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground" aria-label="Légende">
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-primary/10 ring-1 ring-primary/30" aria-hidden="true" />Zone d’intérêt : moins de {unit} et mieux jugée que la médiane</li>
        <li className="flex items-center gap-1.5"><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" className="stroke-foreground" strokeWidth="1.5" strokeDasharray="2 3" /></svg>Frontière de Pareto</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-primary" aria-hidden="true" />Sur la frontière</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-subtle-foreground" aria-hidden="true" />Dominée</li>
      </ul>
      {/* Width-bound: the dots (HTML) and the SVG keep one coordinate system at any panel size. */}
      <div className="relative mx-auto w-full" style={{ aspectRatio: `${CHART.width} / ${CHART.height}`, maxWidth: (CHART_MAX_HEIGHT * CHART.width) / CHART.height }}>
        <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} className="absolute inset-0 h-full w-full" role="img"
          aria-label={`Validation humaine selon les ${unit} : ${points.length} configurations, ${frontier.length} sur la frontière de Pareto`}>
          {zone ? (
            <rect x={CHART.left} y={sy(1)} width={Math.max(0, sx(zone.maxX) - CHART.left)} height={Math.max(0, sy(zone.minY) - sy(1))} className="fill-primary/10" />
          ) : null}
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((value) => (
            <g key={value}>
              <line x1={CHART.left} x2={CHART.width - CHART.right} y1={sy(value)} y2={sy(value)} className="stroke-border-subtle" strokeWidth="1" />
              <text x={CHART.left - 8} y={sy(value)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px]">{formatPercent(value)}</text>
            </g>
          ))}
          {ticks.map((value) => (
            <g key={value}>
              <line x1={sx(value)} x2={sx(value)} y1={CHART.top} y2={CHART.height - CHART.bottom} className="stroke-border-subtle" strokeWidth="1" />
              <text x={sx(value)} y={CHART.height - CHART.bottom + 16} textAnchor="middle" className="fill-muted-foreground text-[11px]">{tickLabel(value)}</text>
            </g>
          ))}
          <text x={CHART.left + plotWidth / 2} y={CHART.height - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
            {axis === "tokens" ? "Jetons moyens par réponse (échelle log)" : "Latence moyenne par réponse (échelle log)"}
          </text>
          {frontier.length > 1 ? (
            <polyline points={frontier.map((point) => `${sx(point.x)},${sy(point.y)}`).join(" ")} fill="none" className="stroke-foreground" strokeWidth="1.5" strokeDasharray="2 3" />
          ) : null}
          {points.map((point) => (
            <text key={`${point.id}-label`} x={sx(point.x) + 9} y={sy(point.y) - 8} className="fill-foreground font-mono text-[11px]">{point.group.label}</text>
          ))}
        </svg>
        {points.map((point) => (
          <Tooltip key={point.id}>
            <TooltipTrigger render={<button type="button" />} aria-label={`${groupName(point.group)} : ${formatPercent(point.y)} jugé bon, n = ${point.group.judged}`}
              className="absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full focus-visible:outline-2 focus-visible:outline-ring"
              style={{ left: `${(sx(point.x) / CHART.width) * 100}%`, top: `${(sy(point.y) / CHART.height) * 100}%` }}>
              <span className={cn("absolute inset-1 rounded-full ring-2 ring-surface", onFrontier.has(point.id) ? "bg-primary" : "bg-subtle-foreground")} />
            </TooltipTrigger>
            <TooltipContent className="flex-col items-start">
              <span className="font-mono">{groupName(point.group)}</span>
              <span>{formatPercent(point.y)} jugé bon · n = {point.group.judged} ({point.group.good} bons, {point.group.bad} pas bons)</span>
              <span>{point.group.mean_tokens !== null ? `${formatInteger(point.group.mean_tokens)} jetons` : "jetons —"} · {formatLatency(point.group.mean_latency_ms === null ? null : Math.round(point.group.mean_latency_ms))}</span>
              <span>{onFrontier.has(point.id) ? "Sur la frontière de Pareto" : "Dominée par une autre configuration"}</span>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function BenchReports() {
  const [reports, setReports] = useState<LabBenchReportSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  useEffect(() => {
    void labApi.benchReports().then(setReports).catch((cause) => setError(errorMessage(cause)));
  }, []);
  useEffect(() => {
    if (!open) return;
    setMarkdown(null);
    void labApi.benchReport(open).then(setMarkdown).catch((cause) => setMarkdown(errorMessage(cause)));
  }, [open]);
  return (
    <section aria-labelledby="lab-bench-reports" className="space-y-2">
      <h3 id="lab-bench-reports" className="text-sm font-semibold text-foreground">Rapports du banc (takeoff:bench, lecture seule)</h3>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {reports && reports.length === 0 ? <p className="text-xs text-muted-foreground">Aucun rapport takeoff-bench-* à côté de la sortie du labo.</p> : null}
      <ul className="divide-y divide-border-subtle rounded-md border border-border text-xs">
        {reports?.map((report) => (
          <li key={report.name} className="flex items-center gap-3 px-3 py-1.5">
            <span className="font-mono text-foreground">{report.name}</span>
            <span className="text-muted-foreground">{report.commit ? report.commit.slice(0, 8) : "—"} · {report.couples.map((couple) =>
              `${couple.model} · ${couple.reasoning_effort ?? "auto"} (${couple.keys_ok.join(" / ")} clés sur ${couple.keys_scored ?? "—"})`).join(", ")}</span>
            <Button size="xs" variant="ghost" className="ml-auto" leftIcon={<FileText />} onClick={() => setOpen(report.name)}>Lire</Button>
          </li>
        ))}
      </ul>
      <Sheet open={open !== null} onOpenChange={(value) => { if (!value) setOpen(null); }}>
        <SheetContent side="right" className="data-[side=right]:w-[min(720px,90vw)] data-[side=right]:sm:max-w-none">
          <SheetHeader>
            <SheetTitle>{open}</SheetTitle>
            <SheetDescription>report.md du banc, en lecture seule.</SheetDescription>
          </SheetHeader>
          <pre className="min-h-0 flex-1 overflow-auto px-4 pb-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">{markdown ?? "Chargement…"}</pre>
        </SheetContent>
      </Sheet>
    </section>
  );
}

export function LabStatsScreen() {
  const fieldId = useId();
  const { state } = useTakeoffLab();
  const [campaign, setCampaign] = useState(state.latest_campaign ?? "");
  const [task, setTask] = useState("");
  const [axis, setAxis] = useState<Axis>("tokens");
  const [stats, setStats] = useState<LabStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only the latest request may update the screen: a response for a previous
  // selection (or an earlier refresh) that arrives last is dropped.
  const latestRequest = useRef(0);
  const load = useCallback(async () => {
    if (!state.configured) return;
    const request = ++latestRequest.current;
    try {
      const next = await labApi.stats({ campaign: campaign || null, task: task || null });
      if (request !== latestRequest.current) return;
      setStats(next);
      setError(null);
    } catch (cause) {
      if (request !== latestRequest.current) return;
      setError(errorMessage(cause));
    }
  }, [campaign, task, state.configured]);
  useEffect(() => { void load(); }, [load]);
  const groups = useMemo(() => stats?.groups ?? [], [stats]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-end gap-3 border-b border-border bg-surface px-4 py-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Stats</p>
          <h2 className="text-base font-semibold text-foreground">Validation humaine par configuration</h2>
        </div>
        <div className="w-56 space-y-0.5 text-xs">
          <label htmlFor={`${fieldId}-campaign`} className="block text-muted-foreground">Campagne</label>
          <NativeSelect id={`${fieldId}-campaign`} size="sm" value={campaign} onChange={(event) => setCampaign(event.target.value)}>
            <option value="">Toutes les campagnes</option>
            {state.campaigns.map((name) => <option key={name} value={name}>{name}</option>)}
          </NativeSelect>
        </div>
        <div className="w-56 space-y-0.5 text-xs">
          <label htmlFor={`${fieldId}-task`} className="block text-muted-foreground">Tâche</label>
          <NativeSelect id={`${fieldId}-task`} size="sm" value={task} onChange={(event) => setTask(event.target.value)}>
            <option value="">Toutes les tâches</option>
            {state.tasks.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </NativeSelect>
        </div>
        <p className="text-xs text-muted-foreground">{stats ? `${stats.runs} essai${stats.runs > 1 ? "s" : ""} · ${stats.verdicts} verdict${stats.verdicts > 1 ? "s" : ""}` : null}</p>
        <Button size="sm" variant="outline" className="ml-auto" leftIcon={<RefreshCw />} onClick={() => void load()}>Actualiser</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-surface">
        {error ? <Alert variant="danger" className="rounded-none border-x-0 border-t-0">{error}</Alert> : null}
        <div className="grid border-b border-border xl:grid-cols-2">
          <section aria-labelledby="lab-rate" className="space-y-3 border-b border-border p-4 xl:border-r xl:border-b-0">
            <div>
              <h3 id="lab-rate" className="text-sm font-semibold text-foreground">% jugé bon par configuration et version du prompt</h3>
              <p className="text-xs text-muted-foreground">bons / (bons + pas bons) ; n = éléments évalués. Les éléments passés ne comptent pas.</p>
            </div>
            {groups.length > 0 ? <RateBars groups={groups} /> : <p className="text-sm text-muted-foreground">Aucun essai dans cette sélection.</p>}
          </section>
          <section aria-labelledby="lab-pareto" className="space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 id="lab-pareto" className="text-sm font-semibold text-foreground">Validation humaine selon les {axis === "tokens" ? "jetons" : "latences"}</h3>
                <p className="text-xs text-muted-foreground">Un point par configuration ; en haut à gauche : moins coûteuse et mieux jugée.</p>
              </div>
              <fieldset className="flex items-center gap-3 rounded-md border border-border px-2 py-1 text-xs">
                <legend className="sr-only">Axe horizontal</legend>
                {(["tokens", "latency"] as const).map((value) => (
                  <label key={value} className="flex items-center gap-1.5">
                    <input type="radio" name="lab-axis" value={value} checked={axis === value} onChange={() => setAxis(value)} />
                    {value === "tokens" ? "Jetons" : "Latence"}
                  </label>
                ))}
              </fieldset>
            </div>
            <ParetoChart groups={groups} axis={axis} />
          </section>
        </div>
        <section aria-labelledby="lab-table" className="space-y-2 border-b border-border p-4">
          <h3 id="lab-table" className="text-sm font-semibold text-foreground">Tableau des configurations</h3>
          <div className="overflow-x-auto">
            <table aria-labelledby="lab-table" className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">Configuration</th><th className="py-1 pr-3 font-medium">Tâche</th>
                  <th className="py-1 pr-3 font-medium">Version du prompt</th><th className="py-1 pr-3 text-right font-medium">% jugé bon</th>
                  <th className="py-1 pr-3 text-right font-medium">n</th><th className="py-1 pr-3 text-right font-medium">Bons</th>
                  <th className="py-1 pr-3 text-right font-medium">Pas bons</th><th className="py-1 pr-3 text-right font-medium">Réponses</th>
                  <th className="py-1 pr-3 text-right font-medium">Jetons moyens</th><th className="py-1 text-right font-medium">Latence moyenne</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle tabular-nums">
                {groups.map((group) => (
                  <tr key={group.id}>
                    <td className="py-1 pr-3 font-mono">{group.label}</td><td className="py-1 pr-3">{group.task.label}</td>
                    <td className="py-1 pr-3 font-mono">{promptVersionLabel(group.prompt_version)}</td>
                    <td className="py-1 pr-3 text-right">{group.rate === null ? "—" : formatPercent(group.rate)}</td>
                    <td className="py-1 pr-3 text-right">{group.judged}</td><td className="py-1 pr-3 text-right">{group.good}</td>
                    <td className="py-1 pr-3 text-right">{group.bad}</td><td className="py-1 pr-3 text-right">{group.responses}</td>
                    <td className="py-1 pr-3 text-right">{group.mean_tokens === null ? "—" : formatInteger(group.mean_tokens)}</td>
                    <td className="py-1 text-right">{formatLatency(group.mean_latency_ms === null ? null : Math.round(group.mean_latency_ms))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="p-4"><BenchReports /></div>
      </div>
    </div>
  );
}
