"use client";

import Link from "next/link";

import {
  describeTakeoffRequestActivityCoverage,
  describeTakeoffRequestUnitState,
  reviewableTakeoffRequestUnits,
} from "@/lib/takeoff/request-activity";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";

import { useTakeoffRequestActivity } from "./useTakeoffRequestActivity";

/**
 * Above the review of one plan: the other plans of the same launch request, which ones are still missing, and the way to
 * the previous and next plan read (in the recorded order). Read again while the others are read; a plan that arrives
 * meanwhile adds its link without moving the focus, the selection or what the member is typing. Nothing for an analysis
 * without a request, for lot 2's grouped analysis or for a request of one plan.
 */
export function TakeoffRequestPlansNav({ projectId, jobId, viewerKey }: { projectId: string; jobId: string; viewerKey: string }) {
  const { data } = useTakeoffRequestActivity({ viewerKey, projectId, view: "job", target: jobId, poll: true });
  const request = data?.current ?? null;
  const units = request?.units;
  if (!request || !units || units.format !== "per_plan" || units.units.length < 2) return null;

  const jobs = new Map(request.jobs.map((job) => [job.jobId, job]));
  const here = units.units.find((unit) => unit.jobId === jobId) ?? null;
  const readable = reviewableTakeoffRequestUnits(request);
  const position = readable.findIndex((unit) => unit.jobId === jobId);
  const previous = position > 0 ? readable[position - 1] : null;
  const next = position >= 0 ? readable[position + 1] ?? null : readable[0] ?? null;
  const missing = units.units.filter((unit) => unit.state !== "succeeded");
  const href = (unit: (typeof readable)[number]) =>
    takeoffReviewHref({ projectId, jobId: unit.jobId, versionId: jobs.get(unit.jobId)?.estimateVersionId ?? null });

  return (
    <nav aria-label="Plans de cette analyse" className="journey-panel mb-4" data-testid="takeoff-request-plans-nav">
      <div className="journey-panel-body space-y-2">
        <p className="text-sm font-medium text-foreground">
          {here ? `Plan ${here.ordinal} sur ${units.coverage.expected} de cette analyse` : "Plans de cette analyse"}
          <span className="ml-2 font-normal text-muted-foreground" role="status">{describeTakeoffRequestActivityCoverage(request)}</span>
        </p>
        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {units.units.map((unit) => {
            const isHere = unit.jobId === jobId;
            const canOpen = !isHere && readable.some((entry) => entry.jobId === unit.jobId);
            return (
              <li key={unit.key} className="min-w-0 [overflow-wrap:anywhere]">
                {isHere ? (
                  <span aria-current="page" className="font-semibold text-foreground">{unit.name}</span>
                ) : canOpen ? (
                  <Link href={href(unit)} className="journey-text-action">Revoir {unit.name}</Link>
                ) : (
                  <span className="text-muted-foreground">{unit.name} · {describeTakeoffRequestUnitState(unit, jobs.get(unit.jobId) ?? null)}</span>
                )}
              </li>
            );
          })}
        </ol>
        {missing.length > 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="takeoff-request-plans-missing">
            {missing.length > 1 ? "Plans encore manquants" : "Plan encore manquant"} :{" "}
            {missing.map((unit) => `${unit.name} (${describeTakeoffRequestUnitState(unit, jobs.get(unit.jobId) ?? null).toLowerCase()})`).join(", ")}.
          </p>
        ) : null}
        {previous || next ? (
          <div className="flex flex-wrap justify-between gap-3 text-sm">
            {previous ? <Link href={href(previous)} className="journey-text-action">Plan précédent : {previous.name}</Link> : <span />}
            {next ? <Link href={href(next)} className="journey-text-action">Plan suivant : {next.name}</Link> : null}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
