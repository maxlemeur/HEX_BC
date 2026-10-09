"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";

import { updateDirectionAlertStatusAction } from "@/app/dashboard/_actions/direction";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui-legacy/Toast";
import type { DirectionSyntheticAlert } from "@/lib/direction/alerts";
import type { TakeoffRiskStatus } from "@/lib/takeoff/types";
import { cn } from "@/lib/utils";

type Props = {
  alerts: DirectionSyntheticAlert[];
  compact?: boolean;
};

const LEVEL_VARIANT = {
  info: "info",
  warning: "warning",
  critical: "danger",
} as const;

const STATUS_LABEL = {
  to_process: "À traiter",
  assumed: "Assumée",
  false_positive: "Fausse alerte",
} as const;

const STATUS_VARIANT = {
  to_process: "warning",
  assumed: "success",
  false_positive: "neutral",
} as const;

function buildAlertHref(alert: DirectionSyntheticAlert) {
  const reviewJobId = alert.latestJobId ?? alert.jobId;

  if (reviewJobId) {
    return `/dashboard/affaires/${alert.projectId}/takeoff/${reviewJobId}/review?versionId=${alert.versionId}&from=approval&reviewMode=validation&view=dpgf&dpgfView=exceptions_only`;
  }

  return `/dashboard/affaires/${alert.projectId}`;
}

export function RiskAlertBanner({ alerts, compact = false }: Readonly<Props>) {
  const [isPending, startTransition] = useTransition();
  const [editorKey, setEditorKey] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState<Exclude<TakeoffRiskStatus, "to_process"> | null>(
    null
  );
  const [note, setNote] = useState("");
  const toast = useToast();
  const headingId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const activeTriggerKeyRef = useRef<string | null>(null);
  const pendingFocusTriggerKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!editorKey) {
      return;
    }

    textareaRef.current?.focus();
  }, [editorKey]);

  const visibleAlerts = useMemo(
    () => (compact ? alerts.slice(0, 2) : alerts.slice(0, 4)),
    [alerts, compact]
  );

  if (visibleAlerts.length === 0) {
    return null;
  }

  function closeEditor() {
    pendingFocusTriggerKeyRef.current = activeTriggerKeyRef.current;
    activeTriggerKeyRef.current = null;
    setEditorKey(null);
    setNextStatus(null);
    setNote("");
  }

  function registerTriggerRef(triggerKey: string, node: HTMLButtonElement | null) {
    triggerRefs.current[triggerKey] = node;

    if (node && pendingFocusTriggerKeyRef.current === triggerKey) {
      node.focus();
      pendingFocusTriggerKeyRef.current = null;
    }
  }

  function handleReset(alert: DirectionSyntheticAlert) {
    if (!alert.jobId || alert.alertIds.length === 0) {
      return;
    }
    const jobId = alert.jobId;

    startTransition(async () => {
      try {
        await updateDirectionAlertStatusAction({
          projectId: alert.projectId,
          versionId: alert.versionId,
          jobId,
          alertIds: alert.alertIds,
          status: "to_process",
        });
        toast.success({ title: `Alerte remise « À traiter » pour ${alert.projectName}.` });
      } catch {
        toast.error({ title: "Impossible de mettre à jour cette alerte." });
      }
    });
  }

  function handleConfirm(alert: DirectionSyntheticAlert) {
    if (!alert.jobId || alert.alertIds.length === 0 || !nextStatus || note.trim().length === 0) {
      return;
    }
    const jobId = alert.jobId;

    startTransition(async () => {
      try {
        await updateDirectionAlertStatusAction({
          projectId: alert.projectId,
          versionId: alert.versionId,
          jobId,
          alertIds: alert.alertIds,
          status: nextStatus,
          reviewNote: note.trim(),
        });
        toast.success({ title: `Statut mis à jour pour ${alert.projectName}.` });
        closeEditor();
      } catch {
        toast.error({ title: "Impossible de mettre à jour cette alerte." });
      }
    });
  }

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "min-w-0 rounded-lg border border-border bg-surface shadow-card",
        compact ? "p-4" : "p-4 sm:p-5"
      )}
    >
      <div>
        <h2 id={headingId} className="text-base font-semibold text-foreground">
          Alertes de portefeuille
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Les signaux ci-dessous regroupent les dossiers qui demandent un arbitrage clair.
        </p>
      </div>

      <div className={cn("mt-4 grid gap-3", !compact && "lg:grid-cols-2")}>
        {visibleAlerts.map((alert) => {
          const isEditing = editorKey === alert.alertKey;
          const href = buildAlertHref(alert);
          const assumedTriggerKey = `${alert.alertKey}:assumed`;
          const falsePositiveTriggerKey = `${alert.alertKey}:false_positive`;

          return (
            <article
              key={alert.alertKey}
              className="min-w-0 rounded-control border border-border bg-surface-subtle p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={LEVEL_VARIANT[alert.level]} size="sm">
                      {alert.level === "critical"
                        ? "Critique"
                        : alert.level === "warning"
                          ? "Attention"
                          : "Info"}
                    </Badge>
                    <Badge variant={STATUS_VARIANT[alert.status]} size="sm">
                      {STATUS_LABEL[alert.status]}
                    </Badge>
                    <span className="text-xs font-medium text-muted-foreground">
                      {alert.projectName}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      {alert.label}
                    </h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground-secondary marker:text-subtle-foreground">
                      {alert.reasons.map((reason) => (
                        <li key={reason} className="break-words">
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <Link href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Ouvrir la revue
                </Link>
              </div>

              {alert.jobId && alert.alertIds.length > 0 ? (
                <div className="mt-4 border-t border-border pt-4">
                  {isEditing && nextStatus ? (
                    <div className="space-y-3">
                      <Field className="gap-1.5">
                        <FieldLabel
                          htmlFor={`${alert.alertKey}-note`}
                          className="text-xs font-semibold text-foreground-secondary"
                        >
                          Note de décision
                        </FieldLabel>
                        <Textarea
                          id={`${alert.alertKey}-note`}
                          ref={textareaRef}
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          rows={3}
                          className="min-h-20 resize-none text-sm"
                          placeholder="Expliquez pourquoi cette alerte est assumée ou fausse."
                        />
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          disabled={note.trim().length === 0}
                          loading={isPending}
                          onClick={() => handleConfirm(alert)}
                        >
                          {nextStatus === "assumed" ? "Confirmer l’hypothèse" : "Confirmer la fausse alerte"}
                        </Button>
                        <Button type="button" variant="outline" onClick={closeEditor}>
                          Annuler
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => handleReset(alert)}
                      >
                        Marquer à traiter
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        ref={(node) => registerTriggerRef(assumedTriggerKey, node)}
                        disabled={isPending}
                        onClick={() => {
                          activeTriggerKeyRef.current = assumedTriggerKey;
                          setEditorKey(alert.alertKey);
                          setNextStatus("assumed");
                        }}
                      >
                        Marquer comme assumée
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        ref={(node) => registerTriggerRef(falsePositiveTriggerKey, node)}
                        disabled={isPending}
                        onClick={() => {
                          activeTriggerKeyRef.current = falsePositiveTriggerKey;
                          setEditorKey(alert.alertKey);
                          setNextStatus("false_positive");
                        }}
                      >
                        Marquer comme fausse alerte
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
