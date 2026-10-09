"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";

import { assignDirectionProjectOwnerAction } from "@/app/dashboard/_actions/direction";
import { ApprovalQueueStateActions } from "@/components/approvals/ApprovalQueueStateActions";
import { Badge } from "@/components/ui-legacy/Badge";
import { EmptyState } from "@/components/ui-legacy/EmptyState";
import type {
  DirectionOwnerOption,
  DirectionWeeklyQueueItem,
} from "@/lib/direction/server";
import { formatEUR } from "@/lib/money";
import { CalendarIcon } from "lucide-react";

type Props = {
  items: DirectionWeeklyQueueItem[];
  ownerOptions: DirectionOwnerOption[];
};

const QUEUE_STATE_META = {
  sendable: { label: "Envoyable", variant: "success" },
  ready_not_validated: { label: "Prêt mais non validé", variant: "warning" },
  blocked: { label: "Bloqué", variant: "error" },
  high_risk: { label: "Risque eleve", variant: "error" },
} as const;

function formatTargetDate(value: string | null) {
  if (!value) {
    return "À confirmer";
  }

  return new Date(value).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

export function WeeklySendPriorityQueue({ items, ownerOptions }: Readonly<Props>) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selectedOwnerByProjectId, setSelectedOwnerByProjectId] = useState<
    Record<string, string>
  >(() =>
    Object.fromEntries(items.map((item) => [item.projectId, item.ownerUserId]))
  );

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timer = window.setTimeout(() => setFeedback(null), 3000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const topItems = useMemo(() => items.slice(0, 8), [items]);

  if (topItems.length === 0) {
    return (
      <EmptyState
        icon={
          <CalendarIcon strokeWidth="1.5" aria-hidden="true" size={26} />
        }
        title="Aucun depart à prioriser cette semaine"
        description="Les échéances détectées sont hors de la semaine courante ou déjà stabilisees."
      />
    );
  }

  return (
    <section className="dashboard-card p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            À envoyer cette semaine
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Traitez en premier les dossiers proches de l&apos;envoi et encore fragiles.
          </p>
        </div>
        <p className="text-xs text-subtle-foreground" aria-live="polite">
          {feedback ?? ""}
        </p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[940px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-[0.14em] text-subtle-foreground">
              <th className="pb-3 pr-4">Affaire</th>
              <th className="pb-3 pr-4">État</th>
              <th className="pb-3 pr-4">Échéance</th>
              <th className="pb-3 pr-4">Montant</th>
              <th className="pb-3 pr-4">Score</th>
              <th className="pb-3 pr-4">Revue</th>
              <th className="pb-3 pr-4">Responsable</th>
              <th className="pb-3 text-right">Cockpit</th>
            </tr>
          </thead>
          <tbody>
            {topItems.map((item) => {
              const selectedOwner =
                selectedOwnerByProjectId[item.projectId] ?? item.ownerUserId;
              const queueMeta = QUEUE_STATE_META[item.queueState];

              return (
                <tr key={item.projectId} className="border-b border-border-subtle align-top">
                  <td className="py-4 pr-4">
                    <p className="font-semibold text-foreground">
                      {item.projectName}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.clientName ?? "Client non précise"}
                    </p>
                    {item.alerts[0] ? (
                      <p className="mt-2 max-w-xs text-xs text-slate-600">
                        {item.alerts[0].label}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-4 pr-4">
                    <Badge variant={queueMeta.variant} size="sm">
                      {queueMeta.label}
                    </Badge>
                  </td>
                  <td className="py-4 pr-4 text-slate-600">
                    {formatTargetDate(item.sendTargetAt)}
                  </td>
                  <td className="py-4 pr-4 font-medium text-foreground-secondary">
                    {formatEUR(item.amountHtCents)}
                  </td>
                  <td className="py-4 pr-4 text-foreground-secondary">
                    {item.riskScore}/100
                  </td>
                  <td className="py-4 pr-4">
                    {item.cycleId ? (
                      <div className="flex items-center gap-2">
                        {item.reviewerState === "acceptable" ? (
                          <Badge variant="success" size="sm">
                            Revue terminée
                          </Badge>
                        ) : null}
                        <ApprovalQueueStateActions
                          cycleId={item.cycleId}
                          currentState={item.reviewerState}
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-subtle-foreground">
                        Pas de cycle ouvert
                      </span>
                    )}
                  </td>
                  <td className="py-4 pr-4">
                    <div className="flex min-w-[240px] items-center gap-2">
                      <select
                        className="form-input form-select form-input--sm"
                        value={selectedOwner}
                        onChange={(event) =>
                          setSelectedOwnerByProjectId((current) => ({
                            ...current,
                            [item.projectId]: event.target.value,
                          }))
                        }
                      >
                        {ownerOptions.map((option) => (
                          <option key={option.userId} value={option.userId}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm whitespace-nowrap"
                        disabled={isPending || selectedOwner === item.ownerUserId}
                        onClick={() =>
                          startTransition(async () => {
                            try {
                              await assignDirectionProjectOwnerAction({
                                projectId: item.projectId,
                                ownerUserId: selectedOwner,
                              });
                              setFeedback(`Affaire réassignée à ${ownerOptions.find((option) => option.userId === selectedOwner)?.label ?? "ce responsable"}.`);
                            } catch {
                              setFeedback("Impossible de modifier le responsable.");
                            }
                          })
                        }
                      >
                        Assigner
                      </button>
                    </div>
                  </td>
                  <td className="py-4 text-right">
                    <Link
                      href={`/dashboard/affaires/${item.projectId}`}
                      className="inline-flex rounded-full border border-border px-3 py-2 text-xs font-medium text-foreground-secondary transition hover:border-border-strong hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      Ouvrir
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
