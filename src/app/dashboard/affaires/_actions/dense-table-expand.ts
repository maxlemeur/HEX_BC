"use server";

import { z } from "zod";
import {
  fetchAffaireHubSummary,
  fetchAffaireHubDpgfSource,
  type AffaireHubSummaryResult,
  type AffaireHubDpgfSourceResult,
} from "@/lib/affaires/server";

export type AffaireDenseExpandData = {
  summary: AffaireHubSummaryResult;
  dpgfSource: AffaireHubDpgfSourceResult;
};

const projectIdSchema = z.string().uuid();

export async function fetchAffaireDenseExpandData(
  projectId: string
): Promise<AffaireDenseExpandData> {
  const parsed = projectIdSchema.parse(projectId);

  const [summary, dpgfSource] = await Promise.all([
    fetchAffaireHubSummary(parsed),
    fetchAffaireHubDpgfSource(parsed),
  ]);

  return { summary, dpgfSource };
}
