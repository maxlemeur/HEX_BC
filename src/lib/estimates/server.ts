import type { SupabaseClient } from "@supabase/supabase-js";

import { computeEstimateLineValues } from "@/lib/estimate-calculations";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import {
  badRequest,
  conflict,
  forbidden,
  mapSupabaseError,
  notFound,
  unauthorized,
} from "./errors";
import type {
  BulkUpdateEstimateItemsInput,
  CreateEstimateInput,
  CreateEstimateCategoryInput,
  CreateEstimateItemInput,
  CreateLaborRoleInput,
  CreateSuggestionRuleInput,
  DeleteEstimateItemInput,
  PatchEstimateStatusInput,
  PatchEstimateVersionInput,
  ReorderEstimateItemsInput,
  UpdateLaborRoleInput,
  UpdateSuggestionRuleInput,
  UpdateEstimateItemInput,
} from "./schemas";

type Supabase = SupabaseClient<Database>;

type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateVersionInsert = Database["public"]["Tables"]["estimate_versions"]["Insert"];
type EstimateVersionUpdate = Database["public"]["Tables"]["estimate_versions"]["Update"];
type EstimateCategoryInsert = Database["public"]["Tables"]["estimate_categories"]["Insert"];
type EstimateCategoryRow = Database["public"]["Tables"]["estimate_categories"]["Row"];
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateItemInsert = Database["public"]["Tables"]["estimate_items"]["Insert"];
type EstimateItemUpdate = Database["public"]["Tables"]["estimate_items"]["Update"];
type LaborRoleInsert = Database["public"]["Tables"]["labor_roles"]["Insert"];
type LaborRoleUpdate = Database["public"]["Tables"]["labor_roles"]["Update"];
type LaborRoleRow = Database["public"]["Tables"]["labor_roles"]["Row"];
type SuggestionRuleInsert =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Insert"];
type SuggestionRuleUpdate =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Update"];
type SuggestionRuleRow =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];
type EstimateStatus = Database["public"]["Enums"]["estimate_status"];

type EmbeddedProjectAccess = Pick<
  EstimateProjectRow,
  "id" | "user_id" | "name" | "reference" | "client_name" | "notes" | "is_archived"
>;

type VersionAccessRow = Pick<
  EstimateVersionRow,
  "id" | "project_id" | "status" | "margin_multiplier" | "tax_rate_bp"
> & {
  estimate_projects: EmbeddedProjectAccess | EmbeddedProjectAccess[] | null;
};

type EstimateListProject = Pick<
  EstimateProjectRow,
  "id" | "name" | "reference" | "client_name" | "is_archived"
>;

type EstimateListRow = Pick<
  EstimateVersionRow,
  | "id"
  | "project_id"
  | "version_number"
  | "status"
  | "title"
  | "updated_at"
  | "total_ht_cents"
> & {
  estimate_projects: EstimateListProject | EstimateListProject[] | null;
};

type EstimateVersionDetailsRow = EstimateVersionRow & {
  estimate_projects: EmbeddedProjectAccess | EmbeddedProjectAccess[] | null;
};

const DEFAULT_VALIDITE_JOURS = 30;
const DEFAULT_MARGIN_MULTIPLIER = 1;
const DEFAULT_TAX_RATE_BP = 2000;
const DEFAULT_ROUNDING_MODE: EstimateVersionRow["rounding_mode"] = "none";
const DEFAULT_ROUNDING_STEP_CENTS = 1;
const DEFAULT_CURRENCY = "EUR";

const DEFAULT_ESTIMATE_CATEGORIES = [
  { name: "Materiaux", position: 1 },
  { name: "Main d'oeuvre", position: 2 },
  { name: "Sous-traitance", position: 3 },
] as const;

function resolveEmbeddedOne<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function toNullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

async function getAuthenticatedContext() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw unauthorized();
  }

  return {
    supabase,
    userId: user.id,
  };
}

async function getVersionAccessOrThrow(
  supabase: Supabase,
  versionId: string,
  userId: string
): Promise<{ version: VersionAccessRow; project: EmbeddedProjectAccess }> {
  const { data, error } = await supabase
    .from("estimate_versions")
    .select(
      "id, project_id, status, margin_multiplier, tax_rate_bp, estimate_projects!inner(id, user_id, name, reference, client_name, notes, is_archived)"
    )
    .eq("id", versionId)
    .single();

  if (error || !data) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const row = data as unknown as VersionAccessRow;
  const project = resolveEmbeddedOne(row.estimate_projects);

  if (!project || project.user_id !== userId) {
    throw notFound("Version de chiffrage introuvable.");
  }

  return {
    version: row,
    project,
  };
}

