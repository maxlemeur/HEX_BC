import path from "node:path";

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

// Lot 2, sous-lot 2.7 (conception §10.4, §14 « 2.7 » ; docs/testing/estimate-engine-v3-2.7.md §2) :
// les conditions bac à sable s'ouvrent aussi au build de production de la pile POSSÉDÉE du profil
// calc-v3 (ports libres tirés à chaque exécution), jamais avec un marqueur d'hébergement, jamais hors
// de ce profil, et jamais sur la pile longue des développeurs (45585, 33485), réservée au cas
// `offer`, inchangé. Isolation justifiée : un parcours ne peut ni poser un marqueur d'hébergement
// ni démarrer une pile sur 45585 (interdite à la campagne) pour prouver le refus.
// Revue 2.7 (docs/testing/estimate-engine-v3-2.7.md §12) : la pile doit être POSSÉDÉE, pas seulement
// hors des ports des développeurs. Le profil exige le marqueur positif du lanceur
// (`E2E_CALC_V3_OWNED_STACK=1`, posé par calc-v3-campaign.ts et transmis à l'application par
// calc-v3.config.ts) et le répertoire de sa campagne d'émission,
// `<racine>/.e2e/army/offer/runs/<horodatage>-calc-v3-<uuid>`. Sans eux, un build étiqueté calc-v3
// contre la pile CLI par défaut (54321) ou la pile possédée d'une autre session servait les
// conditions de travail.
const ownedCalcV3RunDirectory = path.resolve(
  ".e2e/army/offer/runs/2026-10-18T00-00-00-000Z-calc-v3-6f1c2a0e-8b4d-4c3e-9a71-2d5b8e0f4a13");
const ownedCalcV3Production = {
  NODE_ENV: "production",
  E2E_OFFER_SANDBOX_TERMS: "1",
  E2E_OFFER_SERVER_MODE: "production",
  E2E_ARMY: "1",
  E2E_ARMY_SUITE: "calc-v3",
  E2E_OFFER_SERVER_GUARD: "1",
  E2E_CALC_V3_OWNED_STACK: "1",
  E2E_OFFER_RUN_DIRECTORY: ownedCalcV3RunDirectory,
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54917",
  E2E_OFFER_BACKEND_ORIGIN: "http://127.0.0.1:54917",
  E2E_OFFER_APP_ORIGIN: "http://localhost:3127",
} as const;

function ownedCalcV3ProductionProfile() {
  for (const [name, value] of Object.entries(ownedCalcV3Production)) {
    vi.stubEnv(name, value);
  }
}

