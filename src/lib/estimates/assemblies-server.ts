import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeDraftItems } from "@/lib/estimate-calculations";
import { resolveCalcEngineVersion } from "@/lib/estimates/calc-engine-version";
import {
  loadAssemblyItemCountByAssemblyId,
  loadAssemblyMemberCountByAssemblyId,
  loadEstimateAssemblyItems,
  loadEstimateAssemblyMembers,
  loadEstimateAssemblyOrThrow,
  loadValidLaborRoleIdsForOwner,
} from "@/lib/estimates/estimate-assembly-helpers";
import {
  assertLinePlacementAllowed,
  assertSectionPlacementAllowed,
  assertSectionSubtreePlacementAllowed,
  ensureParentIsValid,
  resolveSectionLevelFromParent,
} from "@/lib/estimates/estimate-placement-helpers";
import {
  errorMessageContains,
  loadEstimateTemplateItems,
  loadEstimateTemplateOrThrow,
  throwAssemblyCompositionErrorIfNeeded,
  throwAssemblyNameConflictIfNeeded,
  toAssemblySummary,
} from "@/lib/estimates/estimate-template-helpers";
import {
  DEFAULT_MAX_SECTION_DEPTH,
  buildHierarchyIndex,
  clampMaxSectionDepth,
} from "@/lib/estimates/hierarchy";
import {
  assertDraftLockOwnedByCurrentUser,
  assertDraftStatus,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
  toNullableText,
} from "@/lib/estimates/server-context";
import { assertCanWriteEstimateWorkflows } from "@/lib/estimates/write-access";
import {
  badRequest,
  conflict,
  internalError,
  mapSupabaseError,
  notFound,
} from "@/lib/estimates/errors";
import { isFeatureEnabled } from "@/lib/feature-flags";
import type {
  CreateEstimateAssemblyInput,
  ListEstimateAssembliesQueryInput,
  UpdateEstimateAssemblyInput,
} from "@/lib/estimates/schemas";
import type { Database, Json } from "@/types/database";

type Supabase = SupabaseClient<Database>;
type EstimateAssemblyRow =
  Database["public"]["Tables"]["estimate_assemblies"]["Row"];
type EstimateAssemblyInsert =
  Database["public"]["Tables"]["estimate_assemblies"]["Insert"];
type EstimateAssemblyUpdate =
  Database["public"]["Tables"]["estimate_assemblies"]["Update"];
type EstimateAssemblyItemInsert =
  Database["public"]["Tables"]["estimate_assembly_items"]["Insert"];
type EstimateAssemblyMemberInsert =
  Database["public"]["Tables"]["estimate_assembly_members"]["Insert"];
type LaborRoleRow = Database["public"]["Tables"]["labor_roles"]["Row"];
type SupplyTypeRow = Database["public"]["Tables"]["supply_types"]["Row"];
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"] & {
  labor_role_atelier_id?: string | null;
  labor_role_chantier_id?: string | null;
};

export async function listEstimateAssemblies(
  query: ListEstimateAssembliesQueryInput
) {
  const { supabase, tenantId, userId } = await getAuthenticatedContext();

  let assembliesQuery = supabase
    .from("estimate_assemblies")
    .select("*")
    .eq("tenant_id", tenantId);

  const search = toNullableText(query.search);
  if (search) {
    assembliesQuery = assembliesQuery.or(
      `name.ilike.%${search}%,description.ilike.%${search}%`
    );
  }

  const { data, error } = await assembliesQuery
    .order("updated_at", { ascending: query.order === "oldest" })
    .limit(query.limit);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les ouvrages.");
  }

  const assemblies = (data ?? []) as EstimateAssemblyRow[];
  const itemCountByAssemblyId = await loadAssemblyItemCountByAssemblyId({
    supabase,
    tenantId,
    assemblyIds: assemblies.map((assembly) => assembly.id),
  });
  const memberCountByAssemblyId = await loadAssemblyMemberCountByAssemblyId({
    supabase,
    tenantId,
    assemblyIds: assemblies.map((assembly) => assembly.id),
  });
  const { data: laborRoles, error: laborRolesError } = await supabase
    .from("labor_roles")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("position", { ascending: true });

  if (laborRolesError) {
    throw mapSupabaseError(laborRolesError, "Impossible de charger les rôles de main-d’œuvre.");
  }

  const { data: supplyTypes, error: supplyTypesError } = await supabase
    .from("supply_types")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  if (supplyTypesError) {
    throw mapSupabaseError(
      supplyTypesError,
      "Impossible de charger les types de fourniture."
    );
  }
  return {
    assemblies: assemblies.map((assembly) =>
      toAssemblySummary(
        assembly,
        itemCountByAssemblyId.get(assembly.id) ?? 0,
        memberCountByAssemblyId.get(assembly.id) ?? 0
      )
    ),
    labor_roles: (laborRoles ?? []) as LaborRoleRow[],
    supply_types: (supplyTypes ?? []) as SupplyTypeRow[],
  };
}

