"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CockpitSuggestion } from "@/lib/cockpit/suggestions";

type CockpitCommandPreviewProps = {
  suggestion: CockpitSuggestion;
  onConfirm: () => void;
  onCancel: () => void;
};

export function CockpitCommandPreview({
  suggestion,
  onConfirm,
  onCancel,
}: Readonly<CockpitCommandPreviewProps>) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{suggestion.label}</DialogTitle>
          <DialogDescription>{suggestion.preview}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="lg" onClick={onCancel}>
            Annuler
          </Button>
          <Button
            variant={suggestion.confirmTone === "info" ? "primary" : "danger-solid"}
            size="lg"
            onClick={onConfirm}
          >
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