function assertDraftStatus(status: EstimateStatus) {
  if (status === "draft") return;
  throw forbidden("Cette version est en lecture seule.", undefined, "READ_ONLY");
}

async function getNextItemPosition(
  supabase: Supabase,
  versionId: string,
  parentId: string | null
) {
  let query = supabase
    .from("estimate_items")
    .select("position")
    .eq("version_id", versionId)
    .order("position", { ascending: false })
    .limit(1);

  query = parentId === null ? query.is("parent_id", null) : query.eq("parent_id", parentId);

  const { data, error } = await query;

  if (error) {
    throw mapSupabaseError(error, "Impossible de determiner la prochaine position.");
  }

  return (data?.[0]?.position ?? 0) + 1;
}

async function ensureParentIsValid({
  supabase,
  versionId,
  parentId,
  itemId,
}: {
  supabase: Supabase;
  versionId: string;
  parentId: string | null;
  itemId?: string;
}) {
  if (parentId === null) return;

  const { data, error } = await supabase
    .from("estimate_items")
    .select("id, version_id, item_type")
    .eq("id", parentId)
    .single();

  if (error || !data) {
    throw badRequest("parent_id invalide.");
  }

  if (data.version_id !== versionId) {
    throw badRequest("parent_id doit appartenir a la meme version.");
  }

  if (data.item_type !== "section") {
    throw badRequest("Le parent doit etre de type section.");
  }

  if (itemId && data.id === itemId) {
    throw badRequest("Un element ne peut pas etre son propre parent.");
  }
}

async function ensureCategoryIsValid(
  supabase: Supabase,
  categoryId: string | null,
  userId: string
) {
  if (categoryId === null) return;

  const { data, error } = await supabase
    .from("estimate_categories")
    .select("id, user_id")
    .eq("id", categoryId)
    .single();

  if (error || !data || data.user_id !== userId) {
    throw badRequest("category_id invalide.");
  }
}

async function resolveLaborRateCents(
  supabase: Supabase,
  laborRoleId: string | null,
  userId: string
) {
  if (laborRoleId === null) return 0;

  const { data, error } = await supabase
    .from("labor_roles")
    .select("id, user_id, hourly_rate_cents")
    .eq("id", laborRoleId)
    .single();

  if (error || !data || data.user_id !== userId) {
    throw badRequest("labor_role_id invalide.");
  }

  return data.hourly_rate_cents;
}

async function ensureLaborRoleIsValid(
  supabase: Supabase,
  laborRoleId: string | null,
  userId: string
) {
  if (laborRoleId === null) return;

  const { data, error } = await supabase
    .from("labor_roles")
    .select("id, user_id")
    .eq("id", laborRoleId)
    .single();

  if (error || !data || data.user_id !== userId) {
    throw badRequest("labor_role_id invalide.");
  }
}

async function getNextCategoryPosition(supabase: Supabase, userId: string) {
  const { data, error } = await supabase
    .from("estimate_categories")
    .select("position")
    .eq("user_id", userId)
    .order("position", { ascending: false })
    .limit(1);

  if (error) {
    throw mapSupabaseError(error, "Impossible de determiner la prochaine position.");
  }

  return (data?.[0]?.position ?? 0) + 1;
}

async function getNextLaborRolePosition(supabase: Supabase, userId: string) {
  const { data, error } = await supabase
    .from("labor_roles")
    .select("position")
    .eq("user_id", userId)
    .order("position", { ascending: false })
    .limit(1);

  if (error) {
    throw mapSupabaseError(error, "Impossible de determiner la prochaine position.");
  }

  return (data?.[0]?.position ?? 0) + 1;
}

async function getNextSuggestionRulePosition(supabase: Supabase, userId: string) {
  const { data, error } = await supabase
    .from("estimate_suggestion_rules")
    .select("position")
    .eq("user_id", userId)
    .order("position", { ascending: false })
    .limit(1);

  if (error) {
    throw mapSupabaseError(error, "Impossible de determiner la prochaine position.");
  }

  return (data?.[0]?.position ?? 0) + 1;
}

