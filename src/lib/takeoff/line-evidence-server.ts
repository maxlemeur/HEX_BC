import "server-only";

import { z } from "zod";
import { type AuthenticatedTakeoffContext, getAuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";
import { takeoffJobIdSchema, type TakeoffLineEvidencePanelQuery } from "@/lib/takeoff/schemas";
import type { TakeoffDpgfComparisonResponse, TakeoffLineEvidencePanelResponse } from "@/lib/takeoff/types";
import type { SupplierPriceEvidenceRow } from "@/lib/takeoff/evidence-preparation";
import { type TakeoffDpgfEstimateItem } from "@/lib/takeoff/dpgf-comparison-preparation";
import { loadTakeoffDpgfComparisonContext } from "@/lib/takeoff/dpgf-comparison-context-server";
import { buildTakeoffDpgfComparison } from "@/lib/takeoff/dpgf-compare";
import {
  listSupplierPriceEvidenceRows,
  listTakeoffLineEvidenceRows,
  mapActiveLineEvidenceRowsToProofs,
  mapTakeoffLineEvidencePanel,
  syncTakeoffLineEvidences,
} from "@/lib/takeoff/evidence";

export async function buildSupplierPriceEvidenceByEstimateItemId(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  estimateItems: TakeoffDpgfEstimateItem[];
}) {
  const selectedPriceIds = input.estimateItems
    .map((item) => item.selected_supplier_price_id ?? null)
    .filter((priceId): priceId is string => typeof priceId === "string");

  if (selectedPriceIds.length === 0) {
    return new Map<string, SupplierPriceEvidenceRow>();
  }

  const supplierPriceById = await listSupplierPriceEvidenceRows({
    supabase: input.supabase as never,
    tenantId: input.tenantId,
    supplierPriceIds: selectedPriceIds,
  });

  return new Map(
    input.estimateItems.flatMap((item) => {
      if (!item.selected_supplier_price_id) {
        return [];
      }

      const supplierPrice = supplierPriceById.get(item.selected_supplier_price_id);
      if (!supplierPrice) {
        return [];
      }

      return [[item.id, supplierPrice] as const];
    })
  );
}

export async function syncAndHydrateTakeoffLineProofs(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  userId: string | null;
  projectId: string;
  versionId: string;
  jobId: string;
  rows: TakeoffDpgfComparisonResponse["rows"];
  supplierPriceByEstimateItemId: Map<string, SupplierPriceEvidenceRow>;
}) {
  if (input.rows.length === 0) {
    return input.rows;
  }

  await syncTakeoffLineEvidences({
    supabase: input.supabase as never,
    tenantId: input.tenantId,
    userId: input.userId,
    projectId: input.projectId,
    versionId: input.versionId,
    jobId: input.jobId,
    rows: input.rows,
    supplierPriceByEstimateItemId: input.supplierPriceByEstimateItemId,
  });

  const evidenceRows = await listTakeoffLineEvidenceRows({
    supabase: input.supabase as never,
    tenantId: input.tenantId,
    versionId: input.versionId,
    jobId: input.jobId,
    lineIds: input.rows.map((row) => row.line_id),
    includeHistory: false,
  });

  const proofsByLineId = new Map<string, ReturnType<typeof mapActiveLineEvidenceRowsToProofs>>();
  for (const evidenceRow of evidenceRows) {
    const current = proofsByLineId.get(evidenceRow.estimate_item_id) ?? [];
    current.push(...mapActiveLineEvidenceRowsToProofs([evidenceRow]));
    proofsByLineId.set(evidenceRow.estimate_item_id, current);
  }

  return input.rows.map((row) => ({
    ...row,
    proofs: proofsByLineId.get(row.line_id) ?? row.proofs,
  }));
}

export async function refreshTakeoffLineEvidenceSnapshot(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  userId: string | null;
  versionId: string;
  jobId: string;
  estimateItemIds: string[];
}) {
  if (input.estimateItemIds.length === 0) return;

  const context = await loadTakeoffDpgfComparisonContext({
    auth: input,
    versionId: input.versionId,
    jobId: input.jobId,
    estimateItemIds: input.estimateItemIds,
  });
  const comparison = buildTakeoffDpgfComparison({
    ...context.comparisonInput,
    pageSize: context.comparisonInput.dpgfLines.length,
    view: "all",
  });
  const supplierPriceByEstimateItemId = await buildSupplierPriceEvidenceByEstimateItemId({
    supabase: context.supabase,
    tenantId: context.tenantId,
    estimateItems: context.estimateItems,
  });
  await syncTakeoffLineEvidences({
    supabase: context.supabase as never,
    tenantId: context.tenantId,
    userId: context.userId,
    projectId: context.projectId,
    versionId: context.comparisonInput.versionId,
    jobId: context.comparisonInput.jobId,
    rows: comparison.rows,
    supplierPriceByEstimateItemId,
  });
}

export async function fetchTakeoffLineEvidencePanel(
  jobId: string,
  input: TakeoffLineEvidencePanelQuery & {
    line_id: string;
  }
): Promise<TakeoffLineEvidencePanelResponse> {
  const { supabase, tenantId, userId } = await getAuthenticatedTakeoffContext();
  const normalizedJobId = parseWithSchema(
    takeoffJobIdSchema,
    jobId,
    "Identifiant job invalide."
  );
  const normalizedVersionId = parseWithSchema(
    z.string().uuid("version_id invalide."),
    input.version_id,
    "version_id invalide."
  );
  const normalizedLineId = parseWithSchema(
    z.string().uuid("line_id invalide."),
    input.line_id,
    "line_id invalide."
  );

  await refreshTakeoffLineEvidenceSnapshot({
    supabase,
    tenantId,
    userId,
    versionId: normalizedVersionId,
    jobId: normalizedJobId,
    estimateItemIds: [normalizedLineId],
  });

  return mapTakeoffLineEvidencePanel({
    supabase: supabase as never,
    tenantId,
    versionId: normalizedVersionId,
    jobId: normalizedJobId,
    lineId: normalizedLineId,
  });
}
