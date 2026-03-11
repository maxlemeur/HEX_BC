"use client";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: "danger" | "default";
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  errorMessage?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirmer",
  variant = "default",
  confirmDisabled = false,
  cancelDisabled = false,
  errorMessage,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget && !cancelDisabled) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
        <p className="mt-3 text-sm text-slate-600">{message}</p>
        {errorMessage ? (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-danger/20 bg-error-light px-3 py-2 text-sm text-danger"
          >
            {errorMessage}
          </div>
        ) : null}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onCancel}
            disabled={cancelDisabled}
          >
            Annuler
          </button>
          <button
            type="button"
            className={`btn btn-sm ${variant === "danger" ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
