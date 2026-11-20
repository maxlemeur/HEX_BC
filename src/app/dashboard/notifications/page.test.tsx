import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/components/navigation/NavigationFeedback", () => ({
  NavigationLink: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("./actions", () => ({ markTakeoffCompletionRead: vi.fn() }));
vi.mock("@/lib/takeoff/completion-notifications", () => ({
  listTakeoffCompletionNotifications: async () => ({ hasOlder: false, takeoffEnabled: true, notifications: [{
    id: "a1000000-0000-4000-8000-000000000001", outcome: "success", finished_at: "2026-11-20T08:00:00.000Z",
    read_at: "2026-11-20T08:01:00.000Z", delivery_state: "sent", project_id: "a1000000-0000-4000-8000-000000000002",
    job_id: "a1000000-0000-4000-8000-000000000003", project: { name: "Affaire fictive" },
    job: { estimate_version_id: null, error_code: null },
  }] }),
}));

import NotificationsPage from "./page";

it("links a completed versionless job directly to its review", async () => {
  const markup = renderToStaticMarkup(await NotificationsPage({ searchParams: Promise.resolve({}) }));
  expect(markup).toMatch(/<a href="\/dashboard\/affaires\/a1000000-0000-4000-8000-000000000002\/takeoff\/a1000000-0000-4000-8000-000000000003\/review"[^>]*>Ouvrir la revue<\/a>/);
});
