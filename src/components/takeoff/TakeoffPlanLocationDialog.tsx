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
import {
  PLAN_LOCATION_FIELDS,
  normalizePlanLocationValue,
  planLocationCarriedFields,
  resolvePlanLocation,
  type PlanLocationAnnotationValues,
  type PlanLocationChoice,
  type PlanLocationField,
  type PlanLocationView,
} from "@/lib/takeoff/plan-location";
import { fetchTakeoffPlanFileLocation, planLocationConflict, saveTakeoffPlanFileLocation } from "@/lib/takeoff/plan-location-client";
import type { PlanLocationReplacement, TakeoffPlanFileLocation } from "@/lib/takeoff/plan-location-contracts";

type Annotation = TakeoffPlanFileLocation["annotation"];
type CarryOver = TakeoffPlanFileLocation["carry_over"];
type Conflict = NonNullable<ReturnType<typeof planLocationConflict>>;

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
  // A scan prints no text: its name is not a reading of the plan, only shown beside it.
  if (!reading.title_block_read) return `Cartouche non lu : aucun texte lisible sur ${scope} (un plan scanné, par exemple). Le nom du fichier n’en tient pas lieu.`;
  const blank = reading.unreadable_pages.length
    ? ` Sans texte lisible dans le cartouche : page${reading.unreadable_pages.length > 1 ? "s" : ""} ${reading.unreadable_pages.join(", ")}.` : "";
  return `Cartouche lu sur ${scope}.${blank}`;
}

type FieldDraft = { choice: PlanLocationChoice; text: string };

/**
 * The choice the form starts from: the revision's own, else the single value proposed (the reading or an earlier
 * revision's correction) to confirm, else the reading.
 */
function initialDraft(field: PlanLocationField, data: TakeoffPlanFileLocation): FieldDraft {
  const chosen = data.annotation?.[field];
  if (chosen) return { choice: chosen.choice, text: chosen.value ?? "" };
  const view = data.location[field];
  return view.state === "proposed" && view.value !== null ? { choice: "value", text: view.value } : { choice: "reading", text: "" };
}

const CHOICE_WORDS: Record<PlanLocationChoice, string> = { reading: "lecture du plan", value: "", unknown: "à préciser" };
const describeDraft = (draft: FieldDraft) => draft.choice === "value" ? draft.text.trim() || "vide" : CHOICE_WORDS[draft.choice];

/** What « Lecture du plan » gives for the field on these bytes, whatever is chosen now. */
function readingLabel(field: PlanLocationField, data: TakeoffPlanFileLocation) {
  const read = resolvePlanLocation({ reading: data.reading, annotation: null, carryOver: null })[field];
  if (read.value !== null) return `Lecture du plan (${read.value})`;
  return read.state === "multiple" ? "Lecture du plan (plusieurs valeurs)" : "Lecture du plan (rien de lu)";
}

