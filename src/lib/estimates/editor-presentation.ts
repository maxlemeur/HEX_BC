import type { EstimateVersionView } from "@/lib/estimates/editor-items";

/** What the estimate editor shows of its data: the project's name, the last save, a copy target, an action's error. */

export function getProjectName(
  value: EstimateVersionView["estimate_projects"]
) {
  if (!value) return "";
  if (Array.isArray(value)) return value[0]?.name ?? "";
  return value.name ?? "";
}

export function resolveLatestSavedAt(
  first: string | null | undefined,
  second: string | null | undefined
) {
  if (!first) return second ?? null;
  if (!second) return first;
  return Date.parse(first) >= Date.parse(second) ? first : second;
}

export function formatSectionDuplicateTargetLabel(input: {
  versionNumber: number;
  title: string | null;
}) {
  const title = input.title?.trim();
  if (title && title.length > 0) {
    return `V${input.versionNumber} - ${title}`;
  }
  return `V${input.versionNumber} - Sans titre`;
}

export function resolveEstimateActionError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("row-level security") || normalized.includes("read-only")) {
    return "Cette version est en lecture seule.";
  }
  return message;
}
