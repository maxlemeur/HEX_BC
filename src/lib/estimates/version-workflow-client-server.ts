import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { internalError } from "@/lib/http/api-response";

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
