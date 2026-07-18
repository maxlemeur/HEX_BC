"use client";

import {
  forwardRef,
  useState,
  type FocusEventHandler,
  type InputHTMLAttributes,
} from "react";

import { parseNumberInput } from "@/components/estimates/components/estimate-editor-row/shared";

type DecimalDraftInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  | "defaultValue"
  | "inputMode"
  | "onBlur"
  | "onChange"
  | "onFocus"
  | "type"
  | "value"
> & {
  value: number;
  onValueChange: (value: number) => void;
  onValueCommit: (value: number) => void;
  onFocus?: FocusEventHandler<HTMLInputElement>;
  onBlur?: FocusEventHandler<HTMLInputElement>;
};

export const DecimalDraftInput = forwardRef<
  HTMLInputElement,
  DecimalDraftInputProps
>(function DecimalDraftInput(
  {
    value,
    onValueChange,
    onValueCommit,
    onFocus,
    onBlur,
    ...inputProps
  },
  ref,
) {
  const [draftValue, setDraftValue] = useState<string | null>(null);

  return (
    <input
      {...inputProps}
      ref={ref}
      type="text"
      inputMode="decimal"
      value={draftValue ?? String(value)}
      onFocus={(event) => {
        setDraftValue(event.currentTarget.value);
        onFocus?.(event);
      }}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        setDraftValue(nextValue);
        onValueChange(parseNumberInput(nextValue));
      }}
      onBlur={(event) => {
        const nextValue = event.currentTarget.value;
        onBlur?.(event);
        setDraftValue(null);
        onValueCommit(parseNumberInput(nextValue));
      }}
    />
  );
});