export async function getEstimateAssembly(assemblyId: string) {
  const { supabase, tenantId } = await getAuthenticatedContext();

  const assembly = await loadEstimateAssemblyOrThrow({
    supabase,
    tenantId,
    assemblyId,
  });
  const items = await loadEstimateAssemblyItems({
    supabase,
    tenantId,
    assemblyId,
  });
  const members = await loadEstimateAssemblyMembers({
    supabase,
    tenantId,
    assemblyId,
  });

  return {
    assembly: {
      ...toAssemblySummary(assembly, items.length, members.length),
      items,
      members,
    },
  };
}

export function computeAssemblyMetrics(
  items: CreateEstimateAssemblyInput["items"],
  laborRatesById: ReadonlyMap<string, number> = new Map()
) {
  let directCostCents = 0;
  let laborHours = 0;

  items.forEach((item) => {
    const quantity = Math.max(item.default_quantity ?? 0, 0);
    const unitCostCents = Math.max(item.unit_cost_ht_cents ?? 0, 0);
    const isLabor = (item.cost_type ?? "material") === "labor";
    const itemLaborHours = Math.max(
      item.h_mo ?? (isLabor ? quantity : 0),
      0
    );
    const supplyCostCents = isLabor
      ? 0
      : quantity * unitCostCents * Math.max(item.k_fo ?? 1, 0);
    const selectedLaborRate = item.labor_role_id
      ? laborRatesById.get(item.labor_role_id)
      : undefined;
    const laborRateCents =
      selectedLaborRate !== undefined
        ? selectedLaborRate
        : isLabor
          ? unitCostCents
          : 0;
    const laborCostCents =
      itemLaborHours * laborRateCents * Math.max(item.k_mo ?? 1, 0);

    directCostCents += Math.round(supplyCostCents + laborCostCents);
    laborHours += itemLaborHours;
  });

  return {
    directCostCents,
    laborHours: laborHours > 0 ? laborHours : null,
  };
}
export async function createEstimateAssembly(input: CreateEstimateAssemblyInput) {
  const { supabase, tenantId, userId, tenantRole } = await getAuthenticatedContext();
  assertCanWriteEstimateWorkflows(tenantRole);

  const laborRoleIds = Array.from(
    new Set(
      input.items
        .map((item) => item.labor_role_id)
        .filter((roleId): roleId is string => Boolean(roleId))
    )
  );
  const laborRatesById = new Map<string, number>();
  if (laborRoleIds.length > 0) {
    const { data: laborRoles, error: laborRolesError } = await supabase
      .from("labor_roles")
      .select("id, hourly_rate_cents")
      .eq("tenant_id", tenantId)
      .in("id", laborRoleIds);

    if (laborRolesError) {
      throw mapSupabaseError(
        laborRolesError,
        "Impossible de charger les taux de main-d’œuvre."
      );
    }
    (laborRoles ?? []).forEach((role) => {
      laborRatesById.set(role.id, role.hourly_rate_cents);
    });
  }

  const supplyTypeIds = Array.from(
    new Set(
      input.items
        .map((item) => item.supply_type_id)
        .filter((typeId): typeId is string => Boolean(typeId))
    )
  );
  if (supplyTypeIds.length > 0) {
    const { data: supplyTypes, error: supplyTypesError } = await supabase
      .from("supply_types")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", supplyTypeIds);

    if (supplyTypesError) {
      throw mapSupabaseError(
        supplyTypesError,
        "Impossible de vérifier les types de fourniture."
      );
    }
    if ((supplyTypes ?? []).length !== supplyTypeIds.length) {
      throw badRequest("supply_type_id invalide.");
    }
  }
  const metrics = computeAssemblyMetrics(input.items, laborRatesById);
  const { data: assemblyData, error: assemblyError } = await supabase
    .from("estimate_assemblies")
    .insert({
      tenant_id: tenantId,
      created_by: userId,
      name: input.name.trim(),
      description: toNullableText(input.description),
      reference_code: toNullableText(input.reference_code),
      unit: toNullableText(input.unit),
      pricing_source: "manual",
      ds_cents: metrics.directCostCents,
      indicative_target_price_cents: 0,
      avg_time_hours: metrics.laborHours,
    } as EstimateAssemblyInsert)
    .select("*")
    .single();

  if (assemblyError || !assemblyData) {
    if (assemblyError) {
      throwAssemblyNameConflictIfNeeded(assemblyError);
      throw mapSupabaseError(assemblyError, "Impossible de créer l'ouvrage.");
    }
    throw badRequest("Impossible de créer l'ouvrage.");
  }

  const assembly = assemblyData as EstimateAssemblyRow;
  const itemsPayload: EstimateAssemblyItemInsert[] = input.items.map((item) => ({
    tenant_id: tenantId,
    assembly_id: assembly.id,
    title: item.title.trim(),
    unit: toNullableText(item.unit),
    k_fo: item.k_fo ?? 1,
    k_mo: item.k_mo ?? 1,
    labor_role_id: item.labor_role_id ?? null,
    supply_type_id: item.supply_type_id ?? null,
    default_quantity: item.default_quantity ?? null,
    h_mo:
      item.h_mo ??
      ((item.cost_type ?? "material") === "labor"
        ? Math.max(item.default_quantity ?? 0, 0)
        : 0),
    position: item.position,
    cost_type: item.cost_type ?? "material",
    unit_cost_ht_cents: item.unit_cost_ht_cents ?? 0,
    loss_coeff_bp: item.loss_coeff_bp ?? 0,
    yield_value: item.yield_value ?? null,
    yield_unit: toNullableText(item.yield_unit),
    source_metadata: (item.source_metadata ?? {}) as Json,
  }));

  const membersPayload: EstimateAssemblyMemberInsert[] = input.members.map(
    (member) => ({
      tenant_id: tenantId,
      parent_assembly_id: assembly.id,
      child_assembly_id: member.child_assembly_id,
      quantity: member.quantity,
      position: member.position,
    })
  );

  const { error: contentsError } = await supabase.rpc(
    "replace_estimate_assembly_contents",
    {
      p_assembly_id: assembly.id,
      p_items: itemsPayload as unknown as Json,
      p_members: membersPayload as unknown as Json,
    }
  );

  if (contentsError) {
    await supabase
      .from("estimate_assemblies")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", assembly.id);

    throwAssemblyCompositionErrorIfNeeded(contentsError);
    throw mapSupabaseError(contentsError, "Impossible de créer l'ouvrage.");
  }

  const [savedAssembly, insertedItems, insertedMembers] = await Promise.all([
    loadEstimateAssemblyOrThrow({
      supabase,
      tenantId,
      assemblyId: assembly.id,
    }),
    loadEstimateAssemblyItems({
      supabase,
      tenantId,
      assemblyId: assembly.id,
    }),
    loadEstimateAssemblyMembers({
      supabase,
      tenantId,
      assemblyId: assembly.id,
    }),
  ]);

  return {
    assembly: {
      ...toAssemblySummary(
        savedAssembly,
        insertedItems.length,
        insertedMembers.length
      ),
      items: insertedItems,
      members: insertedMembers,
    },
  };
}

