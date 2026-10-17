import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { computeReadOnlyTotals } from "@/lib/estimate-calculations";
import { resolveFixedDiscountSignal, type CanonicalFixedDiscountEvidence, type FixedDiscountVersion } from "@/lib/estimates/effective-discount";
import {
  isLegacyEngine,
  isUnifiedEngine,
  requireEstimateEngineVersion,
  requireHistoricalEngine,
} from "@/lib/estimates/engine/capabilities";
import { conflict, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import { assertEstimateVersionUnchanged, readAllEstimateItems } from "@/lib/estimates/read-all-items-server";
import { calculateEstimateSnapshotForItems, type EstimateCalculationDependencies } from "@/lib/estimates/version-totals";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;
type Item = Database["public"]["Tables"]["estimate_items"]["Row"];
type Version = Database["public"]["Tables"]["estimate_versions"]["Row"] & FixedDiscountVersion;
type AuthorizedVersion = { id: string; project_id: string; status: string; updated_at: string; content_revision: number } & FixedDiscountVersion;

function contextChanged(): never {
  throw conflict("Le contexte de calcul a changé. Rechargez le devis avant de poursuivre.", undefined, "CONTEXT_CHANGED");
}

async function readDependencies(input: {
  supabase: Supabase;
  tenantId: string;
  projectUserId: string;
  version: Version;
  items: Item[];
}): Promise<EstimateCalculationDependencies> {
  const roleIds = Array.from(new Set(input.items.flatMap((item) => [
    item.labor_role_id, item.labor_role_atelier_id, item.labor_role_chantier_id,
  ]).filter((id): id is string => typeof id === "string")));
  const [roles, tiers, flag] = await Promise.all([
    roleIds.length === 0 ? Promise.resolve({ data: [], error: null, count: 0 }) :
      input.supabase.from("labor_roles").select("id, tenant_id, user_id, hourly_rate_cents", { count: "exact" })
        .eq("tenant_id", input.tenantId).eq("user_id", input.projectUserId).in("id", roleIds),
    input.version.margin_mode !== "tiered" ? Promise.resolve({ data: [], error: null, count: 0 }) :
      input.supabase.from("margin_tiers").select("id, threshold_cents, multiplier, position", { count: "exact" })
        .eq("tenant_id", input.tenantId).order("threshold_cents").order("position").order("id"),
    input.supabase.from("feature_flags").select("id, enabled").eq("tenant_id", input.tenantId)
      .eq("flag_key", "EST_031_LABOR_SPLIT").maybeSingle(),
  ]);
  const error = roles.error ?? tiers.error ?? flag.error;
  if (error) throw mapSupabaseError(error, "Impossible de vérifier le contexte de remise.");
  if (roles.count === null || roles.count !== roles.data?.length ||
    tiers.count === null || tiers.count !== tiers.data?.length) contextChanged();
  return {
    labor_roles: [...(roles.data ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
    margin_tiers: tiers.data ?? [],
    labor_split_flag: flag.data,
  };
}

/** Called only after tenant/project access; never writes a snapshot or reads current prices for an issued offer. */
export async function loadCanonicalFixedDiscountEvidence(input: {
  supabase: Supabase;
  tenantId: string;
  projectUserId: string;
  authorizedVersion: AuthorizedVersion;
}): Promise<CanonicalFixedDiscountEvidence | null> {
  if (input.authorizedVersion.discount_amount_cents == null) return null;
  const { data, error } = await input.supabase.from("estimate_versions").select("*")
    .eq("tenant_id", input.tenantId).eq("id", input.authorizedVersion.id).single();
  if (error) throw mapSupabaseError(error, "Impossible de charger la preuve de remise.");
  if (!data) throw notFound("Version de chiffrage introuvable.");
  const version = data as Version;
  const calcEngineVersion = requireHistoricalEngine(requireEstimateEngineVersion(version));
  if (version.tenant_id !== input.tenantId || ["id", "project_id", "status", "updated_at", "content_revision", "discount_amount_cents", "total_ht_cents"].some((key) => {
    const name = key as keyof AuthorizedVersion;
    return input.authorizedVersion[name] !== version[name as keyof Version];
  })) contextChanged();
  const { data: project, error: projectError } = await input.supabase.from("estimate_projects")
    .select("id, tenant_id, user_id").eq("tenant_id", input.tenantId).eq("id", version.project_id).single();
  if (projectError) throw mapSupabaseError(projectError, "Impossible de vérifier le projet de la remise.");
  if (!project || project.user_id !== input.projectUserId) throw notFound("Projet de chiffrage introuvable.");

  // Finalized V2 must use the actual frozen capture, never a live reconstruction.
  if (version.status !== "draft" && isUnifiedEngine(calcEngineVersion)) {
    await assertEstimateVersionUnchanged({ supabase: input.supabase, version });
    return null;
  }
  const items = await readAllEstimateItems({ supabase: input.supabase, tenantId: input.tenantId, versionId: version.id });
  let baseCents: number;
  let appliedCents: number;
  let source: CanonicalFixedDiscountEvidence["source"];
  if (version.status === "draft") {
    const calculated = await calculateEstimateSnapshotForItems({
      supabase: input.supabase, tenantId: input.tenantId, projectUserId: input.projectUserId,
      version, lineItems: items.filter((item) => item.item_type === "line"), captureDependencies: true,
    });
    if (!calculated.dependencies) contextChanged();
    const currentDependencies = await readDependencies({ ...input, version, items });
    if (JSON.stringify(calculated.dependencies) !== JSON.stringify(currentDependencies)) contextChanged();
    baseCents = calculated.breakdown.totals.saleSubtotalCents;
    appliedCents = calculated.breakdown.totals.discountCents;
    source = "authenticated_live";
  } else {
    if (!isLegacyEngine(calcEngineVersion) || items.some((item) => item.item_type === "line" &&
      (typeof item.line_total_ht_cents !== "number" || !Number.isSafeInteger(item.line_total_ht_cents) || item.line_total_ht_cents < 0))) return null;
    const stored = computeReadOnlyTotals({
      items, version, discountCents: version.discount_amount_cents ?? 0,
      laborRateById: new Map(), isLaborSplitEnabled: false, marginTiers: [],
      roundingMode: version.rounding_mode, roundingStepCents: version.rounding_step_cents,
      calcEngineVersion: 1,
    });
    baseCents = stored.saleSubtotalCents;
    appliedCents = Math.min(version.discount_amount_cents ?? 0, baseCents);
    source = "stored_v1";
  }
  const { data: currentProject, error: currentProjectError } = await input.supabase.from("estimate_projects")
    .select("id, tenant_id, user_id").eq("tenant_id", input.tenantId).eq("id", version.project_id).single();
  if (currentProjectError) throw mapSupabaseError(currentProjectError, "Impossible de vérifier le propriétaire du calcul.");
  if (!currentProject || currentProject.id !== project.id || currentProject.tenant_id !== project.tenant_id ||
    currentProject.user_id !== project.user_id) contextChanged();
  await assertEstimateVersionUnchanged({ supabase: input.supabase, version });
  const evidence: CanonicalFixedDiscountEvidence = {
    source,
    version: { id: version.id, tenant_id: version.tenant_id, project_id: version.project_id,
      status: version.status, content_revision: version.content_revision, updated_at: version.updated_at },
    fixed_discount: { requested_cents: version.discount_amount_cents ?? 0, base_cents: baseCents, applied_cents: appliedCents },
    net_cents: baseCents - appliedCents,
  };
  return resolveFixedDiscountSignal(version, evidence).state === "ready" ? evidence : null;
}
