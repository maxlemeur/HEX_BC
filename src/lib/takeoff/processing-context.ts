import type { getAuthenticatedContext } from "@/lib/auth/tenant-context";

export type Supabase = Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];

export const TAKEOFF_LEVEL_A = "A";
export const TAKEOFF_LEVEL_B = "B";
export const TAKEOFF_LEVEL_C = "C";

export type ProcessableTakeoffLevel =
  | typeof TAKEOFF_LEVEL_A
  | typeof TAKEOFF_LEVEL_B
  | typeof TAKEOFF_LEVEL_C;
