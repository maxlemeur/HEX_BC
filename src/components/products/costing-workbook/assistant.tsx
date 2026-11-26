"use client";

import { createContext, useContext, useId, useRef, useState } from "react";

import { SparklesIcon } from "lucide-react";

import { ReasoningEffortSelect } from "@/components/ai/ReasoningEffortSelect";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import type { ChatGptPreferences, ChatGptReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";
import {
  fetchSuggestionProviders,
  type SuggestionProvider,
  type SuggestionProviders,
} from "@/lib/catalogue/costing-workbook-suggestions-client";
import type {
  CostingWorkbookSuggestionProvidersResponse,
  CostingWorkbookSuggestionsRequest,
  CostingWorkbookSuggestionStatus,
} from "@/lib/catalogue/costing-workbook-suggestions-contract";

/**
 * The AI source the office chose for the import screen's proposals (TI-711): its ChatGPT plan, its own OpenAI
 * API key, or the Decisions API of the server. Without one, proposals come from the rules alone. The model only
 * chooses among candidates the rules found, and nothing it proposes is applied without the office retaining it.
 */

export const SUGGESTION_PROVIDER_LABELS: Record<SuggestionProvider, string> = {
  chatgpt_plan: "Forfait ChatGPT",
  personal_api_key: "Clé API OpenAI",
  decisions: "API Decisions",
};

/** A proposal the office may retain in one go: the rules found it, or the model is at least this sure. */
export const RETAINED_CONFIDENCE = 0.8;

export type WorkbookAssistant = {
  sources: CostingWorkbookSuggestionProvidersResponse | "loading" | "error" | null;
  provider: SuggestionProvider | null;
  preferences: ChatGptPreferences | null;
  requestOptions: Pick<CostingWorkbookSuggestionsRequest, "provider" | "model" | "reasoning_effort">;
  settingsLocked: boolean;
  lockSettings: () => (() => void) | null;
  chooseProvider: (provider: SuggestionProvider | null) => void;
  chooseModel: (model: string) => void;
  chooseEffort: (effort: ChatGptReasoningEffort | null) => void;
  loadProviders: () => void;
};

const NO_ASSISTANT: WorkbookAssistant = {
  sources: null, provider: null, preferences: null, requestOptions: {},
  settingsLocked: false, lockSettings: () => () => undefined,
  chooseProvider: () => undefined, chooseModel: () => undefined, chooseEffort: () => undefined, loadProviders: () => undefined,
};
const WorkbookAssistantContext = createContext<WorkbookAssistant>(NO_ASSISTANT);
export const WorkbookAssistantProvider = WorkbookAssistantContext.Provider;
export const useWorkbookAssistant = () => useContext(WorkbookAssistantContext);

function personalOptions(providers: SuggestionProviders, provider: SuggestionProvider | null) {
  return provider && provider !== "decisions" ? providers[provider] : null;
}

/** The choices last as long as the page. */
export function useWorkbookAssistantState(): WorkbookAssistant {
  const [sources, setSources] = useState<WorkbookAssistant["sources"]>(null);
  const [provider, setProvider] = useState<SuggestionProvider | null>(null);
  const [preferences, setPreferences] = useState<ChatGptPreferences | null>(null);
  const [settingsLocked, setSettingsLocked] = useState(false);
  const settingsLock = useRef(false);
  const providers = typeof sources === "object" ? sources?.providers : undefined;

  function lockSettings() {
    if (settingsLock.current) return null;
    settingsLock.current = true;
    setSettingsLocked(true);
    return () => {
      settingsLock.current = false;
      setSettingsLocked(false);
    };
  }

  function loadProviders() {
    if (settingsLock.current || (sources !== null && sources !== "error")) return;
    setSources("loading");
    void fetchSuggestionProviders().then((answer) => {
      const preferred = answer.defaultProvider ? answer.providers[answer.defaultProvider] : null;
      setProvider(preferred?.available ? answer.defaultProvider : null);
      setPreferences(preferred?.available ? preferred.preferences : null);
      setSources(answer);
    }, () => setSources("error"));
  }

  function chooseProvider(next: SuggestionProvider | null) {
    if (settingsLock.current || !providers || (next && !providers[next].available)) return;
    setProvider(next);
    setPreferences(personalOptions(providers, next)?.preferences ?? null);
  }

  function chooseModel(id: string) {
    if (settingsLock.current || !providers || !preferences) return;
    const model = personalOptions(providers, provider)?.models.find((entry) => entry.id === id);
    if (!model) return;
    const effort = preferences.reasoningEffort;
    setPreferences({
      model: model.id,
      reasoningEffort: effort === null || model.reasoningEfforts.includes(effort) ? effort : model.defaultReasoningEffort,
    });
  }

  function chooseEffort(reasoningEffort: ChatGptReasoningEffort | null) {
    if (!settingsLock.current && preferences) setPreferences({ ...preferences, reasoningEffort });
  }

  const requestOptions = provider ? { provider, ...(preferences && { model: preferences.model, reasoning_effort: preferences.reasoningEffort }) } : {};
  return { sources, provider, preferences, requestOptions, settingsLocked, lockSettings, chooseProvider, chooseModel, chooseEffort, loadProviders };
}

export function confidenceLabel(confidence: number | null) {
  return confidence === null ? "confiance non donnée" : `confiance ${Math.round(confidence * 100)} %`;
}

/** The choice of the AI source, with why a source cannot be chosen here. */
export function AssistantProviderSelect() {
  const selectId = useId();
  const { sources, provider, preferences, settingsLocked, chooseProvider, chooseModel, chooseEffort, loadProviders } = useWorkbookAssistant();
  if (sources === "error") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span role="alert">Les sources d’IA n’ont pas pu être lues. Les propositions suivent les règles seules.</span>
        <Button variant="ghost" size="xs" disabled={settingsLocked} onClick={loadProviders}>Recharger les sources d’IA</Button>
      </div>
    );
  }
  if (sources === null || sources === "loading") {
    return <span role="status" className="text-xs text-muted-foreground">Chargement des sources d’IA…</span>;
  }
  const { providers, defaultProvider } = sources;
  const options = personalOptions(providers, provider);
  const model = options?.models.find((entry) => entry.id === preferences?.model);
  const defaultSource = defaultProvider ? providers[defaultProvider] : null;
  const defaultMessage = defaultSource === null ? "Les préférences de Mon profil n’ont pas pu être lues."
    : !defaultSource.available ? `Source par défaut indisponible : ${defaultSource.message}` : null;
  const message = provider ? providers[provider].message : defaultMessage;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 space-y-1.5">
          <FieldLabel htmlFor={selectId} className="inline-flex items-center gap-1">
            <SparklesIcon className="size-3.5" aria-hidden="true" /> Propositions
          </FieldLabel>
          <NativeSelect
            id={selectId}
            value={provider ?? ""}
            disabled={settingsLocked}
            aria-describedby={message ? `${selectId}-source-info` : undefined}
            onChange={(event) => chooseProvider((event.currentTarget.value || null) as SuggestionProvider | null)}
          >
            <option value="">Règles seules, sans IA</option>
            {(Object.keys(providers) as SuggestionProvider[]).map((id) => (
              <option key={id} value={id} disabled={!providers[id].available}>
                {`${SUGGESTION_PROVIDER_LABELS[id]}${providers[id].available ? "" : " (indisponible)"}`}
              </option>
            ))}
          </NativeSelect>
        </div>
        {options && preferences ? (
          <>
            <div className="min-w-0 space-y-1.5">
              <FieldLabel htmlFor={`${selectId}-model`}>Modèle</FieldLabel>
              <NativeSelect id={`${selectId}-model`} value={preferences.model} disabled={settingsLocked}
                onChange={(event) => chooseModel(event.currentTarget.value)}>
                {options.models.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </NativeSelect>
            </div>
            <ReasoningEffortSelect id={`${selectId}-effort`} efforts={model?.reasoningEfforts ?? []}
              value={preferences.reasoningEffort} disabled={settingsLocked || !model} onChange={chooseEffort} />
          </>
        ) : null}
      </div>
      {message ? <p id={`${selectId}-source-info`} className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}

const STATUS_TONE: Record<CostingWorkbookSuggestionStatus, string> = {
  deterministic: "text-muted-foreground",
  available: "text-muted-foreground",
  partial: "text-warning",
  unavailable: "text-warning",
  failed: "text-danger",
};

/** What the last request answered, in the provider's own words. */
export function SuggestionStatus({ status, message }: Readonly<{ status: CostingWorkbookSuggestionStatus; message: string }>) {
  if (!message) return null;
  return <p role={status === "failed" ? "alert" : "status"} className={`text-xs ${STATUS_TONE[status]}`}>{message}</p>;
}

/** The button that asks for proposals: by the rules alone, or arbitrated by the source chosen. */
export function SuggestButton({ label, withAi, loading, disabled, onClick }: Readonly<{
  label: string;
  /** Said on the button when a source is chosen: the request is then billed or counted by it. */
  withAi: boolean;
  loading: boolean;
  disabled?: boolean;
  onClick: () => void;
}>) {
  const { provider, sources } = useWorkbookAssistant();
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={loading}
      disabled={disabled || (withAi && sources === "loading")}
      leftIcon={<SparklesIcon aria-hidden="true" />}
      title={withAi && provider ? `Arbitré par ${SUGGESTION_PROVIDER_LABELS[provider]} : rien n’est appliqué sans votre accord` : undefined}
      onClick={onClick}
    >
      {withAi && provider ? `${label} avec l’IA` : label}
    </Button>
  );
}
