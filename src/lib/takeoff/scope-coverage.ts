import type { TakeoffPreparation } from "@/lib/takeoff/preparation";
import type { TakeoffJobItem } from "@/lib/takeoff/types";
import { takeoffItemLocation } from "@/lib/takeoff/scope-location";

type CoverageItem = Pick<TakeoffJobItem, "id" | "designation" | "source_file_name" | "source_page" | "evidence" | "confidence"
  | "is_excluded" | "metadata" | "rule_results">;
export type TakeoffScopeEntry = { kind: string; label: string; status: "analysed" | "incomplete" | "not_analysed"; item_ids: string[] };
function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9+-]+/g, " ").trim();
}

/** Presence is compared with an expected scope, never inferred from an empty alert list. */
export function takeoffScopeCoverage(preparation: TakeoffPreparation | null, items: readonly CoverageItem[]) {
  const scope = preparation?.scope;
  const expected: Array<[string, readonly string[]]> = [
    ["Bâtiment", scope?.buildings ?? []], ["Étage", scope?.levels ?? []], ["Zone", scope?.zones ?? []], ["Réseau", scope?.networks ?? []],
  ];
  const entries: TakeoffScopeEntry[] = expected.flatMap(([kind, labels]) => labels.map(label => {
    const token = ` ${normalized(label)} `;
    const matching = items.filter(item => {
      if (item.is_excluded) return false;
      const location = takeoffItemLocation(item);
      if (location.ambiguous) return false;
      const key = kind === "Étage" ? "level" : kind === "Zone" ? "zone" : kind === "Bâtiment" ? "building" : null;
      return key ? normalized(location[key] ?? "") === normalized(label)
        : ` ${normalized(item.designation)} `.includes(token);
    });
    return { kind, label, item_ids: matching.map(item => item.id),
      status: matching.length === 0 ? "not_analysed" : matching.some(item => !item.evidence?.trim() || !item.source_page
        || item.confidence === null || item.confidence < 0.8 || item.rule_results?.some(rule => rule.status === "fail"))
        ? "incomplete" : "analysed" };
  }));
  return { known: entries.length > 0, entries };
}
