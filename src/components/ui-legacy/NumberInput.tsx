"use client";

import { useState } from "react";
import { formatDecimalInput, NUMERIC_INPUT_ERROR, parseDecimalInput } from "@/lib/numeric-input/parsers";

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
  return parseDecimalInput(value);
}

function formatNumberInputValue(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) {
    return "";
  }

  return formatDecimalInput(value);
}

export function NumberInput({
  value,
  onValueChange,
  parseValue = parseLocalizedNumberInput,
  formatValue = formatNumberInputValue,
  emptyValue,
  onBlur,
  onFocus,
  min,
  max,
  ...props
}: Readonly<NumberInputProps>) {
  const [draftValue, setDraftValue] = useState<string | null>(null);
  const displayedValue = draftValue ?? formatValue(value);
  const parse = (raw: string) => {
    const parsed = parseValue(raw);
    if (parsed === null || (min !== undefined && parsed < Number(min)) || (max !== undefined && parsed > Number(max))) return null;
    return parsed;
  };
  const invalid = draftValue !== null && draftValue.trim() !== "" && parse(draftValue) === null;

  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      aria-invalid={invalid || props["aria-invalid"]}
      title={invalid ? NUMERIC_INPUT_ERROR : props.title}
      value={displayedValue}
      onFocus={(event) => {
        setDraftValue(event.currentTarget.value);
        onFocus?.(event);
      }}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        setDraftValue(nextValue);

        event.currentTarget.setCustomValidity(nextValue.trim() !== "" && parse(nextValue) === null ? NUMERIC_INPUT_ERROR : "");
      }}
      onBlur={(event) => {
        const nextValue = draftValue ?? event.currentTarget.value;
        const parsedValue = parse(nextValue);

        if (parsedValue !== null) {
          onValueChange(parsedValue);
        } else if (nextValue.trim().length === 0 && emptyValue !== undefined) {
          onValueChange(emptyValue);
        } else if (nextValue.trim() !== "") {
          event.currentTarget.setCustomValidity(NUMERIC_INPUT_ERROR);
          event.currentTarget.reportValidity();
          onBlur?.(event);
          return;
        }

        setDraftValue(null);
        onBlur?.(event);
      }}
    />
  );
}
