"use client";

import { useEffect, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";

export function ProductReferenceSuggestion({ enabled, value, onUse }: {
  enabled: boolean;
  value: string;
  onUse: (reference: string) => void;
}) {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const shouldSuggest = enabled && !value.trim();
  useEffect(() => {
    if (!shouldSuggest) return;
    let active = true;
    void fetchApi<{ reference: string }>("/api/products/reference-suggestion")
      .then((result) => { if (active) setSuggestion(result.reference); })
      .catch(() => { if (active) setSuggestion(null); });
    return () => { active = false; };
  }, [shouldSuggest]);
  if (!enabled) return null;
  return (
    <div className="mt-1.5 space-y-1.5 text-xs text-[var(--slate-600)]">
      <p>Une référence sera générée automatiquement si ce champ reste vide.</p>
      {shouldSuggest && suggestion ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>Référence suggérée : <strong>{suggestion}</strong></span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onUse(suggestion)}>Utiliser</button>
          <span>Suggestion provisoire ; la référence enregistrée sera confirmée.</span>
        </div>
      ) : null}
    </div>
  );
}
