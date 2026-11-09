import {
  checkApplyGuard,
  getTakeoffVerificationReadiness,
  type ApplyGuardBlockReason,
  type ApplyGuardItem,
  type ApplyGuardResult,
  type GuardBlockedItem,
} from "@/lib/takeoff/guards";
import { blockingRules, failedRules } from "@/lib/takeoff/rules/blocking";
import { leftOutByPartners } from "@/lib/takeoff/rules/partner-exclusions";
import { readRuleInputs } from "@/lib/takeoff/rules/contracts";
import type { TakeoffRuleResult, ZoneOverlapPartner } from "@/lib/takeoff/rules/types";
import { isQuantityWarning, quantitySourceComparison } from "@/lib/takeoff/quantity-review-policy";

// TI-681: show protections, quantity uncertainties, alternative-reading gaps
// and important priced posts. Recommendations never require every run to be
// acknowledged. Optional corrections, localized evidence and prior decisions
// remain available; stale results and technical protections retain their guard.
// TI-686 H17: V is never offered on a line that has a quantity to enter, even beside an acceptable failure (the
// database refuses V while a failure V never settles is there). A quantity to enter is entered with what it rests on
// (TI-686 D12, the review's QuantityEntryDialog).

export type TargetedReviewTier = "rejected" | "uncertain";

export type TargetedReviewLine<T extends ApplyGuardItem> = {
  item: T;
  tier: TargetedReviewTier;
  /** The guard's reasons for a rejected line; empty for an uncertain one. */
  reasons: ApplyGuardBlockReason[];
  rule_failures: NonNullable<GuardBlockedItem["rule_failures"]>;
};

/** The lines to review, rejected then uncertain, each in the job's order, and the guard they come from. */
export function targetedReviewLines<T extends ApplyGuardItem>(items: readonly T[], threshold: number, level: string | null,
  importantIds: readonly string[] = []) {
  const guard: ApplyGuardResult = checkApplyGuard([...items], threshold, { level, leftOut: leftOutByPartners });
  const byId = new Map(items.map((item) => [item.id, item]));
  const lines: TargetedReviewLine<T>[] = [
    ...guard.blocked_items.map((blocked) => ({ item: byId.get(blocked.item_id) as T, tier: "rejected" as const,
      reasons: blocked.reasons, rule_failures: blocked.rule_failures ?? [] })),
    ...guard.medium_items.map((medium) => ({ item: byId.get(medium.item_id) as T, tier: "uncertain" as const, reasons: [],
      rule_failures: [] })),
  ];
  const listed = new Set(lines.map((line) => line.item.id));
  const important = new Set(importantIds);
  for (const item of items) {
    if (item.is_excluded || listed.has(item.id)) continue;
    const warnings = (item.rule_results ?? []).filter((entry) => entry.status === "fail" && isQuantityWarning(entry.code));
    const comparison = quantitySourceComparison("metadata" in item ? item.metadata : null);
    if ((warnings.length === 0 && !important.has(item.id) && !comparison?.delta) || item.is_verified) continue;
    lines.push({ item, tier: "uncertain", reasons: warnings.length ? ["rule_failed"] : [], rule_failures: warnings });
  }
  for (const line of lines) {
    const warnings = (line.item.rule_results ?? []).filter((entry) => entry.status === "fail" && isQuantityWarning(entry.code));
    if (warnings.length > 0 && !line.reasons.includes("rule_failed")) line.reasons.push("rule_failed");
    line.rule_failures = [...line.rule_failures, ...warnings.filter(warning => !line.rule_failures.some(rule => rule.code === warning.code))];
  }
  return { guard, lines };
}

export type Acceptance = { enabled: boolean; reason: string | null };

const STALE_REASON = "Règles à recalculer : ce qu’elles disaient peut ne plus tenir, V ne les lève pas. Utilisez « Recalculer les règles ».";
const TO_ENTER_REASON = "Une quantité à saisir ne s’accepte pas : saisissez-la (F2, puis Entrée).";