export async function updateEstimateAssembly(
  assemblyId: string,
  input: UpdateEstimateAssemblyInput
) {
  const { supabase, tenantId, tenantRole } = await getAuthenticatedContext();
  assertCanWriteEstimateWorkflows(tenantRole);

  await loadEstimateAssemblyOrThrow({
    supabase,
    tenantId,
    assemblyId,
  });

  const assemblyPayload: EstimateAssemblyUpdate = {};
  if ("name" in input) {
    assemblyPayload.name = (input.name ?? "").trim();
  }
  if ("description" in input) {
    assemblyPayload.description = toNullableText(input.description);
  }
  if ("reference_code" in input) {
    assemblyPayload.reference_code = toNullableText(input.reference_code);
  }
  if ("unit" in input) {
    assemblyPayload.unit = toNullableText(input.unit);
  }
  let updatedAssembly: EstimateAssemblyRow;
  if (Object.keys(assemblyPayload).length > 0) {
    const { data, error } = await supabase
      .from("estimate_assemblies")
      .update(assemblyPayload)
      .eq("tenant_id", tenantId)
      .eq("id", assemblyId)
      .select("*")
      .single();

    if (error || !data) {
      if (error) {
        throwAssemblyNameConflictIfNeeded(error);
        throw mapSupabaseError(error, "Impossible de mettre a jour l'ouvrage.");
      }
      throw badRequest("Impossible de mettre a jour l'ouvrage.");
    }
    updatedAssembly = data as EstimateAssemblyRow;
  } else {
    updatedAssembly = await loadEstimateAssemblyOrThrow({
      supabase,
      tenantId,
      assemblyId,
    });
  }

  if (
    ("items" in input && input.items) ||
    ("members" in input && input.members)
  ) {
    const requestedItems =
      input.items ??
      (await loadEstimateAssemblyItems({ supabase, tenantId, assemblyId }));
    const itemsPayload = requestedItems.map((item) => ({
      title: item.title.trim(),
      unit: toNullableText(item.unit),
      k_fo: item.k_fo ?? 1,
      k_mo: item.k_mo ?? 1,
      labor_role_id: item.labor_role_id ?? null,
      supply_type_id: item.supply_type_id ?? null,
      default_quantity: item.default_quantity ?? null,
      h_mo:
        item.h_mo ??
        ((item.cost_type ?? "material") === "labor"
          ? Math.max(item.default_quantity ?? 0, 0)
          : 0),
      position: item.position,
      cost_type: item.cost_type ?? "material",
      unit_cost_ht_cents: item.unit_cost_ht_cents ?? 0,
      loss_coeff_bp: item.loss_coeff_bp ?? 0,
      yield_value: item.yield_value ?? null,
      yield_unit: toNullableText(item.yield_unit),
      source_metadata: (item.source_metadata ?? {}) as Json,
    }));

    const requestedMembers =
      input.members ??
      (await loadEstimateAssemblyMembers({
        supabase,
        tenantId,
        assemblyId,
      }));
    const membersPayload = requestedMembers.map((member) => ({
      child_assembly_id: member.child_assembly_id,
      quantity: member.quantity,
      position: member.position,
    }));

    const { error: replaceContentsError } = await supabase.rpc(
      "replace_estimate_assembly_contents",
      {
        p_assembly_id: assemblyId,
        p_items: itemsPayload as unknown as Json,
        p_members: membersPayload as unknown as Json,
      }
    );

    if (replaceContentsError) {
      throwAssemblyCompositionErrorIfNeeded(replaceContentsError);
      throw mapSupabaseError(
        replaceContentsError,
        "Impossible de mettre a jour l'ouvrage."
      );
    }

    updatedAssembly = await loadEstimateAssemblyOrThrow({
      supabase,
      tenantId,
      assemblyId,
    });
  }

  const items = await loadEstimateAssemblyItems({
    supabase,
    tenantId,
    assemblyId,
  });
  const members = await loadEstimateAssemblyMembers({
    supabase,
    tenantId,
    assemblyId,
  });

  return {
    assembly: {
      ...toAssemblySummary(updatedAssembly, items.length, members.length),
      items,
      members,
    },
  };
}

