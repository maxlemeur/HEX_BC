import { extractEntity } from "@/lib/estimates/client-json";
import { jsonRequest } from "@/lib/estimates/client-http";
import { requestJson } from "@/lib/estimates/client-requests";
import type { Database } from "@/types/database";
import type { LaborRole } from "@/lib/estimates/editor-items";

type EstimateCategory =
  Database["public"]["Tables"]["estimate_categories"]["Row"];

type MarginTier = Database["public"]["Tables"]["margin_tiers"]["Row"];
type SuggestionRule =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];

export type SuggestionRuleFeedback = "accept" | "reject";

export async function createEstimateCategory(
  versionId: string,
  category: Pick<
    Database["public"]["Tables"]["estimate_categories"]["Insert"],
    "name" | "color" | "position"
  >
): Promise<EstimateCategory> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/categories`,
    jsonRequest("POST", category),
    "Impossible de créer la catégorie."
  );

  const entity = extractEntity(payload, ["category", "item"]);
  if (!entity) {
    throw new Error("Impossible de créer la catégorie.");
  }

  return entity as EstimateCategory;
}

export async function createEstimateLaborRole(
  versionId: string,
  role: Pick<
    Database["public"]["Tables"]["labor_roles"]["Insert"],
    "name" | "hourly_rate_cents" | "is_active" | "position"
  >
): Promise<LaborRole> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/labor-roles`,
    jsonRequest("POST", role),
    "Impossible de créer le rôle."
  );

  const entity = extractEntity(payload, ["labor_role", "laborRole", "role"]);
  if (!entity) {
    throw new Error("Impossible de créer le rôle.");
  }

  return entity as LaborRole;
}

export async function updateEstimateLaborRole(
  versionId: string,
  roleId: string,
  updates: Database["public"]["Tables"]["labor_roles"]["Update"]
): Promise<void> {
  await requestJson<unknown>(
    `/api/estimates/${versionId}/labor-roles/${roleId}`,
    jsonRequest("PATCH", updates),
    "Impossible de mettre à jour le rôle."
  );
}

export async function createMarginTier(
  tier: Pick<
    Database["public"]["Tables"]["margin_tiers"]["Insert"],
    "threshold_cents" | "multiplier"
  >
): Promise<MarginTier> {
  const payload = await requestJson<unknown>(
    `/api/margin-tiers`,
    jsonRequest("POST", tier),
    "Impossible de créer la tranche de marge."
  );

  const entity = extractEntity(payload, ["margin_tier", "marginTier"]);
  if (!entity) {
    throw new Error("Impossible de créer la tranche de marge.");
  }

  return entity as MarginTier;
}

export async function updateMarginTier(
  tierId: string,
  updates: Database["public"]["Tables"]["margin_tiers"]["Update"]
): Promise<MarginTier> {
  const payload = await requestJson<unknown>(
    `/api/margin-tiers/${tierId}`,
    jsonRequest("PATCH", updates),
    "Impossible de mettre à jour la tranche de marge."
  );

  const entity = extractEntity(payload, ["margin_tier", "marginTier"]);
  if (!entity) {
    throw new Error("Impossible de mettre à jour la tranche de marge.");
  }

  return entity as MarginTier;
}

export async function deleteMarginTier(tierId: string): Promise<void> {
  await requestJson<unknown>(
    `/api/margin-tiers/${tierId}`,
    {
      method: "DELETE",
    },
    "Impossible de supprimer la tranche de marge."
  );
}

export async function createEstimateSuggestionRule(
  versionId: string,
  rule: Pick<
    Database["public"]["Tables"]["estimate_suggestion_rules"]["Insert"],
    | "name"
    | "match_type"
    | "match_value"
    | "unit"
    | "category_id"
    | "k_fo"
    | "k_mo"
    | "labor_role_id"
    | "position"
    | "is_active"
  >
): Promise<SuggestionRule> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/suggestion-rules`,
    jsonRequest("POST", rule),
    "Impossible de créer la règle."
  );

  const entity = extractEntity(payload, ["suggestion_rule", "suggestionRule", "rule"]);
  if (!entity) {
    throw new Error("Impossible de créer la règle.");
  }

  return entity as SuggestionRule;
}

export async function updateEstimateSuggestionRule(
  versionId: string,
  ruleId: string,
  updates: Database["public"]["Tables"]["estimate_suggestion_rules"]["Update"]
): Promise<SuggestionRule | null> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/suggestion-rules/${ruleId}`,
    jsonRequest("PATCH", updates),
    "Impossible de mettre à jour la règle."
  );

  const entity = extractEntity(payload, ["suggestion_rule", "suggestionRule", "rule"]);
  return entity ? (entity as SuggestionRule) : null;
}

export async function sendEstimateSuggestionRuleFeedback(
  versionId: string,
  ruleId: string,
  feedback: SuggestionRuleFeedback,
  count?: number
): Promise<SuggestionRule | null> {
  const feedbackPayload: {
    feedback: SuggestionRuleFeedback;
    count?: number;
  } = {
    feedback,
  };
  if (typeof count === "number") {
    feedbackPayload.count = count;
  }

  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/suggestion-rules/${ruleId}/feedback`,
    jsonRequest("POST", feedbackPayload),
    "Impossible d'enregistrer le feedback de la règle."
  );

  const entity = extractEntity(payload, ["suggestion_rule", "suggestionRule", "rule"]);
  return entity ? (entity as SuggestionRule) : null;
}