/** Whether V settles something on this line, and why not. */
export function acceptanceOf(item: ApplyGuardItem, level: string | null): Acceptance {
  if (item.is_verified) return { enabled: false, reason: "Ligne déjà acceptée." };
  if (item.rules_stale) return { enabled: false, reason: STALE_REASON };
  const failures = blockingRules(item.rule_results, false);
  if (failures.some((failure) => failure.code === "DN_NETWORK_MATERIAL_BLOCKED")) {
    // TI-686: the admin override at apply time is the only way past it; no reserve, variant or provision exists yet.
    return { enabled: false, reason: "Matériau bloqué : corrigez la ligne. Sinon, seul un administrateur peut forcer l’application, avec une justification écrite." };
  }
  // TI-686 H17: a failure V never settles (a quantity to enter) refuses V on the whole line, as the database does
  // (TAKEOFF_RULE_NOT_ACCEPTABLE), even beside failures V settles.
  if (failedRules(item.rule_results).some((failure) => !failure.acceptable)) return { enabled: false, reason: TO_ENTER_REASON };
  const settles = failures.some((failure) => failure.acceptable)
    || ((level ?? "C") === "C" && failures.length === 0 && !item.rules_stale);
  if (!settles) return { enabled: false, reason: STALE_REASON };
  if ((level ?? "C") === "C") {
    const readiness = getTakeoffVerificationReadiness(item);
    if (!readiness.canVerify) return { enabled: false, reason: readiness.message };
  }
  return { enabled: true, reason: null };
}

/** A quantity as the database stores it (numeric(12,3)). */
function thousandths(value: number) {
  return Math.round(value * 1000) / 1000;
}

/** The rules' settling tolerance: 1 cm per reduced line (quantities rounded to the centimetre). */
const SETTLE_M = 0.01;

export type ZoneOverlapGuidance = {
  kind: "pair" | "group" | "unregistered" | "resolved";
  /** The results are to compute again: shown, never acted on. */
  stale: boolean;
  /** A pair: the length still counted twice. A group: what the other lines draw of this line. */
  overlap_m: number | null;
  group_size: number | null;
  partners: ZoneOverlapPartner[];
  /** The quantity that settles a pair (this line less the length counted twice); null when none does. */
  reduce_to: number | null;
  /** The others draw all of this line: excluding it (« Retirer la ligne ») settles its part of the duplicate. */
  remove_line: boolean;
  /** A group: the length of this line no other line draws (excluding the line would lose it). */
  own_m: number | null;
};

/** What the zone overlap rule says of a line and what settles it; null when the rule does not read it or passes alone. */
export function zoneOverlapGuidance(item: ApplyGuardItem & { quantity: number; metadata?: unknown }): ZoneOverlapGuidance | null {
  const result: TakeoffRuleResult | undefined = (item.rule_results ?? []).find((entry) => entry.rule === "zone_overlap");
  if (!result) return null;
  const partners = result.details?.partners ?? [];
  const stale = item.rules_stale === true;
  const base = { stale, overlap_m: null, group_size: null, partners, reduce_to: null, remove_line: false, own_m: null };
  if (result.code === "ZONE_OVERLAP_RESOLVED") return { kind: "resolved", ...base };
  if (result.code === "ZONE_OVERLAP_UNREGISTERED") return { kind: "unregistered", ...base };
  if (result.code !== "ZONE_OVERLAP_DUPLICATE") return null;
  const overlap = result.details?.overlap_m ?? 0;
  const groupSize = result.details?.group_size ?? null;
  // The line as measured: the rules read a reduction against it (evaluate.ts), never against a quantity raised above.
  const measured = readRuleInputs(item.metadata)?.model_quantity ?? item.quantity;
  if (groupSize !== null && groupSize >= 3) {
    // What the others draw of the line (a quantity reduced by hand settles no group).
    const own = Math.max(0, thousandths(measured - overlap));
    return { ...base, kind: "group", overlap_m: overlap, group_size: groupSize, remove_line: !stale && own <= SETTLE_M, own_m: own };
  }
  const reduced = thousandths(Math.min(item.quantity, measured) - overlap);
  const entire = reduced <= SETTLE_M;
  return { ...base, kind: "pair", overlap_m: overlap, reduce_to: entire || stale ? null : reduced, remove_line: entire && !stale };
}

/** The exclusion reason a guided « Retirer la ligne » proposes: the lines that draw it too, the user may edit it. */
export function duplicateExclusionReason(guidance: ZoneOverlapGuidance) {
  const others = guidance.partners.map((partner) => `« ${partner.designation} »${partner.zone ? ` (${partner.zone})` : ""}`);
  return `Entièrement en double : tronçon déjà compté par ${others.join(", ") || "une autre zone"}.`.slice(0, 500);
}
