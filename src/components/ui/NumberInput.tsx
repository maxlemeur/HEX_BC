"use client";

import { useState } from "react";

export type NumberInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "defaultValue" | "onChange" | "type" | "value"
> & {
  value: number | null | undefined;
  onValueChange: (value: number) => void;
  parseValue?: (value: string) => number | null;
  formatValue?: (value: number | null | undefined) => string;
  emptyValue?: number;
};

export function parseLocalizedNumberInput(value: string): number | null {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    return null;
  }

  const normalizedValue = trimmedValue.replace(",", ".");
  const parsedValue = Number.parseFloat(normalizedValue);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function formatNumberInputValue(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) {
    return "";
  }

  return String(value);
}

export function NumberInput({
  value,
  onValueChange,
  parseValue = parseLocalizedNumberInput,
  formatValue = formatNumberInputValue,
  emptyValue,
  onBlur,
  onFocus,
  ...props
}: Readonly<NumberInputProps>) {
  const [draftValue, setDraftValue] = useState<string | null>(null);
  const displayedValue = draftValue ?? formatValue(value);

  return (
    <input
      {...props}
      type="number"
      value={displayedValue}
      onFocus={(event) => {
        setDraftValue(event.currentTarget.value);
        onFocus?.(event);
      }}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        setDraftValue(nextValue);

        const parsedValue = parseValue(nextValue);
        if (parsedValue !== null) {
          onValueChange(parsedValue);
        }
      }}
      onBlur={(event) => {
        const nextValue = draftValue ?? event.currentTarget.value;
        const parsedValue = parseValue(nextValue);

        if (parsedValue !== null) {
          onValueChange(parsedValue);
        } else if (nextValue.trim().length === 0 && emptyValue !== undefined) {
          onValueChange(emptyValue);
        }

        setDraftValue(null);
        onBlur?.(event);
      }}
    />
  );
}
