import type { MaterialCode, NetworkCode } from "@/lib/takeoff/bench/keys";

// Fixed quantity rules of the takeoff (TI-664, TI-658 pipeline step 6): « the
// model proposes, fixed rules decide, the user settles what fails ». Each rule
// is pure, reads only the inputs below and returns « pass » or « fail » with a
// stable code, a readable reason and its version. A rule that has nothing to
// read on a line gives no result for it: a line without result for a rule is
// neither passed nor failed by it.
// - Inputs of a line come from the worker, never from the user: the vector
//   reading's geometry (network, material, DN, centrelines, polygon) or the
//   designation the model wrote, read once by the deterministic reader of the
//   bench (item-keys.ts). The user edits the quantity and the exclusion, which
//   the rules read as they are now.
// - A failed rule is « acceptable » when the user may settle it by verifying
//   the line (V); a non-observable quantity is never accepted, it is entered.

export const TAKEOFF_RULES_VERSION = 1;

export const TAKEOFF_RULE_IDS = [
  "dn_network",
  "zone_overlap",
  "scale_dimension",
  "area_printed",
  "room_overlap",
  "closed_box",
  "non_observable",
] as const;
export type TakeoffRuleId = (typeof TAKEOFF_RULE_IDS)[number];

/** Stable codes, one per outcome; a code never changes meaning, a new outcome gets a new code. */
export const TAKEOFF_RULE_CODES = {
  dn_network: {
    pass: ["DN_NETWORK_COMPATIBLE"],
    fail: [
      "DN_NETWORK_NETWORK_MISSING", "DN_NETWORK_MATERIAL_MISSING", "DN_NETWORK_DN_MISSING", "DN_NETWORK_MATERIAL_NOT_ALLOWED",
      "DN_NETWORK_DN_NOT_IN_SERIES",
    ],
  },
  zone_overlap: {
    pass: ["ZONE_OVERLAP_NONE", "ZONE_OVERLAP_RESOLVED"],
    fail: ["ZONE_OVERLAP_DUPLICATE", "ZONE_OVERLAP_UNREGISTERED"],
  },
  scale_dimension: { pass: ["SCALE_DIMENSION_CONSISTENT"], fail: ["SCALE_DIMENSION_MISMATCH"] },
  area_printed: { pass: ["AREA_PRINTED_CONSISTENT"], fail: ["AREA_PRINTED_MISMATCH"] },
  room_overlap: { pass: ["ROOM_OVERLAP_NONE"], fail: ["ROOM_OVERLAP"] },
  closed_box: { pass: ["CLOSED_BOX_NONE"], fail: ["CLOSED_BOX_LABEL", "CLOSED_BOX_SHAPE"] },
  non_observable: { pass: ["NON_OBSERVABLE_ENTERED"], fail: ["NON_OBSERVABLE_TO_ENTER"] },
} as const satisfies Record<TakeoffRuleId, { pass: readonly string[]; fail: readonly string[] }>;

type CodesOf<R extends TakeoffRuleId> = (typeof TAKEOFF_RULE_CODES)[R]["pass" | "fail"][number];
export type TakeoffRuleCode = { [R in TakeoffRuleId]: CodesOf<R> }[TakeoffRuleId];

/** A duplicate run of another page (Z1/Z2): the other line and the length both count. */
export type ZoneOverlapPartner = {
  item_id: string;
  job_id: string;
  zone: string | null;
  designation: string;
  overlap_m: number;
  /** The pair is resolved: one of both lines was reduced by this length (or more). */
  resolved: boolean;
};

export type TakeoffRuleDetails = {
  network?: NetworkCode | null;
  material?: MaterialCode | null;
  dn?: string | null;
  allowed_materials?: MaterialCode[];
  partners?: ZoneOverlapPartner[];
  overlap_m?: number;
  level?: string | null;
  printed_m2?: number;
  measured_m2?: number;
  deviation?: number;
  overlapping_item_ids?: string[];
  overlap_m2?: number;
  cause?: string;
  model_quantity?: number;
  scale_reason?: string | null;
};

export type TakeoffRuleResult = {
  rule: TakeoffRuleId;
  status: "pass" | "fail";
  code: TakeoffRuleCode;
  /** Version of the rule (its thresholds and reference tables): a new value is a new version. */
  version: number;
  /** The user may settle the failure by verifying the line (V); never for a quantity to be entered. */
  acceptable: boolean;
  reason: string;
  details?: TakeoffRuleDetails;
};

/** Why a quantity cannot be read on a plan view and must be entered (bench PLAN_CAUSES, keys.ts). */
export type NonObservableCause = "vertical" | "weld" | "tap" | "support" | "install_only" | "transport" | "service";

/**
 * What the rules read on a line, written by the worker (metadata.rule_inputs, or the vector geometry):
 * - kind: a network length (ml), an insulation length, a room surface (m2), a count (u), or null (none read);
 * - network, material and the DN as printed (« DN 22 », « 22x1,2 »), read on the plan label or the designation;
 * - non_observable: the cause when the line is a quantity the plan view cannot give;
 * - model_quantity: the quantity the model (or the vector reading) proposed, before any edit.
 */
export type TakeoffRuleInputs = {
  version: number;
  source: "vector" | "designation";
  kind: "network" | "insulation" | "surface" | "count" | null;
  network: NetworkCode | null;
  material: MaterialCode | null;
  dn: string | null;
  non_observable: NonObservableCause | null;
  model_quantity: number;
  /** A vector room: its printed label and the surface printed in it (null: none printed). */
  room?: string | null;
  printed_m2?: number | null;
};

/** Page frame metres to the common frame of the version: x' = a x + c y + e, y' = b x + d y + f. */
export type TakeoffFrameTransform = [number, number, number, number, number, number];
