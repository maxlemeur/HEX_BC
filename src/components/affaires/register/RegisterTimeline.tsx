import {
  AFFAIRE_REGISTER_EVENT_LABELS,
  AFFAIRE_REGISTER_KIND_LABELS,
  AFFAIRE_REGISTER_STATUS_LABELS,
  type AffaireRegisterTimelineEvent,
} from "@/lib/affaires/register";

import { formatDateTime } from "./registerViewModel";

type RegisterTimelineProps = {
  timelineEvents: AffaireRegisterTimelineEvent[];
};

export function RegisterTimeline({
  timelineEvents,
}: Readonly<RegisterTimelineProps>) {
  return (
    <section className="mt-6 rounded-2xl border border-[var(--slate-200)] bg-[var(--slate-50)]/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--slate-800)]">
            Historique récent du registre
          </h3>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            Actions historisées pour expliciter qui a fait quoi sur les points du dossier.
          </p>
        </div>
        <div className="rounded-full bg-white px-2.5 py-1 text-xs text-[var(--slate-600)]">
          {timelineEvents.length} événement{timelineEvents.length > 1 ? "s" : ""}
        </div>
      </div>
      {timelineEvents.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--slate-200)] bg-white px-4 py-6 text-center">
          <p className="text-sm font-medium text-[var(--slate-700)]">
            Aucun événement récent pour cette vue du registre.
          </p>
          <p className="mt-2 text-sm text-[var(--slate-500)]">
            Les créations, changements de statut et commentaires de trace remonteront ici.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {timelineEvents.map((event) => (
            <article
              key={event.id}
              className="rounded-xl border border-[var(--slate-200)] bg-white px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[var(--slate-100)] px-2.5 py-1 text-xs font-medium text-[var(--slate-600)]">
                      {AFFAIRE_REGISTER_EVENT_LABELS[event.eventType]}
                    </span>
                    <span className="rounded-full bg-[var(--slate-100)] px-2.5 py-1 text-xs font-medium text-[var(--slate-600)]">
                      {AFFAIRE_REGISTER_KIND_LABELS[event.entryKind]}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-medium text-[var(--slate-800)]">
                    {event.scopeLabel}: {event.entryText}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--slate-500)]">
                    <span>
                      {event.actorUserName || "Système"} · {formatDateTime(event.createdAt)}
                    </span>
                    {event.beforeStatus &&
                    event.afterStatus &&
                    event.beforeStatus !== event.afterStatus ? (
                      <span>
                        {AFFAIRE_REGISTER_STATUS_LABELS[event.beforeStatus]} →{" "}
                        {AFFAIRE_REGISTER_STATUS_LABELS[event.afterStatus]}
                      </span>
                    ) : null}
                  </div>
                  {event.comment ? (
                    <p className="mt-2 rounded-lg border border-[var(--brand-blue)]/15 bg-[var(--brand-blue)]/5 px-3 py-2 text-sm text-[var(--slate-700)]">
                      {event.comment}
                    </p>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
