import { z } from "zod";

export const AFFAIRE_ANALYSIS_PROGRESS_PATH = "/api/affaires/analysis-progress";
export const analysisProgressCursorSchema = z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/);
const timestamp = z.iso.datetime({ offset: true });

const analysisProgressLineSchema = z.object({
  id: z.string(),
  kind: z.enum(["dossier", "takeoff"]),
  state: z.enum(["reading", "waiting", "finished"]),
  status: z.string(),
  detail: z.string().nullable(),
  href: z.string(),
  updatedAt: timestamp,
  completionKeys: z.array(z.string()),
});

const analysisProgressAffaireSchema = z.object({
  id: z.string(),
  name: z.string(),
  lines: z.array(analysisProgressLineSchema),
});

const analysisProgressSchema = z.object({
  viewer: z.object({ tenantId: z.string(), userId: z.string() }),
  observedAt: timestamp,
  nextCursor: analysisProgressCursorSchema.nullable(),
  affaires: z.array(analysisProgressAffaireSchema),
});

export const analysisProgressResponseSchema = z.object({ ok: z.literal(true), data: analysisProgressSchema });

export type AnalysisProgress = z.infer<typeof analysisProgressSchema>;
export type AnalysisProgressLine = z.infer<typeof analysisProgressLineSchema>;
