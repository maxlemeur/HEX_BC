/**
 * The dashboard always uses the workspace navigation: a global top bar plus a drawer.
 * The former persistent sidebar mode was removed with the UI polish.
 */
export type DashboardNavigationMode = "workspace";

const PRODUCTION_WORKSPACE_ROUTE_PATTERNS = [
  /^\/dashboard\/estimates\/[^/]+\/edit(?:\/|$)/,
  /^\/dashboard\/estimates\/[^/]+\/takeoff(?:\/|$)/,
  // The affaire's métrés page is an ordinary journey page; its review stays a workspace.
  /^\/dashboard\/affaires\/[^/]+\/takeoff\/[^/]+/,
];

export function isProductionWorkspaceRoute(pathname: string): boolean {
  return PRODUCTION_WORKSPACE_ROUTE_PATTERNS.some((pattern) =>
    pattern.test(pathname)
  );
}

// Technical tool screens (TI-658 « mise en page outil »): the takeoff lab and the
// screens TI-662 adds under it, and the targeted review of a takeoff job (TI-664).
// Full height under the 60 px top bar, without margins nor version footer; only
// their own panels scroll.
const TOOL_WORKSPACE_ROUTE_PATTERNS = [
  /^\/dashboard\/admin\/takeoff\/lab(?:\/|$)/,
  /^\/dashboard\/affaires\/[^/]+\/takeoff\/[^/]+\/review\/targeted(?:\/|$)/,
];

export function isToolWorkspaceRoute(pathname: string): boolean {
  return TOOL_WORKSPACE_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}
