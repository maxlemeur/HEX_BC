import type { SupabaseClient } from "@supabase/supabase-js";

import { forbidden } from "@/lib/estimates/errors";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { TAKEOFF_MODULE_ENABLED_FLAG_KEY } from "@/lib/takeoff/constants";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;

export async function isTakeoffEnabled(
  tenantId: string,
  input?: { supabase?: Supabase }
) {
  return isFeatureEnabled(tenantId, TAKEOFF_MODULE_ENABLED_FLAG_KEY, input);
}

export async function assertTakeoffEnabled(
  tenantId: string,
  input?: { supabase?: Supabase }
) {
  const enabled = await isTakeoffEnabled(tenantId, input);

  if (!enabled) {
    throw forbidden(
      "Le module Takeoff est desactive pour ce tenant.",
      undefined,
      "TAKEOFF_MODULE_DISABLED"
    );
  }
}
