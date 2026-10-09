/**
 * The dashboard always uses the workspace navigation: a global top bar plus a drawer.
 * The former persistent sidebar mode was removed with the UI polish.
 */
export type DashboardNavigationMode = "workspace";

const PRODUCTION_WORKSPACE_ROUTE_PATTERNS = [
  /^\/dashboard\/estimates\/[^/]+\/edit(?:\/|$)/,
  /^\/dashboard\/estimates\/[^/]+\/takeoff(?:\/|$)/,
  /^\/dashboard\/affaires\/[^/]+\/takeoff(?:\/|$)/,
];

export function isProductionWorkspaceRoute(pathname: string): boolean {
  return PRODUCTION_WORKSPACE_ROUTE_PATTERNS.some((pattern) =>
    pattern.test(pathname)
  );
}
