"use server";

import type { AffaireListQuery } from "@/components/affaires/types";
import { fetchAffaireManagerQueueSummary } from "@/lib/affaires/server";

export async function fetchAffaireManagerQueueSummaryAction(
  input: Pick<AffaireListQuery, "q" | "status" | "favorites">
) {
  return fetchAffaireManagerQueueSummary(input);
}
