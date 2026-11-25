import "server-only";

import type { Database } from "@/types/database";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { readAllRows } from "@/lib/supabase/read-all";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildPlanFileStoragePath, sanitizePlanPdfFilename } from "@/lib/takeoff/plan-file-display-name";
import { inspectPlanSetResourceBudget, PLAN_FILE_MAX_SIZE_BYTES } from "@/lib/takeoff/plans";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { isTakeoffPlanDispatchActive } from "@/lib/takeoff/local-dispatcher";
import { readAdmittedContent, readingThroughOtherCopy } from "./admitted-plan-readings-server";
import { readTakeoffVisibleSources } from "./source-visibility-server";
import { isTakeoffSourceVisible } from "./request-activity";
import { sha256Hex } from "./sha256";
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

type VisibleFile = Pick<Database["public"]["Tables"]["plan_files"]["Row"], "id" | "plan_set_id" | "file_path" | "file_name" | "file_size_bytes">;
const changed = { code: "TAKEOFF_BRIEF_PLAN_CHANGED", message: BRIEF_PLAN_CHANGED } as const;

async function copyDigest(context: Context, file: VisibleFile) {
  if (file.file_size_bytes <= 0 || file.file_size_bytes > PLAN_FILE_MAX_SIZE_BYTES ||
      file.file_path !== buildPlanFileStoragePath({ tenantId: context.tenantId, setId: file.plan_set_id,
        fileId: file.id, fileName: sanitizePlanPdfFilename(file.file_name) })) return null;
  const { data, error } = await context.supabase.storage.from(PLAN_FILES_BUCKET).download(file.file_path);
  if (error || !data || data.size !== file.file_size_bytes) return null;
  return sha256Hex(new Uint8Array(await data.arrayBuffer()));
}

export async function readBriefPlanOptions(context: Context, projectId: string) {
  const service = createServiceRoleClient();
  if (!await isTakeoffEnabled(context.tenantId, { supabase: context.supabase }) || !await isTakeoffPlanDispatchActive(service)) return [];
  const files = await visiblePlanCopies(context, projectId);
  const options = await planOptions(context, projectId, files);
  if (!options.some(option => option.state !== "analysed")) return options;
  const history = await readAdmittedContent(service, context.tenantId, projectId);
  if (!history.size) return options;
  // The version token includes the copy UUID. Compare actual bytes to recognise a different copy.
  for (const option of options) {
    if (option.state === "analysed") continue;
    const digest = await copyDigest(context, files.get(option.id)!);
    if (!digest) {
      if (option.state !== "in_progress") option.state = "unverified";
      continue;
    }
    const prior = readingThroughOtherCopy(history.get(digest), option.id);
    if (prior) option.state = prior.state;
  }
  return options;
}

export async function attestBriefPlanChoice(context: Context, projectId: string, selected: BriefPlanSelection):
  Promise<{ plans: SealedBriefPlans } | { code: string; message: string }> {
  const plans: SealedBriefPlans = {};
  if (!selected.length) return { plans };
  const files = await visiblePlanCopies(context, projectId, selected.map(({ id }) => id));
  if (files.size !== selected.length) return changed;
  const options = await planOptions(context, projectId, files);
  const byId = new Map(options.map(option => [option.id, option]));
  if (selected.some(({ id, version }) => byId.get(id)?.version !== version)) return changed;
  if (inspectPlanSetResourceBudget([...files.values()]).violation) {
    return { code: "TAKEOFF_BRIEF_PLAN_LIMIT", message: "Les plans choisis dépassent la taille autorisée. Réduisez votre sélection." };
  }
  for (const { id, version } of selected) {
    const digest = await copyDigest(context, files.get(id)!);
    if (!digest) return changed;
    plans[id] = { version, sha256: digest };
  }
  const service = createServiceRoleClient();
  // A rewrite during hashing can make two different files appear identical. Give a stale
  // selection its recovery message before reporting a duplicate. Accepted selections are
  // rechecked by the confirmation RPC itself, under lock.
  async function refuseCurrentChoice(code: string, message: string) {
    const { data, error } = await service.rpc("takeoff_brief_plan_options", { p_tenant_id: context.tenantId,
      p_project_id: projectId, p_plans: plans });
    if (error) throw new Error("Impossible de vérifier les plans choisis.");
    return data.length === selected.length ? { code, message } : changed;
  }
  const firstWithDigest = new Map<string, string>();
  for (const [id, { sha256 }] of Object.entries(plans)) {
    const first = firstWithDigest.get(sha256);
    if (first) return refuseCurrentChoice("TAKEOFF_BRIEF_IDENTICAL_COPIES",
      `« ${byId.get(first)!.name} » et « ${byId.get(id)!.name} » sont le même fichier. Gardez-en un seul.`);
    firstWithDigest.set(sha256, id);
  }
  // The caller already checked affaire access. Read sealed units just before the confirmation RPC.
  const history = await readAdmittedContent(service, context.tenantId, projectId);
  for (const [digest, id] of firstWithDigest) {
    const prior = readingThroughOtherCopy(history.get(digest), id);
    if (!prior) continue;
    const visible = await readTakeoffVisibleSources({ supabase: context.supabase, tenantId: context.tenantId,
      projectId, ids: [prior.id, prior.documentId] });
    const where = isTakeoffSourceVisible(visible, prior.id, prior.documentId) ? `sous le nom « ${prior.name} »` : "dans cette affaire";
    return refuseCurrentChoice("TAKEOFF_BRIEF_COPY_ALREADY_REQUESTED", prior.state === "analysed"
      ? `Ce fichier a déjà été analysé ${where}.` : `L’analyse de ce fichier est déjà en cours ${where}.`);
  }
  return { plans };
}
