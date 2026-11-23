import { z } from "zod";

export const WIDE_PAGE = 700;
export const COUNT_MARK_READER_VERSION = "1";
export const MARK_SCOPE_REFUSAL =
  "Les pages choisies dépassent la limite de 24 appels de repérage. Choisissez la page affichée seule ou désactivez les propositions.";
export const countMarkScheduleSchema = z
  .object({
    pages: z
      .array(z.object({ page: z.number().int().positive(), width_points: z.number().positive() }).strict())
      .min(1)
      .max(6),
    tile_calls: z.number().int().min(4).max(24),
    other_calls: z.number().int().min(1).max(80),
    total_calls: z.number().int().min(5).max(104),
  })
  .strict();
export type CountMarkSchedule = z.infer<typeof countMarkScheduleSchema>;

export function countMarkSchedule(pages: CountMarkSchedule["pages"], otherCalls: number): CountMarkSchedule {
  const tileCalls = pages.reduce((n, sheet) => n + (sheet.width_points > WIDE_PAGE ? 6 : 4), 0);
  const schedule = countMarkScheduleSchema.safeParse({
    pages,
    tile_calls: tileCalls,
    other_calls: otherCalls,
    total_calls: tileCalls + otherCalls,
  });
  if (!schedule.success || pages.some((sheet, i) => i > 0 && sheet.page <= pages[i - 1].page))
    throw new Error(MARK_SCOPE_REFUSAL);
  return schedule.data;
}

// Qualification is an owner decision on a versioned reader, model, effort and family.
export const COUNT_MARK_QUALIFICATIONS: readonly {
  reader: string;
  version: string;
  family: string;
  model: string;
  effort: string | null;
}[] = [];
export function countMarkReaderStatus(
  reader: string,
  family: string,
  model = "",
  effort: string | null = null,
  version = COUNT_MARK_READER_VERSION,
) {
  return COUNT_MARK_QUALIFICATIONS.some(
    (q) =>
      q.reader === reader && q.version === version && q.family === family && q.model === model && q.effort === effort,
  )
    ? "qualifié"
    : "non qualifié";
}

export const tileStatus = z.enum(["read", "truncated", "failed", "unknown", "not_read"]);
export const markPageCoverageSchema = z
  .object({
    page: z.number().int().positive(),
    vector_state: z.enum(["read", "no_layer", "failed", "not_read"]),
    tiles: z.array(tileStatus).min(4).max(6),
    limited: z.boolean(),
  })
  .strict();
export const markCoverageSchema = z.array(markPageCoverageSchema).max(6);
export type MarkCoverage = z.infer<typeof markCoverageSchema>;

const vectors = {
  read: "Dessin lu",
  no_layer: "Page sans couche vectorielle",
  failed: "Lecture du dessin en échec",
  not_read: "Dessin non lu",
};
const tiles = {
  read: "lue",
  truncated: "tronquée",
  failed: "en échec",
  unknown: "de consommation inconnue",
  not_read: "non lue",
};

export function describeMarkCoverage(coverage: MarkCoverage[number]) {
  const read = coverage.tiles.filter((tile) => tile === "read").length;
  const parts = [
    `Page ${coverage.page} · ${vectors[coverage.vector_state]}`,
    `${read} tuiles lues sur ${coverage.tiles.length}`,
  ];
  coverage.tiles.forEach((status, index) => {
    if (status !== "read") parts.push(`Tuile ${index + 1} ${tiles[status]}`);
  });
  if (coverage.limited) parts.push("Limite de publication atteinte, une partie des propositions a été écartée");
  return parts.join(" · ");
}

export function publishedMarkCoverage(value: unknown): MarkCoverage | undefined {
  const result = markCoverageSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
