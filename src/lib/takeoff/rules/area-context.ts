import { createHash } from "node:crypto";
import { compareQuantityPairs, surfaceBasis, surfaceLineBasis } from "@/lib/takeoff/quantity-policy";
import type { RuleLine, RulePage } from "@/lib/takeoff/rules/evaluate";

export function expectedSurfaceBasis(line: RuleLine) {
  return line.expected_surface_basis !== undefined ? line.expected_surface_basis : surfaceLineBasis(line.designation);
}

export type AreaQuantityContext = { policy: ReturnType<typeof compareQuantityPairs>; key: string };

/** Only included contributions to the same actual estimate line share a denominator. */
export function areaQuantityContexts(lines: readonly RuleLine[], pages: ReadonlyMap<string, RulePage>) {
  const groups = new Map<string, RuleLine[]>();
  for (const line of lines) {
    if (line.inputs?.kind !== "surface") continue;
    const key = line.is_excluded ? `excluded:${line.id}` : line.quantity_line_key ?? line.id;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const contexts = new Map<string, AreaQuantityContext>();
  for (const [group, members] of groups) {
    members.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const state = members.map(line => ({ id: line.id, page: line.page_key, printed: line.inputs?.printed_m2,
      measured: line.geometry?.area_m2 ?? line.inputs?.model_quantity, label: line.inputs?.room,
      basis: expectedSurfaceBasis(line), scale: line.page_key ? pages.get(line.page_key)?.scale : null }));
    const reference = members[0]?.quantity_line_reference;
    const key = createHash("sha256").update(JSON.stringify({ group, reference, state })).digest("hex");
    const pairs = members.flatMap(line => {
      const printed = line.inputs?.printed_m2;
      const measured = line.geometry?.area_m2 ?? line.inputs?.model_quantity;
      return typeof printed === "number" && printed > 0 && typeof measured === "number"
        && surfaceBasis(line.inputs?.room ?? "") === "net_floor" && expectedSurfaceBasis(line) === "net_floor"
        ? [{ reference: printed, measured }] : [];
    });
    const compared = compareQuantityPairs(pairs);
    const policy = compared && reference !== undefined ? { ...compared, reference,
      percentGap: reference > 0 ? compared.absoluteGap / reference * 100 : null,
      requiresReview: compared.absoluteGap > reference / 100 + 1e-9 } : compared;
    for (const member of members) contexts.set(member.id, { policy, key });
  }
  return contexts;
}
