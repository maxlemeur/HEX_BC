import "server-only";

const hostingMarkers = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_TARGET_ENV"] as const;
const nativeBackendOrigin = "http://127.0.0.1:45585";

function isLocalApplicationOrigin(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      Number(url.port) > 0 && url.origin === value &&
      !url.username && !url.password && url.pathname === "/" &&
      !url.search && !url.hash;
  } catch {
    return false;
  }
}

/** Draft terms remain a local sandbox source, never legally reviewed terms. */
export function canUseDevelopmentEstimateTerms(): boolean {
  if (hostingMarkers.some((name) => process.env[name] !== undefined)) return false;
  if (process.env.NODE_ENV === "development") return true;
  if (process.env.NODE_ENV !== "production") return false;

  return process.env.E2E_OFFER_SANDBOX_TERMS === "1" &&
    process.env.E2E_OFFER_SERVER_MODE === "production" &&
    process.env.E2E_ARMY === "1" &&
    process.env.E2E_ARMY_SUITE === "offer" &&
    process.env.E2E_OFFER_SERVER_GUARD === "1" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL === nativeBackendOrigin &&
    process.env.E2E_OFFER_BACKEND_ORIGIN === nativeBackendOrigin &&
    isLocalApplicationOrigin(process.env.E2E_OFFER_APP_ORIGIN);
}
