import path from "node:path";

// Seeded-fixture journeys were written against the isolated audit stack
// 127.0.0.1:59827. The calc-v3 owned ephemeral stack (run-tester-army-ci.ts
// calc-v3) allocates its API port per run, so these journeys accept it only
// when that runner marked the environment and the coverage origin names the
// same loopback backend. The developers' long-running stack is never accepted.
const AUDIT_STACK_ORIGIN = "http://127.0.0.1:59827";
const LONG_RUNNING_STACK_PORTS = new Set(["45585", "33485"]);
// Not an origin: equal to no configured backend nor any fixture apiUrl, so the
// journeys' existing precondition checks fail closed.
const NO_ISOLATED_BACKEND = "no-isolated-local-backend";

/** The explicit isolated backend a seeded fixture must belong to. */
export function isolatedLocalBackend(): string {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (configured === AUDIT_STACK_ORIGIN) return configured;
  if (process.env.E2E_CALC_V3_OWNED_STACK !== "1" || !configured || configured !== process.env.E2E_COVERAGE_BACKEND_ORIGIN) return NO_ISOLATED_BACKEND;
  const port = /^http:\/\/127\.0\.0\.1:([0-9]{2,5})$/.exec(configured)?.[1];
  return port && !LONG_RUNNING_STACK_PORTS.has(port) ? configured : NO_ISOLATED_BACKEND;
}

/**
 * The per-run SDK output root a seeded journey reads its own downloads from:
 * the audit recipe's `.e2e/product-foundation/runs`, or the calc-v3 campaign's
 * `.e2e/army/calc-v3/runs` only when isolatedLocalBackend() accepts its owned stack.
 */
export function isolatedRunsRoot(): string {
  const ownedCalcV3 = process.env.NEXT_PUBLIC_SUPABASE_URL !== AUDIT_STACK_ORIGIN && isolatedLocalBackend() !== NO_ISOLATED_BACKEND;
  return path.resolve(ownedCalcV3 ? ".e2e/army/calc-v3/runs" : ".e2e/product-foundation/runs");
}
