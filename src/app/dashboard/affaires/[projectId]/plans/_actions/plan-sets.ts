"use server";

import {
  createPlanSet,
  deletePlanSet,
  parseCreatePlanSetInput,
  planSetIdSchema,
} from "@/lib/takeoff/plans";

export async function createPlanSetAction(input: unknown) {
  const payload = parseCreatePlanSetInput(input);
  return createPlanSet(payload);
}

export async function deletePlanSetAction(setId: string) {
  const parsedSetId = planSetIdSchema.parse(setId);
  return deletePlanSet(parsedSetId);
}
