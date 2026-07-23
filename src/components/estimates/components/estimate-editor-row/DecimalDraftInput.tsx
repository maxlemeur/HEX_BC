"use client";

import {
  forwardRef,
  useState,
  type FocusEventHandler,
  type InputHTMLAttributes,
} from "react";

import {
  parseDecimalDraft,
  parseNumberInput,
} from "@/components/estimates/components/estimate-editor-row/shared";

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
  /**
   * Valeur retenue quand le champ est vidé ou invalide. Fournie par les
   * cellules de coefficient (K FO / K MO = 1) pour ne pas enregistrer 0 par
   * un simple effacement. Sans cette prop, le comportement historique
   * (vide -> 0) est conservé pour les autres cellules (heures, etc.).
   */
  emptyValue?: number;
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
    emptyValue,
    ...inputProps
  },
  ref,
) {
  const [draftValue, setDraftValue] = useState<string | null>(null);

  // Quand emptyValue est fourni, une saisie vide/invalide retombe sur cette
  // valeur neutre au lieu de 0. Sinon, comportement historique (vide -> 0).
  const resolve = (raw: string): number => {
    if (emptyValue === undefined) return parseNumberInput(raw);
    return parseDecimalDraft(raw) ?? emptyValue;
  };

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
        onValueChange(resolve(nextValue));
      }}
      onBlur={(event) => {
        const nextValue = event.currentTarget.value;
        onBlur?.(event);
        setDraftValue(null);
        onValueCommit(resolve(nextValue));
      }}
    />
  );
});