export async function listLatestEstimates() {
  const { supabase, userId } = await getAuthenticatedContext();

  const { data, error } = await supabase
    .from("estimate_versions")
    .select(
      "id, project_id, version_number, status, title, updated_at, total_ht_cents, estimate_projects!inner(id, name, reference, client_name, is_archived)"
    )
    .eq("estimate_projects.user_id", userId)
    .eq("estimate_projects.is_archived", false)
    .neq("status", "archived")
    .order("version_number", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger la liste des chiffrages.");
  }

  const rows = (data ?? []) as unknown as EstimateListRow[];
  const latestByProject = new Map<
    string,
    {
      project_id: string;
      project_name: string;
      project_reference: string | null;
      project_client_name: string | null;
      version_id: string;
      version_number: number;
      status: EstimateStatus;
      title: string | null;
      updated_at: string;
      total_ht_cents: number;
    }
  >();

  rows.forEach((row) => {
    const project = resolveEmbeddedOne(row.estimate_projects);
    if (!project) return;
    if (latestByProject.has(row.project_id)) return;

    latestByProject.set(row.project_id, {
      project_id: row.project_id,
      project_name: project.name,
      project_reference: project.reference,
      project_client_name: project.client_name,
      version_id: row.id,
      version_number: row.version_number,
      status: row.status,
      title: row.title,
      updated_at: row.updated_at,
      total_ht_cents: row.total_ht_cents,
    });
  });

  const items = Array.from(latestByProject.values()).sort((left, right) => {
    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  });

  return {
    items,
  };
}

export async function duplicateEstimateVersion(versionId: string) {
  const { supabase, userId } = await getAuthenticatedContext();
  await getVersionAccessOrThrow(supabase, versionId, userId);

  const { data, error } = await supabase.rpc("duplicate_estimate_version", {
    source_version_id: versionId,
  });

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de dupliquer le chiffrage.");
    }
    throw badRequest("Impossible de dupliquer le chiffrage.");
  }

  return {
    version_id: data,
  };
}

export async function createEstimate(input: CreateEstimateInput) {
  const { supabase, userId } = await getAuthenticatedContext();

  const { data: project, error: projectError } = await supabase
    .from("estimate_projects")
    .insert({
      user_id: userId,
      name: input.project.name,
      reference: toNullableText(input.project.reference),
      client_name: toNullableText(input.project.client_name),
      notes: toNullableText(input.project.notes),
      is_archived: false,
    })
    .select("*")
    .single();

  if (projectError || !project) {
    if (projectError) {
      throw mapSupabaseError(projectError, "Impossible de creer le projet de chiffrage.");
    }
    throw badRequest("Impossible de creer le projet de chiffrage.");
  }

  const versionPayload: EstimateVersionInsert = {
    project_id: project.id,
    version_number: 1,
    status: "draft",
    title: toNullableText(input.version?.title),
    date_devis: input.version?.date_devis ?? todayDateOnly(),
    validite_jours: input.version?.validite_jours ?? DEFAULT_VALIDITE_JOURS,
    margin_multiplier: input.version?.margin_multiplier ?? DEFAULT_MARGIN_MULTIPLIER,
    currency: input.version?.currency?.trim() || DEFAULT_CURRENCY,
    margin_bp: input.version?.margin_bp ?? 0,
    discount_bp: input.version?.discount_bp ?? 0,
    tax_rate_bp: input.version?.tax_rate_bp ?? DEFAULT_TAX_RATE_BP,
    rounding_mode: input.version?.rounding_mode ?? DEFAULT_ROUNDING_MODE,
    rounding_step_cents:
      input.version?.rounding_step_cents ?? DEFAULT_ROUNDING_STEP_CENTS,
    total_ht_cents: 0,
    total_tax_cents: 0,
    total_ttc_cents: 0,
  };

  const { data: version, error: versionError } = await supabase
    .from("estimate_versions")
    .insert(versionPayload)
    .select("*")
    .single();

  if (versionError || !version) {
    await supabase.from("estimate_projects").delete().eq("id", project.id);

    if (versionError) {
      throw mapSupabaseError(versionError, "Impossible de creer la version initiale.");
    }

    throw badRequest("Impossible de creer la version initiale.");
  }

  const categoriesPayload: EstimateCategoryInsert[] = DEFAULT_ESTIMATE_CATEGORIES.map(
    (category) => ({
      user_id: userId,
      name: category.name,
      position: category.position,
      color: null,
    })
  );

  const { error: categoriesError } = await supabase
    .from("estimate_categories")
    .upsert(categoriesPayload, {
      onConflict: "user_id,name",
      ignoreDuplicates: true,
    });

  if (categoriesError) {
    await supabase.from("estimate_projects").delete().eq("id", project.id);
    throw mapSupabaseError(categoriesError, "Impossible de preparer les categories par defaut.");
  }

  return {
    project,
    version,
  };
}

