"use client";

import { AiRequestSettings } from "@/components/ai/AiRequestSettings";
import { Button } from "@/components/ui/button";
import { TAKEOFF_NANO_USD_PER_CENT } from "@/lib/takeoff/payment-choice";
import type { TakeoffPaymentSettings } from "./useTakeoffPaymentSettings";

export function TakeoffPaymentFields({ settings, disabled, stale, onReload, ceilingScope = "cette demande" }: {
  settings: TakeoffPaymentSettings;
  disabled?: boolean;
  stale?: boolean;
  onReload?: () => void;
  ceilingScope?: string;
}) {
  if (settings.loading) return <p role="status" className="text-sm text-muted-foreground">Lecture des réglages du métré…</p>;
  return <>
    {settings.data && (settings.data.defaultSource !== "chatgpt_plan" || Object.values(settings.sources).some((source) => source?.available)) && (
      <AiRequestSettings
        sources={settings.sources}
        defaultSource={settings.data.defaultSource}
        value={settings.value}
        onChange={settings.setValue}
        sourcePicker={{ label: "Source IA" }}
        fieldsClassName="grid grid-cols-1 gap-3 sm:grid-cols-2"
        locked={disabled || stale}
        keyCeiling={{ nanoUsd: settings.data.maxCostCents * TAKEOFF_NANO_USD_PER_CENT,
          message: (amount) => `Plafond pour ${ceilingScope} avec votre clé API OpenAI : ${amount}.` }}
      />
    )}
    {settings.error && <p role="alert" className="text-sm text-danger">{settings.error}</p>}
    {(stale || settings.error) && (
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onReload ?? settings.reload}>
        Recharger les réglages
      </Button>
    )}
  </>;
}
