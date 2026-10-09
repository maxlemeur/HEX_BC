"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type LibraryNameDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  defaultValue?: string;
  confirmLabel: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
};

/** Asks for a name (rename, duplicate) in the template and assembly libraries. */
export function LibraryNameDialog({
  open,
  title,
  description,
  label,
  defaultValue = "",
  confirmLabel,
  onConfirm,
  onCancel,
}: Readonly<LibraryNameDialogProps>) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <DialogContent size="sm">
        {open ? (
          <LibraryNameForm
            key={defaultValue}
            title={title}
            description={description}
            label={label}
            defaultValue={defaultValue}
            confirmLabel={confirmLabel}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function LibraryNameForm({
  title,
  description,
  label,
  defaultValue,
  confirmLabel,
  onConfirm,
  onCancel,
}: Omit<LibraryNameDialogProps, "open">) {
  const [value, setValue] = useState(defaultValue ?? "");
  const inputId = useId();
  const trimmed = value.trim();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onConfirm(trimmed);
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
        <Input
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoComplete="off"
          required
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" size="lg" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" size="lg" disabled={!trimmed}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
