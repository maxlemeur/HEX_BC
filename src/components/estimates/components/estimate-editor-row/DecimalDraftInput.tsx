"use client";

import {
  forwardRef,
  useState,
  useRef,
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
  /** Only a deliberate edit may switch an automatic coefficient to manual. */
  commitOnUnchangedBlur?: boolean;
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
    commitOnUnchangedBlur = true,
    parseValue = parseDecimalDraft,
    ...inputProps
  },
  ref,
) {
  const edited = useRef(false);
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
        edited.current = false;
        setDraftValue(event.currentTarget.value);
        onFocus?.(event);
      }}
      onChange={(event) => {
        edited.current = true;
        const nextValue = event.currentTarget.value;
        setDraftValue(nextValue);
        const parsed = resolve(nextValue);
        event.currentTarget.setCustomValidity(parsed === null ? NUMERIC_INPUT_ERROR : "");
      }}
      onBlur={(event) => {
        const nextValue = event.currentTarget.value;
        onBlur?.(event);
        if (!commitOnUnchangedBlur && !edited.current) {
          setDraftValue(null);
          return;
        }
        const parsed = resolve(nextValue);
        if (parsed === null) {
          event.currentTarget.setCustomValidity(NUMERIC_INPUT_ERROR);
          // Leave the invalid draft visible without stealing focus from the next control.
          return;
        }
        event.currentTarget.setCustomValidity("");
        setDraftValue(null);
        onValueChange(parsed);
        onValueCommit(parsed);
      }}
    />
  );
});
