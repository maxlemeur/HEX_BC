"use client";

import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { controlSurface } from "@/components/ui/input";
import { effectiveLineMaterial } from "@/lib/material-requests/alerts";
import {
  MATERIAL_REQUEST_DELIVERY_PLACE_LABELS,
  MATERIAL_REQUEST_DELIVERY_PLACES,
  type MaterialRequestDeliveryPlace,
  type MaterialRequestTechnician,
} from "@/lib/material-requests/contracts";
import { cn } from "@/lib/utils";

import { ChoiceCell, TextCell, usePendingWrites } from "./cells";
import type { MaterialRequestEditorApi, SaveResult } from "./useMaterialRequestEditor";

const LABEL = "mb-1 block text-xs font-medium text-muted-foreground";
const DELIVERY_OPTIONS = MATERIAL_REQUEST_DELIVERY_PLACES.map((value) => ({
  value,
  label: MATERIAL_REQUEST_DELIVERY_PLACE_LABELS[value],
}));

function FieldError({ id, message }: Readonly<{ id?: string; message: string | null }>) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs font-medium text-danger">
      Non enregistré : {message}
    </p>
  );
}

/** A date saved when the field is left, so that a half-typed date never leaves. */
function DateField({
  id,
  value,
  required = false,
  disabled,
  onCommit,
}: Readonly<{
  id: string;
  value: string | null;
  required?: boolean;
  disabled: boolean;
  onCommit: (next: string | null) => Promise<SaveResult>;
}>) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const writes = usePendingWrites(value ?? "");

  const commit = async () => {
    if (draft === null) return;
    const next = draft;
    if (next === "" && required) {
      setDraft(null);
      setError(null);
      return;
    }
    if (next === writes.expected()) {
      if (writes.idle()) {
        setDraft(null);
        setError(null);
      }
      return;
    }
    const result = await writes.send(next, () => onCommit(next === "" ? null : next));
    if (result === null) return;
    if (result.ok) {
      setDraft((current) => (current === next ? null : current));
      setError(null);
    } else {
      setError(result.message);
    }
  };

  return (
    <>
      <input
        id={id}
        type="date"
        className={cn(controlSurface, "h-9 w-full px-2 text-sm")}
        value={draft ?? value ?? ""}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") void commit();
          if (event.key === "Escape") {
            setDraft(null);
            setError(null);
          }
        }}
      />
      <FieldError id={`${id}-error`} message={error} />
    </>
  );
}

function NoteField({
  id,
  value,
  disabled,
  onCommit,
}: Readonly<{
  id: string;
  value: string | null;
  disabled: boolean;
  onCommit: (next: string | null) => Promise<SaveResult>;
}>) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const writes = usePendingWrites((value ?? "").trim());

  return (
    <>
      <textarea
        id={id}
        rows={2}
        maxLength={2000}
        className={cn(controlSurface, "w-full px-2 py-1.5 text-sm")}
        value={draft ?? value ?? ""}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={async () => {
          if (draft === null) return;
          const next = draft.trim();
          if (next === writes.expected()) {
            if (writes.idle()) {
              setDraft(null);
              setError(null);
            }
            return;
          }
          const result = await writes.send(next, () => onCommit(next.length > 0 ? next : null));
          if (result === null) return;
          if (result.ok) {
            setDraft((current) => (current !== null && current.trim() === next ? null : current));
            setError(null);
          } else {
            setError(result.message);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setDraft(null);
            setError(null);
          }
        }}
      />
      <FieldError id={`${id}-error`} message={error} />
    </>
  );
}

/**
 * What was read at the top of the sheet is a proposal: it is shown as such until the operator confirms
 * it, and the confirmation is its own action, never a side effect of typing.
 */
