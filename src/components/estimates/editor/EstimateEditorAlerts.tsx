"use client";

type EstimateEditorAlertsProps = {
  statusError: string | null;
  isViewerReadOnly: boolean;
  canSend: boolean;
  isSendBlockedForCurrentUser: boolean;
  isDraftLockedByOther: boolean;
  lockHolderLabel: string;
  isAdmin: boolean;
  isForcingDraftUnlock: boolean;
  isDraftLockAcquiring: boolean;
  onForceUnlockDraftLock: () => void;
  draftLockError: string | null;
  conflictMessage: string | null;
  isReloadingVersion: boolean;
  onReloadAfterConflict: () => void;
  hasRestorableDraft: boolean;
  onRestoreConflictDraft: () => void;
  totalsOutOfSync: boolean;
  isSaveBlocked: boolean;
  onRetryTotalsSave: () => void;
  isStatusReadOnly: boolean;
  bulkSuggestAppliedCount: number | null;
  onUndoBulkSuggest: () => void;
  isUndoingBulkSuggest: boolean;
  isUndoBulkSuggestDisabled: boolean;
  importSummaryMessage: string | null;
  actionError: string | null;
};

export function EstimateEditorAlerts({
  statusError,
  isViewerReadOnly,
  canSend,
  isSendBlockedForCurrentUser,
  isDraftLockedByOther,
  lockHolderLabel,
  isAdmin,
  isForcingDraftUnlock,
  isDraftLockAcquiring,
  onForceUnlockDraftLock,
  draftLockError,
  conflictMessage,
  isReloadingVersion,
  onReloadAfterConflict,
  hasRestorableDraft,
  onRestoreConflictDraft,
  totalsOutOfSync,
  isSaveBlocked,
  onRetryTotalsSave,
  isStatusReadOnly,
  bulkSuggestAppliedCount,
  onUndoBulkSuggest,
  isUndoingBulkSuggest,
  isUndoBulkSuggestDisabled,
  importSummaryMessage,
  actionError,
}: EstimateEditorAlertsProps) {
  return (
    <div data-testid="estimate-editor-alerts">
      {statusError && (
        <div className="alert alert-error mb-6" data-testid="estimate-editor-alert-status-error">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {statusError}
        </div>
      )}

      {isViewerReadOnly ? (
        <div className="alert alert-info mb-6" data-testid="estimate-editor-alert-viewer-read-only">
          Mode consultation — vous ne pouvez pas modifier ce chiffrage.
        </div>
      ) : null}

      {canSend && isSendBlockedForCurrentUser ? (
        <div className="alert alert-warning mb-6" data-testid="estimate-editor-alert-send-blocked">
          Des anomalies bloquantes sont détectées. Corrigez-les avant envoi ou demandez un administrateur pour forcer l&apos;envoi.
        </div>
      ) : null}

      {isDraftLockedByOther && (
        <div
          className="alert alert-warning mb-6 flex flex-wrap items-center justify-between gap-3"
          data-testid="estimate-editor-alert-draft-locked"
        >
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Verrouille par {lockHolderLabel}.</span>
          </div>
          {isAdmin ? (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={onForceUnlockDraftLock}
              disabled={isForcingDraftUnlock || isDraftLockAcquiring}
              data-testid="estimate-editor-alert-force-unlock-button"
            >
              {isForcingDraftUnlock ? "Deverrouillage..." : "Forcer le deverrouillage"}
            </button>
          ) : null}
        </div>
      )}

      {draftLockError && !isDraftLockedByOther ? (
        <div className="alert alert-warning mb-6" data-testid="estimate-editor-alert-draft-lock-error">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          {draftLockError}
        </div>
      ) : null}

      {conflictMessage ? (
        <div
          className="alert alert-warning mb-6 flex flex-wrap items-center justify-between gap-3"
          data-testid="estimate-editor-alert-conflict"
        >
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>
              {conflictMessage}. Rechargez la version pour recuperer les donnees serveur.
            </span>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={onReloadAfterConflict}
            disabled={isReloadingVersion}
            data-testid="estimate-editor-alert-reload-button"
          >
            {isReloadingVersion ? "Rechargement..." : "Recharger"}
          </button>
        </div>
      ) : null}

      {hasRestorableDraft && !conflictMessage ? (
        <div
          className="alert alert-info mb-6 flex flex-wrap items-center justify-between gap-3"
          data-testid="estimate-editor-alert-restorable-draft"
        >
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
            <span>Des modifications locales ont été conservées en mémoire de session.</span>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={onRestoreConflictDraft}
            data-testid="estimate-editor-alert-restore-draft-button"
          >
            Restaurer mes changements
          </button>
        </div>
      ) : null}

      {totalsOutOfSync && !isSaveBlocked ? (
        <div className="alert alert-warning mb-6 flex items-center justify-between" data-testid="estimate-editor-alert-totals-out-of-sync">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Les totaux n&apos;ont pas pu être sauvegardés. Vos modifications locales sont conservées.
          </div>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={onRetryTotalsSave}
            data-testid="estimate-editor-alert-retry-save-button"
          >
            Réessayer
          </button>
        </div>
      ) : null}

      {isStatusReadOnly ? (
        <div className="alert alert-info mb-6" data-testid="estimate-editor-alert-status-read-only">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
          Cette version est en lecture seule car son statut n&apos;est plus brouillon.
        </div>
      ) : null}

      {bulkSuggestAppliedCount ? (
        <div
          className="alert alert-info mb-6 flex flex-wrap items-center justify-between gap-3"
          data-testid="estimate-editor-alert-bulk-suggest-applied"
        >
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
            <span>Suggestions appliquees sur {bulkSuggestAppliedCount} ligne(s).</span>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={onUndoBulkSuggest}
            disabled={isUndoingBulkSuggest || isUndoBulkSuggestDisabled}
            data-testid="estimate-editor-alert-undo-bulk-suggest-button"
          >
            {isUndoingBulkSuggest ? "Annulation..." : "Annuler les suggestions"}
          </button>
        </div>
      ) : null}

      {importSummaryMessage ? (
        <div className="alert alert-info mt-4" data-testid="estimate-editor-alert-import-summary">
          {importSummaryMessage}
        </div>
      ) : null}

      {actionError ? (
        <div className="alert alert-error mt-4" data-testid="estimate-editor-alert-action-error">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {actionError}
        </div>
      ) : null}
    </div>
  );
}
