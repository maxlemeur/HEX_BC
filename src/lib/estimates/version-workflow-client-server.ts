import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { internalError } from "@/lib/estimates/errors";

export function getServiceRoleSupabaseClient() {
  try {
    return createServiceRoleClient();
  } catch (error) {
    throw internalError(
      "Configuration Supabase service role manquante pour executer le workflow protege.",
      error
    );
  }
}
