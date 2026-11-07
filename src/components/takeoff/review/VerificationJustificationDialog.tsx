"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { VERIFICATION_REASONS, verificationJustificationSchema, type VerificationJustification } from "@/lib/takeoff/rules/verification";

export function VerificationJustificationDialog({ gasPe, onClose, onConfirm }: Readonly<{
  gasPe: boolean; onClose: () => void; onConfirm: (value: VerificationJustification) => void;
}>) {
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const parsed = verificationJustificationSchema.safeParse({ reason_code: reason, system_reference: reference });
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Justifier l’acceptation</DialogTitle>
          <DialogDescription>Indiquez la gamme, le fabricant, le certificat et les conditions d’emploi qui justifient cette ligne. La décision reste dans le journal.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="verification-reason">Motif</FieldLabel>
          <select id="verification-reason" className="rounded-md border border-border bg-surface p-2 text-sm" value={reason} onChange={(event) => setReason(event.target.value)}>
            <option value="">Choisir un motif</option>
            {Object.entries(VERIFICATION_REASONS).filter(([code]) => gasPe ? code !== "system_documented" : code === "system_documented")
              .map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="verification-system">Référence du système</FieldLabel>
          <Textarea id="verification-system" value={reference} onChange={(event) => setReference(event.target.value)} minLength={10} maxLength={500} required rows={4} />
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Annuler</DialogClose>
          <Button disabled={!parsed.success} onClick={() => { if (parsed.success) onConfirm(parsed.data); }}>Confirmer l’acceptation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
