"use client";

import { useCallback, useId, useState } from "react";

import { Modal } from "@/components/ui-legacy/Modal";

type PromptModalProps = {
  open: boolean;
  title: string;
  label: string;
  defaultValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
};

export function PromptModal({
  open,
  title,
  label,
  defaultValue = "",
  confirmLabel = "Confirmer",
  onConfirm,
  onCancel,
}: PromptModalProps) {
  if (!open) return null;

  return (
    <PromptModalInner
      key={defaultValue}
      title={title}
      label={label}
      defaultValue={defaultValue}
      confirmLabel={confirmLabel}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

function PromptModalInner({
  title,
  label,
  defaultValue,
  confirmLabel,
  onConfirm,
  onCancel,
}: Omit<PromptModalProps, "open">) {
  const [value, setValue] = useState(defaultValue ?? "");
  const inputId = useId();

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = value.trim();
      if (trimmed) onConfirm(trimmed);
    },
    [value, onConfirm]
  );

  return (
    <Modal.Root
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
    >
      <Modal.Content containerClassName="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <Modal.Header>
            <Modal.Title>{title}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <label
              className="block text-sm font-medium text-slate-600"
              htmlFor={inputId}
            >
              {label}
            </label>
            <input
              id={inputId}
              name="promptValue"
              className="form-input mt-1"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              data-modal-autofocus="true"
            />
          </Modal.Body>
          <Modal.Footer>
            <Modal.Close className="btn btn-secondary btn-sm">
              Annuler
            </Modal.Close>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!value.trim()}
            >
              {confirmLabel}
            </button>
          </Modal.Footer>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
}
