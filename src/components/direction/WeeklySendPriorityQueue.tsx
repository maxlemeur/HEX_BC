"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";

import { assignDirectionProjectOwnerAction } from "@/app/dashboard/_actions/direction";
import { ApprovalQueueStateActions } from "@/components/approvals/ApprovalQueueStateActions";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import type {
  DirectionOwnerOption,
  DirectionWeeklyQueueItem,
} from "@/lib/direction/server";
import { formatEUR } from "@/lib/money";

type Props = {
  items: DirectionWeeklyQueueItem[];
  ownerOptions: DirectionOwnerOption[];
};

const QUEUE_STATE_META = {
  sendable: { label: "Envoyable", variant: "success" },
  ready_not_validated: { label: "Pret mais non valide", variant: "warning" },
  blocked: { label: "Bloque", variant: "error" },
  high_risk: { label: "Risque eleve", variant: "error" },
} as const;

function formatTargetDate(value: string | null) {
  if (!value) {
    return "A confirmer";
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
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 2v4" />
            <path d="M16 2v4" />
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M3 10h18" />
          </svg>
        }
        title="Aucun depart a prioriser cette semaine"
        description="Les echeances detectees sont hors de la semaine courante ou deja stabilisees."
      />
    );
  }

  return (
    <section className="dashboard-card p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--slate-900)]">
            A envoyer cette semaine
          </h2>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            Traitez en premier les dossiers proches de l&apos;envoi et encore fragiles.
          </p>
        </div>
        <p className="text-xs text-[var(--slate-400)]" aria-live="polite">
          {feedback ?? ""}
        </p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[940px] text-sm">
          <thead>
            <tr className="border-b border-[var(--slate-200)] text-left text-xs uppercase tracking-[0.14em] text-[var(--slate-400)]">
              <th className="pb-3 pr-4">Affaire</th>
              <th className="pb-3 pr-4">Etat</th>
              <th className="pb-3 pr-4">Echeance</th>
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
                <tr key={item.projectId} className="border-b border-[var(--slate-100)] align-top">
                  <td className="py-4 pr-4">
                    <p className="font-semibold text-[var(--slate-900)]">
                      {item.projectName}
                    </p>
                    <p className="mt-1 text-xs text-[var(--slate-500)]">
                      {item.clientName ?? "Client non precise"}
                    </p>
                    {item.alerts[0] ? (
                      <p className="mt-2 max-w-xs text-xs text-[var(--slate-600)]">
                        {item.alerts[0].label}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-4 pr-4">
                    <Badge variant={queueMeta.variant} size="sm">
                      {queueMeta.label}
                    </Badge>
                  </td>
                  <td className="py-4 pr-4 text-[var(--slate-600)]">
                    {formatTargetDate(item.sendTargetAt)}
                  </td>
                  <td className="py-4 pr-4 font-medium text-[var(--slate-700)]">
                    {formatEUR(item.amountHtCents)}
                  </td>
                  <td className="py-4 pr-4 text-[var(--slate-700)]">
                    {item.riskScore}/100
                  </td>
                  <td className="py-4 pr-4">
                    {item.cycleId ? (
                      <div className="flex items-center gap-2">
                        {item.reviewerState === "acceptable" ? (
                          <Badge variant="success" size="sm">
                            Revue terminee
                          </Badge>
                        ) : null}
                        <ApprovalQueueStateActions
                          cycleId={item.cycleId}
                          currentState={item.reviewerState}
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--slate-400)]">
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
                              setFeedback(`Affaire reassign ee a ${ownerOptions.find((option) => option.userId === selectedOwner)?.label ?? "ce responsable"}.`);
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
                      className="inline-flex rounded-full border border-[var(--slate-200)] px-3 py-2 text-xs font-medium text-[var(--slate-700)] transition hover:border-[var(--slate-300)] hover:bg-[var(--slate-50)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-blue)]"
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
