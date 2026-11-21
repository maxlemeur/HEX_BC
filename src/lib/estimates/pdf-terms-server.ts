import "server-only";

import { hasOfferHostingMarker, isOfferSandboxRuntime } from "@/lib/runtime/offer-sandbox";

/** Draft terms are available for local development and owned emission fixtures. */
export function canUseDevelopmentEstimateTerms(): boolean {
  if (hasOfferHostingMarker(process.env)) return false;
  if (process.env.NODE_ENV === "development") return true;
  return process.env.NODE_ENV === "production" && isOfferSandboxRuntime({
    env: process.env,
    root: process.cwd(),
    backendOrigin: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
}
