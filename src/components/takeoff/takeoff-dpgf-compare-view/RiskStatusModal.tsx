"use client";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

import { RISK_STATUS_LABELS } from "@/components/takeoff/takeoff-dpgf-compare-view/constants";

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
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--slate-50)] p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
              Signal cible
            </p>
            <p className="mt-2 text-sm font-semibold text-[var(--slate-950)]">
              {riskActionTarget?.causeLabel ?? "Signal"}
            </p>
            <p className="mt-1 text-sm text-[var(--slate-600)]">
              {riskActionTarget?.scopeLabel ?? "Scope inconnu"} ·{" "}
              {riskActionTarget ? RISK_STATUS_LABELS[riskActionTarget.status] : "Statut"}
            </p>
          </div>
          <div className="mt-4">
            <label className="form-label" htmlFor="risk-review-note">
              Note humaine obligatoire
            </label>
            <textarea
              id="risk-review-note"
              name="risk_review_note"
              autoComplete="off"
              className="form-input min-h-[140px] py-3"
              value={riskReviewNote}
              placeholder="Distinguer le fait observe, l'hypothese retenue et la raison de l'arbitrage humain."
              onChange={(event) => onRiskReviewNoteChange(event.target.value)}
              maxLength={2000}
            />
            <p className="mt-2 text-xs text-[var(--slate-500)]">
              Aucune suggestion IA n&apos;est appliquee silencieusement. Ce changement reste explicite
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
