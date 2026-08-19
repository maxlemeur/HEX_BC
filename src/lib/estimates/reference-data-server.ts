import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ensureCategoryIsValid,
  ensureLaborRoleIsValid,
  getNextCategoryPosition,
  getNextLaborRolePosition,
  getNextSuggestionRulePosition,
} from "@/lib/estimates/estimate-reference-helpers";
import {
  assertDraftLockOwnedByCurrentUser,
  assertDraftStatus,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
  isTenantAdmin,
  toNullableText,
} from "@/lib/estimates/server-context";
import {
  badRequest,
  conflict,
  forbidden,
  mapSupabaseError,
  notFound,
} from "@/lib/estimates/errors";
import type {
  CreateEstimateCategoryInput,
  CreateLaborRoleInput,
  CreateMarginTierInput,
  CreateSuggestionRuleInput,
  SuggestionRuleFeedbackInput,
  UpdateLaborRoleInput,
  UpdateMarginTierInput,
  UpdateSuggestionRuleInput,
} from "@/lib/estimates/schemas";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;
type EstimateCategoryInsert =
  Database["public"]["Tables"]["estimate_categories"]["Insert"];
type LaborRoleInsert = Database["public"]["Tables"]["labor_roles"]["Insert"];
type LaborRoleUpdate = Database["public"]["Tables"]["labor_roles"]["Update"];
type MarginTierInsert = Database["public"]["Tables"]["margin_tiers"]["Insert"];
type MarginTierUpdate = Database["public"]["Tables"]["margin_tiers"]["Update"];
type SuggestionRuleInsert =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Insert"];
type SuggestionRuleUpdate =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Update"];

export async function createEstimateCategory(
  versionId: string,
  input: CreateEstimateCategoryInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(supabase, versionId, context);
  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const position =
    input.position ??
    (await getNextCategoryPosition(supabase, context, project.user_id));

  const { data, error } = await supabase
    .from("estimate_categories")
    .insert({
      tenant_id: tenantId,
      user_id: project.user_id,
      name: input.name.trim(),
      color: toNullableText(input.color),
      position,
    } as EstimateCategoryInsert)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de créer la catégorie.");
    }
    throw badRequest("Impossible de créer la catégorie.");
  }

  return {
    category: data,
  };
}

export async function createLaborRole(
  versionId: string,
  input: CreateLaborRoleInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(supabase, versionId, context);
  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const position =
    input.position ??
    (await getNextLaborRolePosition(supabase, context, project.user_id));

  const { data, error } = await supabase
    .from("labor_roles")
    .insert({
      tenant_id: tenantId,
      user_id: project.user_id,
      name: input.name.trim(),
      hourly_rate_cents: input.hourly_rate_cents ?? 0,
      is_active: input.is_active ?? true,
      position,
    } as LaborRoleInsert)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de créer le rôle.");
    }
    throw badRequest("Impossible de créer le rôle.");
  }

  return {
    labor_role: data,
  };
}

export async function updateLaborRole(
  versionId: string,
  roleId: string,
  input: UpdateLaborRoleInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(supabase, versionId, context);
  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const existingRoleQuery = supabase
    .from("labor_roles")
    .select("id")
    .eq("id", roleId)
    .eq("tenant_id", tenantId)
    .eq("user_id", project.user_id);

  const { data: existingRole, error: existingRoleError } = await existingRoleQuery.single();

  if (existingRoleError || !existingRole) {
    throw notFound("Role introuvable.");
  }

  const payload: LaborRoleUpdate = {};
  if ("name" in input) payload.name = input.name;
  if ("hourly_rate_cents" in input) {
    payload.hourly_rate_cents = input.hourly_rate_cents;
  }
  if ("is_active" in input) payload.is_active = input.is_active;
  if ("position" in input) payload.position = input.position;

  const updateRoleQuery = supabase
    .from("labor_roles")
    .update(payload)
    .eq("id", roleId)
    .eq("tenant_id", tenantId)
    .eq("user_id", project.user_id);

  const { data, error } = await updateRoleQuery.select("*").single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de mettre a jour le role.");
    }
    throw badRequest("Impossible de mettre a jour le role.");
  }

  return {
    labor_role: data,
  };
}

async function getNextMarginTierPosition(
  supabase: Supabase,
  tenantId: string
) {
  const { data, error } = await supabase
    .from("margin_tiers")
    .select("position")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: false })
    .limit(1);

  if (error) {
    throw mapSupabaseError(error, "Impossible de determiner la prochaine position.");
  }

  return (data?.[0]?.position ?? 0) + 1;
}

