import type { MaterialCode, NetworkCode } from "@/lib/takeoff/bench/keys";
import type { ResolvedSize, SizeCandidate } from "@/lib/takeoff/rules/network-diameters";

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
      "DN_NETWORK_DN_NOT_IN_SERIES", "DN_NETWORK_MATERIAL_REQUIRES_JUSTIFICATION",
      "DN_NETWORK_GAS_PE_REQUIRES_JUSTIFICATION", "DN_NETWORK_MATERIAL_BLOCKED",
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

/** What two copies of one run read differently (TI-684): the network, the material or the DN. */
export const ZONE_OVERLAP_DIFFERENCES = ["network", "material", "dn"] as const;
export type ZoneOverlapDifference = (typeof ZONE_OVERLAP_DIFFERENCES)[number];

/** A duplicate run of another page (Z1/Z2): the other line and the length both count. */
export type ZoneOverlapPartner = {
  item_id: string;
  job_id: string;
  zone: string | null;
  designation: string;
  overlap_m: number;
  /** The pair is resolved: both lines' reductions remove this length (never in a group of three lines or more). */
  resolved: boolean;
  /**
   * The other line is drawn at the same place but read differently (TI-684): one run counted twice with a wrong
   * reading, or two pipes drawn over each other. Absent when both lines carry one reading.
   */
  differs?: ZoneOverlapDifference[];
};

export type TakeoffRuleDetails = {
  /** Digest of all failed rule keys of this line when partner identities had to be clipped. */
  failure_keys_sha256?: string;
  network?: NetworkCode | null;
  material?: MaterialCode | null;
  dn?: string | null;
  /** The tube the printed size resolved to: outer diameter, wall and derived nominal DN (TI-683, Q7). */
  size?: ResolvedSize;
  /** The tubes an ambiguous printed size may be (copper « DN 15 »: Ø 15 or Ø 18), by outer diameter. */
  size_candidates?: SizeCandidate[];
  allowed_materials?: MaterialCode[];
  partners?: ZoneOverlapPartner[];
  /** Every partner of a duplicate (the list may be cut when stored): with it, a guard knows the list is whole (TI-677). */
  partner_count?: number;
  /** A pair: the length still counted twice. A group: the length of the line other lines draw. */
  overlap_m?: number;
  /** Lines of a group of duplicates (three or more): no correction settles it, each line is excluded or accepted. */
  group_size?: number;
  level?: string | null;
  printed_m2?: number;
  measured_m2?: number;
  /** The basis the price line expects (TI-686 D9): a printed surface declared on it compares with the line (D17). */
  expected_basis?: "net_floor" | "shab";
  deviation?: number;
  overlapping_item_ids?: string[];
  /** Every room an outline overlaps (the list may be cut when stored). */
  overlap_count?: number;
  overlap_m2?: number;
  cause?: string;
  model_quantity?: number;
  scale_reason?: string | null;
  /** Identity of the full quantity comparison, so a changed partner reopens an earlier acceptance. */
  quantity_context_key?: string;
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
 * - network, material and the size as printed (« DN 22 », « Ø 110 », « 22x1,2 », « 20/22 »), read on the plan label or
 *   the designation and never rewritten (TI-683): the nominal DN is derived by the DN rule, with the outer diameter;
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
