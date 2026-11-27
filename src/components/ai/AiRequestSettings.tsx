"use client";

import { useId, type ReactNode } from "react";

import { ReasoningEffortSelect } from "@/components/ai/ReasoningEffortSelect";
import { FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import type { AiBillingSource } from "@/lib/ai/access/contracts";
import { formatUsdCeiling } from "@/lib/ai/access/openai-pricing";
import { supportsReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";
import {
  AI_REQUEST_PROFILE_UNREADABLE, AI_REQUEST_SOURCE_LABELS, aiRequestKeyCeilingMessage, defaultAiRequestSettings,
  type AiRequestSettingsValue, type AiRequestSource, type AiRequestSourceOptions,
} from "@/lib/ai/request-settings";

type Props = Readonly<{
  id?: string;
  sources: AiRequestSourceOptions;
  defaultSource: AiBillingSource | null;
  value?: AiRequestSettingsValue;
  onChange: (value: AiRequestSettingsValue) => void;
  sourcePicker?: { label: ReactNode; rulesOnlyLabel?: string };
  fields?: "all" | "source" | "model";
  modelLabel?: string;
  fieldsClassName?: string;
  locked?: boolean;
  effortFallback?: "automatic" | "model_default";
  keyCeiling?: { nanoUsd: number; message?: (ceiling: string) => string };
  messageId?: string;
}>;

/** The options come from the server. Changes only apply to the current screen's requests. */
export function AiRequestSettings({
  id, sources, defaultSource, value = defaultAiRequestSettings(defaultSource, sources), onChange, sourcePicker, fields = "all",
  modelLabel = "Modèle", fieldsClassName = "flex flex-wrap items-end gap-3", locked = false,
  effortFallback = "model_default", keyCeiling, messageId,
}: Props) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const infoId = messageId ?? `${selectId}-source-info`;
  const { source, preferences } = value;
  const option = source ? sources[source] : undefined;
  const models = option?.available ? option.models : undefined;
  const selectedModel = models?.find((model) => model.id === preferences?.model);
  const defaultOption = defaultSource ? sources[defaultSource] : undefined;
  const defaultMessage = defaultSource === null ? AI_REQUEST_PROFILE_UNREADABLE
    : !defaultOption?.available ? `Source par défaut indisponible : ${defaultOption?.message ?? "Choisissez une source disponible."}` : null;
  const ceiling = keyCeiling && source === "personal_api_key" && option?.available
    ? formatUsdCeiling(keyCeiling.nanoUsd) : null;
  const message = ceiling
    ? (keyCeiling?.message ?? aiRequestKeyCeilingMessage)(ceiling)
    : option?.message ?? defaultMessage;
  const effort = selectedModel && preferences && supportsReasoningEffort(selectedModel, preferences.reasoningEffort)
    ? preferences.reasoningEffort : effortFallback === "automatic" ? null : selectedModel?.defaultReasoningEffort ?? null;

  return (
    <div className="space-y-1.5">
      <div className={fieldsClassName}>
        {fields !== "model" && sourcePicker ? (
          <div className="min-w-0 space-y-1.5">
            <FieldLabel htmlFor={selectId} className="inline-flex items-center gap-1">{sourcePicker.label}</FieldLabel>
            <NativeSelect id={selectId} value={source ?? ""} disabled={locked}
              aria-describedby={message ? infoId : undefined}
              onChange={(event) => {
                if (locked) return;
                const next = (event.currentTarget.value || null) as AiRequestSource | null;
                const choice = next ? sources[next] : undefined;
                if (next && !choice?.available) return;
                onChange({ source: next, preferences: choice?.preferences ?? null });
              }}>
              <option value="" disabled={!sourcePicker.rulesOnlyLabel}>{sourcePicker.rulesOnlyLabel ?? "Choisir une source"}</option>
              {(Object.keys(sources) as AiRequestSource[]).map((id) => (
                <option key={id} value={id} disabled={!sources[id]?.available}>
                  {AI_REQUEST_SOURCE_LABELS[id]}{sources[id]?.available ? "" : " (indisponible)"}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        {fields !== "source" && models && preferences ? (
          <>
            <div className="min-w-0 space-y-1.5">
              <FieldLabel htmlFor={`${selectId}-model`}>{modelLabel}</FieldLabel>
              <NativeSelect id={`${selectId}-model`} value={selectedModel?.id ?? ""} disabled={locked}
                onChange={(event) => {
                  const model = models.find((entry) => entry.id === event.currentTarget.value);
                  if (locked || !model) return;
                  const reasoningEffort = supportsReasoningEffort(model, effort) ? effort
                    : effortFallback === "automatic" ? null : model.defaultReasoningEffort;
                  onChange({ source, preferences: { model: model.id, reasoningEffort } });
                }}>
                {!selectedModel ? <option value="" disabled>Choisir un modèle</option> : null}
                {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
              </NativeSelect>
            </div>
            <ReasoningEffortSelect id={`${selectId}-effort`} efforts={selectedModel?.reasoningEfforts ?? []}
              value={effort} disabled={locked || !selectedModel}
              onChange={(reasoningEffort) => {
                if (!locked) onChange({ source, preferences: { ...preferences, reasoningEffort } });
              }} />
          </>
        ) : null}
      </div>
      {message && fields !== "model" ? <p id={infoId} className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
