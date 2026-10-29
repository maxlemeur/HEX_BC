"use server";

import { getOpenAiDecisionsCapability } from "@/lib/ai/decisions";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";

export async function loadDecisionsCapability() {
  await getAuthenticatedContext();
  return getOpenAiDecisionsCapability();
}
