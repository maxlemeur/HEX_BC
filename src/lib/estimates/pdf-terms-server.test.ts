import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// PRECODE: promote this file before implementing the absent server predicate.
// ENV/URL admission only. No database, query, network or production fixtures.
import { canUseDevelopmentEstimateTerms } from "@/lib/estimates/pdf-terms-server";

const localProduction = {
  NODE_ENV: "production",
  E2E_OFFER_SANDBOX_TERMS: "1",
  E2E_OFFER_SERVER_MODE: "production",
  E2E_ARMY: "1",
  E2E_ARMY_SUITE: "offer",
  E2E_OFFER_SERVER_GUARD: "1",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:45585",
  E2E_OFFER_BACKEND_ORIGIN: "http://127.0.0.1:45585",
  E2E_OFFER_APP_ORIGIN: "http://localhost:3176",
} as const;

const hostingMarkers = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_TARGET_ENV"] as const;

function productionProfile() {
  for (const [name, value] of Object.entries(localProduction)) {
    vi.stubEnv(name, value);
  }
}

describe("development estimate terms production sandbox boundary", () => {
  beforeEach(() => {
    for (const name of [...Object.keys(localProduction), ...hostingMarkers]) {
      vi.stubEnv(name, undefined);
    }
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses ordinary production without an explicit owned profile", () => {
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it("admits the exact opted-in native profile without changing NODE_ENV", () => {
    productionProfile();
    expect(canUseDevelopmentEstimateTerms()).toBe(true);
    expect(process.env.NODE_ENV).toBe("production");
  });

  it.each([
    "E2E_OFFER_SANDBOX_TERMS",
    "E2E_OFFER_SERVER_MODE",
    "E2E_ARMY",
    "E2E_ARMY_SUITE",
    "E2E_OFFER_SERVER_GUARD",
    "NEXT_PUBLIC_SUPABASE_URL",
    "E2E_OFFER_BACKEND_ORIGIN",
    "E2E_OFFER_APP_ORIGIN",
  ])("refuses an incomplete profile missing %s", (name) => {
    productionProfile();
    vi.stubEnv(name, undefined);
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it.each(["true", "yes", "1 ", "0", ""])("refuses ambiguous opt-in %j", (value) => {
    productionProfile();
    vi.stubEnv("E2E_OFFER_SANDBOX_TERMS", value);
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it.each([
    "https://127.0.0.1:45585",
    "http://localhost:45585",
    "http://127.0.0.1:45586",
    "http://127.0.0.1:45585/",
    "http://127.0.0.1:45585/path",
    "http://127.0.0.1:45585?origin=local",
    "http://127.0.0.1:45585#local",
    "http://127.0.0.1:45585@foreign.invalid",
    "http://127.0.0.1:45585.foreign.invalid",
    "http://2130706433:45585",
    "http://0x7f000001:45585",
  ])("refuses a foreign or normalized backend alias %j", (origin) => {
    productionProfile();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin);
    vi.stubEnv("E2E_OFFER_BACKEND_ORIGIN", origin);
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it("refuses disagreement between the backend and admitted profile", () => {
    productionProfile();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://foreign.invalid");
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it.each([
    "https://offer.example.invalid",
    "http://offer.example.invalid:3176",
    "https://localhost:3176",
    "http://localhost:0",
    "http://localhost:3176/",
    "http://localhost:3176@foreign.invalid",
    "http://localhost:3176?profile=owned",
    "http://localhost:3176#profile",
  ])("refuses hosted or misleading application origin %j", (origin) => {
    productionProfile();
    vi.stubEnv("E2E_OFFER_APP_ORIGIN", origin);
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it.each(hostingMarkers)("refuses hosting marker %s even when empty", (name) => {
    productionProfile();
    vi.stubEnv(name, "");
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it("refuses VERCEL=0 rather than treating it as proof of locality", () => {
    productionProfile();
    vi.stubEnv("VERCEL", "0");
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it("retains ordinary local development behavior", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(canUseDevelopmentEstimateTerms()).toBe(true);
  });

  it("refuses Vercel even when NODE_ENV says development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "1");
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it("does not admit the sandbox in a test environment", () => {
    productionProfile();
    vi.stubEnv("NODE_ENV", "test");
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });
});
