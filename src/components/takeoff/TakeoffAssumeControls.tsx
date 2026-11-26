"use client";

import { useEffect, useState } from "react";

import { assumeTakeoffLaunchRequestAction } from "@/app/dashboard/affaires/_actions/takeoff";
import { Button } from "@/components/ui/button";
import type { TakeoffLaunchGestureResult } from "@/lib/takeoff/launch-payer-server";
import { TAKEOFF_PAYMENT_CHOICE_REQUIRED } from "@/lib/takeoff/payment-choice";
import { cn } from "@/lib/utils";
import { TakeoffPaymentFields } from "./TakeoffPaymentFields";
import { useTakeoffPaymentSettings } from "./useTakeoffPaymentSettings";

export function TakeoffAssumeControls({ projectId, requestId, revision, action, label, busyLabel, size = "sm", className, wrapperClassName, onChanged, onSource }: {
  projectId: string;
  requestId: string;
  revision: number;
  action: "take_on" | "resume";
  label: string;
  busyLabel: string;
  size?: "sm" | "md";
  className?: string;
  /** The button sizes itself against this wrapper: give it the width the button must fill. */
  wrapperClassName?: string;
  onChanged: (result: TakeoffLaunchGestureResult | null, viaKey: boolean) => void;
  /** Whether the gesture reads « avec ma clé API »: the text beside it then names no plan to resume with. */
  onSource?: (viaKey: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; reloadSettings?: true } | null>(null);
  const [explicitRequired, setExplicitRequired] = useState(false);
  const settings = useTakeoffPaymentSettings(projectId, requestId, explicitRequired);
  const viaKey = settings.value.source === "personal_api_key";
  const choice = settings.choice;
  // The source comes with the options, read after the first render, or from the member's own choice.
  useEffect(() => { onSource?.(viaKey); }, [onSource, viaKey]);

  async function confirm() {
    if (busy || !settings.ready || error?.reloadSettings) return;
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

  return <div className={cn("min-w-0 space-y-2", wrapperClassName)}>
    <TakeoffPaymentFields settings={settings} disabled={busy} stale={error?.reloadSettings}
      ceilingScope={action === "resume" ? "les lectures reprises" : "les lectures que vous prenez en charge"}
      onReload={() => { setError(null); settings.reload({ live: true }); }} />
    <Button type="button" variant="primary" size={size} className={className}
      disabled={busy || !settings.ready || Boolean(error?.reloadSettings)}
      onClick={() => void confirm()}>
      {busy ? busyLabel : viaKey ? action === "resume" ? "Reprendre avec ma clé API" : "Prendre en charge avec ma clé API" : label}
    </Button>
    {error && <p className="text-sm text-danger" role="alert">{error.message}</p>}
  </div>;
}