export async function createMarginTier(input: CreateMarginTierInput) {
  const { supabase, tenantId, tenantRole } = await getAuthenticatedContext();

  if (!isTenantAdmin(tenantRole)) {
    throw forbidden("Seul un administrateur peut gerer les tranches de marge.");
  }

  const position =
    input.position ?? (await getNextMarginTierPosition(supabase, tenantId));

  const { data, error } = await supabase
    .from("margin_tiers")
    .insert({
      tenant_id: tenantId,
      threshold_cents: input.threshold_cents,
      multiplier: input.multiplier,
      position,
    } as MarginTierInsert)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      if (error.message?.includes("threshold_cents")) {
        throw conflict("Une tranche avec ce seuil existe déjà pour ce tenant.");
      }
      if (error.message?.includes("position")) {
        throw conflict("Une tranche avec cette position existe déjà pour ce tenant.");
      }
      throw conflict("Conflit de données.", error);
    }
    throw mapSupabaseError(error, "Impossible de créer la tranche de marge.");
  }

  if (!data) {
    throw badRequest("Impossible de créer la tranche de marge.");
  }

  return { margin_tier: data };
}

export async function updateMarginTier(
  tierId: string,
  input: UpdateMarginTierInput
) {
  const { supabase, tenantId, tenantRole } = await getAuthenticatedContext();

  if (!isTenantAdmin(tenantRole)) {
    throw forbidden("Seul un administrateur peut gerer les tranches de marge.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("margin_tiers")
    .select("id")
    .eq("id", tierId)
    .eq("tenant_id", tenantId)
    .single();

  if (existingError || !existing) {
    throw notFound("Tranche de marge introuvable.");
  }

  const payload: MarginTierUpdate = {};
  if ("threshold_cents" in input) payload.threshold_cents = input.threshold_cents;
  if ("multiplier" in input) payload.multiplier = input.multiplier;
  if ("position" in input) payload.position = input.position;

  const { data, error } = await supabase
    .from("margin_tiers")
    .update(payload)
    .eq("id", tierId)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      if (error.message?.includes("threshold_cents")) {
        throw conflict("Une tranche avec ce seuil existe déjà pour ce tenant.");
      }
      if (error.message?.includes("position")) {
        throw conflict("Une tranche avec cette position existe déjà pour ce tenant.");
      }
      throw conflict("Conflit de données.", error);
    }
    throw mapSupabaseError(error, "Impossible de mettre a jour la tranche de marge.");
  }

  if (!data) {
    throw badRequest("Impossible de mettre a jour la tranche de marge.");
  }

  return { margin_tier: data };
}

export async function deleteMarginTier(tierId: string) {
  const { supabase, tenantId, tenantRole } = await getAuthenticatedContext();

  if (!isTenantAdmin(tenantRole)) {
    throw forbidden("Seul un administrateur peut gerer les tranches de marge.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("margin_tiers")
    .select("id")
    .eq("id", tierId)
    .eq("tenant_id", tenantId)
    .single();

  if (existingError || !existing) {
    throw notFound("Tranche de marge introuvable.");
  }

  const { error } = await supabase
    .from("margin_tiers")
    .delete()
    .eq("id", tierId)
    .eq("tenant_id", tenantId);

  if (error) {
    throw mapSupabaseError(error, "Impossible de supprimer la tranche de marge.");
  }

  return { deleted: true };
}

export async function createSuggestionRule(
  versionId: string,
  input: CreateSuggestionRuleInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(supabase, versionId, context);
  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const categoryId = input.category_id ?? null;
  const laborRoleId = input.labor_role_id ?? null;
  await ensureCategoryIsValid(supabase, categoryId, context, project.user_id);
  await ensureLaborRoleIsValid(supabase, laborRoleId, context, project.user_id);

  const position =
    input.position ??
    (await getNextSuggestionRulePosition(supabase, context, project.user_id));

  const { data, error } = await supabase
    .from("estimate_suggestion_rules")
    .insert({
      tenant_id: tenantId,
      user_id: project.user_id,
      name: input.name.trim(),
      match_type: input.match_type ?? "keyword",
      match_value: input.match_value.trim(),
      unit: toNullableText(input.unit),
      category_id: categoryId,
      k_fo: input.k_fo ?? null,
      k_mo: input.k_mo ?? null,
      labor_role_id: laborRoleId,
      position,
      is_active: input.is_active ?? true,
    } as SuggestionRuleInsert)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de créer la règle.");
    }
    throw badRequest("Impossible de créer la règle.");
  }

  return {
    suggestion_rule: data,
  };
}

