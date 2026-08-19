import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  extractCreatedFunctionNames,
  extractMentionedFunctionNames,
  inspectPgtapRpcCoverage,
  parsePgtapRpcBaseline,
  PGTAP_DATABASE_TESTS_DIRECTORY,
  PGTAP_RPC_BASELINE_PATH,
  stripSqlComments,
} from "@/test/pgtap-rpc-coverage";

const temporaryDirectories: string[] = [];

const FAMILY_FUNCTIONS = [
  "decide_estimate_approval",
  "open_estimate_review_cycle",
  "list_approval_queue",
  "claim_portal_estimate_decision",
  "apply_takeoff_job_guarded_atomic",
  "set_active_tenant_membership_default",
] as const;

const FAMILY_FILES = [
  "approvals-security-definer.test.sql",
  "portal-security-definer.test.sql",
  "takeoff-apply-security-definer.test.sql",
  "memberships-security-definer.test.sql",
] as const;

function createFixture(files: Record<string, string>) {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pgtap-rpc-coverage-"));
  temporaryDirectories.push(rootDirectory);
  for (const [relativePath, source] of Object.entries(files)) {
    const absolutePath = path.join(rootDirectory, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, source, "utf8");
  }
  return rootDirectory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("pgTAP RPC coverage guard", () => {
  it("extracts created function names and ignores comments", () => {
    expect(
      extractCreatedFunctionNames(`
        -- create function public.ignored_comment()
        /* create function public.ignored_block() */
        create or replace function public.decide_estimate_approval(
          p_approval_id uuid
        )
        returns void as $$ select 1 $$;
        create function private.assign_tenant_id() returns trigger as $$ begin return new; end; $$;
      `)
    ).toEqual(["assign_tenant_id", "decide_estimate_approval"]);
    expect(stripSqlComments("select 1 -- create function public.x()\n")).not.toMatch(
      /create function/i
    );
  });

  it("requires a whole-name mention before treating a function as covered", () => {
    expect(
      extractMentionedFunctionNames(
        "select public.apply_takeoff_job_guarded_atomic(id)",
        ["apply_takeoff_job", "apply_takeoff_job_guarded_atomic"]
      )
    ).toEqual(["apply_takeoff_job_guarded_atomic"]);
  });

  it("fails when a new RPC is missing from both pgTAP and the baseline", () => {
    const rootDirectory = createFixture({
      "supabase/migrations/20260819000000_new_rpc.sql":
        "create function public.new_unguarded_rpc() returns void as $$ select 1 $$;",
      "supabase/tests/database/existing.test.sql":
        "select public.decide_estimate_approval();",
      [PGTAP_RPC_BASELINE_PATH]: JSON.stringify({
        uncoveredFunctionNames: ["already_known_gap"],
      }),
    });

    const report = inspectPgtapRpcCoverage({ rootDirectory });
    expect(report.unguardedFunctionNames).toEqual(["new_unguarded_rpc"]);
  });

  it("accepts a new RPC that is either mentioned or listed in the baseline", () => {
    const rootDirectory = createFixture({
      "supabase/migrations/20260819000000_new_rpc.sql": `
        create function public.covered_rpc() returns void as $$ select 1 $$;
        create function public.baselined_rpc() returns void as $$ select 1 $$;
      `,
      "supabase/tests/database/covered.test.sql":
        "select public.covered_rpc();",
      [PGTAP_RPC_BASELINE_PATH]: JSON.stringify({
        uncoveredFunctionNames: ["baselined_rpc"],
      }),
    });

    const report = inspectPgtapRpcCoverage({ rootDirectory });
    expect(report.unguardedFunctionNames).toEqual([]);
    expect(report.mentionedFunctionNames).toEqual(["covered_rpc"]);
  });

  it("rejects a malformed baseline", () => {
    expect(() => parsePgtapRpcBaseline([])).toThrow("object");
    expect(() => parsePgtapRpcBaseline({})).toThrow("uncoveredFunctionNames");
  });

  it("keeps the repository baseline aligned with migrations and mentions", () => {
    const report = inspectPgtapRpcCoverage();

    expect(report.migrationFunctionNames.length).toBeGreaterThan(200);
    expect(report.unguardedFunctionNames).toEqual([]);
    expect(report.staleBaselineFunctionNames).toEqual([]);
    expect(report.mentionedFunctionNames).toEqual(
      expect.arrayContaining([...FAMILY_FUNCTIONS])
    );

    const testDirectory = path.join(process.cwd(), PGTAP_DATABASE_TESTS_DIRECTORY);
    for (const fileName of FAMILY_FILES) {
      expect(fs.existsSync(path.join(testDirectory, fileName))).toBe(true);
    }
  });
});
