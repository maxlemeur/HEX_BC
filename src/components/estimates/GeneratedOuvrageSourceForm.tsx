"use client";

import { useEffect, useState } from "react";

import { readGeneratedOuvrageAiOptions } from "@/app/dashboard/affaires/_actions/generated-ouvrages";
import { AiRequestSettings } from "@/components/ai/AiRequestSettings";
import { Alert } from "@/components/ui/alert";

import { Button } from "@/components/ui/button";
import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { AI_REQUEST_CEILINGS_NANO_USD } from "@/lib/ai/request-ceilings";
import { defaultAiRequestSettings, type AiRequestSettingsValue } from "@/lib/ai/request-settings";

import { GENERATED_OUVRAGE_FALLBACK_SECTION_LABEL } from "./generated-ouvrage-types";
import type { ExistingSection } from "@/lib/estimates/editor-item-tree";

type SourceKind = "free_text" | "cctp_excerpt" | "internal_note";

type GenerationInput = Parameters<typeof import("@/app/dashboard/affaires/_actions/generated-ouvrages").generateOuvragesFromText>[0];
export type GeneratedOuvrageSourceInput = Pick<GenerationInput, "sourceKind" | "sourceText" | "preferredLotId" | "ai">;
type GeneratedOuvrageSourceFormProps = {
  versionId: string;
  existingSections: ExistingSection[];
  isGenerating: boolean;
  errorMessage: string | null;
  onGenerate: (input: GeneratedOuvrageSourceInput) => void;
};

const SOURCE_KIND_OPTIONS: { value: SourceKind; label: string }[] = [
  { value: "free_text", label: "Texte libre" },
  { value: "cctp_excerpt", label: "Extrait CCTP" },
  { value: "internal_note", label: "Note interne" },
];

export function GeneratedOuvrageSourceForm({
  versionId,
  existingSections,
  isGenerating,
  errorMessage,
  onGenerate,
}: GeneratedOuvrageSourceFormProps) {
  type Options = Extract<Awaited<ReturnType<typeof readGeneratedOuvrageAiOptions>>, { ok: true }>["data"];
  const [settings, setSettings] = useState<Options | string | null>(null);
  const [choice, setChoice] = useState<AiRequestSettingsValue>();
  useEffect(() => {
    let ignore = false;
    void readGeneratedOuvrageAiOptions(versionId).then((result) => {
      if (!ignore) setSettings(result.ok ? result.data : result.error.message);
    }).catch(() => {
      if (!ignore) setSettings("Impossible de charger les réglages IA. Fermez cette fenêtre puis rouvrez-la pour réessayer.");
    });
    return () => { ignore = true; };
  }, [versionId]);

  const options = typeof settings === "string" ? null : settings;
  const value = choice ?? (options ? defaultAiRequestSettings(options.defaultSource, options.sources) : undefined);
  let ai: GenerationInput["ai"] | null = null;
  if (value?.preferences) {
    const { source, preferences: { model, reasoningEffort: effort } } = value;
    if (source === "chatgpt_plan") ai = { source, model, effort };
    if (source === "personal_api_key" && options?.keyConnectionId) {
      ai = { source, model, effort, expectedConnectionId: options.keyConnectionId };
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (isGenerating || !settings) return;
        const fd = new FormData(e.currentTarget, e.nativeEvent.submitter);
        const requestedAi = fd.get("generationMode") === "fallback" ? { source: "fallback" as const } : ai;
        if (!requestedAi) return;
        onGenerate({
          sourceKind: (fd.get("sourceKind") as SourceKind) ?? "free_text",
          sourceText: (fd.get("sourceText") as string) ?? "",
          preferredLotId: (fd.get("preferredLotId") as string) || null,
          ai: requestedAi,
        });
      }}
    >
      <div className="space-y-1.5">
        <FieldLabel htmlFor="gen-source-kind">Type de source</FieldLabel>
        <NativeSelect
          id="gen-source-kind"
          name="sourceKind"
          size="sm"
          defaultValue="free_text"
          disabled={isGenerating}
        >
          {SOURCE_KIND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="space-y-1.5">
        <FieldLabel htmlFor="gen-source-text">Texte source</FieldLabel>
        <Textarea
          id="gen-source-text"
          name="sourceText"
          className="min-h-30 text-sm"
          placeholder="Collez ici le texte à analyser…"
          required
          disabled={isGenerating}
        />
      </div>

      <div className="space-y-1.5">
        <FieldLabel htmlFor="gen-preferred-lot">Lot cible (optionnel)</FieldLabel>
        <NativeSelect
          id="gen-preferred-lot"
          name="preferredLotId"
          size="sm"
          defaultValue=""
          disabled={isGenerating}
          aria-describedby="gen-preferred-lot-hint"
        >
          <option value="">{GENERATED_OUVRAGE_FALLBACK_SECTION_LABEL}</option>
          {existingSections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.path}
            </option>
          ))}
        </NativeSelect>
        <FieldDescription id="gen-preferred-lot-hint" className="text-xs">
          Sans lot choisi, l&apos;ouvrage sera inséré dans la section explicite{" "}
          <span className="font-medium text-foreground-secondary">À classer</span>.
        </FieldDescription>
      </div>

      {options ? (
        <AiRequestSettings
          sources={options.sources}
          defaultSource={options.defaultSource}
          value={value}
          onChange={setChoice}
          sourcePicker={{ label: "Source d’IA" }}
          keyCeiling={{ nanoUsd: AI_REQUEST_CEILINGS_NANO_USD.generationOrDocument }}
          locked={isGenerating}
        />
      ) : typeof settings === "string" ? <Alert variant="danger">{settings}</Alert>
        : <p role="status" className="text-sm text-muted-foreground">Chargement des réglages IA…</p>}

      {errorMessage ? <Alert variant="danger">{errorMessage}</Alert> : null}

      <div aria-live="polite" className="text-sm text-muted-foreground">
        {isGenerating ? "Génération des ouvrages en cours…" : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={isGenerating || !ai}
          data-testid="generated-ouvrage-generate-button"
        >
          {isGenerating ? "Génération…" : "Générer des propositions"}
        </Button>
        <Button type="submit" name="generationMode" value="fallback" variant="outline" disabled={isGenerating || !settings}>
          Générer sans IA
        </Button>
      </div>
    </form>
  );
}
