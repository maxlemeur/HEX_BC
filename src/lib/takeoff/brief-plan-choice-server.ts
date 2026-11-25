import "server-only";

import { createHash } from "node:crypto";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { readAllRows } from "@/lib/supabase/read-all";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildPlanFileStoragePath, sanitizePlanPdfFilename } from "@/lib/takeoff/plan-file-display-name";
import { inspectPlanSetResourceBudget } from "@/lib/takeoff/plans";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { isTakeoffPlanDispatchActive } from "@/lib/takeoff/local-dispatcher";
import { BRIEF_PLAN_CHANGED, briefPlanReadingState, type BriefPlanOption, type BriefPlanSelection, type SealedBriefPlans } from "./brief-plan-choice";

type Context = AuthenticatedTenantContext;

async function visiblePlanCopies(context: Context, projectId: string, ids?: string[]) {
  const files = await readAllRows(() => {
    const query = context.supabase.from("plan_files")
      .select("id, plan_set_id, file_path, file_name, file_size_bytes, plan_sets!inner(project_id)", { count: "exact" })
      .eq("tenant_id", context.tenantId).eq("plan_sets.project_id", projectId);
    return ids ? query.in("id", ids) : query;
  });
  if (files.error) throw new Error("Impossible de lire les plans du dossier.");
  return new Map((files.data ?? []).map((file) => [file.id, file]));
}

async function planOptions(context: Context, projectId: string, visible: ReadonlyMap<string, unknown>): Promise<BriefPlanOption[]> {
  if (!visible.size) return [];
  const service = createServiceRoleClient();
  const { data, error } = await service.rpc("takeoff_brief_plan_options", { p_tenant_id: context.tenantId, p_project_id: projectId });
  if (error) throw new Error("Impossible de vérifier les lectures précédentes des plans.");
  return (data ?? []).filter((row) => visible.has(row.plan_file_id)).map((row) => ({
    id: row.plan_file_id, name: row.plan_name, version: row.plan_version, state: briefPlanReadingState.parse(row.reading_state),
  }));
}

export async function readBriefPlanOptions(context: Context, projectId: string) {
  const service = createServiceRoleClient();
  if (!await isTakeoffEnabled(context.tenantId, { supabase: context.supabase }) || !await isTakeoffPlanDispatchActive(service)) return [];
  return planOptions(context, projectId, await visiblePlanCopies(context, projectId));
}

export async function attestBriefPlanChoice(context: Context, projectId: string, selected: BriefPlanSelection):
  Promise<{ plans: SealedBriefPlans } | { message: string }> {
  const plans: SealedBriefPlans = {};
  if (!selected.length) return { plans };
  const files = await visiblePlanCopies(context, projectId, selected.map(({ id }) => id));
  if (files.size !== selected.length) return { message: BRIEF_PLAN_CHANGED };
  const options = await planOptions(context, projectId, files);
  if (selected.some(({ id, version }) => !options.some((option) => option.id === id && option.version === version))) {
    return { message: BRIEF_PLAN_CHANGED };
  }
  if (inspectPlanSetResourceBudget([...files.values()]).violation) {
    return { message: "Les plans choisis dépassent la taille autorisée. Réduisez votre sélection." };
  }
  for (const { id, version } of selected) {
    const file = files.get(id)!;
    if (file.file_path !== buildPlanFileStoragePath({ tenantId: context.tenantId, setId: file.plan_set_id,
      fileId: id, fileName: sanitizePlanPdfFilename(file.file_name) })) return { message: BRIEF_PLAN_CHANGED };
    const { data, error } = await context.supabase.storage.from(PLAN_FILES_BUCKET).download(file.file_path);
    if (error || !data || data.size !== file.file_size_bytes) return { message: BRIEF_PLAN_CHANGED };
    plans[id] = { version, sha256: createHash("sha256").update(new Uint8Array(await data.arrayBuffer())).digest("hex") };
  }
  return { plans };
}
