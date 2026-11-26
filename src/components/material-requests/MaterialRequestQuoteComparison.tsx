"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ScanSearch } from "lucide-react";

import { loadPhotoAnalysisModelOptions } from "@/app/dashboard/_actions/chatgpt";
import { AssistantAiFeatureSettings, effectiveAiChoice, useAssistantAiSettings } from "@/components/ai/AssistantAiSettings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { compareMaterialRequestQuoteFile } from "@/lib/material-requests/client";
import type { MaterialRequestFile } from "@/lib/material-requests/contracts";
import {
  QUOTE_COMPARISON_API_CEILING_NANO_USD,
  type MaterialRequestQuoteComparison as Comparison,
  type QuoteComparisonLine,
} from "@/lib/material-requests/quote-comparison";
import type { MaterialRequestPhotoAnalysisAvailability } from "@/lib/material-requests/photo-analysis";

import { formatQuantity } from "./format";

const STATUS = {
  missing: { label: "Absent du devis", variant: "danger" },
  short: { label: "Quantité insuffisante", variant: "danger" },
  mismatch: { label: "Écart technique", variant: "danger" },
  review: { label: "À vérifier", variant: "warning" },
  excess: { label: "Quantité supérieure", variant: "warning" },
  covered: { label: "Quantité couverte", variant: "success" },
} as const;

type Settings = Awaited<ReturnType<typeof loadPhotoAnalysisModelOptions>>;
type State = { result: Comparison } | { error: string };

function quantityWithUnit(quantity: number | null, unit: string | null): string {
  return quantity === null ? "—" : [formatQuantity(quantity), unit].filter(Boolean).join(" ");
}