export async function updateSuggestionRule(
  versionId: string,
  ruleId: string,
  input: UpdateSuggestionRuleInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(supabase, versionId, context);
  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const existingRuleQuery = supabase
    .from("estimate_suggestion_rules")
    .select("id")
    .eq("id", ruleId)
    .eq("tenant_id", tenantId)
    .eq("user_id", project.user_id);

  const { data: existingRule, error: existingRuleError } = await existingRuleQuery.single();

  if (existingRuleError || !existingRule) {
    throw notFound("Regle introuvable.");
  }

  const categoryId =
    "category_id" in input ? (input.category_id ?? null) : undefined;
  const laborRoleId =
    "labor_role_id" in input ? (input.labor_role_id ?? null) : undefined;

  if (categoryId !== undefined) {
    await ensureCategoryIsValid(supabase, categoryId, context, project.user_id);
  }
  if (laborRoleId !== undefined) {
    await ensureLaborRoleIsValid(supabase, laborRoleId, context, project.user_id);
  }

  const payload: SuggestionRuleUpdate = {};
  if ("name" in input) payload.name = input.name;
  if ("match_type" in input) payload.match_type = input.match_type;
  if ("match_value" in input) payload.match_value = input.match_value;
  if ("unit" in input) payload.unit = toNullableText(input.unit);
  if ("category_id" in input) payload.category_id = input.category_id ?? null;
  if ("k_fo" in input) payload.k_fo = input.k_fo ?? null;
  if ("k_mo" in input) payload.k_mo = input.k_mo ?? null;
  if ("labor_role_id" in input) {
    payload.labor_role_id = input.labor_role_id ?? null;
  }
  if ("position" in input) payload.position = input.position;
  if ("is_active" in input) payload.is_active = input.is_active;

  const updateRuleQuery = supabase
    .from("estimate_suggestion_rules")
    .update(payload)
    .eq("id", ruleId)
    .eq("tenant_id", tenantId)
    .eq("user_id", project.user_id);

  const { data, error } = await updateRuleQuery.select("*").single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de mettre a jour la regle.");
    }
    throw badRequest("Impossible de mettre a jour la regle.");
  }

  return {
    suggestion_rule: data,
  };
}

function toSuggestionUsageCount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return 0;
}

function toSuggestionFeedbackIncrement(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return parsed;
    }
  }

  return 1;
}

export async function saveSuggestionRuleFeedback(
  versionId: string,
  ruleId: string,
  input: SuggestionRuleFeedbackInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(supabase, versionId, context);
  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const existingRuleQuery = supabase
    .from("estimate_suggestion_rules")
    .select("*")
    .eq("id", ruleId)
    .eq("tenant_id", tenantId)
    .eq("user_id", project.user_id);

  const { data: existingRule, error: existingRuleError } =
    await existingRuleQuery.single();

  if (existingRuleError || !existingRule) {
    throw notFound("Regle introuvable.");
  }

  if (input.feedback === "reject") {
    return {
      suggestion_rule: existingRule,
      feedback: input.feedback,
    };
  }

  const existingRuleRecord = existingRule as unknown as Record<string, unknown>;
  let usageCount = toSuggestionUsageCount(existingRuleRecord.usage_count);
  const incrementBy = toSuggestionFeedbackIncrement(input.count);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nowIso = new Date().toISOString();
    const payload: SuggestionRuleUpdate = {
      usage_count: usageCount + incrementBy,
      last_used_at: nowIso,
    };

    const updateRuleQuery = supabase
      .from("estimate_suggestion_rules")
      .update(payload)
      .eq("id", ruleId)
      .eq("tenant_id", tenantId)
      .eq("user_id", project.user_id)
      .eq("usage_count", usageCount);

    const { data, error } = await updateRuleQuery.select("*").maybeSingle();

    if (error) {
      throw mapSupabaseError(error, "Impossible d'enregistrer le feedback de la regle.");
    }

    if (data) {
      return {
        suggestion_rule: data,
        feedback: input.feedback,
      };
    }

    const { data: latestRule, error: latestRuleError } = await supabase
      .from("estimate_suggestion_rules")
      .select("usage_count")
      .eq("id", ruleId)
      .eq("tenant_id", tenantId)
      .eq("user_id", project.user_id)
      .maybeSingle();

    if (latestRuleError) {
      throw mapSupabaseError(
        latestRuleError,
        "Impossible d'enregistrer le feedback de la regle."
      );
    }

    if (!latestRule) {
      throw notFound("Regle introuvable.");
    }

    usageCount = toSuggestionUsageCount(
      (latestRule as unknown as Record<string, unknown>).usage_count
    );
  }

  throw conflict("La règle a été modifiée simultanément. Veuillez réessayer.");
}
