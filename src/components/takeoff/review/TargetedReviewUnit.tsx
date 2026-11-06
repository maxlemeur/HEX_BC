"use client";

import { Pencil } from "lucide-react";
import { useId, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type Props = {
  designation: string;
  unit: string;
  disabled: boolean;
  busy: boolean;
  error: string | null;
  save: (unit: string) => Promise<boolean>;
};

export function TargetedReviewUnit({ designation, unit, disabled, busy, error, save }: Readonly<Props>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(unit);
  const [submitted, setSubmitted] = useState(false);
  const next = value.trim();
  return (
    <Dialog open={open} onOpenChange={(show) => {
      if (busy) return;
      if (show) {
        setValue(unit);
        setSubmitted(false);
      }
      setOpen(show);
    }}>
      <DialogTrigger disabled={disabled} render={<Button size="xs" variant="link" aria-label={`Corriger l’unité (${unit})`} />}>
        {unit}<Pencil aria-hidden="true" className="size-3" />
      </DialogTrigger>
      <DialogContent size="sm" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Corriger l’unité</DialogTitle>
          <DialogDescription>{designation}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={async (event) => {
          event.preventDefault();
          if (!next || next === unit || disabled) return;
          setSubmitted(true);
          if (await save(next)) setOpen(false);
        }}>
          <Field>
            <FieldLabel htmlFor={id}>Unité</FieldLabel>
            <Input id={id} required maxLength={64} value={value} disabled={busy}
              onChange={(event) => setValue(event.target.value)} />
          </Field>
          {submitted && error ? <Alert variant="danger">{error}</Alert> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={disabled || !next || next === unit}>Enregistrer</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