function LocationForm({ data, onSaved, onConflict }: {
  data: TakeoffPlanFileLocation;
  onSaved: (next: TakeoffPlanFileLocation) => void;
  onConflict: (conflict: Conflict, rejected: string) => Promise<void>;
}) {
  const formId = useId();
  const [drafts, setDrafts] = useState<Record<PlanLocationField, FieldDraft>>(() => ({
    building: initialDraft("building", data), level: initialDraft("level", data),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const carrying = !data.annotation && data.carry_over ? data.carry_over : null;
  const setDraft = (field: PlanLocationField, next: Partial<FieldDraft>) =>
    setDrafts((current) => ({ ...current, [field]: { ...current[field], ...next } }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    let choices: PlanLocationAnnotationValues;
    try {
      const choiceOf = (field: PlanLocationField) => {
        const draft = drafts[field];
        if (draft.choice !== "value") return { choice: draft.choice, value: null };
        const value = normalizePlanLocationValue(draft.text);
        if (value === null) throw new Error(`${PLAN_LOCATION_FIELD_LABELS[field]} : saisissez une valeur, ou choisissez « Lecture du plan » ou « À préciser ».`);
        return { choice: "value" as const, value };
      };
      choices = { building: choiceOf("building"), level: choiceOf("level") };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Localisation invalide.");
      return;
    }
    // Only the fields set to the earlier correction's values carry it, at the generation shown.
    const carried = planLocationCarriedFields(carrying ? { building: carrying.building, level: carrying.level } : null, choices);
    setSaving(true);
    try {
      onSaved(await saveTakeoffPlanFileLocation(data.plan_set_id, data.plan_file_id, {
        content_hash: data.revision.content_hash, expected_revision: data.annotation?.revision ?? 0,
        building: choices.building, level: choices.level,
        carried_from: carrying && carried.length ? { id: carrying.id, revision: carrying.revision, fields: carried } : null,
      }));
    } catch (cause) {
      const conflict = planLocationConflict(cause);
      const rejected = `Votre saisie (bâtiment ${describeDraft(drafts.building)}, niveau ${describeDraft(drafts.level)}) n’a pas été enregistrée.`;
      if (conflict) await onConflict(conflict, rejected);
      else setError(cause instanceof Error ? cause.message : "Impossible d’enregistrer la localisation de ce plan.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form id={formId} onSubmit={submit} className="space-y-4" aria-label="Corriger la localisation">
      {PLAN_LOCATION_FIELDS.map((field) => {
        const label = PLAN_LOCATION_FIELD_LABELS[field];
        const listId = `${formId}-${field}-options`;
        const options = [...new Set([...data.location[field].candidates.map((candidate) => candidate.value), ...data.suggestions[field]])];
        const draft = drafts[field];
        const name = `${formId}-${field}-choice`;
        return (
          <fieldset key={field} className="space-y-2" data-testid={`plan-location-choice-${field}`} data-choice={draft.choice}>
            <legend className="text-sm font-medium text-foreground">{label}</legend>
            <div role="radiogroup" aria-label={`Choix pour le ${label.toLowerCase()}`} className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name={name} value="reading" checked={draft.choice === "reading"} disabled={saving}
                  onChange={() => setDraft(field, { choice: "reading" })} />
                {readingLabel(field, data)}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name={name} value="value" checked={draft.choice === "value"} disabled={saving}
                  onChange={() => setDraft(field, { choice: "value" })} />
                Valeur saisie
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name={name} value="unknown" checked={draft.choice === "unknown"} disabled={saving}
                  onChange={() => setDraft(field, { choice: "unknown" })} />
                À préciser
              </label>
            </div>
            <Field>
              <FieldLabel htmlFor={`${formId}-${field}`} className="sr-only">{label}</FieldLabel>
              {/* Typing a value chooses it. */}
              <Input id={`${formId}-${field}`} name={field} value={draft.text} maxLength={40} list={options.length ? listId : undefined}
                autoComplete="off" placeholder={`${label} de ce plan`} disabled={saving}
                onChange={(event) => setDraft(field, { text: event.target.value, choice: "value" })} />
              {options.length ? <datalist id={listId}>{options.map((option) => <option key={option} value={option} />)}</datalist> : null}
            </Field>
          </fieldset>
        );
      })}
      <FieldDescription>
        Enregistrer fixe, pour cette version du plan, le choix de chaque champ : la lecture du plan (toujours à vérifier), la valeur
        saisie, ou « À préciser » (ni la lecture ni une valeur ne s’appliquent). Il s’affiche dans les plans, la revue et toute relance
        sur le même fichier.
      </FieldDescription>
      {error ? <Alert variant="danger"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <DialogFooter>
        <Button type="submit" loading={saving} disabled={saving}>{carrying ? "Valider pour cette version" : "Enregistrer"}</Button>
      </DialogFooter>
    </form>
  );
}

/** Reads a plan's location; a copy the dossier replaced since is followed to its current copy, and the member told. */
async function readLocation(setId: string, fileId: string) {
  try {
    return { location: await fetchTakeoffPlanFileLocation(setId, fileId), replaced: null };
  } catch (cause) {
    const conflict = planLocationConflict(cause);
    if (!conflict?.replacement) throw cause;
    return {
      location: await fetchTakeoffPlanFileLocation(conflict.replacement.plan_set_id, conflict.replacement.plan_file_id),
      replaced: conflict.message,
    };
  }
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
  // The copy shown: the one opened, or the current copy of its dossier piece once a save named it.
  const [target, setTarget] = useState<PlanLocationReplacement | null>(null);
  const shown = target ?? { plan_set_id: setId, plan_file_id: fileId };
  const { data: read, error, isLoading, mutate } = useSWR(open ? `takeoff-plan-location:${shown.plan_set_id}:${shown.plan_file_id}` : null,
    () => readLocation(shown.plan_set_id, shown.plan_file_id), { revalidateOnFocus: false, shouldRetryOnError: false });
  const [notice, setNotice] = useState<{ tone: "info" | "warning"; message: string } | null>(null);
  const data = read?.location;

  const changeOpen = (next: boolean) => {
    if (!next) {
      setNotice(null);
      setTarget(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent size="md" data-testid="plan-location-dialog">
        <DialogHeader>
          <DialogTitle>Localisation du plan</DialogTitle>
          <DialogDescription>{data?.document_name ?? documentName}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {isLoading && !data ? <p className="text-sm text-muted-foreground" role="status">Lecture du cartouche du plan…</p> : null}
          {error && !data ? <Alert variant="danger"><AlertDescription>{error instanceof Error ? error.message : "Impossible de lire la localisation de ce plan."}</AlertDescription></Alert> : null}
          {data ? (
            <>
              {read?.replaced && !notice ? (
                <Alert variant="warning" data-testid="plan-location-replaced"><AlertDescription>{read.replaced}</AlertDescription></Alert>
              ) : null}
              <TakeoffPlanLocationSummary location={data.location} annotation={data.annotation} carryOver={data.carry_over} testId="plan-location-summary" />
              <p className="text-xs text-muted-foreground">{readingNote(data)}</p>
              {notice ? <Alert variant={notice.tone} data-testid="plan-location-notice"><AlertDescription>{notice.message}</AlertDescription></Alert> : null}
              {!data.annotation && data.carry_over ? (
                <Alert variant="warning">
                  <AlertDescription>
                    Une version précédente de ce plan{data.carry_over.same_source ? "" : ` (« ${data.carry_over.document_name} »)`} a été corrigée :
                    bâtiment {data.carry_over.building ?? "non corrigé"}, niveau {data.carry_over.level ?? "non corrigé"}. Le contenu du plan a changé :
                    vérifiez ces valeurs avant de les valider pour cette version.
                  </AlertDescription>
                </Alert>
              ) : null}
              {data.can_edit ? (
                <LocationForm key={`${data.plan_file_id}:${data.revision.content_hash}:${data.annotation?.revision ?? 0}`} data={data}
                  onSaved={(next) => {
                    void mutate({ location: next, replaced: null }, { revalidate: false });
                    setNotice({ tone: "info", message: "Localisation enregistrée pour cette version du plan." });
                    onSaved?.();
                  }}
                  onConflict={async (conflict, rejected) => {
                    if (conflict.replacement) setTarget(conflict.replacement);
                    else await mutate();
                    setNotice({ tone: "warning", message: `${conflict.message} ${rejected}` });
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
