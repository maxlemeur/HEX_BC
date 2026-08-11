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
const tenantContextSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/auth/tenant-context.ts"),
  "utf8"
);
const authServerSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/auth/server.ts"),
  "utf8"
);
const activeBoundaryMigrationSql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20260811212848_enforce_active_tenant_boundaries.sql"
  ),
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

function productionSourceFiles(directory = path.resolve(process.cwd(), "src")): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path
      .relative(process.cwd(), absolutePath)
      .replaceAll("\\", "/");

    if (entry.isDirectory()) {
      if (relativePath === "src/test") continue;
      files.push(...productionSourceFiles(absolutePath));
      continue;
    }

    if (
      entry.isFile() &&
      /\.(?:ts|tsx)$/.test(entry.name) &&
      !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)
    ) {
      files.push(absolutePath);
    }
  }

  return files;
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
    expect(tenantContextSource).toMatch(/tenants!inner\(is_active\)/);
    expect(tenantContextSource).toMatch(/\.eq\("tenants\.is_active", true\)/);
    expect(membershipServerSource).toMatch(
      /readActiveTenantMembership\(supabase, user\.id\)/
    );
    expect(authServerSource).toMatch(
      /readActiveTenantMembership\(supabase, userId\)/
    );
    expect(activeBoundaryMigrationSql).toMatch(
      /create policy "Users can view memberships in own tenants"[\s\S]*is_tenant_member\(tenant_id\)[\s\S]*has_tenant_role/i
    );
  });

  it("keeps public portal capabilities behind the active tenant lock", () => {
    const portalDecision = functionBody(
      activeBoundaryMigrationSql,
      "claim_portal_estimate_decision"
    );

    expect(portalDecision).toMatch(
      /join public\.tenants t on t\.id = ev\.tenant_id[\s\S]*t\.is_active[\s\S]*for update of ev, t/i
    );
    expect(activeBoundaryMigrationSql).toMatch(
      /revoke all on function public\.claim_portal_estimate_decision\(uuid, text, inet, text\)[\s\S]*from public, anon, authenticated/i
    );
    expect(activeBoundaryMigrationSql).toMatch(
      /grant execute on function public\.claim_portal_estimate_decision\(uuid, text, inet, text\)[\s\S]*to service_role/i
    );
  });

  it("keeps authenticated context imports out of the estimates god-module", () => {
    const offenders = productionSourceFiles()
      .filter((file) =>
        /import\s*{[^}]*\bgetAuthenticatedContext\b[^}]*}\s*from\s*["']@\/lib\/estimates\/server["']/.test(
          fs.readFileSync(file, "utf8")
        )
      )
      .map((file) => path.relative(process.cwd(), file).replaceAll("\\", "/"));

    expect(offenders).toEqual([]);
  });

  it("centralizes service-role client construction and never relays its key", () => {
    const canonicalFactory = path.resolve(
      process.cwd(),
      "src/lib/supabase/service-role.ts"
    );
    const directFactories = productionSourceFiles()
      .filter((file) => file !== canonicalFactory)
      .filter((file) => {
        const source = fs.readFileSync(file, "utf8");
        return (
          source.includes("SUPABASE_SERVICE_ROLE_KEY") &&
          /import\s*{[^}]*\bcreateClient\b[^}]*}\s*from\s*["']@supabase\/supabase-js["']/.test(
            source
          )
        );
      })
      .map((file) => path.relative(process.cwd(), file).replaceAll("\\", "/"));

    expect(directFactories).toEqual([]);

    const workerSources = [
      "src/lib/takeoff/async-worker.ts",
      "src/app/api/internal/takeoff/process-job/route.ts",
      "supabase/functions/process_takeoff_job/index.ts",
    ].map((file) => fs.readFileSync(path.resolve(process.cwd(), file), "utf8"));

    expect(workerSources.join("\n")).not.toContain("x-supabase-service-role-key");
    expect(workerSources[0]).toMatch(
      /import \{ createServiceRoleClient \} from "@\/lib\/supabase\/service-role"/
    );
  });

  it("keeps src/proxy.ts as the only Next.js session boundary", () => {
    const legacyMiddleware = path.resolve(process.cwd(), "middleware.ts");
    const proxySource = fs.readFileSync(
      path.resolve(process.cwd(), "src/proxy.ts"),
      "utf8"
    );

    expect(fs.existsSync(legacyMiddleware)).toBe(false);
    expect(proxySource).toMatch(/export async function proxy\(/);
    expect(proxySource).toMatch(/!user && pathname\.startsWith\("\/dashboard"\)/);
    expect(proxySource).toMatch(/user && \(pathname === "\/login" \|\| pathname === "\/signup"\)/);
  });
});