function Proposal({
  pendingLabel,
  confirmedLabel,
  pendingHelp,
  confirmedHelp,
  confirmAction,
  undoLabel,
  hasValue,
  confirmed,
  canWrite,
  onChange,
  consequence,
  consequenceId,
  unsaved,
  unsavedHelp,
}: Readonly<{
  /**
   * The field shows a value that is not saved yet (typed, on its way or refused). Confirming then would
   * bear on something else than what the operator sees: the confirmation waits for the save.
   */
  unsaved: boolean;
  unsavedHelp: string;
  /** What withdrawing or changing the confirmed value will do, said before the operator does it. */
  consequence?: string | null;
  consequenceId?: string;
  pendingLabel: string;
  confirmedLabel: string;
  pendingHelp: string;
  confirmedHelp: string;
  confirmAction: string;
  undoLabel: string;
  hasValue: boolean;
  confirmed: boolean;
  canWrite: boolean;
  onChange: (confirmed: boolean) => Promise<SaveResult>;
}>) {
  const noteId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server's sentence, as is: it says the value changed elsewhere and what to do.
  const refusal = error ? (
    <p role="alert" className="mt-1 text-xs font-medium text-danger">
      {error}
    </p>
  ) : null;
  if (!hasValue) return refusal;

  const change = async (next: boolean) => {
    if (next && unsaved) return;
    setBusy(true);
    const result = await onChange(next);
    setBusy(false);
    setError(result.ok ? null : result.message);
  };

  return (
    <div
      className={cn(
        "mt-2 rounded-control border px-2.5 py-2",
        confirmed ? "border-success-border bg-success-subtle" : "border-warning-border bg-warning-light",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={confirmed ? "success" : "warning"} dot>
          {confirmed ? confirmedLabel : pendingLabel}
        </Badge>
        {canWrite && !confirmed ? (
          <Button
            type="button"
            size="sm"
            loading={busy}
            // Not `disabled`: pressing it must still take the focus out of the field, which saves it.
            aria-disabled={unsaved || undefined}
            aria-describedby={unsaved ? noteId : undefined}
            onClick={() => void change(true)}
          >
            {confirmAction}
          </Button>
        ) : null}
        {canWrite && confirmed ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            loading={busy}
            aria-label={undoLabel}
            aria-describedby={consequence ? consequenceId : undefined}
            onClick={() => void change(false)}
          >
            Annuler la confirmation
          </Button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-foreground-secondary">{confirmed ? confirmedHelp : pendingHelp}</p>
      {unsaved && !confirmed ? (
        <p id={noteId} className="mt-1 text-xs font-medium text-warning">
          {unsavedHelp}
        </p>
      ) : null}
      {consequence ? (
        <p id={consequenceId} className="mt-1 text-xs font-medium text-warning">
          {consequence}
        </p>
      ) : null}
      {refusal}
    </div>
  );
}

export function MaterialRequestHeader({
  editor,
  technicians,
  materialListId,
}: Readonly<{
  editor: MaterialRequestEditorApi;
  technicians: readonly MaterialRequestTechnician[];
  materialListId: string;
}>) {
  const ids = useId();
  const [urgentError, setUrgentError] = useState<string | null>(null);
  const [materialUnsaved, setMaterialUnsaved] = useState(false);
  const [supplierUnsaved, setSupplierUnsaved] = useState(false);
  const { data, canWrite, updateRequest } = editor;
  const { request } = data;
  const readOnly = !canWrite;
  // Validated lines that hold their material from the request: the server returns them to draft when
  // that material is changed, cleared or no longer confirmed. Said here, before it happens.
  const relying = data.lines.filter(
    (line) =>
      line.status === "validated" &&
      line.imputation === "project" &&
      effectiveLineMaterial(line, request).source === "presumed",
  ).length;
  const materialConsequence =
    canWrite && relying > 0
      ? relying > 1
        ? `${relying} lignes validées comptent sur cette matière : la modifier, l’effacer ou annuler sa confirmation les fera repasser en brouillon.`
        : "1 ligne validée compte sur cette matière : la modifier, l’effacer ou annuler sa confirmation la fera repasser en brouillon."
      : null;
  const technicianOptions = technicians
    .filter((technician) => technician.is_active || technician.id === request.technician_id)
    .map((technician) => ({ value: technician.id, label: technician.name }));

  return (
    <section aria-labelledby={`${ids}-heading`} className="rounded-lg border border-border bg-surface p-4">
      <h2 id={`${ids}-heading`} className="typo-h3 text-foreground">
        Demande
      </h2>
      <div className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2 2xl:grid-cols-4">
        <div>
          <label htmlFor={`${ids}-technician`} className={LABEL}>
            Technicien
          </label>
          <ChoiceCell
            id={`${ids}-technician`}
            value={request.technician_id}
            options={technicianOptions}
            emptyLabel="Non renseigné"
            unknownLabel={data.technician?.name ?? "Technicien retiré de la liste"}
            disabled={readOnly}
            onCommit={(technician_id) => updateRequest({ technician_id })}
          />
        </div>
        <div>
          <label htmlFor={`${ids}-requested`} className={LABEL}>
            Date de la demande
          </label>
          <DateField
            id={`${ids}-requested`}
            value={request.requested_on}
            required
            disabled={readOnly}
            onCommit={(requested_on) => updateRequest({ requested_on: requested_on ?? request.requested_on })}
          />
        </div>
        <div>
          <label htmlFor={`${ids}-needed`} className={LABEL}>
            Date de besoin
          </label>
          <DateField
            id={`${ids}-needed`}
            value={request.needed_on}
            disabled={readOnly}
            onCommit={(needed_on) => updateRequest({ needed_on })}
          />
        </div>
        <div>
          <label htmlFor={`${ids}-place`} className={LABEL}>
            Lieu de réception
          </label>
          <ChoiceCell
            id={`${ids}-place`}
            value={request.delivery_place}
            options={DELIVERY_OPTIONS}
            emptyLabel="Non précisé"
            disabled={readOnly}
            onCommit={(place) => updateRequest({ delivery_place: place as MaterialRequestDeliveryPlace | null })}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${ids}-material`} className={LABEL}>
            Matière présumée
          </label>
          <TextCell
            id={`${ids}-material`}
            value={request.presumed_material}
            list={materialListId}
            maxLength={120}
            placeholder="Si la demande est toute dans une même matière"
            hintId={materialConsequence ? `${ids}-material-consequence` : undefined}
            disabled={readOnly}
            onUnsavedChange={setMaterialUnsaved}
            onCommit={(presumed_material) => updateRequest({ presumed_material, material_confirmed: false })}
          />
          <Proposal
            pendingLabel="Matière à confirmer"
            confirmedLabel="Matière confirmée"
            pendingHelp="C’est une proposition : elle ne vaut pour aucune ligne tant que vous ne l’avez pas confirmée."
            confirmedHelp="Elle vaut pour les lignes de l’affaire qui n’indiquent pas de matière."
            confirmAction="Confirmer la matière"
            undoLabel="Annuler la confirmation de la matière"
            hasValue={Boolean(request.presumed_material)}
            confirmed={request.material_confirmed}
            canWrite={canWrite}
            consequence={materialConsequence}
            consequenceId={`${ids}-material-consequence`}
            unsaved={materialUnsaved}
            unsavedHelp="La matière saisie n’est pas encore enregistrée : confirmez-la une fois qu’elle l’est."
            // The confirmation names the material shown here: if it was changed elsewhere since, the
            // server confirms nothing and says so.
            onChange={(material_confirmed) =>
              updateRequest(
                material_confirmed && request.presumed_material
                  ? { material_confirmed, expected_presumed_material: request.presumed_material }
                  : { material_confirmed },
              )
            }
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${ids}-supplier`} className={LABEL}>
            Fournisseur présumé
          </label>
          <ChoiceCell
            id={`${ids}-supplier`}
            value={request.presumed_supplier_id}
            options={data.supplierOptions.map((option) => ({ value: option.id, label: option.name }))}
            emptyLabel="Aucun"
            unknownLabel="Fournisseur retiré de la liste"
            disabled={readOnly}
            onUnsavedChange={setSupplierUnsaved}
            onCommit={(presumed_supplier_id) => updateRequest({ presumed_supplier_id, supplier_confirmed: false })}
          />
          <Proposal
            pendingLabel="Fournisseur à confirmer"
            confirmedLabel="Fournisseur confirmé"
            pendingHelp="C’est une indication lue en tête de demande : à confirmer avant de s’y fier."
            confirmedHelp="Il est proposé sur les lignes qui n’indiquent pas de fournisseur."
            confirmAction="Confirmer le fournisseur"
            undoLabel="Annuler la confirmation du fournisseur"
            hasValue={Boolean(request.presumed_supplier_id)}
            confirmed={request.supplier_confirmed}
            canWrite={canWrite}
            unsaved={supplierUnsaved}
            unsavedHelp="Le fournisseur choisi n’est pas encore enregistré : confirmez-le une fois qu’il l’est."
            onChange={(supplier_confirmed) =>
              updateRequest(
                supplier_confirmed && request.presumed_supplier_id
                  ? { supplier_confirmed, expected_presumed_supplier_id: request.presumed_supplier_id }
                  : { supplier_confirmed },
              )
            }
          />
        </div>
        <div className="sm:col-span-2 2xl:col-span-3">
          <label htmlFor={`${ids}-note`} className={LABEL}>
            Note
          </label>
          <NoteField
            id={`${ids}-note`}
            value={request.note}
            disabled={readOnly}
            onCommit={(note) => updateRequest({ note })}
          />
        </div>
        <div className="flex flex-col justify-end">
          <label className="flex min-h-9 items-center gap-2 text-sm font-medium text-foreground">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={request.is_urgent}
              disabled={readOnly}
              onChange={async (event) => {
                const result = await updateRequest({ is_urgent: event.currentTarget.checked });
                setUrgentError(result.ok ? null : result.message);
              }}
            />
            Urgent
          </label>
          <FieldError message={urgentError} />
        </div>
      </div>
    </section>
  );
}
