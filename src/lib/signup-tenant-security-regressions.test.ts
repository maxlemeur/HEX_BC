import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationFile = "20260713132306_isolate_self_signup_tenants.sql";
const migrationsDirectory = path.resolve(process.cwd(), "supabase/migrations");
const migrationSql = fs.readFileSync(
  path.join(migrationsDirectory, migrationFile),
  "utf8"
);
const historicalBootstrapSql = fs.readFileSync(
  path.join(migrationsDirectory, "20260222194000_signup_membership_bootstrap.sql"),
  "utf8"
);

describe("self-signup tenant isolation", () => {
  it("supersedes the historical vulnerable trigger definition", () => {
    expect(historicalBootstrapSql).toMatch(/raw_user_meta_data->>'role'/i);
    expect(historicalBootstrapSql).toMatch(/where t\.slug = 'hydro-express'/i);

    const handleNewUserMigrations = fs
      .readdirSync(migrationsDirectory)
      .filter((fileName) => fileName.endsWith(".sql"))
      .sort()
      .filter((fileName) =>
        fs
          .readFileSync(path.join(migrationsDirectory, fileName), "utf8")
          .match(/create or replace function public\.handle_new_user\(\)/i)
      );

    expect(handleNewUserMigrations.at(-1)).toBe(migrationFile);
  });

  it("keeps profile bootstrap while creating a fresh isolated tenant", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.handle_new_user\(\)/i
    );
    expect(migrationSql).toMatch(/set search_path = ''/i);
    expect(migrationSql).toMatch(/insert into public\.profiles/i);
    expect(migrationSql).toMatch(
      /insert into public\.tenants[\s\S]*'signup-' \|\| new\.id::text[\s\S]*returning id into signup_tenant_id/i
    );
    expect(migrationSql).toMatch(
      /insert into public\.tenant_memberships[\s\S]*signup_tenant_id[\s\S]*new\.id[\s\S]*'admin'::public\.tenant_role[\s\S]*true/i
    );
  });

  it("does not trust signup metadata for authorization", () => {
    expect(migrationSql).not.toMatch(/raw_user_meta_data\s*->>\s*'role'/i);
    expect(migrationSql).not.toMatch(/raw_user_meta_data\s*->>\s*'tenant_id'/i);
    expect(migrationSql).not.toMatch(/membership_role/i);
  });

  it("cannot fall back to or attach the signup to an existing tenant", () => {
    expect(migrationSql).not.toMatch(/hydro-express/i);
    expect(migrationSql).not.toMatch(/from public\.tenants/i);
    expect(migrationSql).not.toMatch(/on conflict\s*\(slug\)/i);
    expect(migrationSql).not.toMatch(/on conflict\s*\(tenant_id\s*,\s*user_id\)/i);
  });

  it("does not expose the privileged trigger function as an RPC", () => {
    expect(migrationSql).toMatch(
      /revoke execute on function public\.handle_new_user\(\)\s+from public, anon, authenticated, service_role/i
    );
  });
});
