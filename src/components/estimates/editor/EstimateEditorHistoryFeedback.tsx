"use client";

import { Button } from "@/components/ui/button";
import type {
  EstimateEditorHistoryFeedback as HistoryFeedback,
  EstimateEditorHistoryRecovery,
} from "@/hooks/useEstimateEditorHistoryController";

type Props = {
  feedback: HistoryFeedback | null;
  recovery: EstimateEditorHistoryRecovery | null;
  canRetry: boolean;
  onRetry: () => Promise<void>;
  onLocate: () => void;
  onDismiss: () => void;
};

export function EstimateEditorHistoryFeedback({
  feedback, recovery, canRetry, onRetry, onLocate, onDismiss,
}: Props) {
  if (!feedback) return null;

  return (
    <div
      role="status"
      aria-label="Historique des modifications"
      aria-live="polite"
      aria-atomic="true"
      data-testid="estimate-editor-history-feedback"
      className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-lg rounded-xl border border-border bg-surface p-4 shadow-lg sm:left-auto sm:right-6 sm:mx-0"
      style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <p className="text-sm font-medium text-foreground">{feedback.message}</p>
      {feedback.kind === "recovery" && recovery ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {recovery.canRetry ? (
            <Button type="button" variant="primary" size="sm" disabled={!canRetry} onClick={() => void onRetry()}>
              Réessayer la remise en ordre
            </Button>
          ) : null}
          {recovery.itemId ? (
            <Button type="button" variant="outline" size="sm" onClick={onLocate}>
              Vérifier la position
            </Button>
          ) : null}
        </div>
      ) : null}
      {feedback.kind === "success" ? (
        <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={onDismiss}>
          Fermer
        </Button>
      ) : null}
    </div>
  );
}
