import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { Browser, Cookie } from "@e2e-dev/web";
import { createServerClient } from "@supabase/ssr";

import { localSqlTransport } from "../takeoff/generated-prerequisites";

// Lot 2, sous-lot 2.5 : préalables SQL du parcours engine-v3-persistence
// (docs/testing/estimate-engine-v3-2.5.md §9). Seule la politique d'entreprise et la règle
// de marge de recette passent par le propriétaire natif de la pile possédée : la politique
// n'a aucun écrivain applicatif pendant le lot 2 (P-13 : service_role seulement) et la règle
// n'a qu'un écran d'administration hors sujet. Tout le reste passe par l'API de l'application.
// Le transport refuse toute origine hors boucle locale et exige la route fournie par le lanceur.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function querySql(sql: string) {
  const transport = localSqlTransport();
  return new Promise<string[]>((resolve, reject) => {
    const child = spawn(transport.executable, transport.args, { env: transport.environment, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.stdin.destroy(); child.kill(); }, 30_000);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-262_144); });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-65_536); });
    child.stdin.on("error", () => { /* The exit outcome reports a refused or closed SQL session. */ });
    child.once("error", () => { clearTimeout(timer); reject(new Error("Owned local SQL could not start; no retry.")); });
    child.once("close", code => {
      clearTimeout(timer);
      if (code !== 0 || timedOut) {
        // The transport runs psql with VERBOSITY=sqlstate: only the SQLSTATE is printed.
        const state = /ERROR:\s*([0-9A-Z]{5})\b/.exec(stderr)?.[1] ?? "none";
        reject(new Error(`Owned local SQL failed: exit=${code}, timeout=${timedOut}, SQLSTATE=${state}; no retry.`));
      } else resolve(stdout.split(/\r?\n/).filter(Boolean));
    });
    child.stdin.end(sql);
  });
}

export type V3Owner = { tenantId: string; userId: string };

function assertOwner(owner: V3Owner) {
  if (!UUID.test(owner.tenantId) || !UUID.test(owner.userId)) throw new Error("Invalid v3 persistence owner identity.");
}

/**
 * Dedicated owner of V3P01 (docs/testing/estimate-engine-v3-2.5.md §9.5, §10.2). The tenant policy is per
 * tenant and the critical campaign shares one ARMY tenant between its two workers: a policy-3 window there
 * makes every concurrent creation without an engine expectation fail with CONTEXT_CHANGED (observed on
 * V3FC02, 17/10/2026). V3P01 therefore signs up its own disposable account on the owned loopback stack
 * (self sign-up without confirmation, anon key only), renames its personal tenant `ARMY V3P <run>` and
 * swaps this browser context's Supabase session cookies for it; the other contexts keep the campaign
 * account. The password never leaves this process and the session lives only in this context's cookies.
 */
export async function useDedicatedV3Owner(browser: Browser, appBaseUrl: string, runPrefix: string): Promise<V3Owner & { email: string }> {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const app = new URL(appBaseUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) || backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST ||
    !anonKey || !/^http:\/\/localhost:\d+$/.test(app.origin) || !/^ARMY-[A-Za-z0-9-]{5,80}$/.test(runPrefix)) {
    throw new Error("The dedicated v3 owner requires the owned loopback stack and app.");
  }
  const current = await browser.cookies();
  const written: Array<{ name: string; value: string; remove: boolean }> = [];
  const client = createServerClient(backend.origin, anonKey, {
    cookies: {
      getAll: () => current.map(cookie => ({ name: cookie.name, value: cookie.value })),
      setAll: (cookies) => {
        for (const cookie of cookies) written.push({ name: cookie.name, value: cookie.value, remove: cookie.options?.maxAge === 0 });
      },
    },
  });
  const email = `${runPrefix.toLowerCase()}-v3p-owner@example.test`;
  const { data, error } = await client.auth.signUp({ email, password: `Army-${randomUUID()}-A1!` });
  const userId = data.user?.id ?? "";
  if (error || !data.session || !UUID.test(userId)) throw new Error("The dedicated v3 owner could not be signed up locally.");
  if (!written.some(cookie => !cookie.remove)) throw new Error("The dedicated v3 owner session produced no cookie.");
  await browser.setCookies(written.map((cookie): Cookie => ({
    name: cookie.name, value: cookie.remove ? "" : cookie.value, url: app.origin, sameSite: "Lax",
    ...(cookie.remove ? { expires: 1 } : {}),
  })));
  const tag = delimiter();
  const output = await querySql(`BEGIN;
DO ${tag}
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Native owner identity differs'; END IF;
  UPDATE public.tenants t SET name = 'ARMY V3P ${runPrefix}'
  WHERE t.created_by = '${userId}' AND t.is_active AND t.id = (SELECT m.tenant_id FROM public.tenant_memberships m
    WHERE m.user_id = '${userId}' AND m.role = 'admin' AND m.is_default);
  IF NOT FOUND THEN RAISE EXCEPTION 'The dedicated owner must own its personal admin tenant'; END IF;
END ${tag};
COMMIT;
SELECT coalesce(jsonb_agg(m.tenant_id), '[]'::jsonb) FROM public.tenant_memberships m WHERE m.user_id = '${userId}';
`);
  const tenants = JSON.parse(output.at(-1) ?? "[]") as string[];
  if (tenants.length !== 1 || !UUID.test(tenants[0])) throw new Error("The dedicated v3 owner must have exactly one tenant.");
  return { tenantId: tenants[0], userId, email };
}

