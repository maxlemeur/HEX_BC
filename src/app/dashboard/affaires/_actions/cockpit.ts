"use server";

import { z } from "zod";

import { recordCockpitCommand } from "@/lib/cockpit/history";
import { upsertCockpitCommandPreference } from "@/lib/cockpit/preferences";

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

const updateCockpitCommandPreferenceSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  actionId: z.string().min(1, "actionId requis."),
  isHidden: z.boolean(),
  isPinned: z.boolean(),
});

export async function updateCockpitCommandPreferenceAction(input: {
  projectId: string;
  actionId: string;
  isHidden: boolean;
  isPinned: boolean;
}): Promise<void> {
  const parsed = updateCockpitCommandPreferenceSchema.parse(input);
  await upsertCockpitCommandPreference(parsed);
}
