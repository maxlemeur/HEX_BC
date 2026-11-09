"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { TAKEOFF_RULE_LABELS } from "@/lib/takeoff/rules/labels";
import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import {
  ACCEPTANCE_MESSAGES,
  ACCEPTANCE_NOTE,
  AREA_PRINTED_REASONS,
  RETAINED_SURFACE_BASES,
  SCALE_DIMENSION_REASONS,
  VERIFICATION_REASONS,
  belowPrintedArea,
  noteLength,
  printedAreaComparison,
  requiredAcceptanceReasons,
  requiresGasPeReason,
  verificationError,
  verificationJustificationSchema,
  type VerificationJustification,
} from "@/lib/takeoff/rules/verification";

// The coded reasons V needs on a line (TI-685, TI-686 D9): one section per failure that asks for one, each titled by
// its rule. The line is read live: a printed surface retained from here (« Retenir … m² ») is saved first, the rules
// are computed again with it, then the acceptance is offered again.

const SELECT_CLASS = "rounded-md border border-border bg-surface p-2 text-sm";
const squareMetres = (value: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(value)} m²`;

type Line = { rule_results?: TakeoffRuleResult[]; rules_stale?: boolean; quantity: number };

/** A note, counted as the server counts it (code points, without the blanks at its ends). */
function NoteField({ id, label, value, onChange }: Readonly<{ id: string; label: string; value: string; onChange: (text: string) => void }>) {
  const length = noteLength(value);
  const valid = length >= ACCEPTANCE_NOTE.min && length <= ACCEPTANCE_NOTE.max;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} required rows={3}
        aria-describedby={`${id}-count`} aria-invalid={value !== "" && !valid} />
      <p id={`${id}-count`} className={valid || value === "" ? "text-xs text-muted-foreground" : "text-xs text-danger"}>
        {length} / {ACCEPTANCE_NOTE.max} caractères (au moins {ACCEPTANCE_NOTE.min})
      </p>
    </Field>
  );
}

export function VerificationJustificationDialog({ item, busy, error, onClose, onConfirm, onRetainPrinted }: Readonly<{
  item: Line; busy: boolean; onClose: () => void; onConfirm: (value: VerificationJustification) => void;
  /** The line's last refused save (a printed surface retained from here), shown where the user acts. */
  error: string | null;
  onRetainPrinted: (quantity: number) => void;
}>) {
  const required = requiredAcceptanceReasons(item.rule_results);
  const gasPe = requiresGasPeReason(item.rule_results);
  const comparison = printedAreaComparison(item.rule_results);
  const [network, setNetwork] = useState({ reason: "", reference: "" });
  const [scale, setScale] = useState({ reason: "", note: "" });
  const [area, setArea] = useState({ reason: "", basis: "", note: "" });

  const value = {
    ...(required.includes("dn_network") ? { reason_code: network.reason, system_reference: network.reference } : {}),
    ...(required.includes("scale_dimension") ? { scale_dimension: { reason_code: scale.reason, note: scale.note } } : {}),
    ...(required.includes("area_printed")
      ? { area_printed: { reason_code: area.reason, retained_basis: area.basis, note: area.note } } : {}),
  };
  const parsed = verificationJustificationSchema.safeParse(value);
  const refusal = parsed.success ? verificationError(item.rule_results, item.rules_stale, parsed.data, item.quantity) : null;
  const accepted = parsed.success && refusal === null;
  const sameBasis = comparison !== null && comparison.expected_basis !== null && area.basis === comparison.expected_basis;
  const retain = sameBasis && belowPrintedArea(item.quantity, comparison.printed_m2) ? comparison.printed_m2 : null;
  // Why a complete form still cannot be confirmed (a line left stale by its last save, a failure V never settles), said
  // where the user acts; a quantity below the printed surface is already said by the button that retains it (D17).
  const blocked = refusal !== null && !(retain !== null && refusal === ACCEPTANCE_MESSAGES.belowPrinted(retain)) ? refusal : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Justifier l’acceptation</DialogTitle>
          <DialogDescription>
            Chaque échec ci-dessous s’accepte avec un motif codé et un texte de {ACCEPTANCE_NOTE.min} à {ACCEPTANCE_NOTE.max} caractères.
            La décision reste dans le journal.
          </DialogDescription>
        </DialogHeader>

        {required.includes("dn_network") ? (
          <FieldSet className="gap-3">
            <FieldLegend variant="label">{TAKEOFF_RULE_LABELS.dn_network}</FieldLegend>
            <p className="text-xs text-muted-foreground">Indiquez la gamme, le fabricant, le certificat et les conditions d’emploi qui justifient cette ligne.</p>
            <Field>
              <FieldLabel htmlFor="verification-reason">Motif</FieldLabel>
              <select id="verification-reason" className={SELECT_CLASS} value={network.reason}
                onChange={(event) => setNetwork({ ...network, reason: event.target.value })}>
                <option value="">Choisir un motif</option>
                {Object.entries(VERIFICATION_REASONS).filter(([code]) => gasPe ? code !== "system_documented" : code === "system_documented")
                  .map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </Field>
            <NoteField id="verification-system" label="Référence du système" value={network.reference}
              onChange={(reference) => setNetwork({ ...network, reference })} />
          </FieldSet>
        ) : null}

        {required.includes("scale_dimension") ? (
          <FieldSet className="gap-3">
            <FieldLegend variant="label">{TAKEOFF_RULE_LABELS.scale_dimension}</FieldLegend>
            <p className="text-xs text-muted-foreground">Calibrer la page règle cet échec pour toutes ses lignes, sans motif.</p>
            <Field>
              <FieldLabel htmlFor="verification-scale-reason">Motif d’échelle</FieldLabel>
              <select id="verification-scale-reason" className={SELECT_CLASS} value={scale.reason}
                onChange={(event) => setScale({ ...scale, reason: event.target.value })}>
                <option value="">Choisir un motif</option>
                {Object.entries(SCALE_DIMENSION_REASONS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </Field>
            <NoteField id="verification-scale-note" label="Ce qui a été vérifié" value={scale.note}
              onChange={(note) => setScale({ ...scale, note })} />
          </FieldSet>
        ) : null}

        {required.includes("area_printed") ? (
          <FieldSet className="gap-3">
            <FieldLegend variant="label">{TAKEOFF_RULE_LABELS.area_printed}</FieldLegend>
            {comparison ? (
              <p className="text-xs text-muted-foreground">
                Surface écrite : <span className="font-mono tabular-nums">{squareMetres(comparison.printed_m2)}</span>
                {" · "}quantité de la ligne : <span className="font-mono tabular-nums">{squareMetres(item.quantity)}</span>
              </p>
            ) : null}
            <Field>
              <FieldLabel htmlFor="verification-area-reason">Motif de surface</FieldLabel>
              <select id="verification-area-reason" className={SELECT_CLASS} value={area.reason}
                onChange={(event) => setArea({ ...area, reason: event.target.value })}>
                <option value="">Choisir un motif</option>
                {Object.entries(AREA_PRINTED_REASONS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </Field>
            <FieldSet className="gap-1.5">
              <FieldLegend variant="label">Base de la surface écrite</FieldLegend>
              {Object.entries(RETAINED_SURFACE_BASES).map(([code, label]) => (
                <label key={code} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="verification-area-basis" value={code} checked={area.basis === code}
                    onChange={() => setArea({ ...area, basis: code })} />
                  {label}
                </label>
              ))}
            </FieldSet>
            {area.basis ? (
              <p role="status" className="text-xs text-foreground-secondary">
                {sameBasis ? "Même base que la prestation : les deux surfaces se comparent, la plus élevée est retenue."
                  : comparison?.expected_basis
                    ? "Bases différentes : la quantité reste celle de la ligne ; la surface écrite reste visible dans le contrôle."
                    : "Base de la prestation non déterminée : la quantité reste celle de la ligne ; la surface écrite reste visible dans le contrôle."}
              </p>
            ) : null}
            {retain !== null ? (
              <Button size="sm" variant="secondary" className="self-start" disabled={busy} onClick={() => onRetainPrinted(retain)}>
                Retenir {squareMetres(retain)}
              </Button>
            ) : null}
            <NoteField id="verification-area-note" label="Note" value={area.note} onChange={(note) => setArea({ ...area, note })} />
          </FieldSet>
        ) : null}

        {error ? <Alert variant="danger" className="px-3 py-2 text-xs">{error}</Alert> : null}
        {blocked && blocked !== error ? <Alert variant="warning" className="px-3 py-2 text-xs">{blocked}</Alert> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Annuler</DialogClose>
          <Button disabled={busy || !accepted} onClick={() => { if (parsed.success && accepted) onConfirm(parsed.data); }}>Confirmer l’acceptation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
