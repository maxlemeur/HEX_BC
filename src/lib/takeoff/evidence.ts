import {
  buildTakeoffLineEvidencePanel,
  prepareTakeoffLineEvidenceSync,
  type TakeoffLineEvidenceSyncInput,
} from "@/lib/takeoff/evidence-preparation";
import {
  applyTakeoffLineEvidenceSyncPlan,
  listActiveTakeoffLineEvidenceRows,
  listEvidenceAuthorNames,
  listTakeoffLineEvidenceRows,
  type EvidenceSupabaseClient,
} from "@/lib/takeoff/evidence-repository";
import type { TakeoffLineEvidencePanelResponse } from "@/lib/takeoff/types";

export { mapActiveLineEvidenceRowsToProofs } from "@/lib/takeoff/evidence-preparation";
export {
  listSupplierPriceEvidenceRows,
  listTakeoffLineEvidenceRows,
} from "@/lib/takeoff/evidence-repository";

export async function syncTakeoffLineEvidences(
  input: TakeoffLineEvidenceSyncInput & { supabase: EvidenceSupabaseClient }
) {
  const lineIds = [...new Set(input.rows.map((row) => row.line_id))];
  if (lineIds.length === 0) {
    return;
  }

  const existingRows = await listActiveTakeoffLineEvidenceRows({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
    jobId: input.jobId,
    lineIds,
  });
  const plan = prepareTakeoffLineEvidenceSync({
    ...input,
    existingRows,
    now: new Date().toISOString(),
  });
  await applyTakeoffLineEvidenceSyncPlan({
    supabase: input.supabase,
    tenantId: input.tenantId,
    jobId: input.jobId,
    plan,
  });
}

export async function mapTakeoffLineEvidencePanel(input: {
  supabase: EvidenceSupabaseClient;
  tenantId: string;
  versionId: string;
  jobId: string;
  lineId: string;
}): Promise<TakeoffLineEvidencePanelResponse> {
  const rows = await listTakeoffLineEvidenceRows({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
    jobId: input.jobId,
    lineIds: [input.lineId],
    includeHistory: true,
  });
  const authorNameById = await listEvidenceAuthorNames({
    supabase: input.supabase,
    jobId: input.jobId,
    authorIds: rows
      .map((row) => row.author_user_id)
      .filter((authorId): authorId is string => Boolean(authorId)),
  });

  return buildTakeoffLineEvidencePanel({
    rows,
    authorNameById,
    versionId: input.versionId,
    jobId: input.jobId,
    lineId: input.lineId,
  });
}
