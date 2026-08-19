import type { SupabaseClient } from "@supabase/supabase-js";

import { badRequest, mapSupabaseError } from "@/lib/estimates/errors";
import {
  buildHierarchyIndex,
  collectSubtreeMetrics,
  resolveSectionLevel,
  type HierarchyItemLike,
} from "@/lib/estimates/hierarchy";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;

export type EstimatePlacementItem = HierarchyItemLike;

export async function ensureParentIsValid({
  supabase,
  tenantId,
  versionId,
  parentId,
  itemId,
}: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  parentId: string | null;
  itemId?: string;
}) {
  if (parentId === null) return null;

  const { data, error } = await supabase
    .from("estimate_items")
    .select("id, version_id, item_type, parent_id")
    .eq("tenant_id", tenantId)
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
    throw badRequest("Un élément ne peut pas être son propre parent.");
  }

  return data as EstimatePlacementItem;
}

export async function loadHierarchyItems(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_items")
    .select("id, parent_id, item_type")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId);

  if (error) {
    throw mapSupabaseError(error, "Impossible de vérifier la hiérarchie.");
  }

  return (data ?? []) as EstimatePlacementItem[];
}

export async function resolveSectionLevelFromParent(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  parent: EstimatePlacementItem | null;
}) {
  if (!input.parent) return null;

  const hierarchyItems = await loadHierarchyItems({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
  });
  const hierarchy = buildHierarchyIndex(hierarchyItems);
  return resolveSectionLevel(hierarchy, input.parent.id);
}

export function assertSectionPlacementAllowed(input: {
  maxSectionDepth: number;
  nextSectionLevel: number;
}) {
  if (input.nextSectionLevel <= input.maxSectionDepth) {
    return;
  }

  throw badRequest(
    `Impossible de creer ce niveau: profondeur max ${input.maxSectionDepth}.`
  );
}

export function assertLinePlacementAllowed(input: {
  maxSectionDepth: number;
  parentSectionLevel: number | null;
}) {
  if (input.parentSectionLevel === null) {
    throw badRequest("Une ligne doit etre ajoutee sous une section.");
  }

  if (input.parentSectionLevel > input.maxSectionDepth) {
    throw badRequest(
      `Une ligne ne peut pas etre rattachee au-dela du niveau ${input.maxSectionDepth}.`
    );
  }
}

export function assertSectionSubtreePlacementAllowed(input: {
  hierarchyIndex: ReturnType<typeof buildHierarchyIndex>;
  sectionId: string;
  nextSectionLevel: number;
  maxSectionDepth: number;
}) {
  const metrics = collectSubtreeMetrics(input.hierarchyIndex, input.sectionId);

  if (
    input.nextSectionLevel + metrics.maxSectionRelativeDepth >
    input.maxSectionDepth
  ) {
    throw badRequest(
      `Ce deplacement depasse la profondeur max ${input.maxSectionDepth}.`
    );
  }
}
