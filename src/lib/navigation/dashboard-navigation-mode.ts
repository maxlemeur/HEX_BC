export type DashboardNavigationMode = "persistent" | "workspace";

const PRODUCTION_WORKSPACE_ROUTE_PATTERNS = [
  /^\/dashboard\/estimates\/[^/]+\/edit(?:\/|$)/,
  /^\/dashboard\/estimates\/[^/]+\/takeoff(?:\/|$)/,
  /^\/dashboard\/affaires\/[^/]+\/takeoff(?:\/|$)/,
];

export function getDashboardNavigationMode(
  pathname: string
): DashboardNavigationMode {
  void pathname;
  return "workspace";
}

export function isProductionWorkspaceRoute(pathname: string): boolean {
  return PRODUCTION_WORKSPACE_ROUTE_PATTERNS.some((pattern) =>
    pattern.test(pathname)
  );
}