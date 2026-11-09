import { haveSameQuantityIdentity, quantityIdentity } from "@/lib/takeoff/quantity-compatibility";
import { takeoffItemLocation } from "@/lib/takeoff/scope-location";

export type QuantitySourceItem = { id: string; designation: string; quantity: number; unit: string;
  source_file_name: string | null; source_page: number | null; is_excluded: boolean; metadata: Record<string, unknown> };
export type QuantitySourceSelection = { id: string; group: string; origin: "vector" | "model"; excluded: boolean;
  comparison: { vector_quantity: number; model_quantity: number | null; delta: number | null; unit: string } };

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Whole alternative readings, compared only on a common document/page, identity and unit. */
export function selectQuantitySources(items: readonly QuantitySourceItem[]): QuantitySourceSelection[] {
  const vectors = items.filter(item => Boolean(item.metadata.vector) && record(item.metadata.quantity_source).exploitable === true);
  const models = items.filter(item => !item.metadata.vector && !item.is_excluded);
  const identities = new Map(items.map(item => [item.id, quantityIdentity(item)]));
  const locations = new Map(items.map(item => [item.id, takeoffItemLocation(item)]));
  const documentPage = (item: QuantitySourceItem) => JSON.stringify([item.source_file_name, item.source_page, item.metadata.source_document ?? null]);
  const scopes = new Map(items.map(item => {
    const location = locations.get(item.id)!;
    return [item.id, item.source_page === null || !item.source_file_name || location.ambiguous ? null
      : JSON.stringify([item.source_file_name,item.source_page,item.metadata.source_document ?? null,location])];
  }));
  const sameScope = (left: QuantitySourceItem, right: QuantitySourceItem) => scopes.get(left.id) !== null && scopes.get(left.id) === scopes.get(right.id);
  const comparable = (left: QuantitySourceItem, right: QuantitySourceItem) => {
    const a = identities.get(left.id)!, b = identities.get(right.id)!;
    return sameScope(left,right) && haveSameQuantityIdentity(a,b)
      && (a.kind === "network" || a.kind === "insulation" || normalized(left.designation) === normalized(right.designation));
  };
  const vectorBuckets = new Map<string, QuantitySourceItem[]>(), modelBuckets = new Map<string, QuantitySourceItem[]>();
  const modelsByPage = new Map<string, QuantitySourceItem[]>();
  for (const model of models) {
    const key = documentPage(model), bucket = modelsByPage.get(key) ?? [];
    bucket.push(model);
    modelsByPage.set(key, bucket);
  }
  for (const [reading, buckets] of [[vectors, vectorBuckets], [models, modelBuckets]] as const) {
    for (const item of reading) {
      const scope = scopes.get(item.id);
      if (!scope) continue;
      const bucket = buckets.get(scope) ?? [];
      bucket.push(item);
      buckets.set(scope, bucket);
    }
  }
  const done = new Set<string>();
  const selected: QuantitySourceSelection[] = [];
  for (const vector of vectors) {
    if (done.has(vector.id)) continue;
    const scope = scopes.get(vector.id);
    if (!scope) continue;
    const location = locations.get(vector.id)!;
    // A wider or unlocated reading may cover this vector too. Only an explicit
    // different building/floor/zone establishes that the two scopes are disjoint.
    const uncertainAlternative = (modelsByPage.get(documentPage(vector)) ?? []).some(model => {
      if (scopes.get(model.id) === scope) return false;
      const other = locations.get(model.id)!;
      return other.ambiguous || !(["building", "level", "zone"] as const).some(key =>
        location[key] && other[key] && location[key] !== other[key]);
    });
    if (uncertainAlternative) continue;
    const scopedModels = modelBuckets.get(scope) ?? [];
    const vectorGroup = (vectorBuckets.get(scope) ?? []).filter(other => !done.has(other.id) && comparable(vector, other));
    if (vectorGroup.length === 0) continue;
    const modelGroup = scopedModels.filter(model => comparable(vector, model));
    // An unclassified alternative on this page cannot safely be treated as a different network.
    if (modelGroup.length === 0 && scopedModels.length > 0) continue;
    const group = JSON.stringify([vector.source_file_name, vector.source_page, vector.metadata.source_document ?? null, takeoffItemLocation(vector),
      identities.get(vector.id)!.unit, normalized(vector.designation)]);
    const vectorTotal = vectorGroup.reduce((sum, item) => sum + Math.round(item.quantity * 1000), 0) / 1000;
    const modelTotal = modelGroup.length ? modelGroup.reduce((sum, item) => sum + Math.round(item.quantity * 1000), 0) / 1000 : null;
    const comparison = { vector_quantity: vectorTotal, model_quantity: modelTotal,
      delta: modelTotal === null ? null : Math.round((vectorTotal - modelTotal) * 1000) / 1000, unit: vector.unit };
    for (const item of [...vectorGroup, ...modelGroup]) {
      if (done.has(item.id)) continue;
      done.add(item.id);
      selected.push({ id: item.id, group, origin: item.metadata.vector ? "vector" : "model", excluded: !item.metadata.vector, comparison });
    }
  }
  return selected;
}
