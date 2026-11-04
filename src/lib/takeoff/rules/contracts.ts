import { z } from "zod";

import { MATERIAL_CODES, NETWORK_CODES } from "@/lib/takeoff/bench/keys";
import { TAKEOFF_RULE_IDS, type TakeoffRuleInputs, type TakeoffRuleResult } from "@/lib/takeoff/rules/types";

// Wire shapes of the fixed rules (TI-664): the inputs the worker writes in
// takeoff_items.metadata.rule_inputs, the results the server writes in
// takeoff_items.rule_results (bounded like the column: 16 results, 64 KiB) and
// returns with each line.

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
  overlap_m: finite, resolved: z.boolean(),
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

function clip(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Results as every read accepts them: a reason or a partner's designation can quote user text of any length (a
 * designation of 500 characters, several partners), clipped here; the list of partners is cut at its bound. Throws
 * when results still do not parse, so that nothing unreadable is ever written (the line then stays stale and blocks
 * on both sides of the guard).
 */
export function boundRuleResults(results: readonly TakeoffRuleResult[]): TakeoffRuleResult[] {
  const bounded = results.map((entry) => {
    const partners = entry.details?.partners;
    return {
      ...entry,
      reason: clip(entry.reason, LIMITS.reason),
      ...(entry.details ? {
        details: {
          ...entry.details,
          ...(partners ? { partners: partners.slice(0, LIMITS.partners).map((partner) => ({ ...partner,
            designation: clip(partner.designation, LIMITS.designation), zone: partner.zone === null ? null : clip(partner.zone, LIMITS.zone) })) } : {}),
        },
      } : {}),
    };
  });
  return TakeoffRuleResultsSchema.parse(bounded);
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
