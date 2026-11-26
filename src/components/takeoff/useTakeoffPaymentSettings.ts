"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { readTakeoffPaymentOptionsAction } from "@/app/dashboard/affaires/_actions/takeoff";
import { useOptionalUserContext } from "@/lib/auth/user-context";
import { defaultAiRequestSettings, type AiRequestSettingsValue, type AiRequestSourceOptions } from "@/lib/ai/request-settings";
import type { TakeoffPaymentChoice } from "@/lib/takeoff/payment-choice";

type Result = Awaited<ReturnType<typeof readTakeoffPaymentOptionsAction>>;
type Options = Extract<Result, { ok: true }>["data"];

/** Keep each gesture's overrides with the options and connection the member saw. */
export function useTakeoffPaymentSettings(projectId: string, request: string | null) {
  const user = useOptionalUserContext();
  const scope = request === null ? null : JSON.stringify([user?.tenantId, user?.profile?.id, projectId, request]);
  const [attempt, setAttempt] = useState(0);
  const readKey = scope === null ? null : `${scope}:${attempt}`;
  const [read, setRead] = useState<{ key: string; result: Result | null }>();
  const [override, setOverride] = useState<{ key: string; value: AiRequestSettingsValue }>();
  const reload = useCallback(() => { setAttempt((value) => value + 1); }, []);

  useEffect(() => {
    if (readKey === null) return;
    let current = true;
    async function load() {
      try {
        const result = await readTakeoffPaymentOptionsAction({ projectId });
        if (current) setRead({ key: readKey!, result });
      } catch {
        if (current) setRead({ key: readKey!, result: null });
      }
    }
    void load();
    return () => { current = false; };
  }, [projectId, readKey]);

  const current = readKey !== null && read?.key === readKey ? read : null;
  const loading = readKey !== null && !current;
  const data: Options | null = current?.result?.ok ? current.result.data : null;
  const error = current
    ? current.result?.ok || current.result?.error.status === 403 ? null
      : current.result?.error.message ?? "Impossible de lire les réglages du métré."
    : null;
  const sources: AiRequestSourceOptions = {};
  for (const source of ["chatgpt_plan", "personal_api_key"] as const) {
    const option = data?.options[source];
    if (!option) continue;
    const available = option.ok && Boolean(source === "chatgpt_plan" ? data?.chatGptConnectionId : option.connection?.id);
    sources[source] = available ? { available, message: option.message, models: option.models, preferences: option.preferences }
      : { available: false, message: option.ok ? "Vérifiez la connexion dans Mon profil." : option.message };
  }
  const changed = readKey !== null && override?.key === readKey;
  const value = changed ? override.value : defaultAiRequestSettings(data?.defaultSource ?? null, sources);
  const { source, preferences } = value;
  const legacyPlan = data?.defaultSource === "chatgpt_plan" && !changed && !preferences;
  const option = source === "personal_api_key" ? data?.options[source] : undefined;
  const expectedConnectionId = source === "chatgpt_plan" ? data?.chatGptConnectionId : option?.ok ? option.connection?.id : null;
  const explicitChoice = useMemo<TakeoffPaymentChoice | undefined>(() =>
    data && (source === "chatgpt_plan" || source === "personal_api_key") && preferences && expectedConnectionId
      ? { source, model: preferences.model, effort: preferences.reasoningEffort, expectedConnectionId,
        ...(source === "personal_api_key" && { expectedMaxCostCents: data.maxCostCents }) }
      : undefined, [data, source, preferences, expectedConnectionId]);
  const choice = changed || source === "personal_api_key" ? explicitChoice : undefined;
  const ready = !loading && !error && (!data || Boolean(explicitChoice) || legacyPlan);
  return {
    data, sources, value, choice, explicitChoice, ready, loading, error, reload,
    setValue: (next: AiRequestSettingsValue) => { if (readKey !== null) setOverride({ key: readKey, value: next }); },
  };
}

export type TakeoffPaymentSettings = ReturnType<typeof useTakeoffPaymentSettings>;
