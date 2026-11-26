"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { readTakeoffPaymentOptionsAction } from "@/app/dashboard/affaires/_actions/takeoff";
import { useOptionalUserContext } from "@/lib/auth/user-context";
import { defaultAiRequestSettings, type AiRequestSettingsValue, type AiRequestSourceOptions } from "@/lib/ai/request-settings";
import type { ChatGptPreferences } from "@/lib/ai/chatgpt-model-preferences";
import type { TakeoffPaymentChoice } from "@/lib/takeoff/payment-choice";

type Result = Awaited<ReturnType<typeof readTakeoffPaymentOptionsAction>>;
type Options = Extract<Result, { ok: true }>["data"];

const READ_FAILED = "Les réglages IA du métré n’ont pas pu être lus.";
const PLAN_STILL_LAUNCHES = "Vous pouvez lancer avec votre forfait ChatGPT et le réglage de Mon profil, ou recharger les réglages pour en changer.";
const KEY_NEEDS_SETTINGS = "Votre source IA par défaut est votre clé API OpenAI : rechargez les réglages avant de lancer. Rien n’est lancé avec votre forfait à sa place.";
const CHOICE_NEEDS_SETTINGS = "Rechargez les réglages avant de lancer.";
const DEFAULT_SOURCE_NAMES = { chatgpt_plan: "votre forfait ChatGPT", personal_api_key: "votre clé API OpenAI" } as const;

/**
 * The sources a gesture's selector offers. An untouched plan pins the profile's setting as it is, even when the catalogue
 * the server holds no longer lists its model: that model is then added to the plan's, named as absent from the catalogue,
 * so the selector shows what the request will use (never the catalogue's default in its place). `unlisted` names it.
 */
export function shownTakeoffPaymentSources(sources: AiRequestSourceOptions, pinned: ChatGptPreferences | null):
  { sources: AiRequestSourceOptions; unlisted: string | null } {
  const plan = sources.chatgpt_plan;
  if (!pinned || !plan?.models || plan.models.some((model) => model.id === pinned.model)) return { sources, unlisted: null };
  return { unlisted: pinned.model, sources: { ...sources, chatgpt_plan: { ...plan, models: [...plan.models,
    { id: pinned.model, name: `${pinned.model} (absent du catalogue)`, defaultReasoningEffort: pinned.reasoningEffort,
      reasoningEfforts: pinned.reasoningEffort ? [pinned.reasoningEffort] : [] }] } } };
}

/**
 * Keep each gesture's overrides with the options and connection the member saw.
 *
 * A member whose profile pays with the ChatGPT plan launches without waiting for these options, and still launches when
 * they cannot be read: the request then carries no choice, as before the settings existed. The profile's payer comes
 * with the page; the options, once read, are the current value. A profile on the key waits for its options and stays
 * blocked without them: nothing falls back to the plan. `explicitRequired`: the server asked for a choice on this
 * gesture, so even an untouched plan is sent as one.
 */
