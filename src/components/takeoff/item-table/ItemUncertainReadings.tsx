import Link from "next/link";

import type { ItemTableResponseLine } from "@/lib/takeoff/item-table-contracts";
import { formatItemCount } from "@/lib/takeoff/item-table-labels";
import { describeItemUncertainty, itemScalePreparationHref } from "@/lib/takeoff/item-uncertainty";
import { takeoffItemDetailHref } from "@/lib/takeoff/review-href";

export function ItemUncertainReadings({ line, projectId, planKey, query, canReview }: {
  line: ItemTableResponseLine;
  projectId: string;
  planKey: string | null;
  query: URLSearchParams;
  canReview: boolean;
}) {
  const plans = line.readings.filter((reading) => reading.answer?.outcome === "uncertain" && (!planKey || reading.planKey === planKey));
  if (!plans.length) return null;

  const summary = (reading: (typeof plans)[number]) => {
    const answer = reading.answer!;
    const canResolve = canReview && !reading.sent && reading.decision?.kind !== "set_aside";
    const next = describeItemUncertainty(answer, line.expectedUnit, canResolve);
    const href = next.action === "prepare" ? itemScalePreparationHref(projectId) : takeoffItemDetailHref({ projectId,
      itemId: line.itemId, planKey: reading.planKey, jobId: answer.jobId, page: next.page, from: query });
    return (
      <div className="space-y-0.5">
        <p className="break-words">{next.candidate ?? next.obstacle}</p>
        <Link className="font-medium underline underline-offset-2" prefetch={false} href={href}>{next.label}</Link>
      </div>
    );
  };

  return (
    <div className="mt-1 max-w-[18rem] min-w-[11rem] whitespace-normal text-xs text-muted-foreground">
      {planKey ? summary(plans[0]) : (
        <details>
          <summary className="cursor-pointer underline-offset-2 hover:underline">
            {formatItemCount(plans.length, "plan incertain", "plans incertains")}
          </summary>
          <ul className="mt-1 space-y-2">
            {plans.map((reading) => (
              <li key={reading.planKey}>
                <p className="font-medium text-foreground">{reading.planName}</p>
                {summary(reading)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
