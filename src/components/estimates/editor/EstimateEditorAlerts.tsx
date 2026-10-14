"use client";

import dynamic from "next/dynamic";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { EstimateMutationRecovery } from "./EstimateMutationRecoveryAlert";

const EstimateMutationRecoveryAlert = dynamic(() =>
  import("./EstimateMutationRecoveryAlert").then((module) => module.EstimateMutationRecoveryAlert)
);

type EstimateEditorAlertsProps = {
  statusError: string | null;
  isViewerReadOnly: boolean;
  canSend: boolean;
  isSendBlockedForCurrentUser: boolean;
  isDraftLockedByOther: boolean;
  lockHolderLabel: string;
  isAdmin: boolean;
  isForcingDraftUnlock: boolean;
  onForceUnlockDraftLock: () => void;
  draftLockError: string | null;
  conflictMessage: string | null;
  isReloadingVersion: boolean;
  onReloadAfterConflict: () => void;
  hasRestorableDraft: boolean;
  onRestoreConflictDraft: () => void;
  totalsOutOfSync: boolean;
  /** Total écrêté au plafond de stockage : le montant affiché est minoré. */
  isTotalCapped?: boolean;
  isSaveBlocked: boolean;
  onRetryTotalsSave: () => void;
  isStatusReadOnly: boolean;
  bulkSuggestAppliedCount: number | null;
  onUndoBulkSuggest: () => void;
  isUndoingBulkSuggest: boolean;
  isUndoBulkSuggestDisabled: boolean;
  importSummaryMessage: string | null;
  actionNotice: string | null;
  actionError: string | null;
  batchRecovery?: EstimateMutationRecovery;
};

/** Message + action laid out on one line, wrapping on narrow screens. */
const ALERT_WITH_ACTION_CLASS = "flex flex-wrap items-center justify-between gap-3";

