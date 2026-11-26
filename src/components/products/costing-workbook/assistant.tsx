"use client";

import { createContext, useContext, useRef, useState } from "react";

import { SparklesIcon } from "lucide-react";

import { AiRequestSettings } from "@/components/ai/AiRequestSettings";
import { Button } from "@/components/ui/button";
import { AI_REQUEST_CEILINGS_NANO_USD } from "@/lib/ai/request-ceilings";
import { AI_REQUEST_SOURCE_LABELS, defaultAiRequestSettings, type AiRequestSettingsValue } from "@/lib/ai/request-settings";
import { fetchSuggestionProviders } from "@/lib/catalogue/costing-workbook-suggestions-client";
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

/** A proposal the office may retain in one go: the rules found it, or the model is at least this sure. */
export const RETAINED_CONFIDENCE = 0.8;

export type WorkbookAssistant = {
  sources: CostingWorkbookSuggestionProvidersResponse | "loading" | "error" | null;
  provider: AiRequestSettingsValue["source"];
  selection?: AiRequestSettingsValue;
  requestOptions: Pick<CostingWorkbookSuggestionsRequest, "provider" | "model" | "reasoning_effort">;
  settingsLocked: boolean;
  lockSettings: () => (() => void) | null;
  chooseSettings: (selection: AiRequestSettingsValue) => void;
  loadProviders: () => void;
};

const NO_ASSISTANT: WorkbookAssistant = {
  sources: null, provider: null, requestOptions: {},
  settingsLocked: false, lockSettings: () => () => undefined,
  chooseSettings: () => undefined, loadProviders: () => undefined,
};
const WorkbookAssistantContext = createContext<WorkbookAssistant>(NO_ASSISTANT);
export const WorkbookAssistantProvider = WorkbookAssistantContext.Provider;
export const useWorkbookAssistant = () => useContext(WorkbookAssistantContext);

/** The choices last as long as the page. */
export function useWorkbookAssistantState(): WorkbookAssistant {
  const [sources, setSources] = useState<WorkbookAssistant["sources"]>(null);
  const [selection, setSelection] = useState<AiRequestSettingsValue>();
  const [settingsLocked, setSettingsLocked] = useState(false);
  const settingsLock = useRef(false);
  const loaded = typeof sources === "object" ? sources : null;
  const { source: provider, preferences } = selection ?? defaultAiRequestSettings(loaded?.defaultProvider ?? null, loaded?.providers ?? {});

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
      setSources(answer);
    }, () => setSources("error"));
  }

  function chooseSettings(next: AiRequestSettingsValue) {
    if (!settingsLock.current) setSelection(next);
  }

  const requestOptions = provider ? { provider, ...(preferences && { model: preferences.model, reasoning_effort: preferences.reasoningEffort }) } : {};
  return { sources, provider, selection, requestOptions, settingsLocked, lockSettings, chooseSettings, loadProviders };
}

export function confidenceLabel(confidence: number | null) {
  return confidence === null ? "confiance non donnée" : `confiance ${Math.round(confidence * 100)} %`;
}

/** The choice of the AI source, with why a source cannot be chosen here. */
export function AssistantProviderSelect() {
  const { sources, selection, settingsLocked, chooseSettings, loadProviders } = useWorkbookAssistant();
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
  return (
    <AiRequestSettings sources={sources.providers} defaultSource={sources.defaultProvider} value={selection}
      onChange={chooseSettings} locked={settingsLocked}
      sourcePicker={{
        label: <><SparklesIcon className="size-3.5" aria-hidden="true" /> Propositions</>,
        rulesOnlyLabel: "Règles seules, sans IA",
      }}
      keyCeiling={{ nanoUsd: AI_REQUEST_CEILINGS_NANO_USD.shortQuestion }} />
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
      title={withAi && provider ? `Arbitré par ${AI_REQUEST_SOURCE_LABELS[provider]} : rien n’est appliqué sans votre accord` : undefined}
      onClick={onClick}
    >
      {withAi && provider ? `${label} avec l’IA` : label}
    </Button>
  );
}
