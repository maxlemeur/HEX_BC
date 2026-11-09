import "server-only";

import { getTakeoffJobDetails, getAuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { loadTakeoffDpgfComparisonContext } from "@/lib/takeoff/dpgf-comparison-context-server";
import { computeTakeoffDpgfRows } from "@/lib/takeoff/dpgf-compare";
import { readAllEstimateItems, assertEstimateVersionUnchanged } from "@/lib/estimates/read-all-items-server";
import { calculateEstimateBreakdownForItems, calculateEstimateV3SnapshotForItems } from "@/lib/estimates/version-totals";
import { buildFinancialReviewPosts } from "@/lib/takeoff/financial-review";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";
import { haveComparableQuantities } from "@/lib/takeoff/quantity-compatibility";
import { takeoffReviewContextResponseSchema } from "@/lib/takeoff/review-context-contracts";
import { mapSupabaseError, notFound } from "@/lib/estimates/errors";
import { requireEstimateEngineVersion, usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import { quantitySourceComparison } from "@/lib/takeoff/quantity-review-policy";

/** Current authorized draft amounts, using the same engines as the estimate. */
export async function getTakeoffReviewContext(jobId: string) {
  const detail = await getTakeoffJobDetails(jobId, { items_limit: 1, items_offset: 0 });
  const auth = await getAuthenticatedTakeoffContext();
  const versionId = detail.job.estimate_version_id;
  const context = await loadTakeoffDpgfComparisonContext({ jobId, versionId, auth });
  const versionRead = await auth.supabase.from("estimate_versions").select("*")
    .eq("id", versionId).eq("tenant_id", auth.tenantId).single();
  if (versionRead.error) throw mapSupabaseError(versionRead.error, "Impossible de lire les montants du devis.");
  const version = versionRead.data;
  if (!version) throw notFound("Version introuvable.");
  const rows = computeTakeoffDpgfRows(context.comparisonInput).rows;
  // A historical sealed version is never recalculated at today's catalogue or labor rates.
  if (version.status !== "draft") return takeoffReviewContextResponseSchema.parse({ version_id: versionId, posts: [], unlinked_item_ids: [] });
  const [items, project] = await Promise.all([
    readAllEstimateItems({ supabase: auth.supabase, tenantId: auth.tenantId, versionId }),
    auth.supabase.from("estimate_projects").select("user_id").eq("id", version.project_id).eq("tenant_id", auth.tenantId).single(),
  ]);
  if (project.error) throw mapSupabaseError(project.error, "Impossible de lire le contexte du lot.");
  if (!project.data) throw notFound("Affaire introuvable.");
  const scope = { supabase: auth.supabase, tenantId: auth.tenantId, projectUserId: project.data.user_id, version, lineItems: items };
  const amounts = new Map<string, number>();
  if (usesSaleCoefficients(requireEstimateEngineVersion(version))) {
    const result = await calculateEstimateV3SnapshotForItems(scope);
    for (const line of result.breakdown.lines) amounts.set(line.id, line.line_total_ht_cents);
  } else {
    const result = await calculateEstimateBreakdownForItems(scope);
    for (const [id, line] of result.lineById) amounts.set(id, line.saleNetHtCents);
  }
  const matches = rows.map(row => ({ line_id: row.line_id,
    item_ids: row.linked_takeoff_items.map(item => item.item_id), delta_absolute: row.delta_absolute }));
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const unitKey = (value: string) => normalizeMeasurementUnit(value).unitCode ?? normalize(value);
  const destinations = new Map<string, typeof items>();
  for (const item of items.filter(item => item.item_type === "line" && item.source_provider !== "dpgf")) {
    const key = `${normalize(item.title)}|${unitKey(item.unit_code ?? item.description ?? "")}`;
    destinations.set(key, [...(destinations.get(key) ?? []), item]);
  }
  const sources = new Map<string, typeof context.takeoffItems>();
  for (const item of context.takeoffItems.filter(item => !item.is_excluded)) {
    const key = `${normalize(item.designation)}|${unitKey(item.unit)}`;
    sources.set(key, [...(sources.get(key) ?? []), item]);
  }
  for (const [key, lines] of destinations) {
    for (const item of lines) {
      const unit = item.unit_code ?? item.description ?? "";
      const linkedItems = lines.length === 1 ? (sources.get(key) ?? []).filter(source =>
        haveComparableQuantities(source, { designation: item.title, quantity: item.quantity ?? 0, unit })) : [];
      matches.push({ line_id: item.id, item_ids: linkedItems.map(source => source.id),
        delta_absolute: linkedItems.length && item.quantity !== null ? Math.abs(linkedItems.reduce((sum, source) => sum + source.quantity, 0) - item.quantity) : null });
    }
  }
  await assertEstimateVersionUnchanged({ supabase: auth.supabase, version });
  const linked = new Set(matches.flatMap(match => match.item_ids));
  return takeoffReviewContextResponseSchema.parse({ version_id: versionId,
    unlinked_item_ids: context.takeoffItems.filter(item => !item.is_excluded && !linked.has(item.id)).map(item => item.id),
    posts: buildFinancialReviewPosts(items, amounts, matches, new Map(context.takeoffItems.flatMap(item => {
      const comparison = quantitySourceComparison(item.metadata);
      return comparison ? [[item.id, comparison] as const] : [];
    })))
      .filter(post => post.recommend_review !== false || (post.impact_cents ?? 0) > 0),
  });
}
