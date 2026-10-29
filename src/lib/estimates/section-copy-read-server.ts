import { readAllRows } from "@/lib/supabase/read-all";
import { mapSupabaseError } from "@/lib/estimates/errors";
import type { Supabase } from "@/lib/estimates/item-write-types";
import {
  assertEstimateVersionUnchanged,
  readAllEstimateItems,
  readEstimateItemSubtrees,
} from "@/lib/estimates/read-all-items-server";
import { collectSectionSubtreeItems } from "@/lib/estimates/section-copy-plan";
import {
  canAccessOwnerResource,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
  isTenantAdmin,
  resolveEmbeddedOne,
  toNullableText,
  type VersionAccessRow,
} from "@/lib/estimates/server-context";
import type { ListEstimateImportSourcesQueryInput } from "@/lib/estimates/schemas";
import type { EstimateProjectRow, EstimateVersionRow } from "@/lib/estimates/version-list-server";
import type {
  EstimateImportSourceVersionItem,
  ListEstimateImportSourcesResult,
  EstimateImportSectionPreviewItem,
  ListEstimateImportSectionsResult,
} from "@/lib/estimates/section-copy-contracts";

type EstimateImportSourceProject = Pick<
  EstimateProjectRow,
  "id" | "tenant_id" | "user_id" | "name" | "is_archived"
>;

type EstimateImportSourceVersionRow = Pick<
  EstimateVersionRow,
  | "id"
  | "project_id"
  | "version_number"
  | "status"
  | "title"
  | "updated_at"
  | "total_ht_cents"
> & {
  estimate_projects: EstimateImportSourceProject | EstimateImportSourceProject[] | null;
};

export async function listEstimateImportSources(
  query?: ListEstimateImportSourcesQueryInput
): Promise<ListEstimateImportSourcesResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;

  let request = supabase
    .from("estimate_versions")
    .select(
      "id, project_id, version_number, status, title, updated_at, total_ht_cents, estimate_projects!inner(id, tenant_id, user_id, name, is_archived)",
      { count: "exact" }
    )
    .eq("tenant_id", tenantId)
    .eq("estimate_projects.tenant_id", tenantId)
    .eq("estimate_projects.is_archived", false);

  if (query?.exclude_version_id) {
    request = request.neq("id", query.exclude_version_id);
  }

  if (!isTenantAdmin(context.tenantRole)) {
    request = request.eq("estimate_projects.user_id", context.userId);
  }

  // Every version, by pages in id order only (the API returns 1 000 rows at most): a version edited between
  // two pages keeps its place, where an updated_at order would move it across pages and fail the read.
  const { data, error } = await readAllRows(() => request);

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger les devis sources pour l'import."
    );
  }

  // Most recently updated first, as PostgreSQL orders them: keep the microseconds Date drops.
  const updatedAtKey = (value: string) => Date.parse(value) * 1000 +
    Number((value.match(/\.(\d+)(?:Z|[+-]\d\d:?\d\d)$/)?.[1] ?? "").padEnd(6, "0").slice(3, 6));
  const rows = ((data ?? []) as EstimateImportSourceVersionRow[]).sort((left, right) =>
    updatedAtKey(right.updated_at) - updatedAtKey(left.updated_at) ||
    right.version_number - left.version_number ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const items = rows
    .map((row): EstimateImportSourceVersionItem | null => {
      const project = resolveEmbeddedOne(row.estimate_projects);
      if (!project) return null;

      const hasAccess = canAccessOwnerResource({
        context,
        resourceUserId: project.user_id,
      });
      if (!hasAccess) return null;

      return {
        id: row.id,
        project_id: row.project_id,
        project_name: project.name,
        version_number: row.version_number,
        status: row.status,
        title: row.title,
        updated_at: row.updated_at,
        total_ht_cents: row.total_ht_cents ?? 0,
      };
    })
    .filter((row): row is EstimateImportSourceVersionItem => row !== null);

  return {
    items,
  };
}

export async function listEstimateImportSections(
  sourceVersionId: string
): Promise<ListEstimateImportSectionsResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  await getVersionAccessOrThrow(supabase, sourceVersionId, context);

  // Every item, by pages: the API returns 1 000 rows at most, and a partial read would miscount the sections.
  const sourceItems = await readAllEstimateItems({ supabase, tenantId, versionId: sourceVersionId });
  const rootSections = sourceItems.filter(
    (item) => item.item_type === "section" && item.parent_id === null
  );

  const items = rootSections
    .map((section): EstimateImportSectionPreviewItem | null => {
      const subtree = collectSectionSubtreeItems(section.id, sourceItems);
      if (!subtree) return null;

      const lineItems = subtree.orderedSubtreeItems.filter(
        (item) => item.item_type === "line"
      );

      return {
        id: section.id,
        title: toNullableText(section.title) ?? "Section sans titre",
        line_count: lineItems.length,
        total_ht_cents: lineItems.reduce(
          (sum, item) => sum + (item.line_total_ht_cents ?? 0),
          0
        ),
        position: section.position,
      };
    })
    .filter((section): section is EstimateImportSectionPreviewItem => section !== null)
    .sort((left, right) => left.position - right.position);

  return {
    source_version_id: sourceVersionId,
    items,
  };
}

/**
 * Toutes les lignes d'une version copiée, par pages (l'API rend 1 000 lignes au plus), quel que soit le moteur.
 * Sous-lot 2.8b (C8, revue Codex de la PR #59, G3 ; PR #70 pour les v1/v2) : au-delà de 500 éléments, la lecture
 * prend plusieurs pages ; la version est relue après la dernière (jeton et révision de contenu lus avec l'accès),
 * sinon une modification concurrente entre deux pages donnerait une copie mêlant deux états. Version changée :
 * 409 VERSION_CONFLICT, rien n'est copié.
 */
export async function readAllItemsForCopy(supabase: Supabase, tenantId: string, version: VersionAccessRow) {
  const items = await readAllEstimateItems({ supabase, tenantId, versionId: version.id });
  await assertEstimateVersionUnchanged({ supabase, version });
  return items;
}

/**
 * Lot 3.1 (docs/testing/lot3-1-v3-copy-scale.md) : la source d'une copie, réduite aux sections sélectionnées et à leur
 * descendance (ce que la copie lit), par niveaux et par pages, puis la même vérification de version que
 * `readAllItemsForCopy`. Un identifiant hors de la version ou qui n'est pas une section reste refusé par l'appelant.
 */
export async function readSelectedSubtreesForCopy(supabase: Supabase, tenantId: string, version: VersionAccessRow,
  sectionIds: readonly string[]) {
  const items = await readEstimateItemSubtrees({ supabase, tenantId, versionId: version.id, ids: sectionIds });
  await assertEstimateVersionUnchanged({ supabase, version });
  return items;
}
