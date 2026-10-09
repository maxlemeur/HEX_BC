"use client";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui-legacy/Modal";

import { RISK_STATUS_LABELS } from "@/components/takeoff/takeoff-dpgf-compare-view/constants";
import { FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

type RiskActionTarget = {
  alertId: string;
  status: "assumed" | "false_positive";
  causeLabel: string;
  scopeLabel: string;
};

type RiskStatusModalProps = {
  riskActionTarget: RiskActionTarget | null;
  riskReviewNote: string;
  riskStatusSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onRiskReviewNoteChange: (value: string) => void;
  onSave: () => void;
};

export function RiskStatusModal({
  riskActionTarget,
  riskReviewNote,
  riskStatusSaving,
  onOpenChange,
  onRiskReviewNoteChange,
  onSave,
}: Readonly<RiskStatusModalProps>) {
  return (
    <Modal.Root open={riskActionTarget !== null} onOpenChange={onOpenChange}>
      <Modal.Content className="max-w-2xl">
        <Modal.Header>
          <Modal.Title>Statut explicite du risque</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="rounded-2xl border border-border bg-surface-subtle p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Signal cible
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {riskActionTarget?.causeLabel ?? "Signal"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {riskActionTarget?.scopeLabel ?? "Scope inconnu"} ·{" "}
              {riskActionTarget ? RISK_STATUS_LABELS[riskActionTarget.status] : "Statut"}
            </p>
          </div>
          <div className="mt-4">
            <FieldLabel className="mb-1.5" htmlFor="risk-review-note">
              Note humaine obligatoire
            </FieldLabel>
            <Textarea
              id="risk-review-note"
              name="risk_review_note"
              autoComplete="off"
              className="min-h-[140px] py-3"
              value={riskReviewNote}
              placeholder="Distinguer le fait observe, l'hypothèse retenue et la raison de l'arbitrage humain."
              onChange={(event) => onRiskReviewNoteChange(event.target.value)}
              maxLength={2000}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Aucune suggestion IA n&apos;est appliquée silencieusement. Ce changement reste explicite
              et justifie.
            </p>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>Annuler</Modal.Close>
          <Button
            type="button"
            size="sm"
            loading={riskStatusSaving}
            disabled={riskReviewNote.trim().length === 0}
            onClick={onSave}
          >
            Enregistrer le statut
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
