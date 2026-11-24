import { describe, expect, it } from "vitest";

import { buildSourceEvidence } from "../../scripts/tester-army/local-recipe-common.mjs";

// The Supabase CLI starts every owned stack with the database password "postgres" (its default, the
// `postgres:postgres@` of every DB_URL fixture). scripts/run-tester-army-ci.ts registers that password in
// knownSecrets, and its privacy check refuses any evidence file containing it. The run manifest
// (`source.inputs`) and the build manifest (`inputs`) list every build-source path: a single path containing
// "postgres" fails every critical, full and calc-v3 job after its journeys pass (PR #530, run 45438955974).
const OWNED_STACK_DATABASE_PASSWORD = "postgres";

describe("TesterArmy source evidence", () => {
  it("names no build-source path that contains the owned stack's database password", async () => {
    const { inputs } = await buildSourceEvidence();
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.map((input: { path: string }) => input.path)
      .filter((file: string) => file.includes(OWNED_STACK_DATABASE_PASSWORD))).toEqual([]);
  });
});
