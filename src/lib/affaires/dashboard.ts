export const DASHBOARD_VIEWS = [
  { value: "recent", label: "Récentes" },
  { value: "all", label: "Toutes" },
  { value: "draft", label: "Brouillons" },
  { value: "sent", label: "Envoyées" },
  { value: "accepted", label: "Acceptées" },
] as const;

export type DashboardView = (typeof DASHBOARD_VIEWS)[number]["value"];
export type DashboardQuery = {
  view: DashboardView;
  cursor: string | null;
  direction: "next" | "previous";
};

export function dashboardHref(view: DashboardView, page?: { cursor: string; direction: "next" | "previous" }) {
  const params = new URLSearchParams();
  if (view !== "recent") params.set("view", view);
  if (page && view !== "recent") params.set(page.direction === "previous" ? "before" : "after", page.cursor);
  return `/dashboard${params.size ? `?${params}` : ""}`;
}
