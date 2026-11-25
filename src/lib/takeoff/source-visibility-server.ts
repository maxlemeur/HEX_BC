import "server-only";

import { selectInChunks } from "@/lib/supabase/in-chunks";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import type { TakeoffVisibleSources } from "@/lib/takeoff/request-activity";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The plan copies and dossier pieces among `ids` that this member may read, by their own policies evaluated for the
 * member: the affaire's owner or an administrator reads every plan file of it (the plan files' rule,
 * public.can_access_takeoff_project); anyone else reads a plan file only where its row is readable to them (the evidence
 * an analysis they read attests) and a dossier piece where its row is. Reading an affaire alone never names its plans.
 * Bound the PostgREST URL when an affaire has many plans.
 */
export async function readTakeoffVisibleSources(input: {
  supabase: AuthenticatedTenantContext["supabase"];
  tenantId: string;
  projectId: string;
  ids: Iterable<string | null | undefined>;
}): Promise<TakeoffVisibleSources> {
  const ids = [...new Set([...input.ids].filter((id): id is string => typeof id === "string" && UUID.test(id))
    .map((id) => id.toLowerCase()))];
  if (ids.length === 0) return { planFiles: new Set(), documents: new Set() };
  const owner = await input.supabase.rpc("can_access_takeoff_project", { p_project_id: input.projectId, p_tenant_id: input.tenantId });
  if (owner.error) throw mapSupabaseError(owner.error, "Impossible de vérifier l’accès aux plans de l’affaire.");
  if (owner.data === true) return "all";
  const [files, documents] = await Promise.all([
    selectInChunks(ids, chunk => input.supabase.from("plan_files").select("id").eq("tenant_id", input.tenantId).in("id", chunk)),
    selectInChunks(ids, chunk => input.supabase.from("affaire_intake_documents").select("id")
      .eq("tenant_id", input.tenantId).eq("project_id", input.projectId).in("id", chunk)),
  ]);
  if (files.error) throw mapSupabaseError(files.error, "Impossible de vérifier l’accès aux plans de l’affaire.");
  if (documents.error) throw mapSupabaseError(documents.error, "Impossible de vérifier l’accès aux pièces de l’affaire.");
  return {
    planFiles: new Set(((files.data ?? []) as Array<{ id: string }>).map((row) => row.id.toLowerCase())),
    documents: new Set(((documents.data ?? []) as Array<{ id: string }>).map((row) => row.id.toLowerCase())),
  };
}
