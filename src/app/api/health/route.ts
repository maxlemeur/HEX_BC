import { NextResponse } from "next/server";

import packageMetadata from "../../../../package.json";

export const dynamic = "force-dynamic";

export type HealthPayload = {
  ok: boolean;
  version: string;
  db: "up" | "down";
};

const DB_PING_TIMEOUT_MS = 2_500;
// Anonymous liveness probe: throttle the upstream ping so an uptime monitor
// (or a scraper) cannot turn this route into a free request amplifier.
const PING_CACHE_TTL_MS = 5_000;

let lastPing: { at: number; status: "up" | "down" } | null = null;

// A five-character SQLSTATE in the error body proves PostgREST completed a
// round trip to PostgreSQL (e.g. 42501 permission denied, which is the expected
// answer for the anon role on a tenant table). PostgREST-level codes (PGRST001
// "could not connect") deliberately do not match.
const SQLSTATE_CODE = /^[0-9][0-9A-Z]{4}$/;

/**
 * Probes the Supabase data API with the anon key. The project answers `up` when
 * the request either succeeds or comes back with a genuine PostgreSQL error:
 * both prove the gateway, PostgREST and the database are reachable. A rejected
 * key, a timeout, a network failure or a PostgREST connection error are all
 * reported as `down` — nothing is treated as "up" by default.
 */
async function pingDatabase(
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now
): Promise<"up" | "down"> {
  if (lastPing && now() - lastPing.at < PING_CACHE_TTL_MS) {
    return lastPing.status;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  let status: "up" | "down" = "down";

  if (url && key) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DB_PING_TIMEOUT_MS);
    try {
      const response = await fetchImpl(
        `${url.replace(/\/+$/, "")}/rest/v1/tenants?select=id&limit=1`,
        {
          method: "GET",
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          cache: "no-store",
          signal: controller.signal,
        }
      );
      if (response.ok) {
        status = "up";
      } else {
        const body = (await response.json().catch(() => null)) as {
          code?: unknown;
        } | null;
        status =
          typeof body?.code === "string" && SQLSTATE_CODE.test(body.code)
            ? "up"
            : "down";
      }
    } catch {
      status = "down";
    } finally {
      clearTimeout(timeout);
    }
  }

  lastPing = { at: now(), status };
  return status;
}

export function resetHealthProbeCacheForTests() {
  lastPing = null;
}

export async function GET() {
  const db = await pingDatabase();
  const body: HealthPayload = {
    ok: db === "up",
    version: packageMetadata.version,
    db,
  };
  return NextResponse.json(body, {
    status: db === "up" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