export async function getEstimateVersionDetails(versionId: string) {
  const { supabase, userId } = await getAuthenticatedContext();

  const { data: versionData, error: versionError } = await supabase
    .from("estimate_versions")
    .select(
      "*, estimate_projects!inner(id, user_id, name, reference, client_name, notes, is_archived)"
    )
    .eq("id", versionId)
    .single();

  if (versionError || !versionData) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const version = versionData as unknown as EstimateVersionDetailsRow;
  const project = resolveEmbeddedOne(version.estimate_projects);

  if (!project || project.user_id !== userId) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const [itemsResult, categoriesResult, laborRolesResult, rulesResult] =
    await Promise.all([
      supabase
        .from("estimate_items")
        .select("*")
        .eq("version_id", versionId)
        .order("position", { ascending: true }),
      supabase
        .from("estimate_categories")
        .select("*")
        .eq("user_id", userId)
        .order("position", { ascending: true }),
      supabase
        .from("labor_roles")
        .select("*")
        .eq("user_id", userId)
        .order("position", { ascending: true }),
      supabase
        .from("estimate_suggestion_rules")
        .select("*")
        .eq("user_id", userId)
        .order("position", { ascending: true }),
    ]);

  if (itemsResult.error) {
    throw mapSupabaseError(itemsResult.error, "Impossible de charger les lignes.");
  }

  if (categoriesResult.error) {
    throw mapSupabaseError(
      categoriesResult.error,
      "Impossible de charger les categories."
    );
  }

  if (laborRolesResult.error) {
    throw mapSupabaseError(
      laborRolesResult.error,
      "Impossible de charger les roles de main d'oeuvre."
    );
  }

  if (rulesResult.error) {
    throw mapSupabaseError(
      rulesResult.error,
      "Impossible de charger les regles de suggestion."
    );
  }

  return {
    version: {
      ...version,
      estimate_projects: project,
    },
    items: (itemsResult.data ?? []) as EstimateItemRow[],
    categories: (categoriesResult.data ?? []) as EstimateCategoryRow[],
    labor_roles: (laborRolesResult.data ?? []) as LaborRoleRow[],
    suggestion_rules: (rulesResult.data ?? []) as SuggestionRuleRow[],
  };
}

export async function listEstimateItems(versionId: string) {
  const { supabase, userId } = await getAuthenticatedContext();
  await getVersionAccessOrThrow(supabase, versionId, userId);

  const { data, error } = await supabase
    .from("estimate_items")
    .select("*")
    .eq("version_id", versionId)
    .order("position", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les lignes.");
  }

  return {
    items: (data ?? []) as EstimateItemRow[],
  };
}

export async function patchEstimateVersion(
  versionId: string,
  input: PatchEstimateVersionInput
) {
  const { supabase, userId } = await getAuthenticatedContext();
  const { version } = await getVersionAccessOrThrow(supabase, versionId, userId);

  assertDraftStatus(version.status);

  const payload: EstimateVersionUpdate = {};

  if ("title" in input) {
    payload.title = toNullableText(input.title);
  }
  if ("date_devis" in input) {
    payload.date_devis = input.date_devis;
  }
  if ("validite_jours" in input) {
    payload.validite_jours = input.validite_jours;
  }
  if ("margin_multiplier" in input) {
    payload.margin_multiplier = input.margin_multiplier;
  }
  if ("currency" in input && typeof input.currency === "string") {
    payload.currency = input.currency.trim();
  }
  if ("margin_bp" in input) {
    payload.margin_bp = input.margin_bp;
  }
  if ("discount_bp" in input) {
    payload.discount_bp = input.discount_bp;
  }
  if ("tax_rate_bp" in input) {
    payload.tax_rate_bp = input.tax_rate_bp;
  }
  if ("rounding_mode" in input) {
    payload.rounding_mode = input.rounding_mode;
  }
  if ("rounding_step_cents" in input) {
    payload.rounding_step_cents = input.rounding_step_cents;
  }
  if ("total_ht_cents" in input) {
    payload.total_ht_cents = input.total_ht_cents;
  }
  if ("total_tax_cents" in input) {
    payload.total_tax_cents = input.total_tax_cents;
  }
  if ("total_ttc_cents" in input) {
    payload.total_ttc_cents = input.total_ttc_cents;
  }

  const { data, error } = await supabase
    .from("estimate_versions")
    .update(payload)
    .eq("id", versionId)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de mettre a jour la version.");
    }
    throw badRequest("Impossible de mettre a jour la version.");
  }

  return {
    version: data,
  };
}

