import { resolveMarginMultiplier, type MarginTier } from "@/lib/estimates/margin-tiers";
import { formatCurrency, type SupportedEstimateCurrency } from "@/lib/money";

type MarginTiersExplanationProps = {
  tiers?: MarginTier[];
  currency?: SupportedEstimateCurrency;
  costSubtotalCents?: number;
  storedMarginMultiplier?: number;
  isFrozen?: boolean;
};

export function MarginTiersExplanation({
  tiers,
  currency = "EUR",
  costSubtotalCents,
  storedMarginMultiplier,
  isFrozen = false,
}: MarginTiersExplanationProps) {
  const hasStoredMultiplier = storedMarginMultiplier !== undefined;
  const hasCurrentCost = !isFrozen && !hasStoredMultiplier && costSubtotalCents !== undefined;
  const exampleCost = hasCurrentCost ? costSubtotalCents : 100_000;
  const exampleMultiplier = tiers
    ? resolveMarginMultiplier(exampleCost, tiers)
    : 1.2;

  return (
    <div className="my-3 space-y-2 text-sm text-foreground-secondary">
      <p>
        Le coût total HT des lignes, avant marge, détermine le seuil atteint.
        Le coefficient de ce seuil s’applique à l’ensemble des lignes du devis.
        Le montant n’est pas découpé en tranches progressives.
      </p>
      {hasStoredMultiplier || isFrozen ? (
        <p>
          {hasStoredMultiplier
            ? `Coefficient appliqué au devis figé : ×${storedMarginMultiplier.toFixed(2).replace(".", ",")}.`
            : "Le coefficient appliqué n'est pas disponible dans l'historique de ce devis figé."}
          {" "}Ses montants enregistrés sont conservés.
        </p>
      ) : hasCurrentCost ? (
        <p>
          Pour ce devis : coût de {formatCurrency(exampleCost, currency)} →
          {" "}coefficient ×{exampleMultiplier.toFixed(2)} selon le barème.
        </p>
      ) : (
        <p>
          Exemple : coût de {formatCurrency(exampleCost, currency)} ×
          {" "}{exampleMultiplier.toFixed(2)} =
          {" "}{formatCurrency(Math.round(exampleCost * exampleMultiplier), currency)}
          {" "}avant coefficient global, remise et TVA.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Au passage d’un seuil, le nouveau coefficient porte sur tout le coût :
        le prix peut diminuer si le coefficient du seuil suivant est plus faible.
      </p>
    </div>
  );
}
