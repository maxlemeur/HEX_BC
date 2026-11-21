import { describeTakeoffResume, TAKEOFF_RESUME_RELOAD_TEXT } from "@/lib/takeoff/operator-state";
import type { TakeoffActivityCenterJobRow } from "@/lib/takeoff/types";

const ACQUIRED_STATUSES = new Set(["completed", "review_required"]);
const WAITING_STATUSES = new Set(["queued", "processing", "provider_pending"]);
const ACTION_REQUIRED_STATUSES = new Set(["action_required"]);

export type TakeoffContinuityHistoryEntry = {
  jobId: string;
  versionLabel: string;
  statusLabel: string;
  statusRaw: string;
  createdAt: string;
  carriedOverFrom: string | null;
};

export type TakeoffContinuitySnapshot = {
  title: string;
  description: string;
  /** The link to the takeoff's activity, named after the latest analysis's decision; null when nothing is to follow. */
  actionLabel: string | null;
  latestStatusRaw: string;
  acquiredCount: number;
  waitingCount: number;
  actionRequiredCount: number;
  history: TakeoffContinuityHistoryEntry[];
};

function toTimestamp(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortJobsByRecency(jobs: TakeoffActivityCenterJobRow[]) {
  return [...jobs].sort((left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt));
}

function countJobsByStatus(jobs: TakeoffActivityCenterJobRow[]) {
  return jobs.reduce(
    (accumulator, job) => {
      if (ACQUIRED_STATUSES.has(job.statusRaw)) {
        accumulator.acquiredCount += 1;
      } else if (WAITING_STATUSES.has(job.statusRaw)) {
        accumulator.waitingCount += 1;
      } else if (ACTION_REQUIRED_STATUSES.has(job.statusRaw)) {
        accumulator.actionRequiredCount += 1;
      }

      return accumulator;
    },
    {
      acquiredCount: 0,
      waitingCount: 0,
      actionRequiredCount: 0,
    }
  );
}

function continuityActionLabel(latestJob: TakeoffActivityCenterJobRow): string | null {
  if (latestJob.statusRaw === "action_required") {
    if (latestJob.resume?.action === "retry_now") return "Reprendre l'analyse";
    if (latestJob.resume?.action === "wait_retry") return "Suivre la reprise";
    return "Ouvrir le suivi du métré";
  }
  return WAITING_STATUSES.has(latestJob.statusRaw) ? "Suivre la reprise" : null;
}

function buildSnapshotCopy(input: {
  latestJob: TakeoffActivityCenterJobRow;
  acquiredCount: number;
  waitingCount: number;
  actionRequiredCount: number;
}) {
  if (input.latestJob.statusRaw === "action_required" && input.acquiredCount > 0) {
    // What to do with the failed analysis is its resume decision, as the activity shows it.
    const decision = input.latestJob.resume;
    const next = decision ? describeTakeoffResume(decision) : TAKEOFF_RESUME_RELOAD_TEXT;
    return {
      title: "Reprise après échec partiel",
      description: next ? `Les analyses déjà acquises restent visibles. ${next}` : "Les analyses déjà acquises restent visibles.",
    };
  }

  if (WAITING_STATUSES.has(input.latestJob.statusRaw) && input.acquiredCount > 0) {
    return {
      title: "Reprise en attente",
      description:
        "Les résultats déjà acquis restent disponibles pendant l'attente. Revenez ici pour suivre ou relancer seulement ce qui manque.",
    };
  }

  if (input.latestJob.statusRaw === "review_required" && input.acquiredCount > 1) {
    return {
      title: "Reprise avec revue requise",
      description:
        "Les statuts précédents restent visibles. Reprenez depuis la revue des exceptions sans perdre les analyses déjà acquises.",
    };
  }

  return {
    title: "Statuts précédents conserves",
    description:
      "L'affaire garde l'historique récent des analyses pour reprendre au bon endroit sans masquer les sous-resultats déjà acquis.",
  };
}

export function buildTakeoffContinuitySnapshot(input: {
  jobs: TakeoffActivityCenterJobRow[];
  latestJobId?: string | null;
  maxHistory?: number;
}): TakeoffContinuitySnapshot | null {
  const sortedJobs = sortJobsByRecency(input.jobs);
  if (sortedJobs.length < 2) {
    return null;
  }

  const latestJob = input.latestJobId
    ? sortedJobs.find((job) => job.jobId === input.latestJobId) ?? sortedJobs[0]
    : sortedJobs[0];
  if (!latestJob) {
    return null;
  }

  const counts = countJobsByStatus(sortedJobs);
  const copy = buildSnapshotCopy({
    latestJob,
    acquiredCount: counts.acquiredCount,
    waitingCount: counts.waitingCount,
    actionRequiredCount: counts.actionRequiredCount,
  });

  return {
    ...copy,
    actionLabel: continuityActionLabel(latestJob),
    latestStatusRaw: latestJob.statusRaw,
    acquiredCount: counts.acquiredCount,
    waitingCount: counts.waitingCount,
    actionRequiredCount: counts.actionRequiredCount,
    history: sortedJobs.slice(0, input.maxHistory ?? 3).map((job) => ({
      jobId: job.jobId,
      versionLabel: job.versionLabel,
      statusLabel: job.statusLabel,
      statusRaw: job.statusRaw,
      createdAt: job.createdAt,
      carriedOverFrom: job.carriedOverFrom,
    })),
  };
}
