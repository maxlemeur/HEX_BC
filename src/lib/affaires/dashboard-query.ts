import "server-only";

import { DASHBOARD_VIEWS, type DashboardQuery } from "@/lib/affaires/dashboard";
import { normalizeAffaireListQuery } from "@/lib/affaires/schemas";

export function parseDashboardQuery(params: Record<string, string | string[] | undefined>): DashboardQuery {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const view = DASHBOARD_VIEWS.find(item => item.value === first(params.view))?.value ?? "recent";
  const before = first(params.before);
  const cursor = normalizeAffaireListQuery({ cursor: before || first(params.after) }).cursor;
  return { view, cursor: view === "recent" ? null : cursor, direction: before ? "previous" : "next" };
}
