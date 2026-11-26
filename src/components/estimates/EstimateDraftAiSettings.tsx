"use client";

import { useEffect, useState } from "react";

import { loadEstimateDraftAiOptions } from "@/app/dashboard/estimates/_actions/draft-ai-settings";
import { AiRequestSettings } from "@/components/ai/AiRequestSettings";
import { Alert } from "@/components/ui/alert";
import { AI_REQUEST_CEILINGS_NANO_USD } from "@/lib/ai/request-ceilings";
import { defaultAiRequestSettings, type AiRequestSettingsValue } from "@/lib/ai/request-settings";
import type { EstimateDraftAiRequest } from "@/lib/estimates/schemas";

type Options = Awaited<ReturnType<typeof loadEstimateDraftAiOptions>>;

export function useEstimateDraftAiSettings(versionId: string, enabled: boolean) {
  const [loaded, setLoaded] = useState<{ versionId: string; data: Options | null }>();
  const [choice, setChoice] = useState<{ versionId: string; value: AiRequestSettingsValue }>();
  useEffect(() => {
    if (!enabled) {
      setLoaded(undefined);
      setChoice(undefined);
      return;
    }
    let active = true;
    void loadEstimateDraftAiOptions(versionId).then(
      (data) => { if (active) setLoaded({ versionId, data }); },
      () => { if (active) setLoaded({ versionId, data: null }); },
    );
    return () => { active = false; };
  }, [enabled, versionId]);

  const options = enabled && loaded?.versionId === versionId ? loaded.data : undefined;
  const value = options
    ? (choice?.versionId === versionId ? choice.value : defaultAiRequestSettings(options.defaultSource, options.sources))
    : undefined;
  let request: EstimateDraftAiRequest | null = null;
  if (value?.preferences) {
    const { source, preferences: { model, reasoningEffort: effort } } = value;
    if (source === "chatgpt_plan") request = { source, model, effort };
    if (source === "personal_api_key" && options?.keyConnectionId) {
      request = { source, model, effort, expectedConnectionId: options.keyConnectionId };
    }
  }

  return {
    options, value, request,
    setValue: (value: AiRequestSettingsValue) => setChoice({ versionId, value }),
  };
}

export function EstimateDraftAiSettings({ settings, locked = false }: {
  settings: ReturnType<typeof useEstimateDraftAiSettings>;
  locked?: boolean;
}) {
  const { options, value, setValue } = settings;
  if (options === null) {
    return <Alert variant="danger">Impossible de charger les réglages IA. Rouvrez la fenêtre pour réessayer.</Alert>;
  }
  if (!options) {
    return <p role="status" className="text-sm text-muted-foreground">Chargement des réglages IA…</p>;
  }
  return (
    <AiRequestSettings
      sources={options.sources}
      defaultSource={options.defaultSource}
      value={value}
      onChange={setValue}
      sourcePicker={{ label: "Source d’IA" }}
      keyCeiling={{ nanoUsd: AI_REQUEST_CEILINGS_NANO_USD.generationOrDocument }}
      locked={locked}
    />
  );
}
