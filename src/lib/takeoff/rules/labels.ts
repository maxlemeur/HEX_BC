import type { TakeoffRuleId, ZoneOverlapDifference } from "@/lib/takeoff/rules/types";

/** The rule a failure belongs to, as the apply wizard's guard panel and the targeted review name it (TI-664). */
export const TAKEOFF_RULE_LABELS: Record<TakeoffRuleId, string> = {
  dn_network: "DN et réseau",
  zone_overlap: "Doublon entre zones",
  scale_dimension: "Échelle et cotes",
  area_printed: "Aire et surface imprimée",
  room_overlap: "Pièces qui se chevauchent",
  closed_box: "Boîte fermée",
  non_observable: "Quantité à saisir",
};

/** What a copy of a run drawn on another page reads differently (TI-684), as the rule's reason and the review name it. */
export const ZONE_OVERLAP_DIFFERENCE_LABELS: Record<ZoneOverlapDifference, string> = { network: "réseau", material: "matériau", dn: "diamètre" };