export function useTakeoffPaymentSettings(projectId: string, request: string | null, explicitRequired = false) {
  const user = useOptionalUserContext();
  const scope = request === null ? null : JSON.stringify([user?.tenantId, user?.profile?.id, projectId, request]);
  const [attempt, setAttempt] = useState({ count: 0, live: false });
  const readKey = scope === null ? null : `${scope}:${attempt.count}`;
  const [read, setRead] = useState<{ key: string; result: Result | null }>();
  const [override, setOverride] = useState<{ key: string; value: AiRequestSettingsValue }>();
  /** `live` reads the plan's models from ChatGPT again; an opening reads the catalogue the server already holds. */
  const reload = useCallback((options?: { live?: boolean }) => {
    setAttempt((value) => ({ count: value.count + 1, live: options?.live === true }));
  }, []);
  const live = attempt.live;

  useEffect(() => {
    if (readKey === null) return;
    let current = true;
    async function load() {
      try {
        const result = await readTakeoffPaymentOptionsAction(live ? { projectId, live } : { projectId });
        if (current) setRead({ key: readKey!, result });
      } catch {
        if (current) setRead({ key: readKey!, result: null });
      }
    }
    void load();
    return () => { current = false; };
  }, [projectId, readKey, live]);

  const current = readKey !== null && read?.key === readKey ? read : null;
  const loading = readKey !== null && !current;
  const data: Options | null = current?.result?.ok ? current.result.data : null;
  // Only a payer is offered a choice: anyone else launches as before, whatever their profile says.
  const notPayer = current?.result?.ok === false && current.result.error.status === 403;
  const failed = Boolean(current) && !data && !notPayer;
  const profileSource = data ? data.defaultSource : user?.aiDefaultSource;
  const planByDefault = profileSource === "chatgpt_plan";
  const sources: AiRequestSourceOptions = {};
  for (const source of ["chatgpt_plan", "personal_api_key"] as const) {
    const option = data?.options[source];
    if (!option) continue;
    const available = option.ok && Boolean(source === "chatgpt_plan" ? data?.chatGptConnectionId : option.connection?.id);
    sources[source] = available ? { available, message: option.message, models: option.models, preferences: option.preferences }
      : { available: false, message: option.ok ? "Vérifiez la connexion dans Mon profil." : option.message };
  }
  const planSetting = data?.planSetting ?? null;
  const changed = readKey !== null && override?.key === readKey;
  const defaults = data ? defaultAiRequestSettings(data.defaultSource, sources) : null;
  // Without options, the labels still name the payer of Mon profil; no setting is chosen for it.
  const source = changed ? override.value.source : defaults ? defaults.source
    : readKey !== null && !notPayer ? profileSource ?? null : null;
  const preferences = changed ? override.value.preferences : defaults?.preferences ?? null;
  const value = useMemo<AiRequestSettingsValue>(() => ({ source, preferences }), [source, preferences]);
  const legacyPlan = data?.defaultSource === "chatgpt_plan" && !changed && !preferences;
  const option = source === "personal_api_key" ? data?.options[source] : undefined;
  const expectedConnectionId = source === "chatgpt_plan" ? data?.chatGptConnectionId : option?.ok ? option.connection?.id : null;
  const explicitChoice = useMemo<TakeoffPaymentChoice | undefined>(() =>
    data && (source === "chatgpt_plan" || source === "personal_api_key") && preferences && expectedConnectionId
      ? { source, model: preferences.model, effort: preferences.reasoningEffort, expectedConnectionId,
        ...(source === "personal_api_key" && { expectedMaxCostCents: data.maxCostCents }) }
      : undefined, [data, source, preferences, expectedConnectionId]);
  const choice = changed || source === "personal_api_key" || explicitRequired ? explicitChoice : undefined;
  const ready = explicitRequired ? Boolean(explicitChoice)
    : data ? Boolean(explicitChoice) || legacyPlan
      : readKey === null || notPayer || planByDefault;
  // An untouched plan is sent without a choice and pins the profile's setting as it is: the selector shows that one, even
  // when the catalogue the server holds no longer lists its model (never that catalogue's default in its place).
  const pinned = !choice && !changed && source === "chatgpt_plan" ? planSetting : null;
  const shown: AiRequestSettingsValue = pinned ? { source, preferences: pinned } : value;
  // The page rendered with one payer of Mon profil and the options name another: the gesture's label just changed.
  const pageSource = user?.aiDefaultSource;
  const defaultChanged = data?.defaultSource && pageSource && data.defaultSource !== pageSource && !changed ? data.defaultSource : null;
  const refusal = current?.result && !current.result.ok ? current.result.error.message : null;
  const message = failed ? refusal ?? READ_FAILED : null;
  const consequence = ready ? PLAN_STILL_LAUNCHES : profileSource === "personal_api_key" ? KEY_NEEDS_SETTINGS : CHOICE_NEEDS_SETTINGS;
  return {
    data, sources, value, shown, pinned: Boolean(pinned), choice, explicitChoice, ready, loading, reload,
    /** The profile's setting an untouched plan pins, as the request will use it (`shownTakeoffPaymentSources`). */
    pinnedSetting: pinned,
    /** The options name another payer than the page rendered with: the gesture's label changed under the member. */
    defaultSourceChanged: defaultChanged ? `Votre source par défaut a changé : c’est maintenant ${DEFAULT_SOURCE_NAMES[defaultChanged]}.` : null,
    /** The options could not be read and this gesture needs them: it stays blocked. */
    error: message && !ready ? `${message} ${consequence}` : null,
    /** The options could not be read; the gesture goes on with the plan, as it does without a choice. */
    notice: message && ready ? `${message} ${consequence}` : null,
    setValue: (next: AiRequestSettingsValue) => { if (readKey !== null) setOverride({ key: readKey, value: next }); },
  };
}

export type TakeoffPaymentSettings = ReturnType<typeof useTakeoffPaymentSettings>;
