import { blockingRules, type LeftOut } from "@/lib/takeoff/rules/blocking";
import { TakeoffRuleResultsSchema } from "@/lib/takeoff/rules/contracts";
import { TAKEOFF_RULE_LABELS } from "@/lib/takeoff/rules/labels";
import { leftOutByPartners } from "@/lib/takeoff/rules/partner-exclusions";
import { TAKEOFF_RULE_IDS, type TakeoffRuleId, type TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import { isQuantityWarning } from "@/lib/takeoff/quantity-review-policy";
import type { TakeoffRuleForcingMetrics } from "@/lib/takeoff/metrics-types";

// TI-686 D10 (H19): per rule, the rate of false positives an administrator declared when forcing lines into an
// estimate, over the applied lines the rule fails. Pure: the route reads the rows (the consumptions through the
// administrators' read, H11) and this counts them.
// - Lines counted: the lines of the applied jobs read, not excluded. An applied job's lines are frozen
//   (enforce_takeoff_item_mutation_before_apply), and the application already excludes the lines the plan skips or
//   folds into an assembly.
// - Failed by R: a failure of R that is not left out, i.e. whose partners, all named, are all excluded among the job's
//   own lines (a partner of another job counts as present: partner-exclusions.ts).
// - Forced past R: a line of the override consumed for its job (only a consumed audit forced anything) whose failure
//   of R blocked it, as TI-681 defines it (checkApplyGuard): a quantity warning (a scale, a printed surface, an overlap,
//   a missing DN…) never blocks, so it is never forced nor declared.
// - Declared a false positive of R: a line forced past R whose coded reason is rule_false_positive naming R. A false
//   positive settled by V is not one (H19). The counts never exceed one another: n <= forced <= N.
// What the stored values hold is read as tolerantly as the guard reads it: unreadable results as none, an audit whose
// forced entries do not parse as forcing nothing.

export type RuleForcingJobRow = { id: string; status: string };

export type RuleForcingItemRow = {
  id: string;
  job_id: string;
  is_excluded: boolean;
  is_verified: boolean;
  rule_results: unknown;
};

export type RuleForcingAuditRow = { id?: string; record_id: string; action: string; after_data: unknown };

export type RuleForcingConsumptionRow = { audit_log_id: string; job_id: string };

type ForcedEntry = { reason_code: unknown; false_positive_rules?: unknown };

/** The forced entries of a consumed override, by line id (the audit's own job only). */
function forcedEntries(audit: RuleForcingAuditRow): Map<string, ForcedEntry> {
  const entries = new Map<string, ForcedEntry>();
  const metadata = (audit.after_data as { metadata?: { forced_items?: unknown } } | null)?.metadata;
  const forced = metadata?.forced_items;
  if (!Array.isArray(forced)) return entries;
  for (const entry of forced as unknown[]) {
    if (entry && typeof entry === "object" && typeof (entry as { item_id?: unknown }).item_id === "string") {
      entries.set(((entry as { item_id: string }).item_id).toLowerCase(), entry as ForcedEntry);
    }
  }
  return entries;
}

function readResults(value: unknown): TakeoffRuleResult[] {
  const results = TakeoffRuleResultsSchema.safeParse(value ?? []);
  return results.success ? results.data : [];
}

/** A rate in percent with one decimal, as the other rates of the payload; none without any line. */
function rate(count: number, total: number): number | null {
  return total > 0 ? Number(((count / total) * 100).toFixed(1)) : null;
}

export function buildRuleForcingStats(input: {
  jobs: readonly RuleForcingJobRow[];
  items: readonly RuleForcingItemRow[];
  overrideAudits: readonly RuleForcingAuditRow[];
  consumptions: readonly RuleForcingConsumptionRow[];
}): TakeoffRuleForcingMetrics {
  const applied = new Set(input.jobs.filter((job) => job.status === "applied").map((job) => job.id));

  // The override consumed for each applied job (its audit names the job: record_id).
  const consumedJobByAudit = new Map(input.consumptions.map((consumption) => [consumption.audit_log_id, consumption.job_id]));
  const forcedByJob = new Map<string, Map<string, ForcedEntry>>();
  for (const audit of input.overrideAudits) {
    if (audit.action !== "takeoff.apply.override" || !audit.id || !applied.has(audit.record_id)
      || consumedJobByAudit.get(audit.id) !== audit.record_id) continue;
    const entries = forcedByJob.get(audit.record_id) ?? new Map<string, ForcedEntry>();
    for (const [itemId, entry] of forcedEntries(audit)) entries.set(itemId, entry);
    forcedByJob.set(audit.record_id, entries);
  }

  // Each applied job's lines as frozen: whether each is excluded, for the partners of its cross-line failures.
  const excludedByJob = new Map<string, Map<string, boolean>>();
  for (const item of input.items) {
    if (!applied.has(item.job_id)) continue;
    const lines = excludedByJob.get(item.job_id) ?? new Map<string, boolean>();
    lines.set(item.id.toLowerCase(), item.is_excluded === true);
    excludedByJob.set(item.job_id, lines);
  }

  const counts = new Map(TAKEOFF_RULE_IDS.map((rule) => [rule, { failed: 0, forced: 0, declared: 0 }]));
  let forcedLines = 0;
  for (const item of input.items) {
    if (!applied.has(item.job_id) || item.is_excluded) continue;
    const ownLines = excludedByJob.get(item.job_id);
    const leftOut: LeftOut = (result) => leftOutByPartners(result, (id) => ownLines?.get(id));
    const results = readResults(item.rule_results);

    const failed = new Set<TakeoffRuleId>(results.filter((entry) => entry.status === "fail" && !leftOut(entry))
      .map((entry) => entry.rule));
    for (const rule of failed) counts.get(rule)!.failed += 1;

    const forced = forcedByJob.get(item.job_id)?.get(item.id.toLowerCase());
    if (!forced) continue;
    forcedLines += 1;
    const blocking = new Set<TakeoffRuleId>(blockingRules(results, item.is_verified === true, leftOut)
      .filter((entry) => !isQuantityWarning(entry.code)).map((entry) => entry.rule));
    const declared = forced.reason_code === "rule_false_positive" && Array.isArray(forced.false_positive_rules)
      ? new Set(forced.false_positive_rules as unknown[]) : new Set<unknown>();
    for (const rule of blocking) {
      counts.get(rule)!.forced += 1;
      if (declared.has(rule)) counts.get(rule)!.declared += 1;
    }
  }

  return {
    forcedLines,
    rows: TAKEOFF_RULE_IDS.map((rule) => {
      const { failed, forced, declared } = counts.get(rule)!;
      return { rule, label: TAKEOFF_RULE_LABELS[rule], failedLines: failed, forcedLines: forced,
        falsePositiveLines: declared, falsePositiveRate: rate(declared, failed) };
    }),
  };
}
