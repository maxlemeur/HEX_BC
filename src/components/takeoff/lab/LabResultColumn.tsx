"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatInteger, formatLatency, formatPercent, formatRatio } from "@/components/takeoff/lab/lab-api";
import { configLabel, type LabAnswer, type LabConfigResult, type LabConfigStatus, type LabScore } from "@/lib/takeoff/lab/contracts";
import { cn } from "@/lib/utils";

const STATUS: Record<LabConfigStatus, { label: string; variant: "success" | "danger" | "warning" | "neutral" }> = {
  ok: { label: "Terminé", variant: "success" },
  schema_error: { label: "Erreur de schéma", variant: "danger" },
  partial: { label: "Partiel", variant: "warning" },
  failed: { label: "Échec", variant: "danger" },
  not_run: { label: "Non lancée", variant: "neutral" },
};

export function ConfigStatusBadge({ status }: { status: LabConfigStatus }) {
  return <Badge size="sm" variant={STATUS[status].variant}>{STATUS[status].label}</Badge>;
}

export function scoreText(score: LabScore | null) {
  if (!score) return null;
  if (score.kind === "lines") {
    return `Précision ${formatRatio(score.precision)} · Rappel ${formatRatio(score.recall)} · Quantités ${score.matched > 0 ? formatRatio(score.quantity_accuracy) : "—"}`;
  }
  return score.status === "scored" ? `Clés dans la tolérance ${score.keys_ok} / ${score.keys_scored}` : "Clés : vérité non notée";
}

/** One bar per option, the chosen one first and marked « Choix ». */
export function AnswerBars({ answer }: { answer: LabAnswer }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-foreground">{answer.label}</p>
      {answer.status !== "answered" ? (
        <p className="text-xs text-danger">Réponse {answer.status === "refused" ? "refusée" : answer.status === "missing" ? "manquante" : "invalide"}</p>
      ) : null}
      {answer.probabilities ? (
        <ul aria-label={`Probabilités · ${answer.label}`} className="space-y-1">
          {answer.probabilities.map((option) => {
            const chosen = option.value === answer.value;
            return (
              <li key={option.value}>
                <Tooltip>
                  <TooltipTrigger render={<div tabIndex={0} />}
                    className="grid grid-cols-[minmax(0,7rem)_1fr_3.5rem] items-center gap-2 rounded text-xs focus-visible:outline-2 focus-visible:outline-ring">
                    <span className={cn("truncate", chosen ? "font-semibold text-foreground" : "text-muted-foreground")}>{option.label}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <span className={cn("block h-full rounded-full", chosen ? "bg-primary" : "bg-border-strong")} style={{ width: `${option.probability * 100}%` }} />
                    </span>
                    <span className="text-right font-mono tabular-nums text-foreground">{formatPercent(option.probability)}</span>
                  </TooltipTrigger>
                  <TooltipContent side="left">{`${option.label} (${option.value}) : ${formatPercent(option.probability)}${chosen ? " · choix du modèle" : ""}`}</TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      ) : answer.value_label ? (
        <p className="text-xs"><span className="font-semibold">{answer.value_label}</span>
          {answer.confidence !== null ? <span className="text-muted-foreground"> · confiance {formatPercent(answer.confidence)}</span> : null}</p>
      ) : null}
    </div>
  );
}

function prettyRaw(raw: string | null) {
  if (raw === null) return "—";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function LabResultColumn({ config }: { config: LabConfigResult }) {
  const label = configLabel(config);
  const score = scoreText(config.score);
  return (
    <section aria-label={`Configuration ${config.id} · ${label}`} className="flex w-[300px] min-w-[260px] flex-1 flex-col border-r border-border bg-surface last:border-r-0">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Badge size="sm" variant="outline" className="font-mono">{config.id}</Badge>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={label}>{label}</span>
        <ConfigStatusBadge status={config.status} />
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-2">
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Jetons</dt>
            <dd>
              {config.usage ? (
                <Tooltip>
                  <TooltipTrigger render={<span tabIndex={0} />} className="font-mono tabular-nums underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring">
                    {formatInteger(config.usage.total)}
                  </TooltipTrigger>
                  <TooltipContent>{`Entrée ${formatInteger(config.usage.input)} · sortie ${formatInteger(config.usage.output)} · raisonnement ${formatInteger(config.usage.reasoning)}`}</TooltipContent>
                </Tooltip>
              ) : <span className="font-mono">—</span>}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Latence</dt>
            <dd className="font-mono tabular-nums">{formatLatency(config.latency_ms)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Éléments</dt>
            <dd className="font-mono tabular-nums">{config.elements.length}</dd>
          </div>
        </dl>
        <p className="text-xs">
          <span className="text-muted-foreground">Score : </span>
          <span className="font-mono tabular-nums text-foreground">{score ?? "sans vérité (ou recadrage)"}</span>
        </p>
        {config.message ? (
          <Alert variant={config.status === "partial" || config.status === "not_run" ? "warning" : "danger"} className="px-3 py-2 text-xs">
            <div>
              <p>{config.message}</p>
              {config.schema_error && config.schema_error.issues.length > 1 ? (
                <ul className="mt-1 list-disc pl-4">{config.schema_error.issues.slice(1, 6).map((issue) => <li key={issue}>{issue}</li>)}</ul>
              ) : null}
            </div>
          </Alert>
        ) : null}
        {config.answers?.map((answer) => <AnswerBars key={answer.name} answer={answer} />)}
        {config.elements.length > 0 && !config.answers ? (
          <ol aria-label={`Éléments ${config.id}`} className="divide-y divide-border-subtle rounded-md border border-border text-xs">
            {config.elements.map((element) => (
              <li key={element.id} className="flex items-baseline gap-2 px-2 py-1">
                <span className="min-w-0 flex-1 truncate" title={element.label}>{element.label}</span>
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{element.detail}{element.source_page ? ` · p.${element.source_page}` : ""}</span>
              </li>
            ))}
          </ol>
        ) : null}
        <div>
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground">JSON brut</h3>
          <pre className="max-h-96 overflow-auto rounded-md border border-border bg-surface-subtle p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground">
            {prettyRaw(config.raw)}
          </pre>
        </div>
      </div>
    </section>
  );
}
