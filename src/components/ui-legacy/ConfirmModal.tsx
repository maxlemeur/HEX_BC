"use client";

import { useId } from "react";

import { Modal } from "@/components/ui-legacy/Modal";

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
  const descriptionId = useId();

  if (!open) return null;

  return (
    <Modal.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !cancelDisabled) {
          onCancel();
        }
      }}
    >
      <Modal.Content
        aria-describedby={descriptionId}
        closeOnEscapeKey={!cancelDisabled}
        closeOnOverlayClick={!cancelDisabled}
        containerClassName="sm:max-w-md"
      >
        <Modal.Header>
          <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p id={descriptionId} className="text-sm text-slate-600">
            {message}
          </p>
          {errorMessage ? (
            <div
              role="alert"
              className="rounded-lg border border-danger/20 bg-error-light px-3 py-2 text-sm text-danger"
            >
              {errorMessage}
            </div>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close
            className="btn btn-secondary btn-sm"
            disabled={cancelDisabled}
          >
            Annuler
          </Modal.Close>
          <button
            type="button"
            className={`btn btn-sm ${variant === "danger" ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
