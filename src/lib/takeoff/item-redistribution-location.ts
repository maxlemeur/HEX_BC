import { itemSendCompartment, type ItemSendBreakdown } from "@/lib/takeoff/item-send-plan";
import type { TakeoffJobPlanLocation } from "@/lib/takeoff/plan-location-contracts";

export type RedistributionDocument = {
  part_id: string; job_id: string; file_id: string | null; hash: string | null; revision: number | null; name: string | null;
};

export function redistributionLocation(source: RedistributionDocument, file: TakeoffJobPlanLocation | undefined,
  breakdown: ItemSendBreakdown, namesBuilding: boolean) {
  if (!file || file.plan_file_id !== source.file_id || file.status !== "current" || file.replacement || file.reading_issue
    || !source.hash || file.revision?.content_hash !== source.hash) {
    return { source, available: false, key: null, label: null, building_state: null, level_state: null };
  }
  const { building, level } = file.location;
  const generation = file.annotation?.revision ?? null;
  const { key, label } = itemSendCompartment(breakdown, { building, level, generation }, namesBuilding);
  return { source: { ...source, revision: generation }, available: true, key, label,
    building_state: building.state, level_state: level.state };
}