// The owned ARMY tenant administered by the logged-in account, never another tenant.
const ownerGuard = (owner: V3Owner, delimiter: string) => `DO ${delimiter}
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Native owner identity differs'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t
    JOIN public.tenant_memberships m ON m.tenant_id = t.id AND m.user_id = '${owner.userId}' AND m.role = 'admin'
    WHERE t.id = '${owner.tenantId}' AND t.is_active AND t.name ~ '^ARMY\\y')
  THEN RAISE EXCEPTION 'The owned ARMY tenant identity differs'; END IF;
END ${delimiter};
`;

const delimiter = () => `$army_${randomUUID().replaceAll("-", "")}$`;

export const V3_VERSION_COLUMNS = [
  "sale_coefficient_fo", "sale_coefficient_mo", "gross_ht_cents", "discount_applied_cents", "commercial_rounding_cents",
] as const;
export const V3_ITEM_COLUMNS = [
  "unit_code", "pricing_status", "h_mo_per_unit", "h_mo_atelier_per_unit", "h_mo_chantier_per_unit",
  "snapshot_gross_ht_cents", "snapshot_gross_fo_ht_cents",
] as const;

export type V3PersistenceSchema = {
  policyTable: boolean;
  policyEvents: boolean;
  policyWriter: boolean;
  freezeV3: boolean;
  pricingStatusType: boolean;
  missingVersionColumns: string[];
  missingItemColumns: string[];
};

/** What M4 must have created on the owned stack (§6.2, §6.3, §7), read as the native owner. */
export async function probeV3PersistenceSchema(): Promise<V3PersistenceSchema> {
  const missing = (table: string, columns: readonly string[]) => `(SELECT coalesce(jsonb_agg(c ORDER BY c), '[]'::jsonb)
    FROM unnest(ARRAY[${columns.map(column => `'${column}'`).join(", ")}]::text[]) AS c
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns ic
      WHERE ic.table_schema = 'public' AND ic.table_name = '${table}' AND ic.column_name = c))`;
  const proc = (name: string) => `EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '${name}')`;
  const [row] = await querySql(`SELECT jsonb_build_object(
  'policyTable', to_regclass('public.tenant_calc_policies') IS NOT NULL,
  'policyEvents', to_regclass('public.tenant_calc_policy_events') IS NOT NULL,
  'policyWriter', ${proc("set_tenant_calc_policy")},
  'freezeV3', ${proc("freeze_estimate_v3_snapshot")},
  'pricingStatusType', to_regtype('public.estimate_line_pricing_status') IS NOT NULL,
  'missingVersionColumns', ${missing("estimate_versions", V3_VERSION_COLUMNS)},
  'missingItemColumns', ${missing("estimate_items", V3_ITEM_COLUMNS)})
WHERE current_user = 'postgres';
`);
  if (!row) throw new Error("The v3 persistence schema probe returned nothing.");
  return JSON.parse(row) as V3PersistenceSchema;
}

export type TenantCalcPolicy = {
  engine: number;
  fo: number | null;
  mo: number | null;
  allowedTaxRatesBp: number[];
  reason: string;
  events: number;
};

export async function readTenantCalcPolicy(owner: V3Owner): Promise<TenantCalcPolicy | null> {
  assertOwner(owner);
  const [row] = await querySql(`SELECT jsonb_build_object(
  'engine', p.new_estimate_calc_engine, 'fo', p.default_sale_coefficient_fo, 'mo', p.default_sale_coefficient_mo,
  'allowedTaxRatesBp', to_jsonb(p.allowed_tax_rates_bp), 'reason', p.change_reason,
  'events', (SELECT count(*) FROM public.tenant_calc_policy_events e WHERE e.tenant_id = p.tenant_id))
FROM public.tenant_calc_policies p WHERE p.tenant_id = '${owner.tenantId}' AND current_user = 'postgres';
`);
  return row ? JSON.parse(row) as TenantCalcPolicy : null;
}

