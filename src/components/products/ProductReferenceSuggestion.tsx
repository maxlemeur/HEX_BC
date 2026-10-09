"use client";

import { useEffect, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import { Button } from "@/components/ui/button";

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
    <div className="space-y-1.5 text-xs text-foreground-secondary">
      <p>Une référence sera générée automatiquement si ce champ reste vide.</p>
      {shouldSuggest && suggestion ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>Référence suggérée : <strong>{suggestion}</strong></span>
          <Button variant="outline" size="sm" onClick={() => onUse(suggestion)}>Utiliser</Button>
          <span>Suggestion provisoire ; la référence enregistrée sera confirmée.</span>
        </div>
      ) : null}
    </div>
  );
}
