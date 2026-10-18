import "server-only";

import path from "node:path";

const hostingMarkers = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_TARGET_ENV"] as const;
const nativeBackendOrigin = "http://127.0.0.1:45585";
/** The developers' long-running recipe stack (API 45585, DB 33485): never an owned calc-v3 backend. */
const developersStackPorts: ReadonlySet<string> = new Set(["45585", "33485"]);

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

/**
 * The emission campaign directory that calc-v3-campaign.ts creates for one owned run, exactly
 * `<app cwd>/.e2e/army/offer/runs/<stamp>-calc-v3-<uuid>` (calc-v3.config.ts requires the same).
 */
function isOwnedCalcV3RunDirectory(value: string | undefined): boolean {
  if (!value || !path.isAbsolute(value)) return false;
  const runs = path.resolve(process.cwd(), ".e2e", "army", "offer", "runs");
  return path.dirname(value) === runs &&
    /^[0-9TZ-]+-calc-v3-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(path.basename(value));
}

/**
 * Lot 2, sub-lot 2.7 (design §10.4): the production build of the owned calc-v3 profile, on the
 * owned ephemeral stack of run-tester-army-ci.ts (exact IPv4 loopback origin on a per-run port,
 * never the developers' stack) and under the offer server guard. Owned means the runner's positive
 * marker and its emission campaign directory, not merely a port outside the developers' stack.
 */
function isOwnedCalcV3ProductionProfile(): boolean {
  const backend = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const app = process.env.E2E_OFFER_APP_ORIGIN;
  if (!isLocalApplicationOrigin(backend) || !isLocalApplicationOrigin(app)) return false;
  const backendUrl = new URL(backend!);
  return process.env.E2E_OFFER_SANDBOX_TERMS === "1" &&
    process.env.E2E_OFFER_SERVER_MODE === "production" &&
    process.env.E2E_ARMY === "1" &&
    process.env.E2E_ARMY_SUITE === "calc-v3" &&
    process.env.E2E_OFFER_SERVER_GUARD === "1" &&
    process.env.E2E_CALC_V3_OWNED_STACK === "1" &&
    isOwnedCalcV3RunDirectory(process.env.E2E_OFFER_RUN_DIRECTORY) &&
    backendUrl.hostname === "127.0.0.1" && !developersStackPorts.has(backendUrl.port) &&
    process.env.E2E_OFFER_BACKEND_ORIGIN === backend &&
    new URL(app!).port !== backendUrl.port;
}

/** Draft terms remain a local sandbox source, never legally reviewed terms. */
export function canUseDevelopmentEstimateTerms(): boolean {
  if (hostingMarkers.some((name) => process.env[name] !== undefined)) return false;
  if (process.env.NODE_ENV === "development") return true;
  if (process.env.NODE_ENV !== "production") return false;

  return (process.env.E2E_OFFER_SANDBOX_TERMS === "1" &&
    process.env.E2E_OFFER_SERVER_MODE === "production" &&
    process.env.E2E_ARMY === "1" &&
    process.env.E2E_ARMY_SUITE === "offer" &&
    process.env.E2E_OFFER_SERVER_GUARD === "1" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL === nativeBackendOrigin &&
    process.env.E2E_OFFER_BACKEND_ORIGIN === nativeBackendOrigin &&
    isLocalApplicationOrigin(process.env.E2E_OFFER_APP_ORIGIN)) ||
    isOwnedCalcV3ProductionProfile();
}