/**
 * Sets the typed tenant policy as service_role, the only writer of lot 2 (P-13), through
 * public.set_tenant_calc_policy with named arguments (contract in the 2.5 E2E doc).
 */
export async function setTenantCalcPolicy(owner: V3Owner, input: { engine: 2 | 3; fo: string; mo: string; reason: string }) {
  assertOwner(owner);
  if (!/^\d\.\d{2}$/.test(input.fo) || !/^\d\.\d{2}$/.test(input.mo) || !/^ARMY-[A-Za-z0-9 :.,'()-]{5,200}$/.test(input.reason)) {
    throw new Error("Invalid tenant calc policy fixture input.");
  }
  const reason = input.reason.replaceAll("'", "''");
  await querySql(`BEGIN;
${ownerGuard(owner, delimiter())}
SET LOCAL ROLE service_role;
SELECT public.set_tenant_calc_policy(
  p_tenant_id => '${owner.tenantId}'::uuid,
  p_new_estimate_calc_engine => ${input.engine}::smallint,
  p_default_sale_coefficient_fo => ${input.fo}::numeric,
  p_default_sale_coefficient_mo => ${input.mo}::numeric,
  p_allowed_tax_rates_bp => '{2000,1000,550,210}'::integer[],
  p_change_reason => '${reason}'::text,
  p_actor_user_id => '${owner.userId}'::uuid);
RESET ROLE;
COMMIT;
`);
  const policy = await readTenantCalcPolicy(owner);
  if (!policy) throw new Error("The tenant calc policy was not persisted.");
  return policy;
}

/** A min_margin rule scoped to the owned affaire only (scope client = project id). */
export async function insertProjectMarginRule(owner: V3Owner, projectId: string, thresholdBp: number) {
  assertOwner(owner);
  if (!UUID.test(projectId) || !Number.isSafeInteger(thresholdBp) || thresholdBp <= 0 || thresholdBp > 10_000) {
    throw new Error("Invalid margin rule fixture input.");
  }
  const ruleId = randomUUID();
  const output = await querySql(`BEGIN;
${ownerGuard(owner, delimiter())}
INSERT INTO public.estimate_rules (id, tenant_id, rule_type, scope_type, scope_id, threshold_value, action, is_active)
SELECT '${ruleId}'::uuid, p.tenant_id, 'min_margin', 'client', p.id, ${thresholdBp}, 'require_approval', true
FROM public.estimate_projects p
WHERE p.id = '${projectId}' AND p.tenant_id = '${owner.tenantId}' AND p.user_id = '${owner.userId}';
COMMIT;
SELECT count(*) FROM public.estimate_rules WHERE id = '${ruleId}' AND scope_id = '${projectId}';
`);
  if (output.at(-1) !== "1") throw new Error("The project margin rule was not persisted.");
  return ruleId;
}

/**
 * A completed takeoff job of an owned v3 (review of 2.5, §10.5): the worker state cannot be forged by an
 * operator and the dedicated owner has no plan to upload. Only the job row is written, for a version of
 * the owned affaire whose engine is 3; the application is then asked to apply it through its API.
 */
export async function insertCompletedTakeoffJob(owner: V3Owner, versionId: string) {
  assertOwner(owner);
  if (!UUID.test(versionId)) throw new Error("Invalid takeoff job fixture input.");
  const jobId = randomUUID();
  const output = await querySql(`BEGIN;
${ownerGuard(owner, delimiter())}
INSERT INTO public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, source_file_type,
  source_file_size_bytes, schema_version, started_at, completed_at)
SELECT '${jobId}'::uuid, v.tenant_id, v.id, 'A', 'completed', 'ARMY-v3p.csv', 'text/csv', 512, 'v1', now(), now()
FROM public.estimate_versions v JOIN public.estimate_projects p ON p.id = v.project_id AND p.tenant_id = v.tenant_id
WHERE v.id = '${versionId}' AND v.tenant_id = '${owner.tenantId}' AND p.user_id = '${owner.userId}' AND v.calc_engine_version = 3;
COMMIT;
SELECT count(*) FROM public.takeoff_jobs WHERE id = '${jobId}' AND estimate_version_id = '${versionId}';
`);
  if (output.at(-1) !== "1") throw new Error("The owned v3 takeoff job was not persisted.");
  return jobId;
}
