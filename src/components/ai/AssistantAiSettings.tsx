"use client";

import Link from "next/link";
import { Check, ChevronDown, Settings, Settings2 } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import useSWR from "swr";
import { z } from "zod";

import { loadAssistantAiOptions } from "@/app/dashboard/_actions/assistant";
import { AiRequestSettings } from "@/components/ai/AiRequestSettings";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { formatUsdCeiling } from "@/lib/ai/access/openai-pricing";
import { CHATGPT_REASONING_EFFORT_LABELS, chatGptReasoningEffortSchema, supportsReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";
import {
  AI_REQUEST_SOURCE_LABELS, defaultAiRequestSettings, type AiRequestSettingsValue, type AiRequestSourceOptions,
} from "@/lib/ai/request-settings";
import { ASSISTANT_KEY_CEILING, type AssistantAiOptions } from "@/lib/assistant/request-settings";

type Settings = {
  owner: { userId: string; tenantId: string };
  choice?: AiRequestSettingsValue;
  choose(value?: AiRequestSettingsValue): void;
  options: AssistantAiOptions | null;
  pending: boolean;
  error: string | null;
  refresh(): void;
};
const SettingsContext = createContext<Settings | null>(null);
export const useAssistantAiSettings = () => useContext(SettingsContext);
const storedChoice = z.object({
  source: z.enum(["chatgpt_plan", "personal_api_key"]),
  preferences: z.object({ model: z.string().min(1).max(120), reasoningEffort: chatGptReasoningEffortSchema.nullable() }),
});

export function AssistantAiSettingsProvider({ userId, tenantId, children }: {
  userId: string; tenantId: string; children: ReactNode;
}) {
  const [choice, setChoice] = useState<AiRequestSettingsValue>();
  const [requested, setRequested] = useState(false);
  const storageKey = "mergeone:assistant:settings:v1:" + userId + ":" + tenantId;
  useEffect(() => {
    try {
      const parsed = storedChoice.safeParse(JSON.parse(sessionStorage.getItem(storageKey) ?? "null"));
      if (parsed.success) setChoice(parsed.data);
    } catch { /* Settings still work in memory. */ }
  }, [storageKey]);
  const choose = useCallback((value?: AiRequestSettingsValue) => {
    setChoice(value);
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch { /* Settings still work in memory. */ }
  }, [storageKey]);
  const { data, error, mutate, isValidating } = useSWR(
    requested ? ["global-assistant-settings", userId, tenantId] : null,
    () => loadAssistantAiOptions(undefined, { userId, tenantId }),
    { revalidateOnFocus: true, shouldRetryOnError: false },
  );
  const settings = useMemo<Settings>(() => ({
    owner: { userId, tenantId }, choice, choose, options: data?.ok ? data.data : null, pending: isValidating,
    error: data?.ok === false ? data.message : error ? "Impossible de charger les sources IA." : null,
    refresh() {
      setRequested(true);
      if (requested) void mutate();
    },
  }), [userId, tenantId, choice, choose, data, isValidating, error, requested, mutate]);
  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>;
}

export function usableAiChoice(choice: AiRequestSettingsValue | undefined, sources: AiRequestSourceOptions) {
  const source = choice?.source ? sources[choice.source] : undefined;
  if (!source?.available || !choice?.preferences) return false;
  const { model, reasoningEffort } = choice.preferences;
  const selected = source.models?.find((entry) => entry.id === model);
  return Boolean(selected && supportsReasoningEffort(selected, reasoningEffort));
}

const NO_CHOICE: AiRequestSettingsValue = { source: null, preferences: null };

/** A source imposed by a workflow stays authoritative. A rejected optional choice requires explicit correction. */
export function effectiveAiChoice(
  common: AiRequestSettingsValue | undefined, fallback: AiRequestSettingsValue, sources: AiRequestSourceOptions, fixed = false,
) {
  if (!common || (fixed && common.source !== fallback.source)) return fallback;
  return usableAiChoice(common, sources) ? common : NO_CHOICE;
}

export type AssistantContextOption = { id: string; label: string; active: boolean; select(): void };

export function AssistantAiSettingsMenu({ scopeChoices, contextOptions, children, locked, onRefresh, keyCeiling = ASSISTANT_KEY_CEILING }: {
  scopeChoices?: { sources: AiRequestSourceOptions; defaultSource: AssistantAiOptions["defaultSource"];
    choice?: AiRequestSettingsValue; onChange(value: AiRequestSettingsValue): void; allowRulesOnly?: boolean };
  contextOptions?: readonly AssistantContextOption[];
  children?: ReactNode;
  locked?: boolean;
  onRefresh?: () => void;
  keyCeiling?: number;
}) {
  const shared = useAssistantAiSettings();
  const [open, setOpen] = useState(false);
  const options = shared?.options;
  const common = shared?.choice ?? (options ? defaultAiRequestSettings(options.defaultSource, options.sources) : undefined);
  const value = scopeChoices ? scopeChoices.choice : common;
  const sources = scopeChoices?.sources ?? options?.sources;
  const defaultSource = scopeChoices ? scopeChoices.defaultSource : options?.defaultSource;
  const onChange = scopeChoices?.onChange ?? shared?.choose;
  const source = value?.source ? sources?.[value.source] : undefined;
  const model = source?.models?.find((entry) => entry.id === value?.preferences?.model);
  const effort = value?.preferences?.reasoningEffort;
  const invalid = Boolean(common?.source && sources && !usableAiChoice(common, sources) && !scopeChoices);
  if (!shared) return null;
  const settingsMenu = (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next && !options && !scopeChoices) shared.refresh();
    }}>
      {contextOptions ? (
        <PopoverTrigger render={<Button type="button" variant="ghost" size="icon" aria-label="Réglages IA"
          className="rounded-full text-(--workbook-composer-text) hover:bg-(--workbook-composer-control) hover:text-(--workbook-composer-text) aria-expanded:bg-(--workbook-composer-control)" />}>
          <Settings className="size-4" aria-hidden="true" />
        </PopoverTrigger>
      ) : (
        <PopoverTrigger render={<Button type="button" variant="outline" size="sm" aria-label="Réglages IA" disabled={locked}
          className="max-w-full rounded-full text-foreground" leftIcon={<Settings2 className="size-4" aria-hidden="true" />} />}>
          <span className="truncate">{children ?? (model ? model.name + (effort ? " · " + CHATGPT_REASONING_EFFORT_LABELS[effort] : "") : "Réglages IA")}</span>
        </PopoverTrigger>
      )}
      <PopoverContent side="top" align="end" sideOffset={8} className="z-[100] max-h-[var(--available-height)] w-[min(29rem,calc(100vw-1rem))] overflow-y-auto border border-border p-4">
        <PopoverTitle>Réglages IA</PopoverTitle>
        {contextOptions ? (
          <fieldset className="space-y-1 border-b border-border pb-2">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">Contexte de l’assistant</legend>
            {contextOptions.map((option) => (
              <Button key={option.id} type="button" variant="ghost" size="sm" aria-pressed={option.active}
                className="w-full justify-between text-left aria-pressed:bg-accent"
                rightIcon={option.active ? <Check className="size-4" aria-hidden="true" /> : undefined}
                onClick={() => { setOpen(false); option.select(); }}>
                {option.label}
              </Button>
            ))}
          </fieldset>
        ) : null}
        {sources && defaultSource !== undefined && onChange ? (
          <AiRequestSettings sources={sources} defaultSource={defaultSource} value={invalid && (!contextOptions || !source?.available) ? NO_CHOICE : value}
            fields={contextOptions ? "source" : "all"}
            onChange={onChange} sourcePicker={{ label: "Source d’IA", ...(scopeChoices?.allowRulesOnly ? { rulesOnlyLabel: "Règles seules" } : {}) }}
            locked={locked} keyCeiling={{ nanoUsd: keyCeiling }} />
        ) : <p role="status" className="text-sm text-muted-foreground">{shared.error ?? "Chargement des sources IA…"}</p>}
        {invalid ? <p role="status" className="text-xs text-muted-foreground">Le réglage choisi est indisponible. Choisissez une source ou un modèle disponible.</p> : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link href="/dashboard/profile#section-cle-api" className="py-2 text-sm font-medium text-primary underline underline-offset-2">Accès IA dans Mon profil</Link>
          {!scopeChoices || onRefresh ? (
            <Button type="button" variant="ghost" size="sm" disabled={locked || (!onRefresh && shared.pending)}
              onClick={onRefresh ?? shared.refresh}>Actualiser les sources d’IA</Button>
          ) : null}
          {!scopeChoices && shared.choice ? <Button type="button" variant="ghost" size="sm" disabled={locked}
            onClick={() => shared.choose()}>Reprendre les préférences du profil</Button> : null}
        </div>
      </PopoverContent>
    </Popover>
  );

  if (!contextOptions) return settingsMenu;
  return (
    <>
      {settingsMenu}
      <Popover>
        <PopoverTrigger render={<Button type="button" variant="outline" size="sm" aria-label="Modèle et effort"
          disabled={locked || !source?.available || !source.models?.length || !value?.preferences}
          className="min-w-0 max-w-full rounded-full border-(--workbook-composer-border) bg-(--workbook-composer-control) text-(--workbook-composer-text) hover:border-(--workbook-composer-muted) hover:bg-(--workbook-composer-control) hover:text-(--workbook-composer-text)"
          rightIcon={<ChevronDown className="size-4" aria-hidden="true" />} />}>
          <span className="truncate">
            {model ? model.name + " · " + (effort ? CHATGPT_REASONING_EFFORT_LABELS[effort] : "Automatique") : "Choisir un modèle"}
          </span>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" sideOffset={8} className="max-w-[calc(100vw-1rem)] border border-border p-4">
          <PopoverTitle>Modèle et effort</PopoverTitle>
          {sources && defaultSource !== undefined && onChange ? (
            <AiRequestSettings sources={sources} defaultSource={defaultSource} value={value}
              fields="model" onChange={onChange} locked={locked} />
          ) : null}
        </PopoverContent>
      </Popover>
    </>
  );
}

