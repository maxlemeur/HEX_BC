"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { CalendarIcon } from "lucide-react";

import { assignDirectionProjectOwnerAction } from "@/app/dashboard/_actions/direction";
import { ApprovalQueueStateActions } from "@/components/approvals/ApprovalQueueStateActions";
import { EmptyState } from "@/components/layout/empty-state";
import { PageSection } from "@/components/layout/page-section";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { useToast } from "@/components/ui-legacy/Toast";
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
  ready_not_validated: { label: "Prêt mais non validé", variant: "warning" },
  blocked: { label: "Bloqué", variant: "danger" },
  high_risk: { label: "Risque élevé", variant: "danger" },
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
  const toast = useToast();
  const [selectedOwnerByProjectId, setSelectedOwnerByProjectId] = useState<
    Record<string, string>
  >(() =>
    Object.fromEntries(items.map((item) => [item.projectId, item.ownerUserId]))
  );

  const topItems = useMemo(() => items.slice(0, 8), [items]);

  if (topItems.length === 0) {
    return (
      <EmptyState
        icon={<CalendarIcon aria-hidden="true" />}
        headingLevel={2}
        title="Aucun départ à prioriser cette semaine"
        description="Les échéances détectées sont hors de la semaine courante ou déjà stabilisées."
      />
    );
  }

  return (
    <PageSection
      title="À envoyer cette semaine"
      id="direction-weekly-queue"
      description="Traitez en premier les dossiers proches de l’envoi et encore fragiles."
      flush
    >
      <div
        role="region"
        aria-labelledby="direction-weekly-queue"
        tabIndex={0}
        className="relative overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <table className="w-full min-w-[940px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-4 py-3">Affaire</th>
              <th scope="col" className="py-3 pr-4">État</th>
              <th scope="col" className="py-3 pr-4">Échéance</th>
              <th scope="col" className="py-3 pr-4">Montant</th>
              <th scope="col" className="py-3 pr-4">Score</th>
              <th scope="col" className="py-3 pr-4">Revue</th>
              <th scope="col" className="py-3 pr-4">Responsable</th>
              <th scope="col" className="py-3 pr-4 text-right">
                <span className="sr-only">Ouvrir l’affaire</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {topItems.map((item) => {
              const selectedOwner =
                selectedOwnerByProjectId[item.projectId] ?? item.ownerUserId;
              const queueMeta = QUEUE_STATE_META[item.queueState];
              const ownerSelectId = `direction-owner-${item.projectId}`;

              return (
                <tr key={item.projectId} className="border-b border-border-subtle align-top last:border-b-0">
                  <th scope="row" className="px-4 py-4 text-left font-normal">
                    <p className="font-semibold text-foreground">
                      {item.projectName}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.clientName ?? "Client non précisé"}
                    </p>
                    {item.alerts[0] ? (
                      <p className="mt-2 max-w-xs text-xs text-foreground-secondary">
                        {item.alerts[0].label}
                      </p>
                    ) : null}
                  </th>
                  <td className="py-4 pr-4">
                    <Badge variant={queueMeta.variant} size="sm">
                      {queueMeta.label}
                    </Badge>
                  </td>
                  <td className="py-4 pr-4 text-foreground-secondary">
                    {formatTargetDate(item.sendTargetAt)}
                  </td>
                  <td className="py-4 pr-4 font-medium tabular-nums text-foreground-secondary">
                    {formatEUR(item.amountHtCents)}
                  </td>
                  <td className="py-4 pr-4 tabular-nums text-foreground-secondary">
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
                      <span className="text-xs text-muted-foreground">
                        Pas de cycle ouvert
                      </span>
                    )}
                  </td>
                  <td className="py-4 pr-4">
                    <div className="flex min-w-[240px] items-center gap-2">
                      <label htmlFor={ownerSelectId} className="sr-only">
                        Responsable de {item.projectName}
                      </label>
                      <NativeSelect
                        id={ownerSelectId}
                        size="sm"
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
                      </NativeSelect>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isPending || selectedOwner === item.ownerUserId}
                        onClick={() =>
                          startTransition(async () => {
                            const ownerLabel =
                              ownerOptions.find((option) => option.userId === selectedOwner)?.label ??
                              "ce responsable";
                            try {
                              await assignDirectionProjectOwnerAction({
                                projectId: item.projectId,
                                ownerUserId: selectedOwner,
                              });
                              toast.success({ title: `Affaire réassignée à ${ownerLabel}.` });
                            } catch {
                              toast.error({ title: "Impossible de modifier le responsable." });
                            }
                          })
                        }
                      >
                        Assigner
                      </Button>
                    </div>
                  </td>
                  <td className="py-4 pr-4 text-right">
                    <Link
                      href={`/dashboard/affaires/${item.projectId}`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                      aria-label={`Ouvrir l’affaire ${item.projectName}`}
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
    </PageSection>
  );
}