export async function patchEstimateStatus(
  versionId: string,
  input: PatchEstimateStatusInput
) {
  const { supabase, userId } = await getAuthenticatedContext();
  const { version } = await getVersionAccessOrThrow(supabase, versionId, userId);

  if (version.status === input.status) {
    const { data, error } = await supabase
      .from("estimate_versions")
      .select("*")
      .eq("id", versionId)
      .single();

    if (error || !data) {
      if (error) {
        throw mapSupabaseError(error, "Impossible de charger la version.");
      }
      throw notFound("Version de chiffrage introuvable.");
    }

    return {
      version: data,
    };
  }

  const { data, error } = await supabase
    .from("estimate_versions")
    .update({ status: input.status })
    .eq("id", versionId)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de changer le statut.");
    }
    throw badRequest("Impossible de changer le statut.");
  }

  return {
    version: data,
  };
}

export async function createEstimateCategory(
  versionId: string,
  input: CreateEstimateCategoryInput
) {
  const { supabase, userId } = await getAuthenticatedContext();
  await getVersionAccessOrThrow(supabase, versionId, userId);

  const position =
    input.position ?? (await getNextCategoryPosition(supabase, userId));

  const { data, error } = await supabase
    .from("estimate_categories")
    .insert({
      user_id: userId,
      name: input.name.trim(),
      color: toNullableText(input.color),
      position,
    } as EstimateCategoryInsert)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de creer la categorie.");
    }
    throw badRequest("Impossible de creer la categorie.");
  }

  return {
    category: data,
  };
}

export async function createLaborRole(
  versionId: string,
  input: CreateLaborRoleInput
) {
  const { supabase, userId } = await getAuthenticatedContext();
  await getVersionAccessOrThrow(supabase, versionId, userId);

  const position =
    input.position ?? (await getNextLaborRolePosition(supabase, userId));

  const { data, error } = await supabase
    .from("labor_roles")
    .insert({
      user_id: userId,
      name: input.name.trim(),
      hourly_rate_cents: input.hourly_rate_cents ?? 0,
      is_active: input.is_active ?? true,
      position,
    } as LaborRoleInsert)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de creer le role.");
    }
    throw badRequest("Impossible de creer le role.");
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
  const { supabase, userId } = await getAuthenticatedContext();
  await getVersionAccessOrThrow(supabase, versionId, userId);

  const { data: existingRole, error: existingRoleError } = await supabase
    .from("labor_roles")
    .select("id")
    .eq("id", roleId)
    .eq("user_id", userId)
    .single();

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

  const { data, error } = await supabase
    .from("labor_roles")
    .update(payload)
    .eq("id", roleId)
    .eq("user_id", userId)
    .select("*")
    .single();

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