export async function deleteEstimateAssembly(assemblyId: string) {
  const { supabase, tenantId, tenantRole } = await getAuthenticatedContext();
  assertCanWriteEstimateWorkflows(tenantRole);

  await loadEstimateAssemblyOrThrow({
    supabase,
    tenantId,
    assemblyId,
  });

  const { error } = await supabase
    .from("estimate_assemblies")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", assemblyId);

  if (error) {
    if (error.code === "23503") {
      throw conflict(
        "Cet ouvrage est utilisé comme sous-ouvrage. Retirez d'abord ses références.",
        error
      );
    }
    throw mapSupabaseError(error, "Impossible de supprimer l'ouvrage.");
  }

  return {
    deleted_id: assemblyId,
  };
}

/** Parcourt l'arbre d'un ouvrage (sous-ouvrages inclus). */
async function collectEstimateAssemblyTreeIds(input: {
  supabase: Supabase;
  tenantId: string;
  rootAssemblyId: string;
}): Promise<string[]> {
  const visited = new Set<string>();
  const queue: string[] = [input.rootAssemblyId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const members = await loadEstimateAssemblyMembers({
      supabase: input.supabase,
      tenantId: input.tenantId,
      assemblyId: current,
    });

    for (const member of members) {
      const childId = (member as { child_assembly_id?: string | null })
        .child_assembly_id;
      if (childId && !visited.has(childId)) {
        queue.push(childId);
      }
    }
  }

  return Array.from(visited);
}

