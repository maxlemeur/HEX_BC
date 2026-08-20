"use client";

import { Button } from "@/components/ui-legacy/Button";
import { Modal } from "@/components/ui-legacy/Modal";
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
    <Modal.Root open onOpenChange={(open) => !open && onCancel()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{suggestion.label}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-sm text-slate-600">{suggestion.preview}</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Annuler
          </Button>
          <Button
            variant={suggestion.confirmTone === "info" ? "primary" : "danger"}
            size="sm"
            onClick={onConfirm}
          >
            Confirmer
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
