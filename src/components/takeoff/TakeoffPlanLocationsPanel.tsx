"use client";

import { useId, useState } from "react";
import useSWR from "swr";

import { TakeoffPlanLocationDialog, TakeoffPlanLocationSummary } from "@/components/takeoff/TakeoffPlanLocationDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchTakeoffJobPlanLocations } from "@/lib/takeoff/plan-location-client";
import type { TakeoffJobPlanLocation } from "@/lib/takeoff/plan-location-contracts";

const STATUS_NOTES: Record<TakeoffJobPlanLocation["status"], string | null> = {
  current: null,
  changed: "Le plan a changé depuis cette analyse : une correction s’appliquera à sa version actuelle, pas à celle lue ici.",
  unavailable: "Le plan lu par cette analyse n’est plus disponible : sa localisation ne peut plus être corrigée d’ici.",
};

/**
 * The building and the level of each plan this analysis read, at the revision it read, with a link to the same form
 * as the plan centre. Read on demand: it reads every plan's bytes. Descriptive: the review's lines and the sending
 * do not use it yet.
 */
export function TakeoffPlanLocationsPanel({ jobId }: { jobId: string }) {
  const regionId = useId();
  const [open, setOpen] = useState(false);
  const { data, error, isLoading, mutate } = useSWR(open ? `takeoff-job-plan-locations:${jobId}` : null,
    () => fetchTakeoffJobPlanLocations(jobId), { revalidateOnFocus: false, shouldRetryOnError: false });
  const [editing, setEditing] = useState<TakeoffJobPlanLocation | null>(null);

  return (
    <Card className="mt-4 space-y-3 p-4 sm:p-6" data-testid="takeoff-plan-locations">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="typo-h3 text-foreground">Bâtiment et niveau des plans</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pour chaque plan de cette analyse, la localisation lue sur le plan ou corrigée par un opérateur. Les pages gardent leur
            propre localisation dans la revue.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" aria-expanded={open} aria-controls={regionId}
          aria-label={`${open ? "Masquer" : "Afficher"} le bâtiment et le niveau des plans`}
          onClick={() => setOpen((current) => !current)}>
          {open ? "Masquer" : "Afficher"}
        </Button>
      </div>
      {open ? <div id={regionId} className="space-y-3">
      {isLoading && !data ? <p className="text-sm text-muted-foreground" role="status">Lecture des cartouches…</p> : null}
      {error && !data ? (
        <Alert variant="warning"><AlertDescription>{error instanceof Error ? error.message : "Impossible de lire la localisation des plans."}</AlertDescription></Alert>
      ) : null}
      {data && !data.plans.length ? (
        <p className="text-sm text-muted-foreground">
          {data.without_preparation ? "Cette analyse ancienne n’atteste aucune version de plan." : "Cette analyse n’a lu aucun plan du dossier."}
        </p>
      ) : null}
      {data?.plans.length ? (
        <ul className="divide-y divide-border">
          {data.plans.map((plan) => {
            const note = STATUS_NOTES[plan.status];
            const editable = data.can_edit && plan.status !== "unavailable" && plan.plan_set_id;
            return (
              <li key={plan.plan_file_id} className="space-y-2 py-3 first:pt-0 last:pb-0" data-testid="takeoff-plan-location">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 truncate font-medium text-foreground">
                    {plan.document_name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {plan.pages.length ? `pages ${plan.pages.join(", ")}` : "toutes les pages"}
                    </span>
                  </p>
                  {editable ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(plan)}
                      aria-label={`Corriger le bâtiment et le niveau de ${plan.document_name}`}>
                      Corriger
                    </Button>
                  ) : null}
                </div>
                <TakeoffPlanLocationSummary location={plan.location} annotation={plan.annotation} carryOver={plan.carry_over} />
                {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      </div> : null}
      {editing?.plan_set_id ? (
        <TakeoffPlanLocationDialog setId={editing.plan_set_id} fileId={editing.plan_file_id} documentName={editing.document_name}
          open onOpenChange={(open) => { if (!open) setEditing(null); }} onSaved={() => { void mutate(); }} />
      ) : null}
    </Card>
  );
}