/**
 * Un composant de main-d'oeuvre SANS role porte son taux horaire dans
 * unit_cost_ht_cents (cf. refresh_estimate_assembly_rollup). Or une ligne de
 * devis ne sait calculer la MO que via labor_role_id -> taux horaire : sans
 * role, tout le cout de main-d'oeuvre serait silencieusement perdu a
 * l'insertion (ligne a 0 EUR alors que la bibliotheque annonce un montant).
 *
 * On refuse donc l'insertion, sous-ouvrages compris, plutot que de sous-chiffrer
 * le devis sans prevenir.
 */
async function assertAssemblyLaborRolesResolved(input: {
  supabase: Supabase;
  tenantId: string;
  rootAssemblyId: string;
}) {
  const assemblyIds = await collectEstimateAssemblyTreeIds(input);

  const { data, error } = await input.supabase
    .from("estimate_assembly_items")
    .select("id, title")
    .eq("tenant_id", input.tenantId)
    .in("assembly_id", assemblyIds)
    .eq("cost_type", "labor")
    .is("labor_role_id", null);

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de vérifier la main-d'œuvre de l'ouvrage."
    );
  }

  const offending = (data ?? []) as Array<{ id: string; title: string | null }>;
  if (offending.length === 0) return;

  throw badRequest(
    "Cet ouvrage contient de la main-d'oeuvre sans role de main-d'oeuvre. Associez un role (qui porte le taux horaire) a ces composants avant insertion : sinon leur cout serait perdu et la ligne inseree vaudrait 0 EUR.",
    {
      items: offending.map((item) => ({
        id: item.id,
        title: item.title ?? "Composant sans titre",
      })),
    },
    "ESTIMATE_ASSEMBLY_LABOR_ROLE_REQUIRED"
  );
}

