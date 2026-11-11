"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ESTIMATE_STATUS_REASON_CODE_VALUES,
  ESTIMATE_STATUS_REASON_CODES,
  normalizeStatusReason,
  readEstimateStatusReason,
  statusReasonError,
  type EstimateStatusReason,
  type EstimateStatusReasonCode,
} from "@/lib/estimates/status-reason";

type V3StatusReasonDialogProps = {
  /** The line whose reason is asked, or null when closed. */
  line: { title: string; statusLabel: string; reason: unknown } | null;
  isReadOnly: boolean;
  onSave: (reason: EstimateStatusReason) => void;
  onClose: () => void;
};

/**
 * TI-682, lot C (D11, D25): the internal reason of a line excluded after « Non chiffrée ». The grid asks for it when
 * the status changes, and never refuses the change: the line is saved either way and the send waits for the reason.
 */
export function V3StatusReasonDialog({ line, isReadOnly, onSave, onClose }: Readonly<V3StatusReasonDialogProps>) {
  return (
    <Dialog open={line !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {line ? (
        <StatusReasonForm key={line.title} line={line} isReadOnly={isReadOnly} onSave={onSave} onClose={onClose} />
      ) : null}
    </Dialog>
  );
}

function StatusReasonForm({
  line,
  isReadOnly,
  onSave,
  onClose,
}: Readonly<Omit<V3StatusReasonDialogProps, "line"> & { line: NonNullable<V3StatusReasonDialogProps["line"]> }>) {
  const stored = readEstimateStatusReason(line.reason);
  const [code, setCode] = useState<EstimateStatusReasonCode | "">(stored?.code ?? "");
  const [note, setNote] = useState(stored?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    if (!code) {
      setError("Choisissez un motif.");
      return;
    }
    const message = statusReasonError({ code, note });
    if (message) {
      setError(message);
      return;
    }
    onSave(normalizeStatusReason({ code, note }));
  };
  return (
    <DialogContent size="md" data-testid="estimate-v3-status-reason-dialog">
      <DialogHeader>
        <DialogTitle>Motif interne de l&apos;exclusion</DialogTitle>
        <DialogDescription>
          « {line.title} » était non chiffrée et passe en « {line.statusLabel} ». Dites pourquoi : ce motif reste
          interne, le client ne le lit jamais. Il est exigé avant l&apos;envoi, pas maintenant.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Motif</span>
            <select
              className="estimate-input h-9 w-full"
              value={code}
              disabled={isReadOnly}
              onChange={(event) => setCode(event.target.value as EstimateStatusReasonCode | "")}
            >
              <option value="">Choisir un motif</option>
              {ESTIMATE_STATUS_REASON_CODE_VALUES.map((value) => (
                <option key={value} value={value}>{ESTIMATE_STATUS_REASON_CODES[value]}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Précision {code === "other" ? "(obligatoire)" : "(facultative)"}</span>
            <textarea
              className="estimate-input min-h-20 w-full"
              value={note}
              maxLength={2000}
              disabled={isReadOnly}
              placeholder="10 à 500 caractères"
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" size="lg" onClick={onClose}>
          {isReadOnly ? "Fermer" : "Plus tard"}
        </Button>
        {isReadOnly ? null : (
          <Button type="button" variant="primary" size="lg" onClick={save}>
            Enregistrer le motif
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
