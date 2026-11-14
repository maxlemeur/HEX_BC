"use client";

import { Tabs } from "@base-ui/react/tabs";
import { ArrowRight, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { REQUEST_STEP_KEYS, type RequestStepKey, type RequestSteps } from "./request-steps";

export function requestStepPanelId(base: string, step: RequestStepKey): string {
  return `${base}-etape-${step}`;
}

/** Keep the current step distinct from its completion state, without a second large page header. */
export function MaterialRequestSteps({ model, active, canWrite, idBase, onGoTo }: Readonly<{
  model: RequestSteps;
  active: RequestStepKey;
  canWrite: boolean;
  idBase: string;
  onGoTo: (step: RequestStepKey) => void;
}>) {
  const { next, steps } = model;
  const compact = active === "lignes";
  const reading = !canWrite && !next.done;
  const standing = steps.find((step) => step.key === next.step);
  return (
    <section aria-label="Avancement de la demande" className="mb-5">
      <Tabs.List aria-label="Étapes de la demande" className={cn("gap-2 border-b border-border sm:gap-6", compact ? "flex flex-wrap" : "grid grid-cols-3")}>
        {steps.map((step, index) => (
          <Tabs.Tab
            key={step.key}
            value={step.key}
            id={`${requestStepPanelId(idBase, step.key)}-onglet`}
            aria-controls={requestStepPanelId(idBase, step.key)}
            className={cn("group/step flex min-w-0 items-start gap-2 border-b-[3px] border-transparent px-1 py-4 text-left transition-colors hover:bg-surface/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-active:border-brand-orange sm:gap-3 sm:px-3", compact && "sm:min-w-40")}
          >
            <span aria-hidden="true" className={cn(
              "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold sm:size-7",
              step.state === "done" && (compact || active !== step.key) ? "bg-success text-white" : active === step.key ? "bg-brand-orange text-white" : "bg-muted text-muted-foreground",
            )}>
              {step.state === "done" && (compact || active !== step.key) ? <Check className="size-4" /> : index + 1}
            </span>
            <span className="min-w-0">
              <span className="sr-only">{`Étape ${index + 1} : `}</span>
              <span className={cn("block text-sm font-semibold text-foreground sm:text-base", !compact && "group-data-active/step:text-brand-orange")}>{step.label}</span>
              <span className="sr-only">{step.state === "done" ? ", terminée. " : ". "}</span>
              <span className={compact ? "sr-only" : "mt-1 block text-xs leading-snug text-muted-foreground sm:text-sm"}>{step.status}</span>
            </span>
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {!next.done ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-muted-foreground"><span className="font-medium text-foreground">{reading && standing ? `${standing.label} · ${standing.status}` : next.title}</span>{reading ? null : ` · ${next.detail}`}</p>
          {next.step !== active ? <Button type="button" size="sm" variant="outline" onClick={() => onGoTo(next.step)}>
            {`Aller à l’étape ${steps[REQUEST_STEP_KEYS.indexOf(next.step)].label}`}<ArrowRight aria-hidden="true" />
          </Button> : null}
        </div>
      ) : null}
    </section>
  );
}