export async function insertAssemblyIntoVersion(input: {
  assemblyId: string;
  versionId: string;
  afterItemId?: string | null;
}) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(
    supabase,
    input.versionId,
    context
  );

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: input.versionId,
    userId,
  });

  const assembly = await loadEstimateAssemblyOrThrow({
    supabase,
    tenantId,
    assemblyId: input.assemblyId,
  });
  const assemblyItems = await loadEstimateAssemblyItems({
    supabase,
    tenantId,
    assemblyId: assembly.id,
  });
  const assemblyMembers = await loadEstimateAssemblyMembers({
    supabase,
    tenantId,
    assemblyId: assembly.id,
  });

  if (assemblyItems.length === 0 && assemblyMembers.length === 0) {
    throw badRequest("Cet ouvrage ne contient aucun contenu.");
  }

  await assertAssemblyLaborRolesResolved({
    supabase,
    tenantId,
    rootAssemblyId: assembly.id,
  });


  const { data, error } = await supabase.rpc(
    "insert_estimate_assembly_into_version",
    {
      p_version_id: input.versionId,
      p_assembly_id: input.assemblyId,
      p_after_item_id: input.afterItemId ?? null,
    }
  );

  if (error) {
    if (errorMessageContains(error, "estimate assembly not found")) {
      throw notFound(
        "Ouvrage introuvable.",
        error,
        "ESTIMATE_ASSEMBLY_NOT_FOUND"
      );
    }
    if (errorMessageContains(error, "estimate version not found")) {
      throw notFound("Version de chiffrage introuvable.", error);
    }
    if (errorMessageContains(error, "after_item_id invalide")) {
      throw badRequest("afterItemId invalide.", error);
    }
    throw mapSupabaseError(error, "Impossible d'insérer l'ouvrage.");
  }

  const insertedItems = Array.isArray(data) ? (data as EstimateItemRow[]) : [];
  const insertedItemIds = insertedItems.map((item) => item.id);

  if (insertedItemIds.length === 0) {
    throw internalError(
      "Impossible d'insérer l'ouvrage.",
      { data },
      "ESTIMATE_ASSEMBLY_INSERT_FAILED"
    );
  }

  const laborRoleIds = insertedItems
    .map((item) => item.labor_role_id)
    .filter((value): value is string => Boolean(value));
  const validLaborRoleIds = await loadValidLaborRoleIdsForOwner({
    supabase,
    tenantId,
    ownerUserId: project.user_id,
    laborRoleIds,
  });
  const invalidLaborRoleIds = new Set(
    laborRoleIds.filter(
      (laborRoleId) => !validLaborRoleIds.has(laborRoleId)
    )
  );


  const lineIdsWithInvalidLaborRole = insertedItems
    .filter(
      (item) =>
        item.item_type === "line" &&
        item.labor_role_id &&
        invalidLaborRoleIds.has(item.labor_role_id)
    )
    .map((item) => item.id);

  if (lineIdsWithInvalidLaborRole.length > 0) {
    const { error: clearRoleError } = await supabase
      .from("estimate_items")
      .update({ labor_role_id: null })
      .eq("tenant_id", tenantId)
      .eq("version_id", input.versionId)
      .in("id", lineIdsWithInvalidLaborRole);

    if (clearRoleError) {
      throw mapSupabaseError(
        clearRoleError,
        "Impossible d'insérer l'ouvrage."
      );
    }
  }

  const { data: reloadedItems, error: reloadError } = await supabase
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("version_id", input.versionId)
    .in("id", insertedItemIds);

  if (reloadError) {
    throw mapSupabaseError(reloadError, "Impossible d'insérer l'ouvrage.");
  }

  const reloadedItemsById = new Map(
    ((reloadedItems ?? []) as EstimateItemRow[]).map((item) => [item.id, item])
  );
  const orderedItems = insertedItemIds
    .map((id) => reloadedItemsById.get(id))
    .filter((item): item is EstimateItemRow => Boolean(item));

  // materialize_estimate_assembly_tree insere les lignes avec
  // pu_ht_cents / line_total_ht_cents / line_tax_cents / line_total_ttc_cents
  // a 0. Sans renormalisation, la ligne s'affiche a 0 EUR alors que le
  // sous-total de section (recalcule a la volee) est correct, et un devis passe
  // en 'sent' sans autre edition figerait un total sous-evalue.
  //
  // On renormalise avec le moteur de calcul existant (source unique de verite)
  // plutot que de recalculer marge/TVA en SQL.
  // EST-031 : les roles de MO ventilee (atelier/chantier) comptent aussi, sans
  // quoi leur taux reste absent de `rateById` et la ligne est renormalisee — et
  // donc PERSISTEE — a 0 EUR. Les trois portees resolvent aujourd'hui la meme
  // colonne `hourly_rate_cents` (labor_roles n'a pas de taux dedie), une seule
  // carte suffit donc.
  const insertedLaborRoleIds = Array.from(
    new Set(
      orderedItems
        .flatMap((item) => [
          item.labor_role_id,
          item.labor_role_atelier_id,
          item.labor_role_chantier_id,
        ])
        .filter((value): value is string => Boolean(value))
    )
  );

  const rateById = new Map<string, number>();
  if (insertedLaborRoleIds.length > 0) {
    const { data: roleRows, error: roleRatesError } = await supabase
      .from("labor_roles")
      .select("id, hourly_rate_cents")
      .eq("tenant_id", tenantId)
      .in("id", insertedLaborRoleIds);

    if (roleRatesError) {
      throw mapSupabaseError(roleRatesError, "Impossible d'insérer l'ouvrage.");
    }

    for (const role of (roleRows ?? []) as Array<{
      id: string;
      hourly_rate_cents: number | null;
    }>) {
      rateById.set(role.id, role.hourly_rate_cents ?? 0);
    }
  }

  // EST-E26 (T6, étape 5) : renormalisation des lignes d'ouvrage insérées avec
  // le flag tenant réel (le contexte tenant/supabase est déjà en portée ici).
  const isLaborSplitEnabled = await isFeatureEnabled(
    tenantId,
    "EST_031_LABOR_SPLIT",
    { supabase }
  );

  const normalizedItems = normalizeDraftItems({
    items: orderedItems,
    version: {
      margin_multiplier: version.margin_multiplier ?? 1,
      margin_mode: version.margin_mode ?? undefined,
      tax_rate_bp: version.tax_rate_bp ?? 0,
      // Remise et coefficient global sont des grandeurs de VERSION : elles
      // n'entrent pas dans les valeurs par ligne calculees ici.
      discount_bp: 0,
    },
    rateById,
    isLaborSplitEnabled,
    calcEngineVersion: resolveCalcEngineVersion(version),
  });

  for (const item of normalizedItems) {
    if (item.item_type !== "line") continue;
    const stored = reloadedItemsById.get(item.id);
    if (
      stored &&
      stored.pu_ht_cents === item.pu_ht_cents &&
      stored.line_total_ht_cents === item.line_total_ht_cents &&
      stored.line_tax_cents === item.line_tax_cents &&
      stored.line_total_ttc_cents === item.line_total_ttc_cents
    ) {
      continue;
    }

    const { error: normalizeError } = await supabase
      .from("estimate_items")
      .update({
        pu_ht_cents: item.pu_ht_cents,
        line_total_ht_cents: item.line_total_ht_cents,
        line_tax_cents: item.line_tax_cents,
        line_total_ttc_cents: item.line_total_ttc_cents,
      })
      .eq("tenant_id", tenantId)
      .eq("version_id", input.versionId)
      .eq("id", item.id);

    if (normalizeError) {
      throw mapSupabaseError(normalizeError, "Impossible d'insérer l'ouvrage.");
    }
  }

  return {
    items: normalizedItems,
  };
}

