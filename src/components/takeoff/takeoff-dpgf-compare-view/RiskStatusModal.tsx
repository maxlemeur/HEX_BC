"use client";

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

import { RISK_STATUS_LABELS } from "@/components/takeoff/takeoff-dpgf-compare-view/constants";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
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
    <Dialog
      open={riskActionTarget !== null}
      onOpenChange={(open) => onOpenChange(open)}
      disablePointerDismissal={riskStatusSaving}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Statut explicite du risque</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="rounded-xl border border-border bg-surface-subtle p-4">
            <p className="text-xs tracking-[0.14em] text-muted-foreground uppercase">
              Signal ciblé
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {riskActionTarget?.causeLabel ?? "Signal"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {riskActionTarget?.scopeLabel ?? "Périmètre inconnu"} ·{" "}
              {riskActionTarget ? RISK_STATUS_LABELS[riskActionTarget.status] : "Statut"}
            </p>
          </div>
          <Field>
            <FieldLabel htmlFor="risk-review-note">Note humaine obligatoire</FieldLabel>
            <Textarea
              id="risk-review-note"
              name="risk_review_note"
              autoComplete="off"
              className="min-h-[140px] py-3"
              value={riskReviewNote}
              placeholder="Distinguer le fait observé, l’hypothèse retenue et la raison de l’arbitrage humain."
              onChange={(event) => onRiskReviewNoteChange(event.target.value)}
              maxLength={2000}
              aria-required="true"
              aria-describedby="risk-review-note-hint"
            />
            <FieldDescription id="risk-review-note-hint" className="text-xs">
              Aucune suggestion IA n’est appliquée silencieusement. Ce changement reste explicite
              et justifié.
            </FieldDescription>
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={riskStatusSaving}>
            Annuler
          </DialogClose>
          <Button
            loading={riskStatusSaving}
            disabled={riskReviewNote.trim().length === 0}
            onClick={onSave}
          >
            Enregistrer le statut
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
