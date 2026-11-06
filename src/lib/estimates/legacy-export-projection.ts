import { hasActiveLaborSplitPayload, type EstimateItemRecord } from "@/lib/estimate-calculations";

// Shared legacy workbook projection. The v3 document path retains its own pinned amounts.
export function toSafeString(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  return normalized;
}

export function sanitizeFilenameSegment(value: string | null | undefined, fallback: string) {
  const safe = toSafeString(value, fallback);
  const normalized = safe
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/[^a-zA-Z0-9._-]+/g, "_")
    .replaceAll(/_{2,}/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : fallback;
}

export function toNullableNumber(value: number | null | undefined): number | null {
  if (!Number.isFinite(value ?? NaN)) return null;
  return value ?? null;
}

export function toEuroAmount(valueCents: number | null | undefined): number | null {
  if (!Number.isFinite(valueCents ?? NaN)) return null;
  return (valueCents ?? 0) / 100;
}

export function resolveDepthByItemId(items: EstimateItemRecord[]) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const depthById = new Map<string, number>();
  const visiting = new Set<string>();

  const visit = (itemId: string): number => {
    const cached = depthById.get(itemId);
    if (cached !== undefined) return cached;
    if (visiting.has(itemId)) return 0;

    visiting.add(itemId);
    const item = itemById.get(itemId);
    if (!item || !item.parent_id) {
      depthById.set(itemId, 0);
      visiting.delete(itemId);
      return 0;
    }

    const parent = itemById.get(item.parent_id);
    const parentDepth = parent ? visit(parent.id) : 0;
    const depth = parent ? parentDepth + 1 : 0;
    depthById.set(itemId, depth);
    visiting.delete(itemId);
    return depth;
  };

  items.forEach((item) => {
    visit(item.id);
  });

  return depthById;
}

export function usesLaborSplit(
  item: EstimateItemRecord,
  isLaborSplitEnabled: boolean
) {
  return isLaborSplitEnabled && hasActiveLaborSplitPayload(item);
}

export function resolveLaborRoleLabel(
  item: EstimateItemRecord,
  laborRoleNameById: Map<string, string>,
  isLaborSplitEnabled: boolean
) {
  if (usesLaborSplit(item, isLaborSplitEnabled)) {
    const parts: string[] = [];
    if (item.labor_role_atelier_id) {
      parts.push(
        `Atelier: ${laborRoleNameById.get(item.labor_role_atelier_id) ?? "Rôle atelier"}`
      );
    }
    if (item.labor_role_chantier_id) {
      parts.push(
        `Chantier: ${laborRoleNameById.get(item.labor_role_chantier_id) ?? "Rôle chantier"}`
      );
    }
    return parts.join(" / ");
  }

  if (!item.labor_role_id) return "";
  return laborRoleNameById.get(item.labor_role_id) ?? "";
}

export function resolveLaborHours(
  item: EstimateItemRecord,
  isLaborSplitEnabled: boolean
) {
  if (usesLaborSplit(item, isLaborSplitEnabled)) {
    return (item.h_mo_atelier ?? 0) + (item.h_mo_chantier ?? 0);
  }
  return item.h_mo ?? 0;
}

export function resolveLaborCoefficient(
  item: EstimateItemRecord,
  isLaborSplitEnabled: boolean
) {
  if (!usesLaborSplit(item, isLaborSplitEnabled)) {
    return item.k_mo ?? 1;
  }

  const hAtelier = item.h_mo_atelier ?? 0;
  const hChantier = item.h_mo_chantier ?? 0;
  const totalHours = hAtelier + hChantier;
  if (totalHours <= 0) return 1;

  const kAtelier = item.k_mo_atelier ?? 1;
  const kChantier = item.k_mo_chantier ?? 1;
  return (hAtelier * kAtelier + hChantier * kChantier) / totalHours;
}

export function resolveExportAid(item: EstimateItemRecord) {
  const aid = (item as EstimateItemRecord & { aid?: string | null }).aid;
  if (typeof aid !== "string") return item.id;
  const normalized = aid.trim();
  return normalized.length > 0 ? normalized : item.id;
}
