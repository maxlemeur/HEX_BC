import { z } from "zod";

import { MATERIAL_CODES, NETWORK_CODES } from "@/lib/takeoff/bench/keys";
import { jsonbTextBytes } from "@/lib/takeoff/rules/jsonb-size";
import { TAKEOFF_RULE_IDS, ZONE_OVERLAP_DIFFERENCES, type TakeoffRuleInputs, type TakeoffRuleResult } from "@/lib/takeoff/rules/types";

// Wire shapes of the fixed rules (TI-664): the inputs the worker writes in
// takeoff_items.metadata.rule_inputs, the results the server writes in
// takeoff_items.rule_results (bounded like the column: 16 results, 64 KiB of
// jsonb text, measured before the write: TI-677) and returns with each line.

const finite = z.number().finite();

export const TakeoffRuleInputsSchema: z.ZodType<TakeoffRuleInputs> = z.object({
  version: z.number().int().positive(),
  source: z.enum(["vector", "designation"]),
  kind: z.enum(["network", "insulation", "surface", "count"]).nullable(),
  network: z.enum(NETWORK_CODES).nullable(),
  material: z.enum(MATERIAL_CODES).nullable(),
  dn: z.string().max(40).nullable(),
  non_observable: z.enum(["vertical", "weld", "tap", "support", "install_only", "transport", "service"]).nullable(),
  model_quantity: finite,
  room: z.string().max(120).nullable().optional(),
  printed_m2: finite.nullable().optional(),
});

const LIMITS = { code: 64, reason: 1000, partners: 50, zone: 16, designation: 500 } as const;

const PartnerSchema = z.object({
  item_id: z.string(), job_id: z.string(), zone: z.string().max(LIMITS.zone).nullable(), designation: z.string().max(LIMITS.designation),
  overlap_m: finite, resolved: z.boolean(), differs: z.array(z.enum(ZONE_OVERLAP_DIFFERENCES)).min(1).max(ZONE_OVERLAP_DIFFERENCES.length).optional(),
});

export const TakeoffRuleResultSchema: z.ZodType<TakeoffRuleResult> = z.object({
  rule: z.enum(TAKEOFF_RULE_IDS),
  status: z.enum(["pass", "fail"]),
  code: z.string().max(LIMITS.code),
  version: z.number().int().positive(),
  acceptable: z.boolean(),
  reason: z.string().max(LIMITS.reason),
  details: z.object({ partners: z.array(PartnerSchema).max(LIMITS.partners).optional() }).passthrough().optional(),
}) as z.ZodType<TakeoffRuleResult>;

export const TakeoffRuleResultsSchema = z.array(TakeoffRuleResultSchema).max(16);

/** The check of takeoff_items.rule_results: octet_length(rule_results::text) <= 65536. */
export const RULE_RESULTS_MAX_BYTES = 65_536;

