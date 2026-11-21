import { requestJson } from "@/lib/estimates/client-requests";
import { priceReuseApplySchema, priceReuseArbitrationSchema, priceReusePreviewSchema, type PriceReuseApplyInput, type PriceReuseApplyResult, type PriceReuseArbitration, type PriceReuseArbitrationInput, type PriceReusePreview } from "@/lib/estimates/price-reuse-contracts";

/** Reprise des prix : comparaison en lecture seule avec un devis de référence (docs/metier/reprise-des-prix.md). */
export async function previewEstimatePriceReuse(targetVersionId: string, referenceVersionId: string): Promise<PriceReusePreview> {
  return requestJson(
    `/api/estimates/${targetVersionId}/price-reuse/preview`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference_version_id: referenceVersionId }) },
    "Impossible de comparer avec le devis de référence.",
    (value) => priceReusePreviewSchema.parse(value)
  );
}

/** Reprise des prix : proposition de Decisions ou du forfait ChatGPT pour des lignes à vérifier, sans écriture. */
export async function arbitrateEstimatePriceReuse(targetVersionId: string, input: PriceReuseArbitrationInput): Promise<PriceReuseArbitration> {
  return requestJson(
    `/api/estimates/${targetVersionId}/price-reuse/arbitration`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
    "L’arbitrage n’a pas abouti. Choisissez les articles manuellement.",
    (value) => priceReuseArbitrationSchema.parse(value)
  );
}

/** Reprise des prix confirmée : une écriture atomique de l'éditeur, au jeton du brouillon. */
export async function applyEstimatePriceReuse(targetVersionId: string, input: PriceReuseApplyInput,
  updatedAt: string): Promise<PriceReuseApplyResult> {
  return requestJson(
    `/api/estimates/${targetVersionId}/price-reuse`,
    { method: "POST", headers: { "Content-Type": "application/json", "If-Match": updatedAt }, body: JSON.stringify(input) },
    "Impossible de reprendre les prix.",
    (value) => priceReuseApplySchema.parse(value),
    { mutation: { versionId: targetVersionId, structural: true } }
  );
}
