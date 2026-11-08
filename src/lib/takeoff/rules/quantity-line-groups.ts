import { surfaceLineBasis } from "@/lib/takeoff/quantity-policy";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";
import type { RuleLine } from "@/lib/takeoff/rules/evaluate";

export type QuantityTargetLine = { id: string; title: string; description: string | null; source_metadata: Record<string, unknown> | null };
export type QuantityLineLink = { takeoff_item_id: string; estimate_item_id: string };

/** A manual link, or a unique exact documentary label, identifies the real price line. Ambiguity never groups. */
export function withQuantityLineGroups(lines: RuleLine[], targets: QuantityTargetLine[], links: QuantityLineLink[]) {
  const byId = new Map(targets.map(target => [target.id, target]));
  const manual = new Map<string, Set<string>>();
  for (const link of links) manual.set(link.takeoff_item_id, new Set([...(manual.get(link.takeoff_item_id) ?? []), link.estimate_item_id]));
  return lines.map(line => {
    if (line.inputs?.kind !== "surface") return line;
    const linked = manual.get(line.id);
    const candidates = linked ? [...linked].flatMap(id => byId.has(id) ? [byId.get(id)!] : [])
      : targets.filter(target => target.title.trim().toLowerCase() === line.designation.trim().toLowerCase());
    if (candidates.length !== 1) return line;
    const target = candidates[0];
    const sourceUnit = target.source_metadata?.dpgf_source_unit;
    const unit = typeof sourceUnit === "string" ? normalizeMeasurementUnit(sourceUnit).unitCode : null;
    if (unit !== "m2" || normalizeMeasurementUnit(line.unit).unitCode !== "m2") return line;
    const reference = target.source_metadata?.dpgf_source_quantity;
    return { ...line, quantity_line_key: target.id,
      expected_surface_basis: surfaceLineBasis(`${target.title} ${target.description ?? ""}`),
      ...(typeof reference === "number" && reference >= 0 ? { quantity_line_reference: reference } : {}),
    };
  });
}
