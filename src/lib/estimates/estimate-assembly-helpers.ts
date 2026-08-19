import type { SupabaseClient } from "@supabase/supabase-js";

import { mapSupabaseError, notFound } from "@/lib/estimates/errors";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;
type EstimateAssemblyRow =
  Database["public"]["Tables"]["estimate_assemblies"]["Row"];
type EstimateAssemblyItemRow =
  Database["public"]["Tables"]["estimate_assembly_items"]["Row"];
type EstimateAssemblyMemberRow =
  Database["public"]["Tables"]["estimate_assembly_members"]["Row"];

export async function loadEstimateAssemblyOrThrow(input: {
  supabase: Supabase;
  tenantId: string;
  assemblyId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_assemblies")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.assemblyId)
    .single();

  if (error || !data) {
    if (error && error.code !== "PGRST116") {
      throw mapSupabaseError(error, "Impossible de charger l'ouvrage.");
    }

    throw notFound(
      "Ouvrage introuvable.",
      undefined,
      "ESTIMATE_ASSEMBLY_NOT_FOUND"
    );
  }

  return data as EstimateAssemblyRow;
}

export async function loadEstimateAssemblyItems(input: {
  supabase: Supabase;
  tenantId: string;
  assemblyId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_assembly_items")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("assembly_id", input.assemblyId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les lignes de l'ouvrage.");
  }

  return (data ?? []) as EstimateAssemblyItemRow[];
}

export async function loadEstimateAssemblyMembers(input: {
  supabase: Supabase;
  tenantId: string;
  assemblyId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_assembly_members")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("parent_assembly_id", input.assemblyId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger les sous-ouvrages."
    );
  }

  const members = (data ?? []) as EstimateAssemblyMemberRow[];
  const childIds = members.map((member) => member.child_assembly_id);
  if (childIds.length === 0) return [];

  const { data: childAssemblies, error: childError } = await input.supabase
    .from("estimate_assemblies")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .in("id", childIds);

  if (childError) {
    throw mapSupabaseError(
      childError,
      "Impossible de charger les sous-ouvrages."
    );
  }

  const childrenById = new Map(
    ((childAssemblies ?? []) as EstimateAssemblyRow[]).map((assembly) => [
      assembly.id,
      assembly,
    ])
  );

  return members.map((member) => ({
    ...member,
    child_assembly: childrenById.get(member.child_assembly_id) ?? null,
  }));
}

export async function loadAssemblyItemCountByAssemblyId(input: {
  supabase: Supabase;
  tenantId: string;
  assemblyIds: string[];
}) {
  const counts = new Map<string, number>();

  if (input.assemblyIds.length === 0) {
    return counts;
  }

  const { data, error } = await input.supabase
    .from("estimate_assembly_items")
    .select("assembly_id")
    .eq("tenant_id", input.tenantId)
    .in("assembly_id", input.assemblyIds);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le comptage des ouvrages.");
  }

  for (const row of (data ?? []) as Array<{ assembly_id: string }>) {
    counts.set(row.assembly_id, (counts.get(row.assembly_id) ?? 0) + 1);
  }

  return counts;
}

export async function loadAssemblyMemberCountByAssemblyId(input: {
  supabase: Supabase;
  tenantId: string;
  assemblyIds: string[];
}) {
  const counts = new Map<string, number>();

  if (input.assemblyIds.length === 0) {
    return counts;
  }

  const { data, error } = await input.supabase
    .from("estimate_assembly_members")
    .select("parent_assembly_id")
    .eq("tenant_id", input.tenantId)
    .in("parent_assembly_id", input.assemblyIds);

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger le comptage des sous-ouvrages."
    );
  }

  for (const row of (data ?? []) as Array<{ parent_assembly_id: string }>) {
    counts.set(
      row.parent_assembly_id,
      (counts.get(row.parent_assembly_id) ?? 0) + 1
    );
  }

  return counts;
}

export async function loadValidLaborRoleIdsForOwner(input: {
  supabase: Supabase;
  tenantId: string;
  ownerUserId: string;
  laborRoleIds: string[];
}) {
  if (input.laborRoleIds.length === 0) {
    return new Set<string>();
  }

  const uniqueRoleIds = [...new Set(input.laborRoleIds)];
  const { data, error } = await input.supabase
    .from("labor_roles")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.ownerUserId)
    .in("id", uniqueRoleIds);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les roles MO.");
  }

  return new Set((data ?? []).map((row) => row.id));
}
