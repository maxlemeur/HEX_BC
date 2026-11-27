"use client";

import { AiRequestSettings } from "@/components/ai/AiRequestSettings";
import { Button } from "@/components/ui/button";
import type { AiRequestSettingsValue } from "@/lib/ai/request-settings";
import { TAKEOFF_NANO_USD_PER_CENT } from "@/lib/takeoff/payment-choice";
import type { TakeoffPaymentSettings } from "./useTakeoffPaymentSettings";

export function TakeoffPaymentFields({ settings, disabled, stale, onReload, onChange, ceilingScope = "cette demande" }: {
  settings: TakeoffPaymentSettings;
  disabled?: boolean;
  stale?: boolean;
  onReload?: () => void;
  onChange?: () => void;
  ceilingScope?: string;
}) {
  if (settings.loading) return <p role="status" className="text-sm text-muted-foreground">Lecture des réglages du métré…</p>;
  return <>
    {settings.data && (settings.data.defaultSource !== "chatgpt_plan" || Object.values(settings.sources).some((source) => source?.available)) && (
      <AiRequestSettings
        sources={settings.sources}
        defaultSource={settings.data.defaultSource}
        value={settings.shown}
        keepUnofferedEffort={settings.pinned}
        onChange={(value: AiRequestSettingsValue) => { settings.setValue(value); onChange?.(); }}
        sourcePicker={{ label: "Source IA" }}
        fieldsClassName="grid grid-cols-1 gap-3 sm:grid-cols-2"
        locked={disabled || stale}
        keyCeiling={{ nanoUsd: settings.data.maxCostCents * TAKEOFF_NANO_USD_PER_CENT,
          message: (amount) => `Plafond pour ${ceilingScope} avec votre clé API OpenAI : ${amount}.` }}
      />
    )}
    {settings.error && <p role="alert" className="text-sm text-danger">{settings.error}</p>}
    {settings.notice && <p role="status" className="text-sm text-muted-foreground">{settings.notice}</p>}
    {(stale || settings.error || settings.notice) && (
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onReload ?? (() => settings.reload({ live: true }))}>
        Recharger les réglages
      </Button>
    )}
  </>;
}
