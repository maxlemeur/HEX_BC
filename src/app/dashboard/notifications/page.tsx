import { NavigationLink as Link } from "@/components/navigation/NavigationFeedback";
import { listTakeoffCompletionNotifications } from "@/lib/takeoff/completion-notifications";
import { formatTakeoffCompletionDate, TAKEOFF_COMPLETION_LABELS } from "@/lib/takeoff/completion-outcome";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";
import { takeoffCompletionFailureReason } from "@/lib/takeoff/visible-status";

import { markTakeoffCompletionRead } from "./actions";

const deliveryLabels: Record<string, string> = {
  unavailable: "Livraison indisponible",
  unknown: "Livraison à vérifier",
  failed: "Courriel non envoyé",
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { page: rawPage } = await searchParams;
  const number = typeof rawPage === "string" ? Number(rawPage) : 1;
  const page = Number.isSafeInteger(number) && number > 0 && number < 1_000_000 ? number : 1;
  const { notifications, hasOlder, takeoffEnabled } = await listTakeoffCompletionNotifications(page);

  return (
    <section aria-labelledby="notifications-title" className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <h1 id="notifications-title" className="text-2xl font-semibold text-slate-900">Notifications</h1>
      {notifications.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">Vous n’avez aucune notification de métré.</p>
      ) : (
        <ul aria-label="Notifications de métré" className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {notifications.map((notice) => {
            const projectHref = `/dashboard/affaires/${notice.project_id}`;
            // The notice is delivered under the affaire's read rule; its job may be hidden from its requester by the
            // job's own rule (notice.job is then null). The review is offered only when the job is readable; the
            // job's end on the affaire's activity always is.
            const reviewHref = takeoffEnabled && notice.outcome === "success" && notice.job_id && notice.job
              ? takeoffReviewHref({
                projectId: notice.project_id, jobId: notice.job_id, versionId: notice.job.estimate_version_id,
              })
              : null;
            const activityHref = takeoffEnabled && notice.job_id
              ? `${projectHref}/takeoff?job=${encodeURIComponent(notice.job_id)}`
              : null;
            // The end of a launch request (no job of its own): the takeoff's zone on the affaire, with its reviews.
            const zoneHref = takeoffEnabled && notice.subject_kind === "request" ? `${projectHref}?view=overview#metre` : null;
            // A cached activity page may still show the job as pending.
            const NoticeLink = !reviewHref && activityHref ? "a" : Link;
            const deliveryLabel = deliveryLabels[notice.delivery_state];
            return (
              <li key={notice.id} id={notice.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-900">
                    {TAKEOFF_COMPLETION_LABELS[notice.outcome]} · {notice.project?.name ?? "Affaire"}
                  </h2>
                  <p className="text-sm text-slate-600">
                    <time dateTime={notice.finished_at}>{formatTakeoffCompletionDate(notice.finished_at)}</time>
                    {notice.read_at ? " · Lue" : " · Non lue"}
                  </p>
                  {notice.outcome === "failure" && (
                    <p className="mt-1 text-sm text-slate-700">
                      {takeoffCompletionFailureReason(notice.reason_code ?? notice.job?.error_code)}
                    </p>
                  )}
                  {deliveryLabel && <p className="mt-1 text-sm text-slate-700">{deliveryLabel}</p>}
                  <NoticeLink href={reviewHref ?? activityHref ?? zoneHref ?? projectHref} className="mt-2 inline-block text-sm font-medium text-blue-700 underline">
                    {reviewHref ? "Ouvrir la revue" : activityHref ? "Ouvrir le suivi du métré" : zoneHref ? "Ouvrir l’état du métré" : "Ouvrir l’affaire"}
                  </NoticeLink>
                </div>
                {!notice.read_at && (
                  <form action={markTakeoffCompletionRead}>
                    <input type="hidden" name="notificationId" value={notice.id} />
                    <button className="btn btn-secondary btn-sm" type="submit">Marquer comme lue</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {(page > 1 || hasOlder) && (
        <nav aria-label="Pages de notifications" className="mt-4 flex items-center gap-4 text-sm">
          {page > 1 && <Link className="underline" href={`?page=${page - 1}`}>Plus récentes</Link>}
          {hasOlder && <Link className="underline" href={`?page=${page + 1}`}>Plus anciennes</Link>}
        </nav>
      )}
    </section>
  );
}
