"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { updateDirectionAlertStatusAction } from "@/app/dashboard/_actions/direction";
import { Badge } from "@/components/ui/Badge";
import type { DirectionSyntheticAlert } from "@/lib/direction/alerts";
import type { TakeoffRiskStatus } from "@/lib/takeoff/types";

type Props = {
  alerts: DirectionSyntheticAlert[];
  compact?: boolean;
};

const LEVEL_VARIANT = {
  info: "info",
  warning: "warning",
  critical: "error",
} as const;

const STATUS_LABEL = {
  to_process: "A traiter",
  assumed: "Assumee",
  false_positive: "Fausse alerte",
} as const;

const STATUS_VARIANT = {
  to_process: "warning",
  assumed: "success",
  false_positive: "neutral",
} as const;

function buildAlertHref(alert: DirectionSyntheticAlert) {
  if (alert.latestJobId) {
    return `/dashboard/affaires/${alert.projectId}/takeoff/${alert.latestJobId}/review?versionId=${alert.versionId}&from=approval&reviewMode=validation&view=dpgf&dpgfView=exceptions_only`;
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
  const [feedback, setFeedback] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!editorKey) {
      return;
    }

    textareaRef.current?.focus();
  }, [editorKey]);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timer = window.setTimeout(() => setFeedback(null), 3000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const visibleAlerts = useMemo(
    () => (compact ? alerts.slice(0, 2) : alerts.slice(0, 4)),
    [alerts, compact]
  );

  if (visibleAlerts.length === 0) {
    return null;
  }

  function closeEditor() {
    setEditorKey(null);
    setNextStatus(null);
    setNote("");
    triggerRef.current?.focus();
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
        setFeedback(`Statut remis a "A traiter" pour ${alert.projectName}.`);
      } catch {
        setFeedback("Impossible de mettre a jour cette alerte.");
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
        setFeedback(`Statut mis a jour pour ${alert.projectName}.`);
        closeEditor();
      } catch {
        setFeedback("Impossible de mettre a jour cette alerte.");
      }
    });
  }

  return (
    <section className={`dashboard-card ${compact ? "p-4" : "p-5"}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--slate-900)]">
            Alertes de portefeuille
          </h2>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            Les signaux ci-dessous regroupent les dossiers qui demandent un arbitrage clair.
          </p>
        </div>
        <p className="text-xs text-[var(--slate-400)]" aria-live="polite">
          {feedback ?? ""}
        </p>
      </div>

      <div className={`mt-4 grid gap-3 ${compact ? "" : "lg:grid-cols-2"}`}>
        {visibleAlerts.map((alert) => {
          const isEditing = editorKey === alert.alertKey;
          const href = buildAlertHref(alert);

          return (
            <article
              key={alert.alertKey}
              className="rounded-2xl border border-[var(--slate-200)] bg-[var(--slate-50)]/70 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
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
                    <span className="text-xs font-medium text-[var(--slate-500)]">
                      {alert.projectName}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-[var(--slate-900)]">
                      {alert.label}
                    </h3>
                    <ul className="mt-2 space-y-1 text-sm text-[var(--slate-600)]">
                      {alert.reasons.map((reason) => (
                        <li key={reason} className="flex gap-2">
                          <span aria-hidden="true" className="mt-0.5 text-[var(--slate-400)]">
                            •
                          </span>
                          <span>{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <Link
                  href={href}
                  className="rounded-full border border-[var(--slate-200)] bg-white px-3 py-2 text-xs font-medium text-[var(--slate-700)] transition hover:border-[var(--slate-300)] hover:bg-[var(--slate-100)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-blue)]"
                >
                  Ouvrir la revue
                </Link>
              </div>

              {alert.jobId && alert.alertIds.length > 0 ? (
                <div className="mt-4 border-t border-[var(--slate-200)] pt-4">
                  {isEditing && nextStatus ? (
                    <div className="space-y-3">
                      <label className="space-y-1.5">
                        <span className="block text-xs font-semibold text-[var(--slate-700)]">
                          Note de decision
                        </span>
                        <textarea
                          ref={textareaRef}
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          rows={3}
                          className="form-input w-full resize-none"
                          placeholder="Expliquez pourquoi cette alerte est assumee ou fausse."
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isPending || note.trim().length === 0}
                          className="btn btn-primary btn-sm"
                          onClick={() => handleConfirm(alert)}
                        >
                          Confirmer {nextStatus === "assumed" ? "l'hypothese" : "le faux positif"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={closeEditor}
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={isPending}
                        onClick={() => handleReset(alert)}
                      >
                        Marquer a traiter
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={isPending}
                        onClick={(event) => {
                          triggerRef.current = event.currentTarget;
                          setEditorKey(alert.alertKey);
                          setNextStatus("assumed");
                        }}
                      >
                        Marquer assumee
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={isPending}
                        onClick={(event) => {
                          triggerRef.current = event.currentTarget;
                          setEditorKey(alert.alertKey);
                          setNextStatus("false_positive");
                        }}
                      >
                        Marquer fausse alerte
                      </button>
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
