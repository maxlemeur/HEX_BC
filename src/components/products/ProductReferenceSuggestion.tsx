"use client";

import { useEffect, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import { Button } from "@/components/ui/button";
import type { ProductReferenceIdentity } from "@/lib/catalogue/product-reference-identity";
import {
  REFERENCE_TOKEN_LABELS, explainProductReference, type ProductReferenceNaming,
} from "@/lib/catalogue/product-reference-naming";

const listFormat = new Intl.ListFormat("fr", { style: "long", type: "conjunction" });

/**
 * What the reference of a new article will be when its field stays blank: the company's format when its
 * administrator saved one and the sheet states what the format needs, the automatic number otherwise.
 */
export function ProductReferenceSuggestion({ enabled, value, identity, onUse }: {
  enabled: boolean;
  value: string;
  /** The characteristics typed so far: the company's format is built from them. */
  identity?: ProductReferenceIdentity;
  onUse: (reference: string) => void;
}) {
  const [answer, setAnswer] = useState<{ reference: string; naming?: ProductReferenceNaming } | null>(null);
  const shouldSuggest = enabled && !value.trim();
  useEffect(() => {
    if (!shouldSuggest) return;
    let active = true;
    void fetchApi<{ reference: string; naming?: ProductReferenceNaming }>("/api/products/reference-suggestion")
      .then((result) => { if (active) setAnswer(result); })
      .catch(() => { if (active) setAnswer(null); });
    return () => { active = false; };
  }, [shouldSuggest]);
  if (!enabled) return null;
  const proposal = answer?.naming && identity ? explainProductReference(answer.naming, identity) : null;
  const suggestion = proposal?.reference ?? answer?.reference ?? null;
  const missing = proposal && !proposal.reference ? proposal.missing : [];
  return (
    <div className="space-y-1.5 text-xs text-foreground-secondary">
      <p>Une référence sera générée automatiquement si ce champ reste vide.</p>
      {shouldSuggest && suggestion ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>Référence suggérée : <strong>{suggestion}</strong></span>
          <Button variant="outline" size="sm" onClick={() => onUse(suggestion)}>Utiliser</Button>
          <span>
            {proposal?.reference
              ? "Selon la nomenclature de l’entreprise ; elle sera confirmée à l’enregistrement."
              : "Suggestion provisoire ; la référence enregistrée sera confirmée."}
          </span>
        </div>
      ) : null}
      {shouldSuggest && missing.length > 0 ? (
        <p>
          Pour une référence selon la nomenclature, renseignez {listFormat.format(missing.map((token) => REFERENCE_TOKEN_LABELS[token]))}.
        </p>
      ) : null}
    </div>
  );
}
