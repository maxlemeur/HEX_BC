"use client";

import { useId, useState } from "react";

import { chooseChatGptPreferences } from "@/app/dashboard/_actions/chatgpt";
import { aiAccessApi, aiAccessErrorMessage } from "@/components/ai/ai-access-api";
import type { ChatGptAnalysisOptions } from "@/components/ai/ChatGptConnectionCard";
import { ReasoningEffortSelect } from "@/components/ai/ReasoningEffortSelect";
import { PageSection } from "@/components/layout/page-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { InfoPopover } from "@/components/ui/info-popover";
import { NativeSelect } from "@/components/ui/native-select";
import {
  AI_ANALYSIS_USAGES, DEFAULT_AI_ANALYSIS_PREFERENCES,
  type AiAnalysisPreferences, type AiAnalysisUsage, type AiBillingSource, type ApiKeyAccessState,
} from "@/lib/ai/access/contracts";
import { chatGptDefaultPreferences, RETIRED_OPENAI_MODEL, type ChatGptAvailableModel, type ChatGptPreferences } from "@/lib/ai/chatgpt-model-preferences";

function applyModel(model: ChatGptAvailableModel, previous: ChatGptPreferences | null): ChatGptPreferences {
  const effort = previous?.reasoningEffort;
  return { model: model.id, reasoningEffort: effort === undefined ? model.defaultReasoningEffort
    : effort !== null && !model.reasoningEfforts.includes(effort) ? null : effort };
}

