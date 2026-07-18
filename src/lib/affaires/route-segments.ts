const RESERVED_AFFAIRE_ROUTE_SEGMENTS = ["new"] as const;

export function normalizeAffaireProjectId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const projectId = value.trim();
  if (
    projectId.length === 0 ||
    projectId.includes("/") ||
    projectId.includes("\\") ||
    projectId.includes("?") ||
    projectId.includes("#") ||
    RESERVED_AFFAIRE_ROUTE_SEGMENTS.some(
      (segment) => segment === projectId.toLowerCase()
    )
  ) {
    return null;
  }

  return projectId;
}
