"use client";

import { ReasoningEffortSelect } from "@/components/ai/ReasoningEffortSelect";
import { FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import type { ChatGptAvailableModel, ChatGptPreferences } from "@/lib/ai/chatgpt-model-preferences";

export function MaterialRequestAnalysisPreferences({ id, models, preferences, disabled, onChange }: Readonly<{
  id: string;
  models: readonly ChatGptAvailableModel[];
  preferences: ChatGptPreferences;
  disabled: boolean;
  onChange: (preferences: ChatGptPreferences) => void;
}>) {
  const selectedModel = models.find((model) => model.id === preferences.model);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-1.5">
        <FieldLabel htmlFor={`${id}-model`}>Modèle d’analyse</FieldLabel>
        <NativeSelect id={`${id}-model`} value={preferences.model} disabled={disabled}
          onChange={(event) => {
            const next = models.find((model) => model.id === event.target.value);
            if (!next) return;
            const effort = preferences.reasoningEffort;
            onChange({
              model: next.id,
              reasoningEffort: effort !== null && next.reasoningEfforts.includes(effort) ? effort : null,
            });
          }}>
          {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </NativeSelect>
      </div>
      <ReasoningEffortSelect id={`${id}-effort`} efforts={selectedModel?.reasoningEfforts ?? []}
        value={preferences.reasoningEffort} disabled={disabled}
        onChange={(reasoningEffort) => onChange({ ...preferences, reasoningEffort })} />
    </div>
  );
}
