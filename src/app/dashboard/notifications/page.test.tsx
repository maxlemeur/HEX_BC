import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const { listed } = vi.hoisted(() => ({ listed: { notifications: [] as unknown[] } }));

vi.mock("@/components/navigation/NavigationFeedback", () => ({
  NavigationLink: (props: React.ComponentProps<"a">) => <a data-client-navigation="true" {...props} />,
}));
vi.mock("./actions", () => ({ markTakeoffCompletionRead: vi.fn() }));
vi.mock("@/lib/takeoff/completion-notifications", () => ({
  listTakeoffCompletionNotifications: async () => ({ hasOlder: false, takeoffEnabled: true, notifications: listed.notifications }),
}));

import NotificationsPage from "./page";

const notice = {
  finished_at: "2026-11-20T08:00:00.000Z", read_at: "2026-11-20T08:01:00.000Z", delivery_state: "sent",
};
const success = {
  ...notice, id: "a1000000-0000-4000-8000-000000000001", outcome: "success", reason_code: null,
  project_id: "a1000000-0000-4000-8000-000000000002", job_id: "a1000000-0000-4000-8000-000000000003",
  project: { name: "Affaire fictive" }, job: { estimate_version_id: null, error_code: null },
};
const failure = {
  ...notice, id: "a1000000-0000-4000-8000-000000000004", outcome: "failure", reason_code: "AI_PROVIDER",
  project_id: "a1000000-0000-4000-8000-000000000005", job_id: "a1000000-0000-4000-8000-000000000006",
  project: { name: "Seconde affaire" }, job: { estimate_version_id: null, error_code: "AI_PROVIDER" },
};

async function render(...notifications: unknown[]) {
  listed.notifications = notifications;
  return renderToStaticMarkup(await NotificationsPage({ searchParams: Promise.resolve({}) }));
}

it("links a completed versionless job directly to its review", async () => {
  const markup = await render(success);
  expect(markup).toContain('href="/dashboard/affaires/a1000000-0000-4000-8000-000000000002/takeoff/a1000000-0000-4000-8000-000000000003/review"');
  expect(markup).toContain("Ouvrir la revue");
});

it("opens a failure on its own job, with a fresh activity page and the same French reason", async () => {
  const markup = await render(failure);
  expect(markup).toMatch(
    /<a href="\/dashboard\/affaires\/a1000000-0000-4000-8000-000000000005\/takeoff\?job=a1000000-0000-4000-8000-000000000006"[^>]*>Ouvrir le suivi du métré<\/a>/,
  );
  expect(markup).toContain("Le service d’analyse n’a pas pu terminer le métré.");
});

// A requester who launched as an administrator and is now a director still reads the affaire, so the notice is
// theirs; the job's own rule hides the job. The reason and the link come from the notice itself.
it("gives a requester who can no longer read the job its reason and a link they may open", async () => {
  const markup = await render({ ...failure, job: null }, { ...success, job: null });
  expect(markup).toContain("Le service d’analyse n’a pas pu terminer le métré.");
  expect(markup).not.toContain("Le traitement n’a pas pu terminer le métré. Consultez l’activité de l’affaire.");
  expect(markup).toMatch(
    /<a href="\/dashboard\/affaires\/a1000000-0000-4000-8000-000000000005\/takeoff\?job=a1000000-0000-4000-8000-000000000006"[^>]*>Ouvrir le suivi du métré<\/a>/,
  );
  // No review link the director could not open: the success leads to its shared end on the affaire.
  expect(markup).not.toContain("/review");
  expect(markup).toMatch(
    /<a href="\/dashboard\/affaires\/a1000000-0000-4000-8000-000000000002\/takeoff\?job=a1000000-0000-4000-8000-000000000003"[^>]*>Ouvrir le suivi du métré<\/a>/,
  );
});

it("says which of the two happened when nobody took the analysis or it waited past the ceiling", async () => {
  const markup = await render(
    { ...failure, reason_code: "TAKEOFF_WORKER_NOT_STARTED", job: null },
    { ...failure, id: "a1000000-0000-4000-8000-000000000007", reason_code: "TAKEOFF_WORKER_QUEUE_EXPIRED", job: null },
  );
  expect(markup).toContain("L’analyse n’a pas pu démarrer sur le poste autorisé.");
  expect(markup).toContain("L’analyse attendait encore son tour sur le poste autorisé quand le délai d’attente maximal a expiré : elle n’a pas démarré.");
});

// The end of a launch request has no job of its own (one request may read several plans): its link opens the takeoff's
// zone on the affaire, which offers each of its reviews.
it("opens the end of a launch request on the takeoff's zone of its affaire", async () => {
  const markup = await render({ ...success, id: "a1000000-0000-4000-8000-000000000008", subject_kind: "request",
    request_id: "a1000000-0000-4000-8000-000000000009", job_id: null, job: null });
  expect(markup).toMatch(/<a [^>]*href="\/dashboard\/affaires\/a1000000-0000-4000-8000-000000000002\?view=overview#metre"[^>]*>Ouvrir l’état du métré<\/a>/);
});
