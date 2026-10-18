import { randomUUID } from "node:crypto";

import type { Browser, Cookie } from "@e2e-dev/web";
import { createServerClient } from "@supabase/ssr";

import { querySql } from "./calculation-gate-support";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type DedicatedOwner = {
  tenantId: string; userId: string; email: string; uiMode: "simplified" | "expert";
  /** Engine of the tenant's policy row, `null` without a row (lot 2, sub-lot 2.10b). */
  calcPolicyEngine: 2 | null;
};

/**
 * A disposable owner for one journey on the owned loopback stack. The critical campaign shares one
 * account and one ARMY tenant between its two workers: per-tenant state (the v3 policy of V3P01) and
 * per-account state (the Expert UI mode of bulk-edit-sync-sources) must never change there. The
 * journey signs up its own account (self sign-up without confirmation, anon key only), renames its
 * personal tenant `ARMY <tag> <run>`, sets its UI mode as the native owner when asked, and swaps this
 * browser context's Supabase session cookies for it; the other contexts keep the campaign account.
 * The password never leaves this process and the session lives only in this context's cookies.
 *
 * Lot 2, sub-lot 2.10b (D-i, docs/testing/estimate-engine-v3-2.10.md): since M8 a tenant without a policy
 * row creates engine 3. A dedicated owner is a v1/v2 owner unless its journey says otherwise: its tenant gets
 * the explicit policy 2 (the per-tenant opt-out) from the policy's only writer, as service_role (P-13), before
 * the journey's first creation. A v3 journey opens its own policy-3 window (setTenantCalcPolicy);
 * `calcPolicy: "absent"` leaves the tenant without a row, the default of a new tenant (V3S01).
 */
export async function signUpDedicatedOwner(
  browser: Browser, appBaseUrl: string, runPrefix: string,
  role: { tag: string; uiMode?: "expert"; calcPolicy?: "absent" },
): Promise<DedicatedOwner> {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const app = new URL(appBaseUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) || backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST ||
    !anonKey || !/^http:\/\/localhost:\d+$/.test(app.origin) || !/^ARMY-[A-Za-z0-9-]{5,80}$/.test(runPrefix) ||
    !/^[A-Z0-9]{2,8}$/.test(role.tag)) {
    throw new Error("A dedicated owner requires the owned loopback stack and app (npm run e2e:army:local or e2e:army:ci).");
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
  const email = `${runPrefix.toLowerCase()}-${role.tag.toLowerCase()}-owner@example.test`;
  const { data, error } = await client.auth.signUp({ email, password: `Army-${randomUUID()}-A1!` });
  const userId = data.user?.id ?? "";
  if (error || !data.session || !UUID.test(userId)) throw new Error("The dedicated owner could not be signed up locally.");
  if (!written.some(cookie => !cookie.remove)) throw new Error("The dedicated owner session produced no cookie.");
  await browser.setCookies(written.map((cookie): Cookie => ({
    name: cookie.name, value: cookie.remove ? "" : cookie.value, url: app.origin, sameSite: "Lax",
    ...(cookie.remove ? { expires: 1 } : {}),
  })));
  const tag = `$army_${randomUUID().replaceAll("-", "")}$`;
  const output = await querySql(`BEGIN;
DO ${tag}
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Native owner identity differs'; END IF;
  UPDATE public.tenants t SET name = 'ARMY ${role.tag} ${runPrefix}'
  WHERE t.created_by = '${userId}' AND t.is_active AND t.id = (SELECT m.tenant_id FROM public.tenant_memberships m
    WHERE m.user_id = '${userId}' AND m.role = 'admin' AND m.is_default);
  IF NOT FOUND THEN RAISE EXCEPTION 'The dedicated owner must own its personal admin tenant'; END IF;
${role.uiMode ? `  UPDATE public.profiles SET ui_mode = '${role.uiMode}' WHERE id = '${userId}';
  IF NOT FOUND THEN RAISE EXCEPTION 'The dedicated owner has no profile'; END IF;
` : ""}END ${tag};
${role.calcPolicy === "absent" ? "" : `SET LOCAL ROLE service_role;
SELECT public.set_tenant_calc_policy(
  p_tenant_id => (SELECT m.tenant_id FROM public.tenant_memberships m WHERE m.user_id = '${userId}' AND m.role = 'admin' AND m.is_default),
  p_new_estimate_calc_engine => 2::smallint, p_default_sale_coefficient_fo => NULL, p_default_sale_coefficient_mo => NULL,
  p_allowed_tax_rates_bp => NULL, p_change_reason => 'ARMY ${role.tag} ${runPrefix}: dedicated v2 owner (2.10b D-i)',
  p_actor_user_id => '${userId}'::uuid);
RESET ROLE;
`}COMMIT;
SELECT jsonb_build_object(
  'tenants', (SELECT coalesce(jsonb_agg(m.tenant_id), '[]'::jsonb) FROM public.tenant_memberships m WHERE m.user_id = '${userId}'),
  'uiMode', (SELECT p.ui_mode FROM public.profiles p WHERE p.id = '${userId}'),
  'calcPolicyEngine', (SELECT p.new_estimate_calc_engine FROM public.tenant_calc_policies p JOIN public.tenant_memberships m
    ON m.tenant_id = p.tenant_id AND m.user_id = '${userId}'));
`);
  const { tenants, uiMode, calcPolicyEngine } = JSON.parse(output.at(-1) ?? "{}") as {
    tenants?: string[]; uiMode?: string; calcPolicyEngine?: number | null;
  };
  if (tenants?.length !== 1 || !UUID.test(tenants[0])) throw new Error("The dedicated owner must have exactly one tenant.");
  if (uiMode !== (role.uiMode ?? "simplified")) throw new Error("The dedicated owner's UI mode differs from the requested one.");
  if ((calcPolicyEngine ?? null) !== (role.calcPolicy === "absent" ? null : 2)) {
    throw new Error("The dedicated owner's calc policy differs from the requested one.");
  }
  return { tenantId: tenants[0], userId, email, uiMode, calcPolicyEngine: role.calcPolicy === "absent" ? null : 2 };
}