function ComparisonResult({ result }: { result: Comparison }) {
  const metadata = [result.reference, result.revision, result.date, result.total_ht ? `Total HT : ${result.total_ht}` : null]
    .filter(Boolean).join(" · ");
  const ordered = Object.keys(STATUS).flatMap((status) => result.lines.filter((line) => line.status === status));

  return (
    <div className="min-w-0 space-y-2 border-t border-border pt-3">
      <p className="text-sm font-medium text-foreground">Comparaison avec le message envoyé</p>
      {metadata ? <p className="text-xs text-muted-foreground">{metadata}</p> : null}
      {!result.complete ? (
        <p role="status" className="text-sm font-medium text-foreground">
          Lecture partielle. Vérifiez les lignes et les pages qui restent à confirmer.
        </p>
      ) : null}
      {ordered.length > 0 ? (
        <div className="max-h-[32rem] overflow-auto rounded-md border border-border">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="sticky top-0 bg-surface-subtle text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="w-[36%] px-3 py-2 font-medium">Demandé</th>
                <th scope="col" className="px-3 py-2 font-medium">Proposé dans la pièce</th>
                <th scope="col" className="w-[25%] px-3 py-2 font-medium">Écart</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ordered.map((line, index) => <ComparisonRow key={index} line={line} />)}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-muted-foreground">Aucune ligne n’a pu être rapprochée du message.</p>}
      {result.unmatched_request.length > 0 ? (
        <details className="rounded-md border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Lignes du message à relire ({result.unmatched_request.length})</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {result.unmatched_request.map((text, index) => <li key={index}>{text}</li>)}
          </ul>
        </details>
      ) : null}
      {result.unmatched_offers.length > 0 ? (
        <details className="rounded-md border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Articles du devis sans correspondance ({result.unmatched_offers.length})</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {result.unmatched_offers.map((offer, index) => (
              <li key={index}>
                {offer.text} <span className="text-xs text-muted-foreground">· p. {offer.page}</span>
                {offer.observation ? <p className="text-xs text-muted-foreground">{offer.observation}</p> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {result.commercial_notes ? <p className="text-sm text-muted-foreground">{result.commercial_notes}</p> : null}
    </div>
  );
}

function ComparisonRow({ line }: { line: QuoteComparisonLine }) {
  const { label, variant } = STATUS[line.status];
  return (
    <tr>
      <td className="px-3 py-2 align-top">
        <ul className="space-y-1">
          {line.requested.map((item, index) => <li key={index}>{item.text}</li>)}
        </ul>
      </td>
      <td className="px-3 py-2 align-top">
        {line.offered.length === 0 ? <span className="text-muted-foreground">—</span> : (
          <ul className="space-y-1">
            {line.offered.map((item, index) => (
              <li key={index}>
                {item.text} <span className="text-xs text-muted-foreground">· p. {item.page}</span>
                {item.price || item.delay ? (
                  <p className="text-xs text-muted-foreground">{[item.price, item.delay].filter(Boolean).join(" · ")}</p>
                ) : null}
                {item.observation ? <p className="text-xs text-muted-foreground">{item.observation}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <Badge variant={variant}>{label}</Badge>
        {line.difference !== null ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {quantityWithUnit(line.offered_quantity, line.unit)} / {quantityWithUnit(line.requested_quantity, line.unit)}
            {line.difference === 0 ? null : ` (${line.difference > 0 ? "+" : ""}${formatQuantity(line.difference)})`}
          </p>
        ) : null}
      </td>
    </tr>
  );
}

export function MaterialRequestQuoteComparison({
  projectId, requestId, quoteId, files, availability, visible,
}: Readonly<{
  projectId: string;
  requestId: string;
  quoteId: string;
  files: readonly MaterialRequestFile[];
  availability: MaterialRequestPhotoAnalysisAvailability;
  visible: boolean;
}>) {
  const settingsId = useId();
  const common = useAssistantAiSettings();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsFailed, setSettingsFailed] = useState(false);
  const [selectedId, setSelectedId] = useState(files[0]?.id ?? "");
  const [results, setResults] = useState<Record<string, State | undefined>>({});
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const file = files.find((entry) => entry.id === selectedId) ?? files[0];
  const shown = file ? results[file.id] : undefined;

  useEffect(() => {
    if (!visible || availability.status !== "available" || settings) return;
    let live = true;
    void loadPhotoAnalysisModelOptions().then((value) => {
      if (live) {
        setSettings(value);
        setSettingsFailed(false);
      }
    }).catch(() => {
      if (live) setSettingsFailed(true);
    });
    return () => { live = false; };
  }, [availability.status, settings, visible]);

  useEffect(() => () => pending.current?.abort(), []);

  const sources = settings ? { [settings.billingSource]: { available: true, models: settings.models, message: "Source d’analyse" } } : {};
  const aiSelection = settings ? effectiveAiChoice(common?.choice,
    { source: settings.billingSource, preferences: settings.preferences }, sources, true) : undefined;
  const preferences = aiSelection?.preferences ?? null;

  const run = async () => {
    if (availability.status !== "available" || !file || !settings || !preferences || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setResults((current) => ({ ...current, [file.id]: undefined }));
    try {
      const result = await compareMaterialRequestQuoteFile(projectId, requestId, quoteId, file.id, {
        preferences,
        billingSource: settings.billingSource,
        connectionId: settings.connectionId ?? undefined,
      }, controller.signal);
      if (!controller.signal.aborted) setResults((current) => ({ ...current, [file.id]: { result } }));
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : "La comparaison n’a pas abouti.";
        setResults((current) => ({ ...current, [file.id]: { error: message } }));
      }
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  if (!file || availability.status === "disabled") return null;
  const showSettings = availability.status === "available" && settings && (preferences || common);
  const settingsText = availability.status !== "available"
    ? availability.message
    : settingsFailed
      ? "Les réglages IA sont indisponibles. Rechargez la demande pour les relire."
      : settings ? "Aucun modèle d’analyse disponible dans Mon profil." : "Lecture des réglages IA…";

  return (
    <div className="min-w-0 space-y-2 rounded-md border border-border bg-surface-subtle p-3">
      {files.length > 1 ? (
        <NativeSelect aria-label="Pièce à comparer" size="sm" value={file.id} disabled={busy}
          onChange={(event) => setSelectedId(event.currentTarget.value)}>
          {files.map((entry) => <option key={entry.id} value={entry.id}>{entry.file_name}</option>)}
        </NativeSelect>
      ) : null}
      {showSettings && settings ? (
        <AssistantAiFeatureSettings fixedSource id={settingsId} messageId={settingsId} defaultSource={settings.billingSource}
          sources={sources}
          value={aiSelection}
          locked={busy} onChange={(value) => {
            if (value.preferences) setSettings({ ...settings, preferences: value.preferences });
          }}
          modelLabel="Modèle d’analyse" fieldsClassName="grid gap-3 sm:grid-cols-2" effortFallback="automatic"
          keyCeiling={{ nanoUsd: QUOTE_COMPARISON_API_CEILING_NANO_USD, message: (ceiling) => `Clé API OpenAI · jusqu’à ${ceiling} par pièce` }} />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" loading={busy}
          disabled={availability.status !== "available" || !preferences}
          aria-describedby={settingsId} onClick={() => void run()}>
          <ScanSearch aria-hidden="true" />
          {shown && "result" in shown ? "Relancer la comparaison" : "Comparer le devis à la demande"}
        </Button>
        {busy ? <span role="status" className="text-xs text-muted-foreground">Lecture du document…</span> : null}
      </div>
      {!showSettings ? <p id={settingsId} className="text-xs text-muted-foreground">{settingsText}</p> : null}
      {shown && "error" in shown ? <p role="alert" className="text-sm text-danger">{shown.error}</p> : null}
      {shown && "result" in shown ? <ComparisonResult result={shown.result} /> : null}
    </div>
  );
}