export function EstimateEditorAlerts({
  statusError,
  isViewerReadOnly,
  canSend,
  isSendBlockedForCurrentUser,
  isDraftLockedByOther,
  lockHolderLabel,
  isAdmin,
  isForcingDraftUnlock,
  onForceUnlockDraftLock,
  draftLockError,
  conflictMessage,
  isReloadingVersion,
  onReloadAfterConflict,
  hasRestorableDraft,
  onRestoreConflictDraft,
  totalsOutOfSync,
  isTotalCapped = false,
  isSaveBlocked,
  onRetryTotalsSave,
  isStatusReadOnly,
  bulkSuggestAppliedCount,
  onUndoBulkSuggest,
  isUndoingBulkSuggest,
  isUndoBulkSuggestDisabled,
  importSummaryMessage,
  actionNotice,
  actionError,
  batchRecovery,
}: EstimateEditorAlertsProps) {
  return (
    <div data-testid="estimate-editor-alerts">
      {batchRecovery?.message ? <EstimateMutationRecoveryAlert recovery={batchRecovery} /> : null}
      {statusError && (
        <Alert variant="danger" className="mb-6" data-testid="estimate-editor-alert-status-error">
          {statusError}
        </Alert>
      )}

      {isViewerReadOnly ? (
        <Alert variant="info" className="mb-6" data-testid="estimate-editor-alert-viewer-read-only">
          Mode consultation — vous ne pouvez pas modifier ce chiffrage.
        </Alert>
      ) : null}

      {canSend && isSendBlockedForCurrentUser ? (
        <Alert variant="warning" className="mb-6" data-testid="estimate-editor-alert-send-blocked">
          Des anomalies bloquantes sont détectées. Corrigez-les avant l’envoi ou demandez à un administrateur de forcer l’envoi.
        </Alert>
      ) : null}

      {isDraftLockedByOther && (
        <Alert
          variant="warning"
          className="mb-6"
          data-testid="estimate-editor-alert-draft-locked"
        >
          <div className={ALERT_WITH_ACTION_CLASS}>
            <span>Verrouillé par {lockHolderLabel}.</span>
            {isAdmin ? (
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={onForceUnlockDraftLock}
                // Une tentative de reprise automatique du verrou tourne toutes
                // les 5 s tant qu'il est détenu ailleurs : elle ne doit pas
                // rendre le bouton de déverrouillage forcé intermittent.
                disabled={isForcingDraftUnlock}
                data-testid="estimate-editor-alert-force-unlock-button"
              >
                {isForcingDraftUnlock ? "Déverrouillage…" : "Forcer le déverrouillage"}
              </Button>
            ) : null}
          </div>
        </Alert>
      )}

      {draftLockError && !isDraftLockedByOther ? (
        <Alert variant="warning" className="mb-6" data-testid="estimate-editor-alert-draft-lock-error">
          {draftLockError}
        </Alert>
      ) : null}

      {conflictMessage ? (
        <Alert
          variant="warning"
          className="mb-6"
          data-testid="estimate-editor-alert-conflict"
        >
          <div className={ALERT_WITH_ACTION_CLASS}>
            <span>
              {conflictMessage}. Rechargez la version pour récupérer les données serveur.
            </span>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={onReloadAfterConflict}
              disabled={isReloadingVersion}
              data-testid="estimate-editor-alert-reload-button"
            >
              {isReloadingVersion ? "Rechargement…" : "Recharger"}
            </Button>
          </div>
        </Alert>
      ) : null}

      {hasRestorableDraft && !conflictMessage ? (
        <Alert
          variant="info"
          className="mb-6"
          data-testid="estimate-editor-alert-restorable-draft"
        >
          <div className={ALERT_WITH_ACTION_CLASS}>
            <span>Des modifications locales ont été conservées en mémoire de session.</span>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={onRestoreConflictDraft}
              data-testid="estimate-editor-alert-restore-draft-button"
            >
              Restaurer mes changements
            </Button>
          </div>
        </Alert>
      ) : null}

      {isTotalCapped ? (
        <Alert
          variant="danger"
          className="mb-6"
          data-testid="estimate-editor-alert-total-capped"
        >
          Le total de ce devis dépasse la limite technique de 21 474 836,47 € :
          le montant affiché est <strong>plafonné, donc inférieur au montant
          réel</strong>. Ne l&apos;envoyez pas en l&apos;état — scindez le devis
          (par lot ou par tranche) avant validation.
        </Alert>
      ) : null}
      {totalsOutOfSync && !isSaveBlocked ? (
        <Alert variant="warning" className="mb-6" data-testid="estimate-editor-alert-totals-out-of-sync">
          <div className={ALERT_WITH_ACTION_CLASS}>
            <span>
              Les totaux n&apos;ont pas pu être sauvegardés. Vos modifications locales sont conservées.
            </span>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={onRetryTotalsSave}
              data-testid="estimate-editor-alert-retry-save-button"
            >
              Réessayer
            </Button>
          </div>
        </Alert>
      ) : null}

      {isStatusReadOnly ? (
        <Alert variant="info" className="mb-6" data-testid="estimate-editor-alert-status-read-only">
          Cette version est en lecture seule car son statut n&apos;est plus brouillon.
        </Alert>
      ) : null}

      {bulkSuggestAppliedCount ? (
        <Alert
          variant="info"
          className="mb-6"
          data-testid="estimate-editor-alert-bulk-suggest-applied"
        >
          <div className={ALERT_WITH_ACTION_CLASS}>
            <span>Suggestions appliquées sur {bulkSuggestAppliedCount} ligne(s).</span>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={onUndoBulkSuggest}
              disabled={isUndoingBulkSuggest || isUndoBulkSuggestDisabled}
              data-testid="estimate-editor-alert-undo-bulk-suggest-button"
            >
              {isUndoingBulkSuggest ? "Annulation…" : "Annuler les suggestions"}
            </Button>
          </div>
        </Alert>
      ) : null}

      {importSummaryMessage ? (
        <Alert variant="info" className="mt-4" data-testid="estimate-editor-alert-import-summary">
          {importSummaryMessage}
        </Alert>
      ) : null}

      {actionNotice ? (
        <Alert
          variant="info"
          className="mt-4"
          aria-live="polite"
          data-testid="estimate-editor-alert-action-notice"
        >
          {actionNotice}
        </Alert>
      ) : null}
      {actionError ? (
        <Alert
          variant="danger"
          className="mt-4"
          aria-live="assertive"
          data-testid="estimate-editor-alert-action-error"
        >
          {actionError}
        </Alert>
      ) : null}
    </div>
  );
}
