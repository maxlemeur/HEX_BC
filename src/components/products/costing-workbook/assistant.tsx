"use client";

import { createContext, useContext, useId, useState } from "react";

import { SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  fetchSuggestionProviders,
  type SuggestionProvider,
  type SuggestionProviders,
} from "@/lib/catalogue/costing-workbook-suggestions-client";
import type { CostingWorkbookSuggestionStatus } from "@/lib/catalogue/costing-workbook-suggestions-contract";

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
  /**
   * null until the office asks for them; "loading"; "error" when the sources could not be read (proposals then
   * come from the rules alone).
   */
  providers: SuggestionProviders | "loading" | "error" | null;
  provider: SuggestionProvider | null;
  chooseProvider: (provider: SuggestionProvider | null) => void;
  /** Reads which sources this member can ask here; no provider is called. */
  loadProviders: () => void;
};

const NO_ASSISTANT: WorkbookAssistant = {
  providers: null, provider: null, chooseProvider: () => undefined, loadProviders: () => undefined,
};
const WorkbookAssistantContext = createContext<WorkbookAssistant>(NO_ASSISTANT);
export const WorkbookAssistantProvider = WorkbookAssistantContext.Provider;
export const useWorkbookAssistant = () => useContext(WorkbookAssistantContext);

/** The sources are read when the office asks to choose one; the choice lasts as long as the page. */
export function useWorkbookAssistantState(): WorkbookAssistant {
  const [providers, setProviders] = useState<WorkbookAssistant["providers"]>(null);
  const [provider, setProvider] = useState<SuggestionProvider | null>(null);
  function loadProviders() {
    if (providers !== null && providers !== "error") return;
    setProviders("loading");
    fetchSuggestionProviders().then((answer) => setProviders(answer), () => setProviders("error"));
  }
  return { providers, provider, chooseProvider: setProvider, loadProviders };
}

export function confidenceLabel(confidence: number | null) {
  return confidence === null ? "confiance non donnée" : `confiance ${Math.round(confidence * 100)} %`;
}

/** The choice of the AI source, with why a source cannot be chosen here. */
export function AssistantProviderSelect() {
  const selectId = useId();
  const { providers, provider, chooseProvider, loadProviders } = useWorkbookAssistant();
  if (providers === null || providers === "loading" || providers === "error") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Button
          variant="ghost"
          size="xs"
          loading={providers === "loading"}
          leftIcon={<SparklesIcon aria-hidden="true" />}
          onClick={loadProviders}
        >
          Propositions avec l’IA
        </Button>
        {providers === "error" ? <span role="alert">Les sources d’IA n’ont pas pu être lues. Les propositions suivent les règles seules.</span> : null}
      </div>
    );
  }
  const entries = Object.entries(providers) as Array<[SuggestionProvider, SuggestionProviders[SuggestionProvider]]>;
  const unavailable = entries.filter(([, state]) => !state.available);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <label htmlFor={selectId} className="inline-flex items-center gap-1 font-medium">
        <SparklesIcon className="size-3.5" aria-hidden="true" /> Propositions
      </label>
      <NativeSelect
        id={selectId}
        size="sm"
        wrapperClassName="w-52"
        className="h-8 text-xs"
        value={provider ?? ""}
        onChange={(event) => chooseProvider((event.currentTarget.value || null) as SuggestionProvider | null)}
      >
        <option value="">Règles seules, sans IA</option>
        {entries.map(([id, state]) => (
          <option key={id} value={id} disabled={!state.available}>
            {`${SUGGESTION_PROVIDER_LABELS[id]}${state.available ? "" : " (indisponible)"}`}
          </option>
        ))}
      </NativeSelect>
      {provider ? (
        <span>{providers[provider].message}</span>
      ) : unavailable.length === entries.length ? (
        <span title={unavailable.map(([id, state]) => `${SUGGESTION_PROVIDER_LABELS[id]} : ${state.message}`).join("\n")}>
          Aucune source d’IA n’est disponible ici.
        </span>
      ) : null}
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
  const { provider } = useWorkbookAssistant();
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={loading}
      disabled={disabled}
      leftIcon={<SparklesIcon aria-hidden="true" />}
      title={withAi && provider ? `Arbitré par ${SUGGESTION_PROVIDER_LABELS[provider]} : rien n’est appliqué sans votre accord` : undefined}
      onClick={onClick}
    >
      {withAi && provider ? `${label} avec l’IA` : label}
    </Button>
  );
}
