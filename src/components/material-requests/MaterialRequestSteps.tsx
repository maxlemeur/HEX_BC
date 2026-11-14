"use client";

import { Tabs } from "@base-ui/react/tabs";
import { ArrowRight, Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { REQUEST_STEP_KEYS, REQUEST_STEP_LABELS, type RequestStepKey, type RequestSteps } from "./request-steps";

/** The id of a step's panel and of its tab, shared by the tab list and the panels. */
export function requestStepPanelId(base: string, step: RequestStepKey): string {
  return `${base}-etape-${step}`;
}

/**
 * The head of a request (TI-691): what to do now, in one sentence, and the three steps of the purchase as tabs, each
 * with where it stands. One step is shown at a time; the tab list is the only way between them, so the order of work
 * stays on screen whatever the step open. Must be rendered inside the `Tabs.Root` that holds the panels.
 */
export function MaterialRequestSteps({
  model,
  active,
  canWrite,
  idBase,
  onGoTo,
}: Readonly<{
  model: RequestSteps;
  /** The step whose panel is open. */
  active: RequestStepKey;
  canWrite: boolean;
  idBase: string;
  /** Opens a step and takes the focus to its heading. */
  onGoTo: (step: RequestStepKey) => void;
}>) {
  const { next, steps } = model;
  const nextIndex = REQUEST_STEP_KEYS.indexOf(next.step);
  // A reader is told where the request stands, never what to do: the actions are not theirs.
  const reading = !canWrite && !next.done;
  const standing = steps.find((entry) => entry.key === next.step);
  const elsewhere = next.step !== active;
  const headingId = `${idBase}-prochaine-etape`;

  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-mono text-micro font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <span aria-hidden="true" className={cn("size-2 rotate-45", next.done ? "bg-success" : "bg-brand-orange")} />
            {next.done ? "Demande traitée" : canWrite ? "Prochaine étape" : "Où en est la demande"}
          </p>
          <Badge variant={next.done ? "success" : "info"}>
            {`Étape ${nextIndex + 1} sur ${REQUEST_STEP_KEYS.length} · ${REQUEST_STEP_LABELS[next.step]}`}
          </Badge>
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h2 id={headingId} className="font-display text-xl font-semibold tracking-tight text-foreground text-balance">
              {reading && standing ? `${standing.label} · ${standing.status}` : next.title}
            </h2>
            {reading ? null : <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{next.detail}</p>}
          </div>
          {elsewhere ? (
            <Button type="button" variant={canWrite && !next.done ? "primary" : "outline"} onClick={() => onGoTo(next.step)}>
              {`Aller à l’étape ${REQUEST_STEP_LABELS[next.step]}`}
              <ArrowRight aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>

      <Tabs.List
        aria-label="Étapes de la demande"
        className="mt-4 grid grid-cols-3 gap-1.5 border-t border-border bg-surface-subtle px-2 py-2 sm:gap-2 sm:px-4"
      >
        {steps.map((step, index) => {
          const done = step.state === "done";
          return (
            <Tabs.Tab
              key={step.key}
              value={step.key}
              id={`${requestStepPanelId(idBase, step.key)}-onglet`}
              // The panels carry their own ids (the head focuses them): the tab names the one it shows.
              aria-controls={requestStepPanelId(idBase, step.key)}
              className={cn(
                // No `outline-none`: with it the focus ring below would resolve to no outline at all.
                "group/step min-w-0 rounded-lg px-2 pt-2 pb-2.5 text-left transition-colors duration-150 sm:px-3",
                "hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                "data-active:bg-surface data-active:shadow-sm",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "block h-1 rounded-full bg-border transition-colors duration-150 group-data-active/step:bg-brand-orange",
                  done && "bg-success group-data-active/step:bg-success",
                )}
              />
              <span className="mt-2 flex min-w-0 items-center gap-1.5">
                <span className="sr-only">{`Étape ${index + 1} : `}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-micro font-semibold",
                    done ? "bg-success-light text-success" : "bg-muted text-foreground-secondary group-data-active/step:bg-primary group-data-active/step:text-primary-foreground",
                  )}
                >
                  {done ? <Check className="size-3" strokeWidth={3} /> : index + 1}
                </span>
                <span className="min-w-0 break-words text-sm font-semibold leading-tight text-foreground-secondary group-data-active/step:text-foreground">
                  {step.label}
                </span>
              </span>
              <span className="sr-only">{done ? ", terminée. " : ". "}</span>
              <span className={cn("mt-1 block text-xs leading-snug text-muted-foreground", step.state === "active" && "text-foreground-secondary")}>
                {step.status}
              </span>
            </Tabs.Tab>
          );
        })}
      </Tabs.List>
    </section>
  );
}
