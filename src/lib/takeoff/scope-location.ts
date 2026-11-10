type LocatedItem = { designation: string; source_file_name: string | null; metadata: Record<string, unknown> };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
const patterns = {
  level: /(?:^|[^A-Z0-9])(RDC|R\+\d{1,2}|R-\d{1,2}|SS\d{1,2}|N\d{1,2})(?![A-Z0-9])/gi,
  zone: /(?:^|[^A-Z0-9])(Z\d{1,2})(?![A-Z0-9])/gi,
  building: /(?:BATIMENT|BAT|BUILDING)\s+([A-Z0-9-]+)(?![A-Z0-9])/gi,
};
function matches(value: string, pattern: RegExp) {
  return [...new Set([...value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").matchAll(pattern)].map(match => match[1].toUpperCase()))];
}

/** Prefer per-item/page locations. A multi-location filename is never proof of every floor. */
export function takeoffItemLocation(item: LocatedItem) {
  const inputs = record(item.metadata.rule_inputs);
  const location = record(record(item.metadata.quantity_source).location);
  const result: { level: string | null; zone: string | null; building: string | null; ambiguous: boolean } =
    { level: null, zone: null, building: null, ambiguous: false };
  for (const key of ["level", "zone", "building"] as const) {
    const fromAmbiguousFile = location.source === "file_name" && matches(item.source_file_name ?? "", patterns[key]).length > 1;
    if (fromAmbiguousFile && inputs.source === "vector") { result.ambiguous = true; continue; }
    const explicit = text(inputs[key]) ?? (location.source === "file_name" ? null : text(location[key]));
    if (explicit) { result[key] = explicit; continue; }
    const inDesignation = matches(item.designation, patterns[key]);
    if (inDesignation.length === 1) { result[key] = inDesignation[0]; continue; }
    const inName = matches(item.source_file_name ?? "", patterns[key]);
    if (inDesignation.length > 1 || inName.length > 1) result.ambiguous = true;
    else result[key] = inName[0] ?? null;
  }
  return result;
}