export async function createSuggestionRule(
  versionId: string,
  input: CreateSuggestionRuleInput
) {
  const { supabase, userId } = await getAuthenticatedContext();
  await getVersionAccessOrThrow(supabase, versionId, userId);

  const categoryId = input.category_id ?? null;
  const laborRoleId = input.labor_role_id ?? null;
  await ensureCategoryIsValid(supabase, categoryId, userId);
  await ensureLaborRoleIsValid(supabase, laborRoleId, userId);

  const position =
    input.position ?? (await getNextSuggestionRulePosition(supabase, userId));

  const { data, error } = await supabase
    .from("estimate_suggestion_rules")
    .insert({
      user_id: userId,
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
      throw mapSupabaseError(error, "Impossible de creer la regle.");
    }
    throw badRequest("Impossible de creer la regle.");
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
  const { supabase, userId } = await getAuthenticatedContext();
  await getVersionAccessOrThrow(supabase, versionId, userId);

  const { data: existingRule, error: existingRuleError } = await supabase
    .from("estimate_suggestion_rules")
    .select("id")
    .eq("id", ruleId)
    .eq("user_id", userId)
    .single();

  if (existingRuleError || !existingRule) {
    throw notFound("Regle introuvable.");
  }

  const categoryId =
    "category_id" in input ? (input.category_id ?? null) : undefined;
  const laborRoleId =
    "labor_role_id" in input ? (input.labor_role_id ?? null) : undefined;

  if (categoryId !== undefined) {
    await ensureCategoryIsValid(supabase, categoryId, userId);
  }
  if (laborRoleId !== undefined) {
    await ensureLaborRoleIsValid(supabase, laborRoleId, userId);
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

  const { data, error } = await supabase
    .from("estimate_suggestion_rules")
    .update(payload)
    .eq("id", ruleId)
    .eq("user_id", userId)
    .select("*")
    .single();

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

export async function createEstimateItem(
  versionId: string,
  input: CreateEstimateItemInput
) {
  const { supabase, userId } = await getAuthenticatedContext();
  const { version } = await getVersionAccessOrThrow(supabase, versionId, userId);

  assertDraftStatus(version.status);

  const parentId = input.parent_id ?? null;
  await ensureParentIsValid({
    supabase,
    versionId,
    parentId,
  });

  const position = input.position ?? (await getNextItemPosition(supabase, versionId, parentId));

  if (input.item_type === "section") {
    const title = input.title ?? (parentId ? "Nouveau sous-chapitre" : "Nouveau chapitre");

    const { data, error } = await supabase
      .from("estimate_items")
      .insert({
        version_id: versionId,
        parent_id: parentId,
        item_type: "section",
        position,
        title,
      } as EstimateItemInsert)
      .select("*")
      .single();

    if (error || !data) {
      if (error) {
        throw mapSupabaseError(error, "Impossible de creer le chapitre.");
      }
      throw badRequest("Impossible de creer le chapitre.");
    }

    return {
      item: data,
    };
  }

  const title = input.title ?? "Nouvelle ligne";
  const description = toNullableText(input.description);
  const quantity = input.quantity ?? 1;
  const unitPriceHtCents = input.unit_price_ht_cents ?? 0;
  const taxRateBp = input.tax_rate_bp ?? version.tax_rate_bp ?? DEFAULT_TAX_RATE_BP;
  const kFo = input.k_fo ?? 1;
  const hMo = input.h_mo ?? 0;
  const kMo = input.k_mo ?? 1;
  const laborRoleId = input.labor_role_id ?? null;
  const categoryId = input.category_id ?? null;

  await ensureCategoryIsValid(supabase, categoryId, userId);
  const laborRateCents = await resolveLaborRateCents(supabase, laborRoleId, userId);

  const lineValues = computeEstimateLineValues(
    {
      quantity,
      unit_price_ht_cents: unitPriceHtCents,
      tax_rate_bp: taxRateBp,
      k_fo: kFo,
      h_mo: hMo,
      k_mo: kMo,
      pu_ht_cents: 0,
      labor_role_hourly_rate_cents: laborRateCents,
    },
    {
      marginMultiplier: version.margin_multiplier,
      taxRateBp,
    }
  );

  const { data, error } = await supabase
    .from("estimate_items")
    .insert({
      version_id: versionId,
      parent_id: parentId,
      item_type: "line",
      position,
      title,
      description,
      quantity,
      unit_price_ht_cents: unitPriceHtCents,
      tax_rate_bp: taxRateBp,
      k_fo: kFo,
      h_mo: hMo,
      k_mo: kMo,
      pu_ht_cents: lineValues.puHtCents,
      labor_role_id: laborRoleId,
      category_id: categoryId,
      line_total_ht_cents: lineValues.saleLineCents,
      line_tax_cents: lineValues.taxLineCents,
      line_total_ttc_cents: lineValues.ttcLineCents,
    } as EstimateItemInsert)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de creer la ligne.");
    }
    throw badRequest("Impossible de creer la ligne.");
  }

  return {
    item: data,
  };
}

const SECTION_ONLY_FORBIDDEN_FIELDS: (keyof UpdateEstimateItemInput)[] = [
  "description",
  "quantity",
  "unit_price_ht_cents",
  "tax_rate_bp",
  "k_fo",
  "h_mo",
  "k_mo",
  "labor_role_id",
  "category_id",
];

export async function updateEstimateItem(
  versionId: string,
  input: UpdateEstimateItemInput
) {
  const { supabase, userId } = await getAuthenticatedContext();
  const { version } = await getVersionAccessOrThrow(supabase, versionId, userId);

  assertDraftStatus(version.status);

  const { data: currentItem, error: currentItemError } = await supabase
    .from("estimate_items")
    .select("*")
    .eq("id", input.id)
    .eq("version_id", versionId)
    .single();

  if (currentItemError || !currentItem) {
    throw notFound("Element de chiffrage introuvable.");
  }

  const nextParentId =
    "parent_id" in input ? (input.parent_id ?? null) : currentItem.parent_id;

  await ensureParentIsValid({
    supabase,
    versionId,
    parentId: nextParentId,
    itemId: currentItem.id,
  });

  if (currentItem.item_type === "section") {
    const containsLineFields = SECTION_ONLY_FORBIDDEN_FIELDS.some((fieldName) => {
      return fieldName in input;
    });

    if (containsLineFields) {
      throw badRequest("Les champs de ligne ne sont pas autorises pour une section.");
    }

    const payload: EstimateItemUpdate = {};

    if ("title" in input) {
      payload.title = input.title;
    }

    if ("parent_id" in input) {
      payload.parent_id = input.parent_id ?? null;
    }

    if ("position" in input) {
      payload.position = input.position;
    }

    const { data, error } = await supabase
      .from("estimate_items")
      .update(payload)
      .eq("id", currentItem.id)
      .eq("version_id", versionId)
      .select("*")
      .single();

    if (error || !data) {
      if (error) {
        throw mapSupabaseError(error, "Impossible de mettre a jour la section.");
      }
      throw badRequest("Impossible de mettre a jour la section.");
    }

    return {
      item: data,
    };
  }

  const nextTitle =
    ("title" in input ? input.title : currentItem.title) ?? currentItem.title;
  const nextDescription =
    ("description" in input
      ? toNullableText(input.description)
      : currentItem.description) ?? null;
  const nextQuantity =
    ("quantity" in input ? input.quantity : currentItem.quantity) ?? 0;
  const nextUnitPriceHtCents =
    ("unit_price_ht_cents" in input
      ? input.unit_price_ht_cents
      : currentItem.unit_price_ht_cents) ?? 0;
  const nextTaxRateBp =
    ("tax_rate_bp" in input
      ? input.tax_rate_bp
      : currentItem.tax_rate_bp) ??
    version.tax_rate_bp ??
    DEFAULT_TAX_RATE_BP;
  const nextKFo = ("k_fo" in input ? input.k_fo : currentItem.k_fo) ?? 1;
  const nextHMo = ("h_mo" in input ? input.h_mo : currentItem.h_mo) ?? 0;
  const nextKMo = ("k_mo" in input ? input.k_mo : currentItem.k_mo) ?? 1;
  const nextLaborRoleId =
    "labor_role_id" in input ? (input.labor_role_id ?? null) : currentItem.labor_role_id;
  const nextCategoryId =
    "category_id" in input ? (input.category_id ?? null) : currentItem.category_id;
  const nextPosition =
    ("position" in input ? input.position : currentItem.position) ??
    currentItem.position;

  await ensureCategoryIsValid(supabase, nextCategoryId, userId);
  const laborRateCents = await resolveLaborRateCents(supabase, nextLaborRoleId, userId);

  const lineValues = computeEstimateLineValues(
    {
      quantity: nextQuantity,
      unit_price_ht_cents: nextUnitPriceHtCents,
      tax_rate_bp: nextTaxRateBp,
      k_fo: nextKFo,
      h_mo: nextHMo,
      k_mo: nextKMo,
      pu_ht_cents: currentItem.pu_ht_cents,
      labor_role_hourly_rate_cents: laborRateCents,
    },
    {
      marginMultiplier: version.margin_multiplier,
      taxRateBp: nextTaxRateBp,
    }
  );

  const payload: EstimateItemUpdate = {
    parent_id: nextParentId,
    position: nextPosition,
    title: nextTitle,
    description: nextDescription,
    quantity: nextQuantity,
    unit_price_ht_cents: nextUnitPriceHtCents,
    tax_rate_bp: nextTaxRateBp,
    k_fo: nextKFo,
    h_mo: nextHMo,
    k_mo: nextKMo,
    pu_ht_cents: lineValues.puHtCents,
    labor_role_id: nextLaborRoleId,
    category_id: nextCategoryId,
    line_total_ht_cents: lineValues.saleLineCents,
    line_tax_cents: lineValues.taxLineCents,
    line_total_ttc_cents: lineValues.ttcLineCents,
  };

  const { data, error } = await supabase
    .from("estimate_items")
    .update(payload)
    .eq("id", currentItem.id)
    .eq("version_id", versionId)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de mettre a jour la ligne.");
    }
    throw badRequest("Impossible de mettre a jour la ligne.");
  }

  return {
    item: data,
  };
}