type RequestFields = Parameters<typeof AiRequestSettings>[0];

/** Existing dialogs surface the same menu inside their focus boundary. */
export function AssistantAiFeatureSettings({ fixedSource = false, ...fields }: RequestFields & { fixedSource?: boolean }) {
  const shared = useAssistantAiSettings();
  if (!shared) return <AiRequestSettings {...fields} />;
  const value = fields.value ?? defaultAiRequestSettings(fields.defaultSource, fields.sources);
  const selectedModel = value.source ? fields.sources[value.source]?.models?.find(({ id }) => id === value.preferences?.model) : undefined;
  const incompatible = shared.choice?.source && !usableAiChoice(shared.choice, fields.sources);
  const ceiling = value.source === "personal_api_key" && fields.keyCeiling ? formatUsdCeiling(fields.keyCeiling.nanoUsd) : null;
  const scopeChoices = {
    sources: fields.sources, defaultSource: fields.defaultSource, choice: value,
    allowRulesOnly: Boolean(fields.sourcePicker?.rulesOnlyLabel),
    onChange(next: AiRequestSettingsValue) {
      if (next.source && next.source !== "decisions") shared.choose(next);
      fields.onChange(next);
    },
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span role="status" id={fields.messageId ?? fields.id} className="text-xs text-muted-foreground">
        {value.source ? AI_REQUEST_SOURCE_LABELS[value.source] + (selectedModel ? " · " + selectedModel.name : "")
          : incompatible ? "Choisissez une source et un modèle compatibles dans Réglages IA." : "Réglages IA du profil"}
        {fixedSource ? " · Source de cette fonction" : ""}
        {ceiling ? " · " + (fields.keyCeiling?.message?.(ceiling) ?? `${ceiling} au plus par demande`) : ""}
      </span>
      <AssistantAiSettingsMenu keyCeiling={fields.keyCeiling?.nanoUsd} locked={fields.locked} scopeChoices={scopeChoices}>
        Réglages IA
      </AssistantAiSettingsMenu>
    </div>
  );
}
