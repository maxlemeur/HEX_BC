"use client";

import { useCallback, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

type ExclusionReasonDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  onConfirm: (reason: string) => void;
};

/** Asks for the mandatory exclusion reason before excluding takeoff items. */
export function ExclusionReasonDialog({
  open,
  onOpenChange,
  count,
  onConfirm,
}: ExclusionReasonDialogProps) {
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const canConfirm = reason.trim().length > 0;
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setReason("");
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>
            Exclure {count} item{count > 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            Le motif reste visible dans la revue et permet de réintégrer la ligne plus tard.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor={reasonId}>Motif d&apos;exclusion (obligatoire)</FieldLabel>
          <Textarea
            id={reasonId}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Indiquer le motif d'exclusion…"
            maxLength={500}
            required
          />
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Annuler</DialogClose>
          <Button
            variant="danger"
            disabled={!canConfirm}
            onClick={() => {
              onConfirm(reason.trim());
              handleOpenChange(false);
            }}
          >
            Exclure
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
