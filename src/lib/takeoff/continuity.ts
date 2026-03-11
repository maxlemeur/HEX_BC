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

function buildSnapshotCopy(input: {
  latestJob: TakeoffActivityCenterJobRow;
  acquiredCount: number;
  waitingCount: number;
  actionRequiredCount: number;
}) {
  if (input.latestJob.statusRaw === "action_required" && input.acquiredCount > 0) {
    return {
      title: "Reprise apres echec partiel",
      description:
        "Les analyses deja acquises restent visibles. Corrigez ou relancez uniquement la reprise en echec.",
    };
  }

  if (WAITING_STATUSES.has(input.latestJob.statusRaw) && input.acquiredCount > 0) {
    return {
      title: "Reprise en attente",
      description:
        "Les resultats deja acquis restent disponibles pendant l'attente. Revenez ici pour suivre ou relancer seulement ce qui manque.",
    };
  }

  if (input.latestJob.statusRaw === "review_required" && input.acquiredCount > 1) {
    return {
      title: "Reprise avec revue requise",
      description:
        "Les statuts precedents restent visibles. Reprenez depuis la revue des exceptions sans perdre les analyses deja acquises.",
    };
  }

  return {
    title: "Statuts precedents conserves",
    description:
      "L'affaire garde l'historique recent des analyses pour reprendre au bon endroit sans masquer les sous-resultats deja acquis.",
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

  const latestJob =
    (input.latestJobId
      ? sortedJobs.find((job) => job.jobId === input.latestJobId) ?? null
      : null) ?? sortedJobs[0];
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
