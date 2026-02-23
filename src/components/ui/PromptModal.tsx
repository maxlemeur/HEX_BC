"use client";

import { useCallback, useRef, useState } from "react";

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
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed) onConfirm(trimmed);
    },
    [value, onConfirm]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <form
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onSubmit={handleSubmit}
      >
        <h3 className="text-lg font-semibold text-[var(--slate-800)]">{title}</h3>
        <label className="mt-4 block text-sm font-medium text-[var(--slate-600)]">
          {label}
        </label>
        <input
          ref={inputRef}
          className="form-input mt-1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
            Annuler
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
