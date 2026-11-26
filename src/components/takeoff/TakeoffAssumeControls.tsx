"use client";

import { useState } from "react";

import { assumeTakeoffLaunchRequestAction } from "@/app/dashboard/affaires/_actions/takeoff";
import { Button } from "@/components/ui/button";
import type { TakeoffLaunchGestureResult } from "@/lib/takeoff/launch-payer-server";
import { TAKEOFF_PAYMENT_CHOICE_REQUIRED } from "@/lib/takeoff/payment-choice";
import { TakeoffPaymentFields } from "./TakeoffPaymentFields";
import { useTakeoffPaymentSettings } from "./useTakeoffPaymentSettings";

export function TakeoffAssumeControls({ projectId, requestId, revision, action, label, busyLabel, className, onChanged }: {
  projectId: string;
  requestId: string;
  revision: number;
  action: "take_on" | "resume";
  label: string;
  busyLabel: string;
  className?: string;
  onChanged: (result: TakeoffLaunchGestureResult | null, viaKey: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; reloadSettings?: true } | null>(null);
  const [explicitRequired, setExplicitRequired] = useState(false);
  const settings = useTakeoffPaymentSettings(projectId, requestId);
  const viaKey = settings.value.source === "personal_api_key";
  const choice = explicitRequired ? settings.explicitChoice : settings.choice;

  async function confirm() {
    if (busy || !settings.ready || error?.reloadSettings || (explicitRequired && !choice)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await assumeTakeoffLaunchRequestAction({ projectId, requestId, seenRevision: revision,
        action, ...(choice && { paymentChoice: choice }) });
      if (!result.ok) {
        setError(result.error);
        if (result.error.code === TAKEOFF_PAYMENT_CHOICE_REQUIRED) setExplicitRequired(true);
      }
      onChanged(result.ok ? result.data : null, viaKey);
    } catch {
      setError({ message: "Impossible de prendre en charge le métré. Réessayez." });
    } finally {
      setBusy(false);
    }
  }

  return <div className="min-w-0 space-y-2">
    <TakeoffPaymentFields settings={settings} disabled={busy} stale={error?.reloadSettings}
      ceilingScope={action === "resume" ? "les lectures reprises" : "les lectures que vous prenez en charge"}
      onReload={() => { setError(null); settings.reload(); }} />
    <Button type="button" variant="primary" size="sm" className={className}
      disabled={busy || !settings.ready || Boolean(error?.reloadSettings) || (explicitRequired && !choice)}
      onClick={() => void confirm()}>
      {busy ? busyLabel : viaKey ? action === "resume" ? "Reprendre avec ma clé API" : "Prendre en charge avec ma clé API" : label}
    </Button>
    {error && <p className="text-sm text-danger" role="alert">{error.message}</p>}
  </div>;
}
