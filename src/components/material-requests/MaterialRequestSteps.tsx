"use client";

import { Tabs } from "@base-ui/react/tabs";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import type { RequestStep, RequestStepKey } from "./request-steps";

export function requestStepPanelId(base: string, step: RequestStepKey): string {
  return `${base}-etape-${step}`;
}

/** Keep the current step distinct from its completion state, without a second large page header: one size on every step. */
export function MaterialRequestSteps({ steps, active, idBase }: Readonly<{
  steps: readonly RequestStep[];
  active: RequestStepKey;
  idBase: string;
}>) {
  return (
    <section aria-label="Avancement de la demande" className="mb-4 border-b border-border">
      <Tabs.List aria-label="Étapes de la demande" className="grid w-full grid-cols-3 gap-1.5 sm:gap-3 lg:max-w-[46.5rem]">
        {steps.map((step, index) => (
          <Tabs.Tab
            key={step.key}
            value={step.key}
            id={`${requestStepPanelId(idBase, step.key)}-onglet`}
            aria-controls={requestStepPanelId(idBase, step.key)}
            className="group/step flex min-w-0 items-start gap-1.5 border-b-2 border-transparent px-1 py-2 text-left transition-colors hover:bg-surface/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-active:border-brand-orange sm:gap-2 sm:px-2"
          >
            <span aria-hidden="true" className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
              step.state === "done" && active !== step.key ? "bg-success text-white" : active === step.key ? "bg-brand-orange text-white" : "bg-muted text-muted-foreground",
            )}>
              {step.state === "done" ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span className="min-w-0">
              <span className="sr-only">{`Étape ${index + 1} : `}</span>
              <span className="block text-sm leading-5 font-semibold text-foreground group-data-active/step:text-brand-orange">{step.label}</span>
              <span className="sr-only">{step.state === "done" ? ", terminée. " : ". "}</span>
              <span className={cn("block text-xs leading-snug text-muted-foreground", (step.key !== "lignes" || active !== "lignes") && "sr-only sm:not-sr-only")}>
                {step.status}
              </span>
            </span>
          </Tabs.Tab>
        ))}
      </Tabs.List>
    </section>
  );
}
