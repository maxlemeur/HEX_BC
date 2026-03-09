"use server";

import { z } from "zod";

import { recordCockpitCommand } from "@/lib/cockpit/history";

const recordCockpitCommandActionSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  actionId: z.string().min(1, "actionId requis."),
  intent: z.string().min(1, "intent requis."),
});

export async function recordCockpitCommandAction(input: {
  projectId: string;
  actionId: string;
  intent: string;
}): Promise<void> {
  const parsed = recordCockpitCommandActionSchema.parse(input);
  await recordCockpitCommand(parsed);
}
