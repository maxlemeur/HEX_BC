import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationFile = "20260713135334_harden_active_tenant_and_profile_rls.sql";
const migrationSql = fs.readFileSync(
  path.resolve(process.cwd(), "supabase/migrations", migrationFile),
  "utf8"
);
const historicalTenantSql = fs.readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/013_multitenant_core_s5.sql"),
  "utf8"
);
const membershipServerSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/memberships/server.ts"),
  "utf8"
);

function functionBody(sql: string, functionName: string) {
  const match = sql.match(
    new RegExp(
      `create or replace function public\\.${functionName}\\([^]*?\\n\\$\\$;`,
      "i"
    )
  );

  expect(match, `${functionName} must be defined`).not.toBeNull();
  return match?.[0] ?? "";
}

describe("active tenant and profile RLS security", () => {
  it("supersedes the inactive-blind tenant authorization helpers", () => {
    const historicalMemberHelper = functionBody(
      historicalTenantSql,
      "is_tenant_member"
    );
    const historicalRoleHelper = functionBody(historicalTenantSql, "has_tenant_role");

    expect(historicalMemberHelper).not.toMatch(/is_active/i);
    expect(historicalRoleHelper).not.toMatch(/is_active/i);

    expect(functionBody(migrationSql, "current_tenant_id")).toMatch(
      /join public\.tenants t[\s\S]*t\.is_active/i
    );
    expect(functionBody(migrationSql, "is_tenant_member")).toMatch(
      /from public\.tenants t[\s\S]*t\.id = target_tenant_id[\s\S]*t\.is_active[\s\S]*from public\.tenant_memberships tm/i
    );
    expect(functionBody(migrationSql, "has_tenant_role")).toMatch(
      /from public\.tenants t[\s\S]*t\.id = target_tenant_id[\s\S]*t\.is_active[\s\S]*tm\.role = any\(allowed_roles\)/i
    );
  });

  it("restricts profile reads to self, global admin, or a shared active tenant", () => {
    const profileHelper = functionBody(migrationSql, "can_view_profile");

    expect(profileHelper).toMatch(/target_user_id = \(select auth\.uid\(\)\)/i);
    expect(profileHelper).toMatch(/or \(select public\.is_admin_user\(\)\)/i);
    expect(profileHelper).toMatch(
      /from public\.tenant_memberships actor[\s\S]*join public\.tenant_memberships subject[\s\S]*join public\.tenants t[\s\S]*actor\.user_id = \(select auth\.uid\(\)\)[\s\S]*subject\.user_id = target_user_id[\s\S]*t\.is_active/i
    );
    expect(migrationSql).toMatch(
      /drop policy if exists "Profiles are viewable by authenticated users" on public\.profiles/i
    );
    expect(migrationSql).toMatch(
      /create policy "Profiles are viewable in active tenant scope"[\s\S]*on public\.profiles[\s\S]*for select[\s\S]*to authenticated[\s\S]*using \(\(select public\.can_view_profile\(id\)\)\)/i
    );
    expect(migrationSql).not.toMatch(/using \(true\)/i);
  });

  it("keeps the security-definer helpers on a fixed search path", () => {
    for (const helper of [
      "current_tenant_id",
      "is_tenant_member",
      "has_tenant_role",
      "can_view_profile",
    ]) {
      expect(functionBody(migrationSql, helper)).toMatch(/set search_path = ''/i);
    }

    expect(migrationSql).toMatch(
      /revoke execute on function public\.can_view_profile\(uuid\) from public, anon/i
    );
    expect(migrationSql).toMatch(
      /grant execute on function public\.can_view_profile\(uuid\) to authenticated/i
    );
  });

  it("keeps directory lookup server-controlled after profile RLS is narrowed", () => {
    expect(membershipServerSource).toMatch(
      /import \{ createServiceRoleClient \} from "@\/lib\/supabase\/service-role"/
    );
    expect(membershipServerSource).toMatch(
      /async function listCandidates[\s\S]*const directoryClient = createServiceRoleClient\(\);[\s\S]*directoryClient[\s\S]*\.from\("profiles"\)/
    );
    expect(membershipServerSource).toMatch(
      /export async function createMembership[\s\S]*const directoryClient = createServiceRoleClient\(\);[\s\S]*directoryClient[\s\S]*\.from\("profiles"\)/
    );
  });

  it("rejects inactive current tenants before membership administration", () => {
    expect(membershipServerSource).toMatch(
      /async function getCurrentMembershipOrThrow[\s\S]*await getTenantOrThrow\(supabase, membership\.tenant_id\);[\s\S]*return membership;/
    );
  });
});