describe("development estimate terms on the owned calc-v3 production build", () => {
  beforeEach(() => {
    for (const name of [...Object.keys(ownedCalcV3Production), ...hostingMarkers]) {
      vi.stubEnv(name, undefined);
    }
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("admits the exact owned calc-v3 production profile without changing NODE_ENV", () => {
    ownedCalcV3ProductionProfile();
    expect(canUseDevelopmentEstimateTerms()).toBe(true);
    expect(process.env.NODE_ENV).toBe("production");
  });

  it.each(hostingMarkers)("refuses hosting marker %s even when empty", (name) => {
    ownedCalcV3ProductionProfile();
    vi.stubEnv(name, "");
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it.each(Object.keys(ownedCalcV3Production).filter((name) => name !== "NODE_ENV"))(
    "refuses an incomplete profile missing %s", (name) => {
      ownedCalcV3ProductionProfile();
      vi.stubEnv(name, undefined);
      expect(canUseDevelopmentEstimateTerms()).toBe(false);
    });

  it.each(["critical", "full", "dev", "calc-v3 ", "CALC-V3"])("refuses another campaign suite %j", (suite) => {
    ownedCalcV3ProductionProfile();
    vi.stubEnv("E2E_ARMY_SUITE", suite);
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it.each(["dev", "development", "production "])("refuses another server mode %j", (mode) => {
    ownedCalcV3ProductionProfile();
    vi.stubEnv("E2E_OFFER_SERVER_MODE", mode);
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it.each([
    "http://127.0.0.1:45585",
    "http://127.0.0.1:33485",
    "http://localhost:54917",
    "https://127.0.0.1:54917",
    "http://127.0.0.1",
    "http://127.0.0.1:54917/",
    "http://127.0.0.1:54917/rest",
    "http://127.0.0.1:54917?origin=owned",
    "http://127.0.0.1:54917@foreign.invalid",
    "http://2130706433:54917",
    "https://project.supabase.co",
  ])("refuses a backend outside the owned loopback stack %j", (origin) => {
    ownedCalcV3ProductionProfile();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin);
    vi.stubEnv("E2E_OFFER_BACKEND_ORIGIN", origin);
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it.each(["0", "true", "", " 1"])("refuses an owned-stack marker other than \"1\" %j", (marker) => {
    ownedCalcV3ProductionProfile();
    vi.stubEnv("E2E_CALC_V3_OWNED_STACK", marker);
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it("refuses the Supabase CLI default developer stack (54321) without the owned-stack marker", () => {
    ownedCalcV3ProductionProfile();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("E2E_OFFER_BACKEND_ORIGIN", "http://127.0.0.1:54321");
    vi.stubEnv("E2E_CALC_V3_OWNED_STACK", undefined);
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it.each([
    path.resolve(".e2e/army/offer/runs/2026-10-18T00-00-00-000Z-offer-6f1c2a0e-8b4d-4c3e-9a71-2d5b8e0f4a13"),
    path.resolve(".e2e/army/offer/runs/2026-10-18T00-00-00-000Z-calc-v3-not-a-uuid"),
    path.resolve(".e2e/army/offer/runs/nested/2026-10-18T00-00-00-000Z-calc-v3-6f1c2a0e-8b4d-4c3e-9a71-2d5b8e0f4a13"),
    path.resolve(".e2e/army/calc-v3/runs/2026-10-18T00-00-00-000Z-calc-v3-6f1c2a0e-8b4d-4c3e-9a71-2d5b8e0f4a13"),
    path.resolve("..", "other-session/.e2e/army/offer/runs/2026-10-18T00-00-00-000Z-calc-v3-6f1c2a0e-8b4d-4c3e-9a71-2d5b8e0f4a13"),
    ".e2e/army/offer/runs/2026-10-18T00-00-00-000Z-calc-v3-6f1c2a0e-8b4d-4c3e-9a71-2d5b8e0f4a13",
  ])("refuses a run directory outside the owned calc-v3 emission campaign %j", (directory) => {
    ownedCalcV3ProductionProfile();
    vi.stubEnv("E2E_OFFER_RUN_DIRECTORY", directory);
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it("refuses disagreement between the served backend and the admitted profile", () => {
    ownedCalcV3ProductionProfile();
    vi.stubEnv("E2E_OFFER_BACKEND_ORIGIN", "http://127.0.0.1:54918");
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it.each(["https://offer.example.invalid", "http://localhost:3127/", "http://localhost:54917"])(
    "refuses a hosted, misleading or backend application origin %j", (origin) => {
      ownedCalcV3ProductionProfile();
      vi.stubEnv("E2E_OFFER_APP_ORIGIN", origin);
      expect(canUseDevelopmentEstimateTerms()).toBe(false);
    });

  it("does not admit the owned profile in a test environment", () => {
    ownedCalcV3ProductionProfile();
    vi.stubEnv("NODE_ENV", "test");
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
  });

  it("keeps the offer case on the developers' native stack only (45585, unchanged)", () => {
    ownedCalcV3ProductionProfile();
    vi.stubEnv("E2E_ARMY_SUITE", "offer");
    expect(canUseDevelopmentEstimateTerms()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:45585");
    vi.stubEnv("E2E_OFFER_BACKEND_ORIGIN", "http://127.0.0.1:45585");
    expect(canUseDevelopmentEstimateTerms()).toBe(true);
  });
});
