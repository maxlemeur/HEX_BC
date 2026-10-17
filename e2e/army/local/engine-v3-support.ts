import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { ArmyState } from "../critical/fixtures";
import { localSqlTransport } from "../takeoff/generated-prerequisites";

// Lot 2, sous-lot 2.1 : fixture v3 insérée par le propriétaire natif (postgres) de la pile
// possédée, sous le contrat d'écrivain v3, seul chemin de création d'une v3 avant 2.10
// (docs/testing/estimate-engine-v3-2.1.md). Elle ne vise jamais une pile partagée : le
// transport refuse toute origine hors boucle locale et exige la route fournie par le lanceur.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

async function querySql(sql: string) {
  const transport = localSqlTransport();
  return new Promise<string[]>((resolve, reject) => {
    const child = spawn(transport.executable, transport.args, { env: transport.environment, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.stdin.destroy(); child.kill(); }, 30_000);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-65_536); });
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

export type V3Fixture = {
  projectId: string;
  versionId: string;
  sectionId: string;
  lineId: string;
  title: string;
  tenantId: string;
  userId: string;
};

/**
 * Inserts ARMY-L2-V3-FIXTURE-<run>: one v3 draft in a project owned by the logged-in ARMY
 * account, one section and one line. The line inputs (2 × 22,50 €) would read as 45,00 € HT /
 * 54,00 € TTC through the v1 engine; the stored amounts are all zero. Since M4 (2.5) the v3
 * shape CHECK requires margin ×1, sale coefficients (1,30 / 1,20) and the three v3 amounts.
 */
export async function insertV3Fixture(army: ArmyState, owner: { projectId: string; tenantId: string; userId: string }): Promise<V3Fixture> {
  const fixture: V3Fixture = {
    ...owner,
    versionId: randomUUID(),
    sectionId: randomUUID(),
    lineId: randomUUID(),
    title: `ARMY-L2-V3-FIXTURE-${army.runPrefix}`,
  };
  if (![fixture.projectId, fixture.tenantId, fixture.userId].every(id => UUID.test(id))) {
    throw new Error("Invalid v3 fixture owner identity.");
  }
  const delimiter = `$army_${randomUUID().replaceAll("-", "")}$`;
  if (JSON.stringify(fixture).includes(delimiter)) throw new Error("v3 fixture SQL delimiter collision.");
  const output = await querySql(`BEGIN;
DO ${delimiter}
DECLARE ctx jsonb := ${literal(fixture)};
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Native owner identity differs'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.estimate_projects p
    JOIN public.tenants t ON t.id = p.tenant_id AND t.is_active AND t.name ~ '^ARMY\\y'
    WHERE p.id = (ctx->>'projectId')::uuid AND p.tenant_id = (ctx->>'tenantId')::uuid AND p.user_id = (ctx->>'userId')::uuid)
  THEN RAISE EXCEPTION 'The owned ARMY project identity differs'; END IF;
  INSERT INTO public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, title, margin_multiplier, tax_rate_bp,
    sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents, commercial_rounding_cents)
  SELECT (ctx->>'versionId')::uuid, p.tenant_id, p.id,
    coalesce((SELECT max(v.version_number) FROM public.estimate_versions v WHERE v.project_id = p.id), 0) + 1,
    'draft', 3, ctx->>'title', 1, 2000, 1.3, 1.2, 0, 0, 0
  FROM public.estimate_projects p WHERE p.id = (ctx->>'projectId')::uuid;
  PERFORM set_config('miaouffrage.estimate_v3_writer', ctx->>'versionId', true);
  INSERT INTO public.estimate_items (id, tenant_id, version_id, item_type, position, title)
  SELECT (ctx->>'sectionId')::uuid, v.tenant_id, v.id, 'section', 1, 'Lot ' || (ctx->>'title')
  FROM public.estimate_versions v WHERE v.id = (ctx->>'versionId')::uuid;
  INSERT INTO public.estimate_items (
    id, tenant_id, version_id, parent_id, item_type, position, title, description,
    quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
    pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents
  )
  SELECT (ctx->>'lineId')::uuid, v.tenant_id, v.id, (ctx->>'sectionId')::uuid, 'line', 1, 'Ligne ' || (ctx->>'title'), 'u',
    2, 2250, 2000, 1, 0, 1, 1, 0, 0, 0, 0
  FROM public.estimate_versions v WHERE v.id = (ctx->>'versionId')::uuid;
  PERFORM set_config('miaouffrage.estimate_v3_writer', '', true);
END ${delimiter};
COMMIT;
SELECT 'ARMY_V3_FIXTURE_COMMITTED';
`);
  if (!output.includes("ARMY_V3_FIXTURE_COMMITTED")) throw new Error("v3 fixture commit is ambiguous; no retry.");
  return fixture;
}

export type V3State = {
  engine: number;
  status: string;
  contentRevision: number;
  updatedAt: string;
  items: number;
  documents: number;
  emails: number;
  totals: [number, number, number];
};

/** Persisted state of the v3 fixture, read as the native owner. */
export async function readV3State(versionId: string): Promise<V3State> {
  if (!UUID.test(versionId)) throw new Error("Invalid v3 fixture identity.");
  const [row] = await querySql(`SELECT jsonb_build_object(
    'engine', v.calc_engine_version, 'status', v.status, 'contentRevision', v.content_revision, 'updatedAt', v.updated_at,
    'items', (SELECT count(*) FROM public.estimate_items i WHERE i.version_id = v.id),
    'documents', (SELECT count(*) FROM public.estimate_documents d WHERE d.version_id = v.id),
    'emails', (SELECT count(*) FROM public.estimate_emails e WHERE e.version_id = v.id),
    'totals', jsonb_build_array(v.total_ht_cents, v.total_tax_cents, v.total_ttc_cents))
  FROM public.estimate_versions v WHERE v.id = '${versionId}' AND current_user = 'postgres';
`);
  if (!row) throw new Error("The v3 fixture is missing.");
  return JSON.parse(row) as V3State;
}
