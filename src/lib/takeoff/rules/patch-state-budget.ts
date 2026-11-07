import type { TakeoffItemRuleState } from "@/lib/takeoff/types";

export const RULE_STATE_INLINE_MAX = 100;
const RULE_STATE_INLINE_BYTES = 262_144;

/** Never send a prefix: clients refresh through the paginated job reader when the whole state won't fit. */
export function boundedRuleStates(states: TakeoffItemRuleState[]): TakeoffItemRuleState[] | null {
  if (states.length > RULE_STATE_INLINE_MAX) return null;
  return new TextEncoder().encode(JSON.stringify(states)).byteLength <= RULE_STATE_INLINE_BYTES ? states : null;
}
