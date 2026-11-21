"use client";

import { useId, useState, type FormEvent } from "react";
import useSWR from "swr";

import {
  PLAN_LOCATION_FIELD_LABELS,
  planLocationNeedsCheck,
  planLocationOtherReadings,
  planLocationProvenanceLabel,
  planLocationValueLabel,
} from "@/components/takeoff/plan-location-labels";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PLAN_LOCATION_FIELDS, normalizePlanLocationValue, type PlanLocationField, type PlanLocationView } from "@/lib/takeoff/plan-location";
import { fetchTakeoffPlanFileLocation, planLocationConflictReason, saveTakeoffPlanFileLocation } from "@/lib/takeoff/plan-location-client";
import type { TakeoffPlanFileLocation } from "@/lib/takeoff/plan-location-contracts";

type Annotation = TakeoffPlanFileLocation["annotation"];
type CarryOver = TakeoffPlanFileLocation["carry_over"];

/** The two fields of a revision, with where each value comes from. Shared by the plan centre and the review. */
export function TakeoffPlanLocationSummary({ location, annotation, carryOver, testId }: {
  location: PlanLocationView; annotation: Annotation; carryOver: CarryOver; testId?: string;
}) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2" data-testid={testId}>
      {PLAN_LOCATION_FIELDS.map((field) => {
        const view = location[field];
        const others = planLocationOtherReadings(view);
        return (
          <div key={field} className="min-w-0" data-testid={testId ? `${testId}-${field}` : undefined} data-state={view.state}>
            <dt className="text-xs font-medium text-muted-foreground">{PLAN_LOCATION_FIELD_LABELS[field]}</dt>
            <dd className="mt-0.5 flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{planLocationValueLabel(field, view)}</span>
              {planLocationNeedsCheck(view) ? <Badge variant="warning" size="sm">À vérifier</Badge> : null}
            </dd>
            <dd className="mt-0.5 text-xs text-muted-foreground">{planLocationProvenanceLabel(field, view, annotation, carryOver)}</dd>
            {others.length ? <dd className="mt-0.5 text-xs text-muted-foreground">Autre lecture : {others.join(", ")}</dd> : null}
          </div>
        );
      })}
    </dl>
  );
}

function readingNote(data: TakeoffPlanFileLocation) {
  const reading = data.reading;
  if (data.reading_issue === "unreadable" || !reading) return "Le PDF n’a pas pu être lu : seul son nom l’a été, sans rien proposer à sa place.";
  const read = reading.pages_read.length;
  const total = reading.pages_total;
  const scope = total && total > read ? `les ${read} premières pages sur ${total}` : `${read} page${read > 1 ? "s" : ""}`;
  const blank = reading.unreadable_pages.length
    ? ` Sans texte lisible dans le cartouche : page${reading.unreadable_pages.length > 1 ? "s" : ""} ${reading.unreadable_pages.join(", ")}.` : "";
  return `Cartouche lu sur ${scope}.${blank}`;
}

/** The value shown for the field when it reads a single value; empty for « À préciser » and « Plusieurs ». */
function initialValue(field: PlanLocationField, data: TakeoffPlanFileLocation) {
  const view = data.location[field];
  return view.state === "multiple" || view.state === "unknown" ? "" : view.value ?? "";
}

