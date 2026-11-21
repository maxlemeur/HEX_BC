import path from "node:path";

export const NATIVE_OFFER_BACKEND_ORIGIN = "http://127.0.0.1:45585";
export const DEVELOPER_STACK_PORTS: ReadonlySet<string> = new Set(["45585", "33485"]);

const HOSTING_MARKERS = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_TARGET_ENV"];
const CALC_V3_RUN_NAME = /^[0-9TZ-]+-calc-v3-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function hasOfferHostingMarker(env: NodeJS.ProcessEnv): boolean {
  return HOSTING_MARKERS.some((name) => env[name] !== undefined);
}

export function readExplicitLoopbackOrigin(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      Number(url.port) > 0 && url.origin === value
      ? url
      : null;
  } catch {
    return null;
  }
}

export function requestsOfferSandboxTerms(env: NodeJS.ProcessEnv): boolean {
  return !hasOfferHostingMarker(env) &&
    env.E2E_OFFER_SANDBOX_TERMS === "1" &&
    env.E2E_OFFER_SERVER_MODE === "production";
}

/** Production-mode fixtures must use the runner's opted-in local profile. */
export function isOfferSandboxRuntime(input: {
  env: NodeJS.ProcessEnv;
  root: string;
  backendOrigin: string | undefined;
}): boolean {
  const { env, root, backendOrigin } = input;
  if (!requestsOfferSandboxTerms(env) || env.E2E_ARMY !== "1" ||
    env.E2E_OFFER_SERVER_GUARD !== "1" || env.E2E_OFFER_BACKEND_ORIGIN !== backendOrigin) {
    return false;
  }
  const app = readExplicitLoopbackOrigin(env.E2E_OFFER_APP_ORIGIN);
  if (!app) return false;

  if (env.E2E_ARMY_SUITE === "offer") return backendOrigin === NATIVE_OFFER_BACKEND_ORIGIN;
  if (env.E2E_ARMY_SUITE !== "calc-v3" || env.E2E_CALC_V3_OWNED_STACK !== "1") return false;

  const backend = readExplicitLoopbackOrigin(backendOrigin);
  const runDirectory = env.E2E_OFFER_RUN_DIRECTORY;
  return Boolean(
    backend && backend.hostname === "127.0.0.1" &&
    !DEVELOPER_STACK_PORTS.has(backend.port) && app.port !== backend.port &&
    runDirectory && path.dirname(runDirectory) === path.resolve(root, ".e2e", "army", "offer", "runs") &&
    CALC_V3_RUN_NAME.test(path.basename(runDirectory))
  );
}
