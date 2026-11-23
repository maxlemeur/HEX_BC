"use client";

import useSWR from "swr";
import { requestContributionRevision } from "@/lib/takeoff/client";
import type { RevisionVersion } from "@/lib/takeoff/contribution-revision-contracts";

type Address = { jobId: string; itemId: string };

async function readVersions([, , , addresses]: readonly [string, string, string, Address[]]) {
  const jobs = new Map<string, Set<string>>();
  for (const { jobId, itemId } of addresses) {
    const items = jobs.get(jobId) ?? new Set<string>();
    items.add(itemId);
    jobs.set(jobId, items);
  }
  const versions: Record<string, RevisionVersion[]> = {};
  await Promise.all(
    Array.from(jobs, async ([jobId, items]) => {
      const result = await requestContributionRevision(jobId, { action: "read", items: [...items] });
      if (result.action !== "read") throw new Error("Impossible de lire les apports du devis.");
      versions[jobId] = result.versions;
    }),
  );
  return versions;
}

export function useContributionRevisions(viewer: string, project: string, addresses: Address[]) {
  return useSWR(
    addresses.length ? (["contribution-revisions", viewer, project, addresses] as const) : null,
    readVersions,
    { keepPreviousData: false, shouldRetryOnError: false },
  );
}
