import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

import type { Database } from "@/types/database";
import { getSupabasePublicEnv } from "@/lib/supabase/public-env";

export const createSupabaseServerClient = cache(async (cookieMode?: "route") => {
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseAnonKey } = getSupabasePublicEnv();

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookieOptions: { secure: process.env.NODE_ENV === "production" },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // A route outside the streaming proxy owns its refresh. Components leave it to the proxy.
        if (cookieMode === "route") {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        }
      },
    },
  });
});