/** A text cut to `max` UTF-16 units, an ellipsis last; never between the two halves of a surrogate pair (unstorable). */
function clip(text: string, max: number) {
  if (text.length <= max) return text;
  let end = max - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

/**
 * Bounds tried in turn until the results fit the column's byte budget (TI-677): the first is the schema's, which
 * keeps every result as written up to its field limits; the next ones clip the partners' designations and the reason,
 * then keep the partners with the largest common length first and the first overlapping rooms. The last keeps only
 * what decides and guides: a short reason and the numbers of the details (16 results of it stay far under the
 * budget). Never touched: the rule, status, code, version and « acceptable » (what blocks), the length counted twice,
 * the group size, the overlapping area (what guides the decision).
 */
const RESULT_BOUNDS = [
  { reason: LIMITS.reason, designation: LIMITS.designation, partners: LIMITS.partners, rooms: Number.POSITIVE_INFINITY, numbersOnly: false },
  { reason: LIMITS.reason, designation: 120, partners: LIMITS.partners, rooms: 500, numbersOnly: false },
  { reason: 300, designation: 40, partners: 20, rooms: 100, numbersOnly: false },
  { reason: 120, designation: 16, partners: 5, rooms: 20, numbersOnly: false },
  { reason: 60, designation: 0, partners: 0, rooms: 0, numbersOnly: true },
] as const;

/**
 * The details' numbers (the length counted twice, the group size, the areas…), the level, clipped, and the basis the
 * price line expects (what the acceptance of a printed area compares, TI-686 D9).
 */
function detailNumbers(details: NonNullable<TakeoffRuleResult["details"]>) {
  const kept = Object.entries(details).filter(([, value]) => typeof value === "number" && Number.isFinite(value));
  return { ...Object.fromEntries([...kept, ...(typeof details.level === "string" ? [["level", clip(details.level, LIMITS.zone)]] : [])]),
    ...(details.expected_basis === "net_floor" || details.expected_basis === "shab" ? { expected_basis: details.expected_basis } : {}),
    ...(details.quantity_context_key ? { quantity_context_key: details.quantity_context_key } : {}),
    ...(details.failure_keys_sha256 ? { failure_keys_sha256: details.failure_keys_sha256 } : {}) };
}

function withinBounds(results: readonly TakeoffRuleResult[], bounds: (typeof RESULT_BOUNDS)[number]) {
  return results.map((entry) => {
    const partners = entry.details?.partners;
    const rooms = entry.details?.overlapping_item_ids;
    return {
      ...entry,
      reason: clip(entry.reason, bounds.reason),
      ...(entry.details ? {
        details: bounds.numbersOnly ? detailNumbers(entry.details) : {
          ...entry.details,
          ...(partners ? { partners: partners.slice(0, bounds.partners).map((partner) => ({ ...partner,
            designation: clip(partner.designation, bounds.designation), zone: partner.zone === null ? null : clip(partner.zone, LIMITS.zone) })) } : {}),
          ...(rooms ? { overlapping_item_ids: rooms.slice(0, bounds.rooms) } : {}),
        },
      } : {}),
    };
  });
}

/**
 * Results as every read accepts them and the column stores them: a reason or a partner's designation can quote user
 * text of any length (a designation of 500 multibyte characters, fifty partners), a room can overlap thousands of
 * rooms. Each bound is tried in turn until the jsonb text fits RULE_RESULTS_MAX_BYTES (jsonbTextBytes, the measure
 * of the check); the last bound always fits schema-valid results. Throws when results do not parse (or would still not
 * fit), so that nothing unreadable or unstorable is ever written: the line then keeps its stored state.
 */
export function boundRuleResults(results: readonly TakeoffRuleResult[]): TakeoffRuleResult[] {
  for (const bounds of RESULT_BOUNDS) {
    const bounded = TakeoffRuleResultsSchema.parse(withinBounds(results, bounds));
    if (jsonbTextBytes(bounded) <= RULE_RESULTS_MAX_BYTES) return bounded;
  }
  throw new Error(`Résultats de règles au-delà de ${RULE_RESULTS_MAX_BYTES} octets après réduction.`);
}

/**
 * Rule inputs as the worker may write them: what the reader accepts. A printed size longer than the bound is no size
 * (the DN rule then fails the line, never skips it); a room label is clipped. Null when they still do not parse: the
 * line then carries no inputs and is not left stale forever.
 */
export function writableRuleInputs(inputs: TakeoffRuleInputs): TakeoffRuleInputs | null {
  const bounded = {
    ...inputs,
    dn: inputs.dn !== null && inputs.dn.length > 40 ? null : inputs.dn,
    ...(typeof inputs.room === "string" ? { room: clip(inputs.room, 120) } : {}),
  };
  const parsed = TakeoffRuleInputsSchema.safeParse(bounded);
  return parsed.success ? parsed.data : null;
}

/** Rule inputs of a line's metadata, or null when it has none (or they no longer parse). */
export function readRuleInputs(metadata: unknown): TakeoffRuleInputs | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const parsed = TakeoffRuleInputsSchema.safeParse((metadata as { rule_inputs?: unknown }).rule_inputs);
  return parsed.success ? parsed.data : null;
}