export async function insertTemplateIntoVersion(input: {
  templateId: string;
  versionId: string;
  afterItemId?: string | null;
}) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version } = await getVersionAccessOrThrow(
    supabase,
    input.versionId,
    context
  );

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: input.versionId,
    userId,
  });

  await loadEstimateTemplateOrThrow({
    supabase,
    tenantId,
    templateId: input.templateId,
  });
  const templateItems = await loadEstimateTemplateItems({
    supabase,
    tenantId,
    templateId: input.templateId,
  });

  if (templateItems.length === 0) {
    throw badRequest("Ce template ne contient aucun élément.");
  }

  let targetParentId: string | null = null;
  if (input.afterItemId) {
    const { data: anchorItem, error: anchorError } = await supabase
      .from("estimate_items")
      .select("id, parent_id")
      .eq("tenant_id", tenantId)
      .eq("version_id", input.versionId)
      .eq("id", input.afterItemId)
      .maybeSingle();

    if (anchorError) {
      throw mapSupabaseError(
        anchorError,
        "Impossible de vérifier la position d'insertion du template."
      );
    }
    if (!anchorItem) {
      throw badRequest("afterItemId invalide.");
    }

    targetParentId = anchorItem.parent_id ?? null;
  }

  const targetParent = await ensureParentIsValid({
    supabase,
    tenantId,
    versionId: input.versionId,
    parentId: targetParentId,
  });
  const maxSectionDepth = clampMaxSectionDepth(
    version.max_section_depth,
    DEFAULT_MAX_SECTION_DEPTH
  );
  const targetParentSectionLevel = await resolveSectionLevelFromParent({
    supabase,
    tenantId,
    versionId: input.versionId,
    parent: targetParent,
  });
  const templateHierarchyIndex = buildHierarchyIndex(
    templateItems.map((item) => ({
      id: item.id,
      parent_id: item.parent_id,
      item_type: item.item_type,
    }))
  );
  const templateRootItems = templateItems.filter((item) => item.parent_id === null);

  if (templateRootItems.length === 0) {
    throw badRequest("Le template est invalide : aucun élément racine.");
  }

  const rootSectionLevel =
    targetParentSectionLevel === null ? 1 : targetParentSectionLevel + 1;
  for (const rootItem of templateRootItems) {
    if (rootItem.item_type === "section") {
      assertSectionPlacementAllowed({
        maxSectionDepth,
        nextSectionLevel: rootSectionLevel,
      });
      assertSectionSubtreePlacementAllowed({
        hierarchyIndex: templateHierarchyIndex,
        sectionId: rootItem.id,
        nextSectionLevel: rootSectionLevel,
        maxSectionDepth,
      });
      continue;
    }

    assertLinePlacementAllowed({
      maxSectionDepth,
      parentSectionLevel: targetParentSectionLevel,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC added in migration, types not yet regenerated
  const { data, error } = await (supabase.rpc as any)(
    "insert_estimate_template_into_version",
    {
      p_version_id: input.versionId,
      p_template_id: input.templateId,
      p_after_item_id: input.afterItemId ?? null,
    }
  );

  if (error) {
    if (errorMessageContains(error, "template not found")) {
      throw notFound(
        "Template introuvable.",
        error,
        "ESTIMATE_TEMPLATE_NOT_FOUND"
      );
    }
    if (errorMessageContains(error, "estimate version not found")) {
      throw notFound("Version de chiffrage introuvable.", error);
    }
    if (errorMessageContains(error, "after_item_id invalide")) {
      throw badRequest("afterItemId invalide.", error);
    }
    throw mapSupabaseError(error, "Impossible d'insérer le template.");
  }

  const insertedItems = Array.isArray(data) ? (data as EstimateItemRow[]) : [];
  const insertedItemIds = insertedItems.map((item) => item.id);

  if (insertedItemIds.length === 0) {
    throw internalError(
      "Impossible d'insérer le template.",
      { data },
      "ESTIMATE_TEMPLATE_INSERT_FAILED"
    );
  }

  const { data: reloadedItems, error: reloadError } = await supabase
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("version_id", input.versionId)
    .in("id", insertedItemIds);

  if (reloadError) {
    throw mapSupabaseError(reloadError, "Impossible d'insérer le template.");
  }

  const reloadedItemsById = new Map(
    ((reloadedItems ?? []) as EstimateItemRow[]).map((item) => [item.id, item])
  );
  const orderedItems = insertedItemIds
    .map((id) => reloadedItemsById.get(id))
    .filter((item): item is EstimateItemRow => Boolean(item));

  return {
    items: orderedItems,
  };
}
