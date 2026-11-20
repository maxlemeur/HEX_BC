import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/components/navigation/NavigationFeedback", () => ({
  NavigationLink: (props: React.ComponentProps<"a">) => <a data-client-navigation="true" {...props} />,
}));
vi.mock("./actions", () => ({ markTakeoffCompletionRead: vi.fn() }));
vi.mock("@/lib/takeoff/completion-notifications", () => ({
  listTakeoffCompletionNotifications: async () => ({ hasOlder: false, takeoffEnabled: true, notifications: [{
    id: "a1000000-0000-4000-8000-000000000001", outcome: "success", finished_at: "2026-11-20T08:00:00.000Z",
    read_at: "2026-11-20T08:01:00.000Z", delivery_state: "sent", project_id: "a1000000-0000-4000-8000-000000000002",
    job_id: "a1000000-0000-4000-8000-000000000003", project: { name: "Affaire fictive" },
    job: { estimate_version_id: null, error_code: null },
  }, {
    id: "a1000000-0000-4000-8000-000000000004", outcome: "failure", finished_at: "2026-11-20T08:00:00.000Z",
    read_at: "2026-11-20T08:01:00.000Z", delivery_state: "sent", project_id: "a1000000-0000-4000-8000-000000000005",
    job_id: "a1000000-0000-4000-8000-000000000006", project: { name: "Seconde affaire" },
    job: { estimate_version_id: null, error_code: "AI_PROVIDER" },
  }] }),
}));

import NotificationsPage from "./page";

it("links a completed versionless job directly to its review", async () => {
  const markup = renderToStaticMarkup(await NotificationsPage({ searchParams: Promise.resolve({}) }));
  expect(markup).toContain('href="/dashboard/affaires/a1000000-0000-4000-8000-000000000002/takeoff/a1000000-0000-4000-8000-000000000003/review"');
  expect(markup).toContain("Ouvrir la revue");
});

it("opens a failure with a fresh activity page and the same French reason", async () => {
  const markup = renderToStaticMarkup(await NotificationsPage({ searchParams: Promise.resolve({}) }));
  expect(markup).toMatch(/<a href="\/dashboard\/affaires\/a1000000-0000-4000-8000-000000000005\/takeoff"[^>]*>Ouvrir le suivi du métré<\/a>/);
  expect(markup).toContain("Le service d’analyse n’a pas pu terminer le métré.");
});