export async function bulkUpdateEstimateItems(
  versionId: string,
  input: BulkUpdateEstimateItemsInput
) {
  const { supabase, userId } = await getAuthenticatedContext();
  const { version } = await getVersionAccessOrThrow(supabase, versionId, userId);

  assertDraftStatus(version.status);

  const updatesPayload = input.map((item) => ({ ...item }));

  const { data: updatedCount, error: bulkUpdateError } = await supabase.rpc(
    "bulk_update_estimate_items",
    {
      target_version_id: versionId,
      item_updates: updatesPayload,
    }
  );

  if (bulkUpdateError) {
    throw mapSupabaseError(
      bulkUpdateError,
      "Impossible de mettre a jour les lignes."
    );
  }

  const normalizedUpdatedCount = updatedCount ?? 0;

  if (normalizedUpdatedCount !== input.length) {
    throw conflict("La liste de mise a jour est obsolete.", {
      expected_count: input.length,
      updated_count: normalizedUpdatedCount,
    });
  }

  return {
    updated_count: normalizedUpdatedCount,
  };
}

export async function deleteEstimateItem(
  versionId: string,
  input: DeleteEstimateItemInput
) {
  const { supabase, userId } = await getAuthenticatedContext();
  const { version } = await getVersionAccessOrThrow(supabase, versionId, userId);

  assertDraftStatus(version.status);

  const { data: currentItem, error: currentItemError } = await supabase
    .from("estimate_items")
    .select("id")
    .eq("id", input.id)
    .eq("version_id", versionId)
    .single();

  if (currentItemError || !currentItem) {
    throw notFound("Element de chiffrage introuvable.");
  }

  const { error } = await supabase
    .from("estimate_items")
    .delete()
    .eq("id", input.id)
    .eq("version_id", versionId);

  if (error) {
    throw mapSupabaseError(error, "Impossible de supprimer l'element.");
  }

  return {
    deleted_id: input.id,
  };
}

