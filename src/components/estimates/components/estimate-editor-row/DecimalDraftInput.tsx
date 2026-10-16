"use client";

import {
  forwardRef,
  useState,
  type FocusEventHandler,
  type InputHTMLAttributes,
} from "react";

import { parseDecimalDraft } from "@/components/estimates/components/estimate-editor-row/shared";
import { formatDecimalInput, NUMERIC_INPUT_ERROR } from "@/lib/numeric-input/parsers";

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
  value: number | null;
  onValueChange: (value: number) => void;
  onValueCommit: (value: number) => void;
  onFocus?: FocusEventHandler<HTMLInputElement>;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  /**
   * Valeur retenue quand le champ est vidé. Une saisie invalide ne la déclenche pas. Fournie par les
   * cellules de coefficient (K FO / K MO = 1) pour ne pas enregistrer 0 par
   * un simple effacement. Sans cette prop, le comportement historique
   * (vide -> 0) est conservé pour les autres cellules (heures, etc.).
   */
  emptyValue?: number;
  /**
   * Lecture d'un brouillon non vide ; par défaut la grammaire décimale commune. Une grandeur y
   * applique sa précision, ses bornes ou son unité (parseurs de `@/lib/numeric-input/parsers`,
   * ex. « Majoration MO (%) » → coefficient) : la valeur rendue, comme `emptyValue`, est celle
   * transmise à `onValueChange` et `onValueCommit`. `null` garde le brouillon visible en erreur.
   */
  parseValue?: (raw: string) => number | null;
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
    parseValue = parseDecimalDraft,
    ...inputProps
  },
  ref,
) {
  const [draftValue, setDraftValue] = useState<string | null>(null);

  const resolve = (raw: string): number | null => {
    return raw.trim() === "" ? emptyValue ?? 0 : parseValue(raw);
  };
  const invalid = draftValue !== null && resolve(draftValue) === null;

  return (
    <input
      {...inputProps}
      ref={ref}
      type="text"
      inputMode="decimal"
      value={draftValue ?? formatDecimalInput(value)}
      aria-invalid={invalid || inputProps["aria-invalid"]}
      title={invalid ? NUMERIC_INPUT_ERROR : inputProps.title}
      onFocus={(event) => {
        setDraftValue(event.currentTarget.value);
        onFocus?.(event);
      }}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        setDraftValue(nextValue);
        const parsed = resolve(nextValue);
        event.currentTarget.setCustomValidity(parsed === null ? NUMERIC_INPUT_ERROR : "");
      }}
      onBlur={(event) => {
        const nextValue = event.currentTarget.value;
        onBlur?.(event);
        const parsed = resolve(nextValue);
        if (parsed === null) {
          event.currentTarget.setCustomValidity(NUMERIC_INPUT_ERROR);
          event.currentTarget.reportValidity();
          return;
        }
        setDraftValue(null);
        onValueChange(parsed);
        onValueCommit(parsed);
      }}
    />
  );
});
