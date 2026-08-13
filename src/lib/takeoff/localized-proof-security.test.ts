import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260813030000_require_localized_takeoff_proofs.sql"
  ),
  "utf8"
);
const takeoffServerSource = readFileSync(
  resolve(process.cwd(), "src/lib/takeoff/server.ts"),
  "utf8"
);

function functionBody(name: string) {
  const match = migrationSql.match(
    new RegExp(
      `create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`,
      "i"
    )
  );

  expect(match, `${name} must exist in the proof migration`).not.toBeNull();
  return match?.[0] ?? "";
}

function dpgfAuthorizedApplyBody() {
  const match = migrationSql.match(
    /create or replace function public\.apply_takeoff_job_guarded\(\s*p_job_id uuid,\s*p_strategy text,\s*p_target_section_id uuid,\s*p_dpgf_authorization_token text\s*\)[\s\S]*?\$\$;/i
  );

  expect(match, "the token-bound DPGF apply RPC must exist").not.toBeNull();
  return match?.[0] ?? "";
}

describe("Level C localized proof security", () => {
  it("rejects direct human verification without evidence and source page", () => {
    const body = functionBody("enforce_authenticated_takeoff_item_fields");

    expect(body).toMatch(/parent_level\s+public\.takeoff_job_level/i);
    expect(body).toMatch(/parent_level\s*=\s*'C'/i);
    expect(body).toMatch(/nullif\(btrim\(new\.evidence\), ''\) is null/i);
    expect(body).toMatch(/new\.source_page is null/i);
    expect(body).toMatch(/new\.source_page < 1/i);
    expect(body).toMatch(/'source_page'/i);
    expect(body).toMatch(/TAKEOFF_ITEM_VERIFICATION_PROOF_REQUIRED/i);
  });

  it("uses the same proof predicate for apply blocking and override coverage", () => {
    const body = functionBody("enforce_takeoff_apply_security");
    const evidenceChecks = body.match(
      /nullif\(btrim\(ti\.evidence\), ''\) is null/gi
    );
    const nullPageChecks = body.match(/ti\.source_page is null/gi);
    const invalidPageChecks = body.match(/ti\.source_page < 1/gi);

    expect(evidenceChecks).toHaveLength(2);
    expect(nullPageChecks).toHaveLength(2);
    expect(invalidPageChecks).toHaveLength(2);
    expect(body).toMatch(/TAKEOFF_APPLY_GUARD_FAILED/i);
    expect(body).toMatch(/takeoff_apply_override_consumptions/i);
  });

  it("keeps both guard functions unavailable as callable APIs", () => {
    expect(migrationSql).toMatch(
      /revoke all on function public\.enforce_authenticated_takeoff_item_fields\(\)\s+from public/i
    );
    expect(migrationSql).toMatch(
      /revoke all on function public\.enforce_takeoff_apply_security\(\)\s+from public/i
    );
  });

  it("recomputes the DPGF comparison before the normal server apply path", () => {
    const applyBody = takeoffServerSource.match(
      /export async function applyTakeoffJob\([\s\S]*?\n}\n\nexport async function/
    )?.[0];

    expect(applyBody).toBeDefined();
    expect(applyBody).toMatch(/hasTakeoffDpgfTargetLines/);
    expect(applyBody).toMatch(/fetchDpgfTakeoffComparison/);
    expect(applyBody).toMatch(/hasBlockingTakeoffDpgfExceptions/);
    expect(applyBody).toMatch(/guard: "dpgf_comparison"/);
    expect(applyBody).toMatch(/TAKEOFF_APPLY_GUARD_FAILED/);

    const patchIndex = applyBody?.indexOf("applyTakeoffItemPreApplyPatches") ?? -1;
    const comparisonIndex = applyBody?.indexOf("fetchDpgfTakeoffComparison") ?? -1;
    const authorizationIndex =
      applyBody?.indexOf("issueTakeoffDpgfApplyAuthorization") ?? -1;
    const rpcIndex = applyBody?.indexOf("invokeApplyTakeoffRpc") ?? -1;
    expect(patchIndex).toBeGreaterThan(-1);
    expect(comparisonIndex).toBeGreaterThan(patchIndex);
    expect(authorizationIndex).toBeGreaterThan(comparisonIndex);
    expect(rpcIndex).toBeGreaterThan(authorizationIndex);
  });

  it("uses a short-lived one-time hashed authorization for DPGF apply", () => {
    const directBody = functionBody("apply_takeoff_job_guarded");
    const authorizedBody = dpgfAuthorizedApplyBody();

    expect(migrationSql).toMatch(
      /create table if not exists public\.takeoff_apply_authorizations/i
    );
    expect(migrationSql).toMatch(
      /alter table public\.takeoff_apply_authorizations force row level security/i
    );
    expect(migrationSql).toMatch(
      /revoke all on table public\.takeoff_apply_authorizations\s+from public, anon, authenticated/i
    );
    expect(directBody).toMatch(/TAKEOFF_DPGF_APPLY_AUTHORIZATION_REQUIRED/i);
    expect(authorizedBody).toMatch(/security definer/i);
    expect(authorizedBody).toMatch(/authorization_token_hash\s*=\s*pg_catalog\.encode/i);
    expect(authorizedBody).toMatch(/permit\.tenant_id\s*=\s*job_tenant_id/i);
    expect(authorizedBody).toMatch(/permit\.job_id\s*=\s*p_job_id/i);
    expect(authorizedBody).toMatch(/permit\.estimate_version_id\s*=\s*job_version_id/i);
    expect(authorizedBody).toMatch(/permit\.user_id\s*=\s*caller_id/i);
    expect(authorizedBody).toMatch(/permit\.consumed_at is null/i);
    expect(authorizedBody).toMatch(/permit\.expires_at > statement_timestamp\(\)/i);
    expect(authorizedBody).toMatch(/for update/i);
    expect(authorizedBody).toMatch(/authorization_token_hash\s*=\s*null/i);
    expect(authorizedBody).toMatch(/consumed_at\s*=\s*statement_timestamp\(\)/i);
  });

  it("passes DPGF authorization only to the guarded RPC without a legacy fallback", () => {
    const invocation = takeoffServerSource.match(
      /async function invokeApplyTakeoffRpc\([\s\S]*?\n}\n\nasync function issueTakeoffDpgfApplyAuthorization/
    )?.[0];
    const tokenBranch = invocation?.match(
      /if \(input\.args\.dpgf_authorization_token\) \{[\s\S]*?\n  }/
    )?.[0];

    expect(invocation).toBeDefined();
    expect(tokenBranch).toMatch(/"apply_takeoff_job_guarded"/);
    expect(tokenBranch).toMatch(/p_dpgf_authorization_token/);
    expect(tokenBranch).not.toMatch(/"apply_takeoff_job"\s+as never/);
    expect(takeoffServerSource).toMatch(
      /authorization_token_hash:\s*toHexSha256\(authorizationToken\)/
    );
    expect(takeoffServerSource).toMatch(/Date\.now\(\) \+ 5 \* 60 \* 1000/);
  });

  it("accepts a corrected source page in the same verification patch", () => {
    expect(takeoffServerSource).toMatch(
      /entry\.fields\.source_page !== undefined[\s\S]*?entry\.fields\.source_page[\s\S]*?: typedItem\.source_page/
    );
    expect(takeoffServerSource).toMatch(
      /updatePayload\.source_page = entry\.fields\.source_page/
    );
  });
});
