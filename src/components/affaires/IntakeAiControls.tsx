"use client";

import { useEffect, useState } from "react";
import { readAffaireIntakeAiOptions } from "@/app/dashboard/affaires/_actions/intake";
import { AiRequestSettings } from "@/components/ai/AiRequestSettings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AI_REQUEST_CEILINGS_NANO_USD } from "@/lib/ai/request-ceilings";
import { defaultAiRequestSettings, type AiRequestSettingsValue } from "@/lib/ai/request-settings";
import type { IntakeAiChoice, IntakeAiOptions } from "@/lib/affaires/intake-ai-settings";

export function IntakeAiControls({ projectId, retry = false, disabled, submitLabel, onSubmit }: {
  projectId: string;
  retry?: boolean;
  disabled?: boolean;
  submitLabel: string;
  onSubmit: (choice: IntakeAiChoice) => void;
}) {
  const [selection, setSelection] = useState<AiRequestSettingsValue>();
  const [retryLoad, setRetryLoad] = useState(0);
  const [read, setRead] = useState<{ projectId: string; attempt: number; data: IntakeAiOptions | null }>();
  useEffect(() => {
    let cancelled = false;
    void readAffaireIntakeAiOptions(projectId).then(data => {
      if (!cancelled) setRead({ projectId, attempt: retryLoad, data });
    }, () => {
      if (!cancelled) setRead({ projectId, attempt: retryLoad, data: null });
    });
    return () => { cancelled = true; };
  }, [projectId, retryLoad]);
  const current = read?.projectId === projectId && read.attempt === retryLoad ? read : null;
  const data = current?.data;
  const error = current && !data;
  if (error) return <p role="status">Impossible de lire les réglages IA.{" "}
    <Button type="button" variant="link" onClick={() => setRetryLoad(value => value + 1)}>Réessayer</Button>
  </p>;
  if (!data) return <p role="status">Chargement des réglages IA…</p>;

  const allowRules = !retry || data.decisionsSelected;
  const value = selection ?? defaultAiRequestSettings(data.defaultSource, data.sources);
  const { source, preferences } = value;
  const noPersonalSourceAvailable = !data.sources.chatgpt_plan?.available && !data.sources.personal_api_key?.available;
  const choice: IntakeAiChoice | null = source === "chatgpt_plan" && preferences && data.sources[source]?.available
    ? { source, model: preferences.model, effort: preferences.reasoningEffort }
    : source === "personal_api_key" && preferences && data.sources[source]?.available && data.keyConnectionId
      ? { source, model: preferences.model, effort: preferences.reasoningEffort, expectedConnectionId: data.keyConnectionId }
      : source === null && allowRules && (selection || noPersonalSourceAvailable || data.decisionsSelected) ? { source: "rules_only" } : null;
  const personalAi = choice && choice.source !== "rules_only";
  const hasQualifiedTranscription = Boolean(source && data.sources[source]?.models?.some(
    (model) => model.id === "gpt-6.1-terra" && model.reasoningEfforts.includes("high"),
  ));
  return <div className="space-y-2">
    <AiRequestSettings
      sources={data.sources}
      defaultSource={data.defaultSource}
      value={value}
      onChange={setSelection}
      locked={disabled}
      sourcePicker={{ label: "Source de l’IA", rulesOnlyLabel: allowRules ? "Sans source personnelle" : undefined }}
      keyCeiling={{ nanoUsd: AI_REQUEST_CEILINGS_NANO_USD.documentBatch, message: (ceiling) =>
        `Plafond de ${ceiling} pour tout le lot, facturé sur votre compte OpenAI.` }}
    />
    <p className="text-sm text-muted-foreground">
      {data.decisionsSelected ? "Le classement des pièces utilise l’API Decisions du serveur. " : personalAi ? "Le classement des pièces utilise ces réglages. " : "Le classement s’appuie sur les règles du dossier. "}
      {personalAi ? "La préparation du brief par ce lot utilise ces réglages. " : "La préparation du brief se fait sans source personnelle. "}
      {personalAi && (hasQualifiedTranscription
        ? "Les images et les PDF scannés sont transcrits avec cette source, sur GPT‑6.1 Terra avec un effort élevé."
        : "La transcription des images et des PDF scannés nécessite GPT‑6.1 Terra avec un effort élevé sur cette source.")}
    </p>
    <Button type="button" disabled={disabled || !choice} onClick={() => { if (choice) onSubmit(choice); }}>{submitLabel}</Button>
  </div>;
}

export function IntakeAnalysisRetryDialog({ projectId, count, onClose, onSubmit }: {
  projectId: string;
  count: number;
  onClose: () => void;
  onSubmit: (choice: IntakeAiChoice) => void;
}) {
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Relancer l’analyse</DialogTitle>
        <DialogDescription>{count === 1 ? "1 pièce à réanalyser." : `${count} pièces à réanalyser avec les mêmes réglages.`}</DialogDescription>
      </DialogHeader>
      <IntakeAiControls projectId={projectId} retry submitLabel="Démarrer la relance" onSubmit={onSubmit} />
    </DialogContent>
  </Dialog>;
}
