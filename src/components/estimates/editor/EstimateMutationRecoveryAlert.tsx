"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type EstimateMutationRecovery = {
  message: string | null; canResume: boolean; isBusy: boolean;
  verify: () => Promise<void>; resume?: () => Promise<void>;
  canAbandon?: boolean; abandon?: () => Promise<void>;
};

export function EstimateMutationRecoveryAlert({ recovery }: { recovery: EstimateMutationRecovery }) {
  if (!recovery.message) return null;
  return (
    <Alert variant="warning" className="mb-6" data-testid="estimate-editor-alert-batch-recovery">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{recovery.message}</span>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="md"
            disabled={recovery.isBusy} onClick={() => void recovery.verify()}>
            Vérifier le résultat
          </Button>
          {recovery.resume ? (
            <Button type="button" variant="outline" size="md"
              disabled={recovery.isBusy || !recovery.canResume} onClick={() => void recovery.resume?.()}>
              Reprendre cette opération
            </Button>
          ) : null}
          {recovery.canAbandon && recovery.abandon ? (
            <Button type="button" variant="outline" size="md" disabled={recovery.isBusy}
              onClick={() => void recovery.abandon?.()}>
              Abandonner la demande
            </Button>
          ) : null}
        </div>
      </div>
      {recovery.canAbandon ? (
        <p className="mt-2 text-xs">Si les ouvrages sont déjà enregistrés, leur résultat sera conservé.</p>
      ) : null}
    </Alert>
  );
}
