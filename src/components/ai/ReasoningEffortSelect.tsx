"use client";

import type { ReactNode } from "react";

import { FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { CHATGPT_REASONING_EFFORT_LABELS, type ChatGptReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";

export function ReasoningEffortSelect({ id, efforts, value, disabled, onChange, label = "Effort de raisonnement", help }: Readonly<{
  id: string;
  label?: string;
  help?: ReactNode;
  efforts: readonly ChatGptReasoningEffort[];
  value: ChatGptReasoningEffort | null;
  disabled: boolean;
  onChange: (effort: ChatGptReasoningEffort | null) => void;
}>) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {help}
      </div>
      <NativeSelect id={id} value={value ?? "auto"} disabled={disabled || efforts.length === 0}
        onChange={(event) => onChange(efforts.find((effort) => effort === event.target.value) ?? null)}>
        <option value="auto">Automatique</option>
        {value !== null && !efforts.includes(value) ? <option value={value} disabled>{CHATGPT_REASONING_EFFORT_LABELS[value]} · sélection actuelle</option> : null}
        {efforts.map((effort) => <option key={effort} value={effort}>{CHATGPT_REASONING_EFFORT_LABELS[effort]}</option>)}
      </NativeSelect>
    </div>
  );
}
