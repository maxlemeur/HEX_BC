"use client";

import { useState } from "react";

import { suggestCockpitNextActionAction } from "@/app/dashboard/affaires/_actions/cockpit-decisions";
import { Button } from "@/components/ui/button";
import type { CockpitDecisionSuggestion } from "@/lib/cockpit/decision-assistance";
import type { CockpitSuggestion } from "@/lib/cockpit/suggestions";

export function CockpitDecisionSuggestionCard({ projectId, suggestions }: { projectId: string; suggestions: CockpitSuggestion[] }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ value: CockpitDecisionSuggestion; candidates: string } | null>(null);
  const candidateIds = suggestions.filter((suggestion) => !suggestion.isHidden).map((suggestion) => suggestion.actionId);
  const candidates = JSON.stringify(suggestions);
  const current = result?.candidates === candidates ? result.value : null;
  const selected = current?.action_id ? suggestions.find((suggestion) => suggestion.actionId === current.action_id && !suggestion.isHidden && !suggestion.isPinned) : null;

  async function suggest() {
    setBusy(true);
    try {
      const value = await suggestCockpitNextActionAction({ projectId, candidateIds });
      setResult({ value, candidates });
    } catch {
      setResult({ candidates, value: { status: "to_review", action_id: null, request_fingerprint: null,
        message: "Le conseil d’action est indisponible. Choisissez une action dans le cockpit." } });
    } finally { setBusy(false); }
  }

  return (
    <div className="mb-3 text-sm">
      <Button type="button" variant="outline" size="sm" disabled={busy || candidateIds.length === 0} onClick={() => void suggest()}>
        {busy ? "Conseil en cours…" : "Conseiller la prochaine action"}
      </Button>
      <p className="mt-1 text-xs text-muted-foreground">Decisions utilise un accès API distinct lorsqu’il est activé.</p>
      {current ? <p className="mt-2 text-muted-foreground" role="status">
        {selected ? <><strong className="text-foreground">Proposition : {selected.label}.</strong>{" "}</> : null}
        {current.message}
      </p> : null}
    </div>
  );
}
