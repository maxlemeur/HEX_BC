import {
  checkApplyGuard,
  getTakeoffVerificationReadiness,
  type ApplyGuardBlockReason,
  type ApplyGuardItem,
  type ApplyGuardResult,
  type GuardBlockedItem,
} from "@/lib/takeoff/guards";
import { blockingRules } from "@/lib/takeoff/rules/blocking";
import { leftOutByPartners } from "@/lib/takeoff/rules/partner-exclusions";
import { readRuleInputs } from "@/lib/takeoff/rules/contracts";
import type { TakeoffRuleResult, ZoneOverlapPartner } from "@/lib/takeoff/rules/types";

// The targeted review of a takeoff job (TI-664 step 4, TI-658 « le modèle propose, les règles décident, une personne
// tranche »): only the lines the apply guard rejects or finds uncertain, each with what may settle it.
// - The lines are the guard's own (checkApplyGuard, same threshold and level as the application): nothing the guard
//   lets through is shown, nothing it stops is hidden. Like the review's own gate, it reads every included line: a
//   line the mapping plan will skip is still listed (the safe side; the wizard and the server leave it out).
// - Results to compute again (rules_stale: a recomputation skipped or failed) guide nothing: what they say may no
//   longer hold (a length already removed, a partner already excluded), so neither V nor a guided decision is offered.
// - V (accept) settles a low or medium confidence and every acceptable failed rule; never a quantity to enter, never
//   results to compute again; on level C only a line with its localized proof, as the database requires.
// - A Z1/Z2 duplicate shows the length counted twice and the other zone's line. An isolated pair is settled by
//   removing that length from one line; a group of three lines or more never by a quantity (decision of 4 Nov. 2026,
//   docs/metier/regles-metre.md « Résolution »): each of its lines is removed (excluded) when the others draw all of
//   it, or accepted (V) once checked.

export type TargetedReviewTier = "rejected" | "uncertain";

export type TargetedReviewLine<T extends ApplyGuardItem> = {
  item: T;
  tier: TargetedReviewTier;
  /** The guard's reasons for a rejected line; empty for an uncertain one. */
  reasons: ApplyGuardBlockReason[];
  rule_failures: NonNullable<GuardBlockedItem["rule_failures"]>;
};

/** The lines to review, rejected then uncertain, each in the job's order, and the guard they come from. */
export function targetedReviewLines<T extends ApplyGuardItem>(items: readonly T[], threshold: number, level: string | null) {
  const guard: ApplyGuardResult = checkApplyGuard([...items], threshold, { level, leftOut: leftOutByPartners });
  const byId = new Map(items.map((item) => [item.id, item]));
  const lines: TargetedReviewLine<T>[] = [
    ...guard.blocked_items.map((blocked) => ({ item: byId.get(blocked.item_id) as T, tier: "rejected" as const,
      reasons: blocked.reasons, rule_failures: blocked.rule_failures ?? [] })),
    ...guard.medium_items.map((medium) => ({ item: byId.get(medium.item_id) as T, tier: "uncertain" as const, reasons: [],
      rule_failures: [] })),
  ];
  return { guard, lines };
}

export type Acceptance = { enabled: boolean; reason: string | null };

const STALE_REASON = "Règles à recalculer : ce qu’elles disaient peut ne plus tenir, V ne les lève pas. Enregistrez une correction pour relancer le calcul.";

/** Whether V settles something on this line, and why not. */
export function acceptanceOf(item: ApplyGuardItem, level: string | null): Acceptance {
  if (item.is_verified) return { enabled: false, reason: "Ligne déjà acceptée." };
  if (item.rules_stale) return { enabled: false, reason: STALE_REASON };
  const failures = blockingRules(item.rule_results, false);
  const settles = failures.some((failure) => failure.acceptable)
    || ((level ?? "C") === "C" && failures.length === 0 && !item.rules_stale);
  if (!settles) {
    return {
      enabled: false,
      reason: failures.some((failure) => !failure.acceptable)
        ? "Une quantité à saisir ne s’accepte pas : saisissez-la (F2, puis Entrée)."
        : STALE_REASON,
    };
  }
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