function LocationForm({ data, onSaved, onConflict }: {
  data: TakeoffPlanFileLocation;
  onSaved: (next: TakeoffPlanFileLocation) => void;
  onConflict: (message: string) => Promise<void>;
}) {
  const formId = useId();
  const [values, setValues] = useState<Record<PlanLocationField, string>>(() => ({
    building: initialValue("building", data), level: initialValue("level", data),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const carrying = !data.annotation && data.carry_over ? data.carry_over : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    let building: string | null;
    let level: string | null;
    try {
      building = normalizePlanLocationValue(values.building);
      level = normalizePlanLocationValue(values.level);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Localisation invalide.");
      return;
    }
    setSaving(true);
    try {
      onSaved(await saveTakeoffPlanFileLocation(data.plan_set_id, data.plan_file_id, {
        content_hash: data.revision.content_hash, expected_revision: data.annotation?.revision ?? 0,
        building, level, carried_from_id: carrying?.id ?? null,
      }));
    } catch (cause) {
      const rejected = `Votre saisie (bâtiment ${building ?? "sans correction"}, niveau ${level ?? "sans correction"}) n’a pas été enregistrée.`;
      if (planLocationConflictReason(cause)) await onConflict(`${cause instanceof Error ? cause.message : ""} ${rejected}`.trim());
      else setError(cause instanceof Error ? cause.message : "Impossible d’enregistrer la localisation de ce plan.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form id={formId} onSubmit={submit} className="space-y-3" aria-label="Corriger la localisation">
      {PLAN_LOCATION_FIELDS.map((field) => {
        const listId = `${formId}-${field}-options`;
        const options = [...new Set([...data.location[field].candidates.map((candidate) => candidate.value), ...data.suggestions[field]])];
        return (
          <Field key={field}>
            <FieldLabel htmlFor={`${formId}-${field}`}>{PLAN_LOCATION_FIELD_LABELS[field]}</FieldLabel>
            <Input id={`${formId}-${field}`} name={field} value={values[field]} maxLength={40} list={options.length ? listId : undefined}
              autoComplete="off" placeholder="À préciser" disabled={saving}
              onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))} />
            {options.length ? <datalist id={listId}>{options.map((option) => <option key={option} value={option} />)}</datalist> : null}
          </Field>
        );
      })}
      <FieldDescription>
        Enregistrer confirme les valeurs saisies pour cette version du plan : elles s’affichent dans les plans, la revue et toute relance sur
        le même fichier. Un champ vide n’est pas corrigé : la lecture du plan s’y applique, toujours à vérifier.
      </FieldDescription>
      {error ? <Alert variant="danger"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <DialogFooter>
        <Button type="submit" loading={saving} disabled={saving}>{carrying ? "Valider pour cette version" : "Enregistrer"}</Button>
      </DialogFooter>
    </form>
  );
}

type DialogProps = {
  setId: string;
  fileId: string;
  documentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
};

/** The one place where the building and the level of a plan revision are read and corrected. */
export function TakeoffPlanLocationDialog({ setId, fileId, documentName, open, onOpenChange, onSaved }: DialogProps) {
  const { data, error, isLoading, mutate } = useSWR(open ? `takeoff-plan-location:${setId}:${fileId}` : null,
    () => fetchTakeoffPlanFileLocation(setId, fileId), { revalidateOnFocus: false, shouldRetryOnError: false });
  const [notice, setNotice] = useState<{ tone: "info" | "warning"; message: string } | null>(null);

  const changeOpen = (next: boolean) => {
    if (!next) setNotice(null);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent size="md" data-testid="plan-location-dialog">
        <DialogHeader>
          <DialogTitle>Localisation du plan</DialogTitle>
          <DialogDescription>{documentName}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {isLoading && !data ? <p className="text-sm text-muted-foreground" role="status">Lecture du cartouche du plan…</p> : null}
          {error && !data ? <Alert variant="danger"><AlertDescription>{error instanceof Error ? error.message : "Impossible de lire la localisation de ce plan."}</AlertDescription></Alert> : null}
          {data ? (
            <>
              <TakeoffPlanLocationSummary location={data.location} annotation={data.annotation} carryOver={data.carry_over} testId="plan-location-summary" />
              <p className="text-xs text-muted-foreground">{readingNote(data)}</p>
              {notice ? <Alert variant={notice.tone} data-testid="plan-location-notice"><AlertDescription>{notice.message}</AlertDescription></Alert> : null}
              {!data.annotation && data.carry_over ? (
                <Alert variant="warning">
                  <AlertDescription>
                    Une version précédente de ce plan{data.carry_over.same_source ? "" : ` (« ${data.carry_over.document_name} »)`} a été corrigée :
                    bâtiment {data.carry_over.building ?? "à préciser"}, niveau {data.carry_over.level ?? "à préciser"}. Le contenu du plan a changé :
                    vérifiez ces valeurs avant de les valider pour cette version.
                  </AlertDescription>
                </Alert>
              ) : null}
              {data.can_edit ? (
                <LocationForm key={`${data.revision.content_hash}:${data.annotation?.revision ?? 0}`} data={data}
                  onSaved={(next) => {
                    void mutate(next, { revalidate: false });
                    setNotice({ tone: "info", message: "Localisation enregistrée pour cette version du plan." });
                    onSaved?.();
                  }}
                  onConflict={async (message) => {
                    await mutate();
                    setNotice({ tone: "warning", message });
                    onSaved?.();
                  }} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {data.current_copy
                    ? "Lecture seule : seuls les opérateurs de l’affaire corrigent la localisation d’un plan."
                    : "Ce plan vient d’être remplacé dans le dossier : rechargez la page des plans pour corriger sa nouvelle version."}
                </p>
              )}
            </>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
