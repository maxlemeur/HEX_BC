"use client";

import { useRef, useState } from "react";
import { XIcon } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type PlanSetFormModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; description: string | null }) => void;
  loading: boolean;
  error: string | null;
};

export function PlanSetFormModal({
  open,
  onClose,
  onSubmit,
  loading,
  error,
}: PlanSetFormModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onSubmit({
      name: trimmedName,
      description: description.trim() || null,
    });
  }

  function handleClose() {
    if (loading) return;
    setName("");
    setDescription("");
    onClose();
  }

  return (
    <Dialog disablePointerDismissal open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent size="md" showCloseButton={false} initialFocus={nameInputRef}>
        <DialogHeader>
          <DialogTitle>Nouveau jeu de plans</DialogTitle>
        </DialogHeader>
        <DialogClose
          disabled={loading}
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Fermer"
              className="absolute top-2 right-2 size-11 sm:top-4 sm:right-4 sm:size-8"
            />
          }
        >
          <XIcon aria-hidden="true" />
        </DialogClose>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogBody>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="plan-set-name">Nom du jeu</FieldLabel>
              <Input
                ref={nameInputRef}
                id="plan-set-name"
                type="text"
                placeholder="Ex. : Plans architecte — Lot 01"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={255}
                required
                disabled={loading}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="plan-set-description">Description (optionnel)</FieldLabel>
              <Textarea
                id="plan-set-description"
                className="min-h-20 resize-y"
                placeholder="Notes supplémentaires…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                disabled={loading}
              />
            </div>
            {error && (
              <Alert variant="danger">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11 sm:h-9"
              onClick={handleClose}
              disabled={loading}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="h-11 sm:h-9"
              loading={loading}
              disabled={!name.trim()}
            >
              Créer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