export function AiAnalysisPreferencesCard({ keyState, chatgpt, onKeyStateChange, onChatGptChange }: Readonly<{
  keyState: ApiKeyAccessState | null;
  chatgpt: ChatGptAnalysisOptions | null;
  onKeyStateChange: (state: ApiKeyAccessState) => void;
  onChatGptChange: (options: ChatGptAnalysisOptions) => void;
}>) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const settings = keyState?.analysisPreferences ?? DEFAULT_AI_ANALYSIS_PREFERENCES;
  const canSaveKeySettings = keyState !== null && keyState.status !== "unavailable";
  const source = settings.billingSource;
  const keyConnection = keyState?.status === "saved" ? keyState.connection : null;
  const keyModels = keyConnection?.offeredModels ?? [];
  const keyDefault = keyModels.find((model) => model.id === settings.apiModel) ?? (settings.apiModel === null ? keyModels[0] : undefined);
  const apiPreferences = keyDefault ? {
    model: keyDefault.id,
    reasoningEffort: settings.apiReasoningEffort === undefined ? keyDefault.defaultReasoningEffort : settings.apiReasoningEffort,
  } : null;
  const models = source === "chatgpt_plan" ? chatgpt?.models ?? [] : keyModels;
  const saved = source === "chatgpt_plan" ? chatgpt?.preferences ?? null : apiPreferences;
  const preferences = saved?.model === RETIRED_OPENAI_MODEL ? null : saved;
  const selectedModel = models.find((model) => model.id === preferences?.model);
  const originalPlan = source === "chatgpt_plan" ? chatGptDefaultPreferences(models) : null;
  const canRestore = originalPlan && (originalPlan.model !== preferences?.model || originalPlan.reasoningEffort !== preferences?.reasoningEffort);

  async function run(effect: () => Promise<void>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await effect();
      setMessage(success);
    } catch (cause) {
      setError(aiAccessErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function persist(next: AiAnalysisPreferences) {
    onKeyStateChange(await aiAccessApi.saveAnalysisPreferences(next, keyConnection?.connectionId ?? null));
  }

  function changeSource(next: AiBillingSource) {
    const proposedModel = keyDefault ?? keyModels[0];
    const nextSettings = next === "personal_api_key" && proposedModel ? {
      ...settings, billingSource: next, apiModel: proposedModel.id,
      apiReasoningEffort: settings.apiModel === proposedModel.id ? settings.apiReasoningEffort : proposedModel.defaultReasoningEffort,
    } : { ...settings, billingSource: next };
    void run(() => persist(nextSettings), "Source IA enregistrée.");
  }

  function changeDefault(next: ChatGptPreferences, label: string) {
    void run(async () => {
      if (source === "chatgpt_plan" && chatgpt) {
        const saved = await chooseChatGptPreferences(next);
        onChatGptChange({ ...chatgpt, preferences: { model: saved.model, reasoningEffort: saved.reasoningEffort } });
      } else {
        await persist({ ...settings, apiModel: next.model, apiReasoningEffort: next.reasoningEffort });
      }
    }, label);
  }

  function changeUsage(usage: AiAnalysisUsage, next: ChatGptPreferences | undefined) {
    const overrides = { ...settings.overrides, [usage]: { ...settings.overrides?.[usage], [source]: next } };
    void run(() => persist({ ...settings, overrides }), "Réglage par usage enregistré.");
  }

  const modelLabel = source === "chatgpt_plan" ? "Modèle ChatGPT" : "Modèle OpenAI";
  return (
    <div className="space-y-5">
      <PageSection variant="plain" headingLevel={3} title="Réglages IA par défaut"
        description="Le choix de la source s’applique aux analyses photo et aux configurations compatibles du labo métré.">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="min-w-0 space-y-1.5">
            <FieldLabel htmlFor={`${id}-source`}>Source</FieldLabel>
            <NativeSelect id={`${id}-source`} value={source} disabled={busy || !canSaveKeySettings}
              onChange={(event) => changeSource(event.target.value === "personal_api_key" ? "personal_api_key" : "chatgpt_plan")}>
              <option value="chatgpt_plan">Mon abonnement ChatGPT</option>
              <option value="personal_api_key" disabled={keyModels.length === 0}>Ma clé API OpenAI</option>
            </NativeSelect>
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor={`${id}-model`}>{modelLabel}</FieldLabel>
              {source === "chatgpt_plan" ? <InfoPopover label="À propos du modèle ChatGPT" title="Modèle ChatGPT">
                <p>Le modèle est enregistré pour le compte ChatGPT actif.</p>
              </InfoPopover> : null}
            </div>
            <NativeSelect id={`${id}-model`} value={preferences?.model ?? ""} disabled={busy || models.length === 0}
              onChange={(event) => {
                const model = models.find((item) => item.id === event.target.value);
                if (!model) return;
                const next = applyModel(model, preferences);
                const effortReset = preferences?.reasoningEffort != null && next.reasoningEffort === null;
                changeDefault(next, effortReset ? "Modèle enregistré. L’effort est revenu sur Automatique car le niveau précédent n’est pas proposé pour ce modèle."
                  : source === "chatgpt_plan" ? "Préférences ChatGPT enregistrées." : "Réglages IA enregistrés.");
              }}>
              <option value="" disabled>Choisir un modèle</option>
              {preferences && !selectedModel ? <option value={preferences.model}>{preferences.model} · sélection actuelle</option> : null}
              {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </NativeSelect>
          </div>
          <ReasoningEffortSelect id={`${id}-effort`} efforts={selectedModel?.reasoningEfforts ?? []}
            value={preferences?.reasoningEffort ?? null} disabled={busy}
            help={source === "chatgpt_plan" ? <InfoPopover label="À propos de l’effort de raisonnement" title="Effort de raisonnement">
              <p>Automatique reprend le niveau choisi par le modèle. Un niveau plus élevé peut allonger la réponse.</p>
            </InfoPopover> : undefined}
            onChange={(reasoningEffort) => {
              if (selectedModel) changeDefault({ model: selectedModel.id, reasoningEffort },
                source === "chatgpt_plan" ? "Préférences ChatGPT enregistrées." : "Réglages IA enregistrés.");
            }} />
        </div>
        {canRestore && originalPlan ? (
          <Button className="mt-3" type="button" variant="outline" disabled={busy}
            onClick={() => changeDefault(originalPlan, "Réglages par défaut rétablis.")}>Rétablir les réglages par défaut</Button>
        ) : null}
        {!selectedModel ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {models.length > 0 ? "Choisissez un modèle disponible."
              : source === "chatgpt_plan" ? "Connectez votre abonnement ChatGPT pour choisir ses modèles."
                : "Ajoutez ou actualisez la clé API pour choisir un modèle disponible."}
          </p>
        ) : null}
      </PageSection>

      <PageSection variant="plain" headingLevel={3} title="Par usage">
        <div className="space-y-3">
          {(Object.keys(AI_ANALYSIS_USAGES) as AiAnalysisUsage[]).map((usage) => {
            const label = AI_ANALYSIS_USAGES[usage];
            const savedOverride = settings.overrides?.[usage]?.[source];
            const override = savedOverride?.model === RETIRED_OPENAI_MODEL ? undefined : savedOverride;
            const model = models.find((entry) => entry.id === override?.model);
            return (
              <div key={usage} className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <FieldLabel htmlFor={`${id}-${usage}`}>{label}</FieldLabel>
                  <NativeSelect id={`${id}-${usage}`} value={override?.model ?? ""} disabled={busy || !canSaveKeySettings || (!override && models.length === 0)}
                    onChange={(event) => {
                      const choice = models.find((entry) => entry.id === event.target.value);
                      changeUsage(usage, choice ? applyModel(choice, override ?? preferences) : undefined);
                    }}>
                    <option value="">Hériter des réglages par défaut</option>
                    {override && !model ? <option value={override.model}>{override.model} · indisponible</option> : null}
                    {models.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                  </NativeSelect>
                </div>
                {override && model ? (
                  <ReasoningEffortSelect id={`${id}-effort-${usage}`} label={`Effort de raisonnement · ${label}`}
                    efforts={model.reasoningEfforts} value={override.reasoningEffort} disabled={busy || !canSaveKeySettings}
                    onChange={(reasoningEffort) => changeUsage(usage, { model: model.id, reasoningEffort })} />
                ) : null}
              </div>
            );
          })}
        </div>
      </PageSection>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  );
}
