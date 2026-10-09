"use client";

import { useId, useState } from "react";
import { BookmarkPlusIcon } from "lucide-react";

import { useToast } from "@/components/ui-legacy/Toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createEstimateTemplate } from "@/lib/estimates/client";
import { cn } from "@/lib/utils";

type SaveAsTemplateButtonProps = {
  versionId: string;
  className?: string;
};

function buildDefaultTemplateName() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String(now.getFullYear()).slice(-2);
  return `Modèle ${day}/${month}/${year}`;
}

export function SaveAsTemplateButton({ versionId, className }: SaveAsTemplateButtonProps) {
  const toast = useToast();
  const fieldId = useId();
  const nameId = `${fieldId}-name`;
  const nameErrorId = `${fieldId}-name-error`;
  const descriptionId = `${fieldId}-description`;
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function openModal() {
    setNameError(null);
    setName(buildDefaultTemplateName());
    setDescription("");
    setIsOpen(true);
  }

  function closeModal() {
    if (isSubmitting) return;
    setIsOpen(false);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!versionId || isSubmitting) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Le nom du modèle est obligatoire.");
      return;
    }

    setNameError(null);
    setIsSubmitting(true);

    try {
      await createEstimateTemplate({
        sourceVersionId: versionId,
        name: trimmedName,
        description: description.trim() || null,
      });

      setIsSubmitting(false);
      setIsOpen(false);
      toast.success({
        title: "Modèle enregistré",
        description: "Le modèle a été ajouté à vos modèles de chiffrage.",
      });
    } catch (error) {
      setIsSubmitting(false);
      toast.error({
        title: "Enregistrement impossible",
        description:
          error instanceof Error ? error.message : "Impossible d'enregistrer le modèle.",
      });
    }
  }

  return (
    <>
      <Button
        className={cn("w-full justify-start", className)}
        variant="ghost"
        size="md"
        type="button"
        leftIcon={<BookmarkPlusIcon aria-hidden="true" />}
        onClick={openModal}
      >
        Sauvegarder comme modèle
      </Button>

      <Dialog
        open={isOpen}
        disablePointerDismissal={isSubmitting}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Sauvegarder comme modèle</DialogTitle>
            <DialogDescription>
              Le modèle reprend les sections, les lignes et les paramètres de cette version.
            </DialogDescription>
          </DialogHeader>

          <form className="grid gap-4" onSubmit={onSubmit} noValidate>
            <Field data-invalid={nameError ? true : undefined}>
              <FieldLabel htmlFor={nameId}>Nom du modèle *</FieldLabel>
              <Input
                id={nameId}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (nameError) {
                    setNameError(null);
                  }
                }}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? nameErrorId : undefined}
                required
                autoComplete="off"
              />
              {nameError ? <FieldError id={nameErrorId}>{nameError}</FieldError> : null}
            </Field>

            <Field>
              <FieldLabel htmlFor={descriptionId}>Description</FieldLabel>
              <Textarea
                id={descriptionId}
                placeholder="Optionnelle"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>

            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={closeModal} disabled={isSubmitting}>
                Annuler
              </Button>
              <Button type="submit" size="lg" loading={isSubmitting}>
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
