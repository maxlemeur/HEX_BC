import { z } from "zod";

import { itemSendCompartment, type ItemSendBreakdown } from "@/lib/takeoff/item-send-plan";
import type { TakeoffJobPlanLocation } from "@/lib/takeoff/plan-location-contracts";

export const redistributionDocumentSchema = z.object({
  part_id: z.string().uuid(), job_id: z.string().uuid(), file_id: z.string().uuid().nullable(),
  hash: z.string().nullable(), name: z.string().nullable(), revision: z.number().int().nullable(),
  current_file: z.object({ source_kind: z.string(), source_id: z.string().uuid(), identity: z.string() }).nullable(),
});

type RedistributionDocument = z.infer<typeof redistributionDocumentSchema>;

export function redistributionLocation(source: RedistributionDocument, file: TakeoffJobPlanLocation | undefined,
  breakdown: ItemSendBreakdown, namesBuilding: boolean) {
  if (!source.current_file || !file || file.plan_file_id !== source.file_id || file.status !== "current" || file.replacement || file.reading_issue
    || !source.hash || file.revision?.content_hash !== source.hash
    || file.revision.source_kind !== source.current_file.source_kind || file.revision.source_id !== source.current_file.source_id) {
    return { source, available: false, key: null, label: null, building_state: null, level_state: null };
  }
  const { building, level } = file.location;
  const generation = file.annotation?.revision ?? null;
  const { key, label } = itemSendCompartment(breakdown, { building, level, generation }, namesBuilding);
  return { source: { ...source, revision: generation }, available: true, key, label,
    building_state: building.state, level_state: level.state };
}
