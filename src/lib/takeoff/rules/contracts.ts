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

const PartnerSchema = z.object({
  item_id: z.string(), job_id: z.string(), zone: z.string().max(16).nullable(), designation: z.string().max(500),
  overlap_m: finite, resolved: z.boolean(),
});

export const TakeoffRuleResultSchema: z.ZodType<TakeoffRuleResult> = z.object({
  rule: z.enum(TAKEOFF_RULE_IDS),
  status: z.enum(["pass", "fail"]),
  code: z.string().max(64),
  version: z.number().int().positive(),
  acceptable: z.boolean(),
  reason: z.string().max(1000),
  details: z.object({ partners: z.array(PartnerSchema).max(50).optional() }).passthrough().optional(),
}) as z.ZodType<TakeoffRuleResult>;

export const TakeoffRuleResultsSchema = z.array(TakeoffRuleResultSchema).max(16);

/** Rule inputs of a line's metadata, or null when it has none (or they no longer parse). */
export function readRuleInputs(metadata: unknown): TakeoffRuleInputs | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const parsed = TakeoffRuleInputsSchema.safeParse((metadata as { rule_inputs?: unknown }).rule_inputs);
  return parsed.success ? parsed.data : null;
}
