import { randomUUID } from "node:crypto";

import { expect } from "e2e";

import type { StoredTotals } from "../critical/version-totals-support";
import { querySql } from "./calculation-gate-support";

// A legacy V1 draft on the owned local stack, for the version-totals journeys (V1PT01, V1BT01 to V1BT03).
// The public creation schema only makes V2 drafts, so the V1 draft is inserted in SQL by the native
// owner of the owned stack, as engine-v3-fail-closed does for v3: fixed margin x1, 20 % VAT, no
// discount, no rounding, one section and one line whose stored totals are given consistent.
export type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
export type V1Draft = { projectId: string; versionId: string; sectionId: string; lineId: string; title: string };
export type LegacyV1Line = {
  title: string; description: string | null; productId: string | null;
  lineNature: "supply_only" | "supply_and_labor";
  quantity: number; unitPriceCents: number; hMo: number; laborRoleId: string | null; puHtCents: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

export function assertOwnedLocalBackend() {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) || backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST ||
    !process.env.E2E_ARMY_LOCAL_DB_URL) {
    throw new Error("The legacy V1 draft requires the owned local Supabase stack and its SQL route.");
  }
}

export async function createdData<T>(response: { status: number; body: Envelope<T> }) {
  // A refusal names its code (409 alone: LOCK_REQUIRED, CONFLICT, CONTEXT_CHANGED…).
  expect([200, 201], `HTTP ${response.status} ${response.body.error?.code ?? "without error code"}`).toContain(response.status);
  expect(response.body.ok).toBe(true);
  return response.body.data;
}

export async function insertLegacyV1Draft(
  owner: { projectId: string; tenantId: string; userId: string },
  line: LegacyV1Line,
  seeded: StoredTotals,
): Promise<V1Draft> {
  const draft = { projectId: owner.projectId, versionId: randomUUID(), sectionId: randomUUID(), lineId: randomUUID(), title: `${line.title} V1` };
  const context = { ...line, ...owner, ...draft, lineTitle: line.title };
  if (![owner.projectId, owner.tenantId, owner.userId].every((id) => UUID.test(id)) ||
    ![line.productId, line.laborRoleId].every((id) => id === null || UUID.test(id))) {
    throw new Error("Invalid legacy V1 draft identity.");
  }
  if (![line.unitPriceCents, line.puHtCents, ...seeded].every(Number.isSafeInteger) ||
    ![line.quantity, line.hMo].every(Number.isFinite)) {
    throw new Error("Invalid legacy V1 draft amounts.");
  }
  const delimiter = `$army_${randomUUID().replaceAll("-", "")}$`;
  if (JSON.stringify(context).includes(delimiter)) throw new Error("Legacy V1 draft SQL delimiter collision.");
  const output = await querySql(`BEGIN;
DO ${delimiter}
DECLARE ctx jsonb := ${literal(context)};
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Native owner identity differs'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.estimate_projects p
    JOIN public.tenants t ON t.id = p.tenant_id AND t.is_active AND t.name ~ '^ARMY\\y'
    WHERE p.id = (ctx->>'projectId')::uuid AND p.tenant_id = (ctx->>'tenantId')::uuid AND p.user_id = (ctx->>'userId')::uuid)
  THEN RAISE EXCEPTION 'The owned ARMY project identity differs'; END IF;
  IF ctx->>'productId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.products a
    WHERE a.id = (ctx->>'productId')::uuid AND a.tenant_id = (ctx->>'tenantId')::uuid)
  THEN RAISE EXCEPTION 'The owned ARMY article identity differs'; END IF;
  IF ctx->>'laborRoleId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.labor_roles r
    WHERE r.id = (ctx->>'laborRoleId')::uuid AND r.tenant_id = (ctx->>'tenantId')::uuid AND r.is_active)
  THEN RAISE EXCEPTION 'The owned ARMY labour role identity differs'; END IF;
  INSERT INTO public.estimate_versions (
    id, tenant_id, project_id, version_number, status, calc_engine_version, title, currency,
    margin_mode, margin_multiplier, margin_bp, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents,
    discount_bp, discount_mode, discount_steps, contractor_role, max_section_depth,
    total_ht_cents, total_tax_cents, total_ttc_cents
  )
  SELECT (ctx->>'versionId')::uuid, p.tenant_id, p.id,
    coalesce((SELECT max(v.version_number) FROM public.estimate_versions v WHERE v.project_id = p.id), 0) + 1,
    'draft', 1, ctx->>'title', 'EUR', 'fixed', 1, 0, 1, 2000, 'none', 1, 0, 'simple', '{}', 'principal', 1,
    ${seeded[0]}, ${seeded[1]}, ${seeded[2]}
  FROM public.estimate_projects p WHERE p.id = (ctx->>'projectId')::uuid;
  INSERT INTO public.estimate_items (id, tenant_id, version_id, item_type, position, title)
  SELECT (ctx->>'sectionId')::uuid, v.tenant_id, v.id, 'section', 0, 'Lot ' || (ctx->>'title')
  FROM public.estimate_versions v WHERE v.id = (ctx->>'versionId')::uuid;
  INSERT INTO public.estimate_items (
    id, tenant_id, version_id, parent_id, item_type, line_nature, position, title, description, product_id,
    quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, labor_role_id,
    pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents
  )
  SELECT (ctx->>'lineId')::uuid, v.tenant_id, v.id, (ctx->>'sectionId')::uuid, 'line', (ctx->>'lineNature')::public.estimate_line_nature, 1,
    ctx->>'lineTitle', ctx->>'description', (ctx->>'productId')::uuid,
    (ctx->>'quantity')::numeric, (ctx->>'unitPriceCents')::integer, 2000, 1, (ctx->>'hMo')::numeric, 1, 1,
    (ctx->>'laborRoleId')::uuid, (ctx->>'puHtCents')::integer, ${seeded[0]}, ${seeded[1]}, ${seeded[2]}
  FROM public.estimate_versions v WHERE v.id = (ctx->>'versionId')::uuid;
END ${delimiter};
COMMIT;
SELECT 'ARMY_LEGACY_V1_DRAFT_COMMITTED';
`);
  if (!output.includes("ARMY_LEGACY_V1_DRAFT_COMMITTED")) throw new Error("Legacy V1 draft commit is ambiguous; no retry.");
  return draft;
}
