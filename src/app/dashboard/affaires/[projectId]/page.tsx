import { notFound } from "next/navigation";

import { AffaireHub } from "@/components/affaires/AffaireHub";
import {
  fetchAffaireHubDpgfSource,
  fetchAffaireHubSummary,
  fetchAffaireHubTimeline,
} from "@/lib/affaires/server";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AffaireHubPage({ params, searchParams }: Props) {
  const { projectId } = await params;
  const search = await searchParams;

  const justCreated =
    typeof search.created === "string" && search.created === "1";

  const timelinePageRaw =
    typeof search.timelinePage === "string"
      ? Number.parseInt(search.timelinePage, 10)
      : undefined;
  const timelinePage =
    typeof timelinePageRaw === "number" &&
    Number.isInteger(timelinePageRaw) &&
    timelinePageRaw > 0
      ? timelinePageRaw
      : undefined;

  const summaryPromise = fetchAffaireHubSummary(projectId);
  const timelinePromise = fetchAffaireHubTimeline(projectId, timelinePage);
  const dpgfSourcePromise = fetchAffaireHubDpgfSource(projectId);

  const [summaryResult, timelineResult, dpgfSourceResult] =
    await Promise.allSettled([summaryPromise, timelinePromise, dpgfSourcePromise]);

  if (summaryResult.status === "rejected") {
    const err = summaryResult.reason as unknown;
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "NOT_FOUND"
    ) {
      notFound();
    }
    throw err;
  }

  const summary = summaryResult.value;

  const timeline =
    timelineResult.status === "fulfilled" ? timelineResult.value : null;
  const dpgfSource =
    dpgfSourceResult.status === "fulfilled" ? dpgfSourceResult.value : null;

  const sectionErrors: {
    timeline?: string;
    dpgfSource?: string;
  } = {};

  if (timelineResult.status === "rejected") {
    sectionErrors.timeline =
      "Impossible de charger la timeline des versions pour le moment.";
  }

  if (dpgfSourceResult.status === "rejected") {
    sectionErrors.dpgfSource =
      "Impossible de charger la section Source DPGF pour le moment.";
  }

  return (
    <AffaireHub
      summary={summary}
      timeline={timeline}
      dpgfSource={dpgfSource}
      sectionErrors={sectionErrors}
      justCreated={justCreated}
    />
  );
}