export async function reorderEstimateItems(
  versionId: string,
  input: ReorderEstimateItemsInput
) {
  const { supabase, userId } = await getAuthenticatedContext();
  const { version } = await getVersionAccessOrThrow(supabase, versionId, userId);

  assertDraftStatus(version.status);

  const parentId = input.parent_id ?? null;

  await ensureParentIsValid({
    supabase,
    versionId,
    parentId,
  });

  let siblingsQuery = supabase
    .from("estimate_items")
    .select("id")
    .eq("version_id", versionId);

  siblingsQuery = parentId === null
    ? siblingsQuery.is("parent_id", null)
    : siblingsQuery.eq("parent_id", parentId);

  const { data: siblings, error: siblingsError } = await siblingsQuery;

  if (siblingsError) {
    throw mapSupabaseError(siblingsError, "Impossible de charger les lignes a reordonner.");
  }

  const siblingIds = (siblings ?? []).map((item) => item.id);

  if (siblingIds.length === 0) {
    throw notFound("Aucun element a reordonner pour ce parent.");
  }

  const receivedSet = new Set(input.ordered_ids);
  const expectedSet = new Set(siblingIds);

  const hasUnknownIds = input.ordered_ids.some((id) => !expectedSet.has(id));
  const hasMissingIds = siblingIds.some((id) => !receivedSet.has(id));

  if (
    input.ordered_ids.length !== siblingIds.length ||
    hasUnknownIds ||
    hasMissingIds
  ) {
    throw conflict("La liste de reordonnancement est obsolete.", {
      expected_ids: siblingIds,
      received_ids: input.ordered_ids,
    });
  }

  const { data: updatedCount, error: reorderError } = await supabase.rpc(
    "reorder_estimate_items",
    {
      target_version_id: versionId,
      target_parent_id: parentId,
      ordered_item_ids: input.ordered_ids,
    }
  );

  if (reorderError) {
    throw mapSupabaseError(reorderError, "Impossible de reordonner les lignes.");
  }

  const normalizedUpdatedCount = updatedCount ?? 0;

  if (normalizedUpdatedCount !== input.ordered_ids.length) {
    throw conflict("La liste de reordonnancement est obsolete.", {
      expected_ids: siblingIds,
      received_ids: input.ordered_ids,
      updated_count: normalizedUpdatedCount,
    });
  }

  return {
    parent_id: parentId,
    ordered_ids: input.ordered_ids,
    updated_count: normalizedUpdatedCount,
  };
}
