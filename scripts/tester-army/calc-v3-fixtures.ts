import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../src/types/database";
import { CALC_V3_FORBIDDEN_PORTS, type CalcV3Phase } from "./calc-v3-phases";

// Seeds, on the owned ephemeral stack only, the prerequisites that the wired
// lot 2 baseline journeys read from explicit fixture files. Each fixture keeps
// the exact shape and oracle of the seed its journey was qualified with
// (docs/testing/tester-army-calc-v3.md lists them); none inserts a final
// result, application, snapshot, parent line or human decision.
// Failure modes fixed before this module:
// - a fixture lands on another stack: the PostgreSQL route must be the owned
//   loopback host, never port 45585/33485, and the SQL runs as the native owner;
// - a partial fixture is used: every phase plan is one transaction with an
//   exact per-row readback, and a failure leaves nothing for the journey;
// - an identity is reused across runs: every identity is a new UUID;
// - credentials leak into fixture files: files hold identities only, logins
//   travel through the journey environment and are registered for redaction;
// - generated proposals written through REST: refused by
//   private.guard_generated_ouvrage_write (docs/testing/generated-review-prerequisites.md),
//   so they are written by the native owner, like the reviewed component recipe.

type Row = Record<string, unknown>;
type PlanRecord = { table: string; row: Row };
export type CalcV3Owner = { userId: string; tenantId: string; laborRoleId: string };
export type CalcV3FixtureContext = {
  /** Fresh directory owned by this campaign; fixture files contain identities only. */
  directory: string;
  backend: string;
  anonKey: string;
  admin: SupabaseClient<Database>;
  databaseUrl: string;
  psql: string;
  /** The runner's fresh ARMY account: journeys, components, numeric and emission phases. */
  owner: CalcV3Owner;
  remember: (secret: string) => void;
};
export type CalcV3PhaseFixtures = {
  /** Fixture paths and selections only. */
  env: Record<string, string>;
  /** Credentials for the journey process only, registered for redaction. */
  secretEnv: Record<string, string>;
  /** Dedicated owner of this phase, replacing the runner's account for its login. */
  login?: { email: string; password: string };
  identities: Record<string, unknown>;
};

const versionDefaults = {
  version_number: 1, status: "draft", currency: "EUR", margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0,
  global_coefficient: 1, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1,
  total_ht_cents: 0, total_tax_cents: 0, total_ttc_cents: 0,
};

function sqlTransport(context: CalcV3FixtureContext) {
  let database: URL;
  let api: URL;
  try {
    database = new URL(context.databaseUrl);
    api = new URL(context.backend);
  } catch {
    throw new Error("calc-v3 fixtures require valid owned API and PostgreSQL routes; values withheld.");
  }
  if (!["postgres:", "postgresql:"].includes(database.protocol) || database.hostname !== api.hostname ||
    !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) || !database.port || database.port === api.port ||
    CALC_V3_FORBIDDEN_PORTS.has(database.port) || CALC_V3_FORBIDDEN_PORTS.has(api.port) ||
    database.pathname !== "/postgres" || decodeURIComponent(database.username) !== "postgres" || !database.password ||
    database.search || database.hash || !path.isAbsolute(context.psql) || !/^psql$/.test(path.basename(context.psql))) {
    throw new Error("calc-v3 fixtures require the owned loopback PostgreSQL route and native psql.");
  }
  return {
    executable: context.psql,
    args: ["-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1"],
    env: {
      NODE_ENV: "test", PATH: process.env.PATH, LANG: "C.UTF-8", PGHOST: database.hostname === "[::1]" ? "::1" : database.hostname,
      PGPORT: database.port, PGUSER: "postgres", PGDATABASE: "postgres", PGPASSWORD: decodeURIComponent(database.password),
      PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable",
      PGOPTIONS: "-c statement_timeout=60000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000",
    } as NodeJS.ProcessEnv,
  };
}

/** Inserts the exact planned rows in one transaction as the native owner, with a per-row readback. */
async function executePlan(context: CalcV3FixtureContext, label: string, records: PlanRecord[]) {
  if (!records.length || records.some(({ table, row }) => !/^[a-z_]+$/.test(table) || Object.keys(row).some((key) => !/^[a-z_]+$/.test(key)))) {
    throw new Error(`calc-v3 fixture ${label}: invalid plan.`);
  }
  const transport = sqlTransport(context);
  const plan = JSON.stringify(records);
  const delimiter = `$calc_v3_${randomUUID().replaceAll("-", "")}$`;
  if (plan.includes(delimiter)) throw new Error(`calc-v3 fixture ${label}: SQL delimiter collision.`);
  const sql = `BEGIN;
DO ${delimiter}
DECLARE plan jsonb := '${plan.replaceAll("'", "''")}'::jsonb;
  entry jsonb; proposal jsonb; table_name text; column_names text; matches integer;
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' THEN RAISE EXCEPTION 'CALC_V3_FIXTURE_OWNER_DIFFERS'; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(plan) LOOP
    table_name := entry->>'table'; proposal := entry->'row';
    SELECT string_agg(quote_ident(key), ',' ORDER BY key) INTO column_names FROM jsonb_object_keys(proposal) key;
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(null::public.%I,$1)', table_name, column_names, column_names, table_name) USING proposal;
    IF proposal ? 'id' THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE id = ($1->>''id'')::uuid', table_name) INTO matches USING proposal;
    ELSE
      EXECUTE format('SELECT count(*) FROM public.%I t WHERE to_jsonb(t) @> $1', table_name) INTO matches USING proposal;
    END IF;
    IF matches <> 1 THEN RAISE EXCEPTION 'CALC_V3_FIXTURE_READBACK %', table_name; END IF;
  END LOOP;
END ${delimiter};
COMMIT;
SELECT 'CALC_V3_FIXTURE_COMMITTED';
`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(transport.executable, transport.args, { env: transport.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.stdin.destroy(); child.kill(); }, 120_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout = (stdout + chunk).slice(-65_536); });
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-65_536); });
    child.stdin.on("error", () => { /* The close callback reports a refused session. */ });
    child.once("error", () => { clearTimeout(timer); reject(new Error(`calc-v3 fixture ${label}: native psql could not start; no retry.`)); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (!timedOut && code === 0 && stdout.split(/\r?\n/).includes("CALC_V3_FIXTURE_COMMITTED")) { resolve(); return; }
      // Row values and SQL errors are synthetic fixture data, never credentials.
      const failure = stderr.split(/\r?\n/).filter((line) => /^(?:psql:.*)?(?:ERROR|DETAIL|CONTEXT):/.test(line)).slice(0, 3).join(" | ").slice(0, 600);
      reject(new Error(`calc-v3 fixture ${label} failed: exit=${code}, timeout=${timedOut}; ${failure || "no SQL error line"}; transaction rolled back, no retry.`));
    });
    child.stdin.end(sql);
  });
}

async function checked<T>(label: string, query: PromiseLike<{ data: T; error: { code?: string; message?: string } | null }>): Promise<NonNullable<T>> {
  const result = await query;
  if (result.error || result.data === null || result.data === undefined) {
    throw new Error(`calc-v3 fixture ${label}: ${result.error?.code ?? "no data"} ${result.error?.message ?? ""}`.trim());
  }
  return result.data as NonNullable<T>;
}

async function writeFixture(context: CalcV3FixtureContext, name: string, value: unknown) {
  await mkdir(context.directory, { recursive: true });
  const file = path.join(context.directory, `${name}.json`);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  return file;
}

type Actor = { userId: string; tenantId: string; membershipId: string; bootstrapTenantId: string; laborRoleId?: string; email: string; password: string };

/** A new ordinary account with its own bootstrap tenant, as created by sign-up. */
async function createActor(context: CalcV3FixtureContext, campaign: string, label: string, options: { rmo4000?: boolean } = {}): Promise<Actor> {
  const email = `army-calc-v3-${campaign}-${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `Army-${randomBytes(24).toString("base64url")}-A1!`;
  context.remember(email);
  context.remember(password);
  const created = await context.admin.auth.admin.createUser({ email, password, email_confirm: true,
    user_metadata: { full_name: `ARMY calc-v3 ${label}` }, app_metadata: { army_test_account: true } });
  if (created.error || !created.data.user) throw new Error(`calc-v3 fixture ${label}: account creation failed.`);
  const userId = created.data.user.id;
  const memberships = await checked(`${label}:bootstrap membership`, context.admin.from("tenant_memberships")
    .select("id, tenant_id, role, is_default").eq("user_id", userId));
  if (memberships.length !== 1 || memberships[0].role !== "admin" || !memberships[0].is_default) {
    throw new Error(`calc-v3 fixture ${label}: a new account must own exactly one default admin tenant.`);
  }
  const tenantId = memberships[0].tenant_id;
  await checked(`${label}:owned tenant name`, context.admin.from("tenants").update({ name: `ARMY calc-v3 ${campaign} ${label}` })
    .eq("id", tenantId).eq("created_by", userId).select("id").single());
  const actor: Actor = { userId, tenantId, membershipId: memberships[0].id, bootstrapTenantId: tenantId, email, password };
  if (options.rmo4000) {
    // The server prices labor with the first active role of the owner and tenant;
    // the generated-ouvrage oracles need exactly one, at 4,000 cents an hour.
    await checked(`${label}:disable new-account bootstrap roles`, context.admin.from("labor_roles").update({ is_active: false })
      .eq("tenant_id", tenantId).eq("user_id", userId).select("id"));
    actor.laborRoleId = randomUUID();
    await checked(`${label}:owned RMO4000`, context.admin.from("labor_roles").insert({ id: actor.laborRoleId, tenant_id: tenantId,
      user_id: userId, name: "ARMY pose", hourly_rate_cents: 4000, is_active: true, position: 0 }).select("id").single());
    const active = await checked(`${label}:unique RMO4000`, context.admin.from("labor_roles").select("id, hourly_rate_cents")
      .eq("tenant_id", tenantId).eq("user_id", userId).eq("is_active", true));
    if (active.length !== 1 || active[0].id !== actor.laborRoleId || active[0].hourly_rate_cents !== 4000) {
      throw new Error(`calc-v3 fixture ${label}: the RMO4000 oracle requires one active role.`);
    }
  }
  return actor;
}

const publicActor = (actor: Actor) => ({ userId: actor.userId, tenantId: actor.tenantId, membershipId: actor.membershipId,
  bootstrapTenantId: actor.bootstrapTenantId, ...(actor.laborRoleId ? { laborRoleId: actor.laborRoleId } : {}) });

// Totals order witness (docs/testing/generated-ouvrage-resume.md, "témoin d'ordre"):
// B sorts before A by UUID while A is first by position; A starts at 2 cents.
// Create-atomic owner (docs/testing/estimate-create-atomic.md): two empty
// legacy V1 drafts, the only estimates the public creation schema cannot make.
async function journeysFixtures(context: CalcV3FixtureContext, campaign: string): Promise<CalcV3PhaseFixtures> {
  const { owner } = context;
  const common = { tenant_id: owner.tenantId };
  const order = {
    prefix: `ARMY-order-calc-v3-${campaign}`, projectId: randomUUID(), versionId: randomUUID(), sectionId: randomUUID(),
    lineA: `f${randomUUID().slice(1)}`, lineB: `0${randomUUID().slice(1)}`,
  };
  const atomic = {
    prefix: `ARMY-CREATE-ATOMIC-calc-v3-${campaign}`,
    legacyV1: { projectId: randomUUID(), versionId: randomUUID() },
    legacySplitV1: { projectId: randomUUID(), versionId: randomUUID() },
  };
  const records: PlanRecord[] = [
    { table: "estimate_projects", row: { ...common, id: order.projectId, user_id: owner.userId, name: order.prefix } },
    { table: "estimate_versions", row: { ...common, ...versionDefaults, id: order.versionId, project_id: order.projectId, title: order.prefix,
      calc_engine_version: 2, max_section_depth: 1, discount_bp: 1667 } },
    { table: "estimate_items", row: { ...common, id: order.sectionId, version_id: order.versionId, parent_id: null, item_type: "section",
      position: 0, title: `${order.prefix} lot` } },
    ...[{ id: order.lineA, position: 1, tax_rate_bp: 2000, unit_price_ht_cents: 2, title: `${order.prefix} A` },
      { id: order.lineB, position: 2, tax_rate_bp: 0, unit_price_ht_cents: 3, title: `${order.prefix} B` }].map((line) => ({
      table: "estimate_items", row: { ...common, ...line, version_id: order.versionId, parent_id: order.sectionId, item_type: "line",
        line_nature: "supply_only", description: "u", quantity: 1, k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1,
        pu_ht_cents: line.unit_price_ht_cents, line_total_ht_cents: line.unit_price_ht_cents, line_tax_cents: 0,
        line_total_ttc_cents: line.unit_price_ht_cents },
    })),
    ...(["legacyV1", "legacySplitV1"] as const).flatMap((label) => [
      { table: "estimate_projects", row: { ...common, id: atomic[label].projectId, user_id: owner.userId, name: `${atomic.prefix} ${label}` } },
      { table: "estimate_versions", row: { ...common, ...versionDefaults, id: atomic[label].versionId, project_id: atomic[label].projectId,
        title: label, calc_engine_version: 1, max_section_depth: 3, discount_bp: 0, discount_mode: "simple", discount_steps: [],
        contractor_role: "principal" } },
    ]),
  ];
  if (!(order.lineB < order.lineA)) throw new Error("calc-v3 fixture totals-order: UUID order witness not established.");
  await executePlan(context, "journeys", records);
  const totalsOrder = await writeFixture(context, "totals-order", { schemaVersion: "calc-v3-totals-order-1", status: "ready",
    campaign, apiUrl: context.backend, createdAt: new Date().toISOString(), ...order, owner: { userId: owner.userId, tenantId: owner.tenantId },
    expected: { discountBp: 1667, grossHt: 6, discount: 1, ht: 5, tax: 0, ttc: 5 },
    boundary: "Owned ARMY account and manual draft only; no generated ouvrage application or snapshot." });
  const createAtomic = await writeFixture(context, "create-atomic", { schemaVersion: "estimate-create-atomic-fixture-1", status: "ready",
    campaign, apiUrl: context.backend, prefix: atomic.prefix, owner, legacyV1: atomic.legacyV1, legacySplitV1: atomic.legacySplitV1,
    boundary: "Two empty legacy V1 drafts; V2 estimates are created by the ordinary POST /api/estimates in the journeys." });
  return {
    env: { E2E_TOTALS_ORDER_FIXTURE_PATH: totalsOrder, E2E_CREATE_ATOMIC_FIXTURE_PATH: createAtomic },
    secretEnv: {},
    identities: { totalsOrder: order, createAtomic: { prefix: atomic.prefix, owner, legacyV1: atomic.legacyV1, legacySplitV1: atomic.legacySplitV1 } },
  };
}

// Same plan as the reviewed native component recipe (generated-components-plan.mjs):
// four candidates with four suggested components each, plus an empty reuse draft.
const componentValues = [["material", 1, "u", 4000], ["labor", 1, "h", 4000], ["material", 1, "u", 8000], ["labor", 2, "h", 4000]] as const;
async function componentsFixtures(context: CalcV3FixtureContext, campaign: string, selection: "full" | "numeric-all"): Promise<CalcV3PhaseFixtures> {
  const { owner } = context;
  const prefix = `ARMY-GENERATED-COMPONENTS-calc-v3-${selection}-${campaign}`;
  const scenarios = ["GC01", "GC02", "GC03", "GC04"].map((label) => ({
    label, projectId: randomUUID(), versionId: randomUUID(), sectionId: randomUUID(), draftId: randomUUID(),
    candidateId: randomUUID(), subdetailId: randomUUID(), designation: `${prefix} ${label} ouvrage`,
    components: componentValues.map(([costType, quantity, unit, unitCostHtCents], index) => ({
      componentId: randomUUID(), fragmentId: randomUUID(), sourceLinkId: randomUUID(),
      designation: `${prefix} ${label} proposition ${index + 1}`, costType, quantity, unit, unitCostHtCents,
    })),
  }));
  const reuse = { projectId: randomUUID(), versionId: randomUUID(), sectionId: randomUUID() };
  // Dynamic import: the plan module has a top-level-await CLI block that tsx
  // cannot compile to the CommonJS form this runner is loaded in.
  const { componentsRecords } = await import("./generated-components-plan.mjs");
  const records = componentsRecords({ prefix, owner: { userId: owner.userId, tenantId: owner.tenantId }, scenarios, reuse }) as PlanRecord[];
  await executePlan(context, selection === "full" ? "components" : "numeric", records);
  const file = await writeFixture(context, `components-${selection}`, { schemaVersion: "estimate-generated-components-fixture-1", status: "ready",
    campaign, prefix, apiUrl: context.backend, selection, owner, scenarios, reuse,
    boundary: "Pending proposals only; human decisions, applications, snapshots and library entries happen in the journeys." });
  return {
    env: { E2E_GENERATED_COMPONENTS_FIXTURE_PATH: file, E2E_GENERATED_COMPONENTS_SELECTION: selection },
    secretEnv: {},
    identities: { prefix, selection, owner, scenarios: scenarios.map(({ label, projectId, versionId, draftId }) => ({ label, projectId, versionId, draftId })), reuse },
  };
}

type GrComponent = { label: string; designation: string; costType: string; quantity: number; unit: string; unitCostHtCents: number;
  dsCents: number; lossCoeffBp: number; yieldValue: number | null; yieldUnit: string | null; componentId: string };
type GrProfile = { parentQuantity?: number; components?: Array<Omit<GrComponent, "componentId" | "lossCoeffBp" | "yieldValue" | "yieldUnit"> & Partial<Pick<GrComponent, "lossCoeffBp" | "yieldValue" | "yieldUnit">>> };
type GrScenario = { label: string; prefix: string; projectId: string; versionId: string; sectionA: string; sectionB: string;
  drafts: Array<{ draftId: string; createdAt: string; status: string; candidates: Array<{ candidateId: string; fragmentId: string;
    subdetailId: string; designation: string; unit: string; quantity: number; components: GrComponent[] }> }> };
type GrOwner = { userId: string; tenantId: string };

const defaultGrComponents = [
  { label: "C-ISO", designation: "ARMY calorifuge 30 mm CH-A", costType: "material", quantity: 10, unit: "m", unitCostHtCents: 800, dsCents: 8000 },
  { label: "C-TUBE", designation: "ARMY canalisation CH-A", costType: "material", quantity: 10, unit: "m", unitCostHtCents: 1200, dsCents: 12000 },
  { label: "C-POSE", designation: "ARMY pose réseau CH-A", costType: "labor", quantity: 5, unit: "h", unitCostHtCents: 4000, dsCents: 20000 },
];

/** Port of the qualified generated-ouvrage seed (GR01–GR09 GREEN 10/10 on 2026-10-11) to the owned stack. */
function generatedScenario(records: PlanRecord[], label: string, who: GrOwner, prefixKind = "GR"): GrScenario {
  const projectId = randomUUID(), versionId = randomUUID(), sectionA = randomUUID(), sectionB = randomUUID();
  const prefix = `ARMY-${prefixKind}-${label}-${projectId.slice(0, 8)}`;
  const common = { tenant_id: who.tenantId };
  records.push(
    { table: "estimate_projects", row: { ...common, id: projectId, user_id: who.userId, name: prefix } },
    { table: "estimate_versions", row: { ...common, ...versionDefaults, id: versionId, project_id: projectId, title: prefix,
      calc_engine_version: 2, max_section_depth: 1, discount_bp: 0 } },
    { table: "estimate_items", row: { ...common, id: sectionA, version_id: versionId, item_type: "section", title: `${prefix} SA`, position: 1, parent_id: null } },
    { table: "estimate_items", row: { ...common, id: sectionB, version_id: versionId, item_type: "section", title: `${prefix} SB`, position: 2, parent_id: null } },
  );
  return { label, prefix, projectId, versionId, sectionA, sectionB, drafts: [] };
}

function generatedDraft(records: PlanRecord[], s: GrScenario, who: GrOwner, index = 0,
  options: { createdAt?: string; status?: string; candidateCount?: number; author?: string; profiles?: GrProfile[] } = {}) {
  const draftId = randomUUID();
  const createdAt = options.createdAt ?? new Date(Date.UTC(2026, 9, 11, 12, 0, index)).toISOString();
  const common = { tenant_id: who.tenantId, project_id: s.projectId, target_version_id: s.versionId };
  const status = options.status ?? "pending";
  records.push({ table: "estimate_generated_ouvrage_drafts", row: { ...common, id: draftId, created_at: createdAt, created_by: options.author ?? who.userId,
    source_kind: "internal_note", preferred_lot_id: s.sectionA, status, summary: {}, generation_metadata: { fixture: "synthetic prepared draft; no model invoked" } } });
  const draft: GrScenario["drafts"][number] = { draftId, createdAt, status, candidates: [] };
  s.drafts.push(draft);
  for (let c = 0; c < (options.candidateCount ?? 1); c += 1) {
    const profile = options.profiles?.[c] ?? {};
    const parentQuantity = profile.parentQuantity ?? 10;
    const candidateId = randomUUID(), fragmentId = randomUUID(), subdetailId = randomUUID();
    const designation = `${s.prefix} Réseau CH-A avec calorifuge ${index}-${c}`;
    records.push(
      { table: "estimate_generated_ouvrage_source_fragments", row: { tenant_id: who.tenantId, project_id: s.projectId, draft_id: draftId, id: fragmentId,
        fragment_order: c, source_kind: "internal_note", label: "ARMY oracle synthétique", excerpt: designation, normalized_excerpt: designation.toLowerCase() } },
      { table: "estimate_generated_ouvrage_candidates", row: { ...common, id: candidateId, draft_id: draftId, candidate_order: c, suggested_lot_id: s.sectionA,
        lot_label: `${s.prefix} SA`, designation, normalized_designation: designation.toLowerCase(), unit: "m", quantity: parentQuantity, confidence: 1,
        ai_status: "certain", resolution_status: "pending", reasoning: "Oracle synthétique, aucune génération" } },
      { table: "estimate_generated_ouvrage_candidate_sources", row: { tenant_id: who.tenantId, draft_id: draftId, candidate_id: candidateId,
        source_fragment_id: fragmentId, source_rank: 0 } },
      { table: "estimate_generated_ouvrage_subdetail_drafts", row: { ...common, id: subdetailId, draft_id: draftId, parent_work_id: candidateId,
        created_by: options.author ?? who.userId, status: "pending_review", summary: {}, generation_metadata: { fixture: "pending human review" } } },
    );
    const components: GrComponent[] = (profile.components ?? defaultGrComponents).map((item) => ({
      lossCoeffBp: 0, yieldValue: null, yieldUnit: null, ...item, componentId: randomUUID() }));
    for (const [componentOrder, item] of components.entries()) {
      records.push({ table: "estimate_generated_ouvrage_subdetail_items", row: { tenant_id: who.tenantId, project_id: s.projectId, draft_id: draftId,
        subdetail_id: subdetailId, parent_work_id: candidateId, source_fragment_id: fragmentId, id: item.componentId, component_order: componentOrder,
        status: "manual", cost_type: item.costType, designation: item.designation, unit: item.unit, quantity: item.quantity,
        unit_cost_ht_cents: item.unitCostHtCents, loss_coeff_bp: item.lossCoeffBp, yield_value: item.yieldValue, yield_unit: item.yieldUnit,
        confidence: 1, source_label: "ARMY oracle synthétique", facts: ["Valeur de recette synthétique"], hypotheses: [], inferences: [] } });
    }
    draft.candidates.push({ candidateId, fragmentId, subdetailId, designation, unit: "m", quantity: parentQuantity, components });
  }
  return draft;
}

async function emptyGeneratedResults(context: CalcV3FixtureContext, scenarios: Record<string, GrScenario>) {
  // The generated-ouvrage tables are absent from the generated Database types.
  const untyped = context.admin as unknown as SupabaseClient;
  const before: Record<string, Record<string, number>> = {};
  for (const [label, s] of Object.entries(scenarios)) {
    const counts: Record<string, number> = {};
    for (const table of ["estimate_generated_ouvrage_applications", "estimate_generated_ouvrage_work_snapshots"]) {
      const result = await untyped.from(table).select("id", { count: "exact", head: true }).eq("target_version_id", s.versionId);
      if (result.error || result.count !== 0) throw new Error(`calc-v3 fixture ${label}: ${table} must start empty.`);
      counts[table] = 0;
    }
    const lines = await checked(`${label}:zero parent lines`, context.admin.from("estimate_items").select("id")
      .eq("version_id", s.versionId).eq("item_type", "line"));
    if (lines.length !== 0) throw new Error(`calc-v3 fixture ${label}: a parent line was preinserted.`);
    counts.lines = 0;
    before[label] = counts;
  }
  return before;
}

async function resumeFixtures(context: CalcV3FixtureContext, campaign: string): Promise<CalcV3PhaseFixtures> {
  const main = await createActor(context, campaign, "gr-owner", { rmo4000: true });
  const other = await createActor(context, campaign, "gr-other-author");
  const foreign = await createActor(context, campaign, "gr-foreign");
  await checked("gr:new-author membership in new owner tenant", context.admin.from("tenant_memberships")
    .insert({ tenant_id: main.tenantId, user_id: other.userId, role: "engineer", is_default: false }).select("id").single());
  const records: PlanRecord[] = [];
  const scenarios: Record<string, GrScenario> = {};
  for (const label of ["main", "pagination", "partial", "failure", "late", "stale", "unit"]) {
    const s = scenarios[label] = generatedScenario(records, label, main);
    if (label === "pagination") {
      for (let i = 0; i < 21; i += 1) generatedDraft(records, s, main, i, { createdAt: new Date(Date.UTC(2026, 9, 11, 12, 0, Math.floor(i / 2))).toISOString() });
      for (const status of ["applied", "discarded"]) generatedDraft(records, s, main, s.drafts.length, { status, candidateCount: 0 });
      generatedDraft(records, s, main, 23, { author: other.userId });
    } else generatedDraft(records, s, main, 0, { candidateCount: label === "partial" ? 2 : 1 });
  }
  const material = (lossCoeffBp: number) => ({ label: "C-LOSS", designation: "ARMY fournitures avec perte", costType: "material", quantity: 10,
    unit: "m", unitCostHtCents: 800, lossCoeffBp, dsCents: lossCoeffBp === 500 ? 8400 : 8001 });
  const parentInexact: GrProfile = { parentQuantity: 1, components: [{ label: "C-LABOR", designation: "ARMY heure non représentable",
    costType: "labor", quantity: 1, unit: "h", unitCostHtCents: 3333, dsCents: 3333 }] };
  const cases: Array<{ scenario: string; accept: boolean; dsCents: number; hours: number; profiles: GrProfile[] }> = [
    { scenario: "cost_base", accept: true, dsCents: 40000, hours: 5, profiles: [{}] },
    { scenario: "cost_loss", accept: true, dsCents: 8400, hours: 0, profiles: [{ parentQuantity: 1, components: [material(500)] }] },
    { scenario: "cost_yield", accept: true, dsCents: 16000, hours: 5, profiles: [{ components: [{ label: "C-YIELD", designation: "ARMY pose rendement",
      costType: "labor", quantity: 4, unit: "m", unitCostHtCents: 4000, dsCents: 16000, yieldValue: 0.5, yieldUnit: "h/m" }] }] },
    { scenario: "cost_canonical_inexact", accept: false, dsCents: 8001, hours: 0, profiles: [{ parentQuantity: 1, components: [material(1)] }] },
    { scenario: "cost_parent_inexact", accept: false, dsCents: 3333, hours: 1, profiles: [parentInexact] },
    { scenario: "cost_batch", accept: false, dsCents: 43333, hours: 6, profiles: [{}, parentInexact] },
  ];
  for (const entry of cases) {
    const s = scenarios[entry.scenario] = generatedScenario(records, entry.scenario, main);
    generatedDraft(records, s, main, 0, { candidateCount: entry.profiles.length, profiles: entry.profiles });
  }
  const foreignScenario = scenarios.foreign = generatedScenario(records, "foreign", foreign);
  generatedDraft(records, foreignScenario, foreign);
  await executePlan(context, "resume", records);
  const before = await emptyGeneratedResults(context, scenarios);
  const paginationOrder = scenarios.pagination.drafts.filter((draft) => draft.status === "pending").slice(0, 21)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.draftId.localeCompare(left.draftId)).map((draft) => draft.draftId);
  const owner = { userId: main.userId, tenantId: main.tenantId, laborRoleId: main.laborRoleId! };
  const file = await writeFixture(context, "generated-resume", { status: "ready", campaign, apiUrl: context.backend, createdAt: new Date().toISOString(),
    actors: { owner, "other-author": { userId: other.userId, tenantId: other.tenantId }, foreign: { userId: foreign.userId, tenantId: foreign.tenantId } },
    scenarios, costMatrix: cases.map(({ scenario, accept, dsCents, hours }) => ({ scenario, accept, dsCents, hours })), owner, paginationOrder, before,
    boundary: "New isolated ARMY actors/tenants/drafts only; no applications, snapshots or parent lines are inserted." });
  return {
    env: { E2E_GENERATED_OUVRAGE_FIXTURE_PATH: file },
    secretEnv: {},
    login: { email: main.email, password: main.password },
    identities: { owner, otherAuthor: publicActor(other), foreign: publicActor(foreign), scenarios: Object.keys(scenarios), paginationOrder },
  };
}

async function accessFixtures(context: CalcV3FixtureContext, campaign: string): Promise<CalcV3PhaseFixtures> {
  const owner = await createActor(context, campaign, "access-owner");
  const observer = await createActor(context, campaign, "access-observer");
  const membership = await checked("access:second new admin in owner tenant", context.admin.from("tenant_memberships")
    .insert({ tenant_id: owner.tenantId, user_id: observer.userId, role: "admin", is_default: false }).select("id, tenant_id, role").single());
  // The observer switches its own active tenant through the ordinary RPC, as in the qualified seed.
  const observerClient = createClient<Database>(context.backend, context.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  try {
    const signedIn = await observerClient.auth.signInWithPassword({ email: observer.email, password: observer.password });
    if (signedIn.error || signedIn.data.user?.id !== observer.userId) throw new Error("calc-v3 fixture access: observer ordinary authentication failed.");
    await checked("access:observer ordinary active-tenant switch", observerClient.rpc("set_active_tenant_membership_default", { p_membership_id: membership.id }));
    const active = await checked("access:observer active tenant", observerClient.from("tenant_memberships").select("id, tenant_id, role")
      .eq("user_id", observer.userId).eq("is_default", true).single());
    if (active.id !== membership.id || active.tenant_id !== owner.tenantId || active.role !== "admin") throw new Error("calc-v3 fixture access: observer active tenant mismatch.");
  } finally {
    await observerClient.auth.signOut({ scope: "local" });
  }
  const admins = await checked("access:exactly two new admins", context.admin.from("tenant_memberships").select("user_id, role").eq("tenant_id", owner.tenantId));
  if (admins.length !== 2 || admins.some((row) => row.role !== "admin") || !admins.some((row) => row.user_id === owner.userId) ||
    !admins.some((row) => row.user_id === observer.userId)) throw new Error("calc-v3 fixture access: two-admin invariant failed.");
  await checked("access:disable owner bootstrap roles", context.admin.from("labor_roles").update({ is_active: false })
    .eq("tenant_id", owner.tenantId).eq("user_id", owner.userId).select("id"));
  owner.laborRoleId = randomUUID();
  await checked("access:owner RMO4000", context.admin.from("labor_roles").insert({ id: owner.laborRoleId, tenant_id: owner.tenantId,
    user_id: owner.userId, name: "ARMY access pose", hourly_rate_cents: 4000, is_active: true, position: 0 }).select("id").single());
  const records: PlanRecord[] = [];
  const scenarios: Record<string, Row> = {};
  for (const label of ["archive", "role"]) {
    const s = generatedScenario(records, label, owner, "ACCESS");
    const draft = generatedDraft(records, s, owner);
    const candidate = draft.candidates[0];
    scenarios[label] = { label, prefix: s.prefix, projectId: s.projectId, versionId: s.versionId, sectionA: s.sectionA, sectionB: s.sectionB,
      draftId: draft.draftId, candidateId: candidate.candidateId, fragmentId: candidate.fragmentId, subdetailId: candidate.subdetailId,
      componentIds: candidate.components.map((component) => component.componentId), designation: candidate.designation };
  }
  await executePlan(context, "access", records);
  const assemblies = await checked("access:no seeded assemblies", context.admin.from("estimate_assemblies").select("id").eq("tenant_id", owner.tenantId));
  if (assemblies.length) throw new Error("calc-v3 fixture access: a canonical assembly must not be seeded.");
  const ownerValue = publicActor(owner);
  const observerValue = { ...publicActor(observer), tenantId: owner.tenantId, membershipId: membership.id };
  const file = await writeFixture(context, "generated-access", { schemaVersion: "generated-ouvrage-access-1", status: "ready", campaign,
    apiUrl: context.backend, createdAt: new Date().toISOString(), owner: ownerValue, observer: observerValue, scenarios,
    before: Object.fromEntries(Object.keys(scenarios).map((label) => [label, { lines: 0, applications: 0, snapshots: 0, assemblies: 0,
      draftStatus: "pending", subdetailStatus: "pending_review" }])),
    boundary: "New users, their bootstrap tenants and one new shared ARMY membership; the journey archives and self-demotes only these." });
  return {
    env: { E2E_GENERATED_ACCESS_FIXTURE_PATH: file },
    secretEnv: { E2E_ACCESS_OBSERVER_EMAIL: observer.email, E2E_ACCESS_OBSERVER_PASSWORD: observer.password },
    login: { email: owner.email, password: owner.password },
    identities: { owner: ownerValue, observer: observerValue, scenarios },
  };
}

// Sub-lot 2.2 (A7, P-08). P1 has an unmarked 0 € offer, more recent than its 12,40 € offer,
// so that before the fix it heads the suggestions and wins the best price; P2 has only an
// unmarked 0 € offer; P3 has a 0 € offer that OZ02 marks "Inclus". All offers are in "ml";
// the estimate lines use "ML", "ml", "m" or "ens". No transport mode: only a tenant admin may
// set freight conditions, and the native owner is not one. A dedicated owner in the "expert"
// UI mode: the supplier preselection is hidden in the default simplified mode, and changing
// the runner's own profile would leak into the later emission phase.
async function offersFixtures(context: CalcV3FixtureContext, campaign: string): Promise<CalcV3PhaseFixtures> {
  const actor = await createActor(context, campaign, "offers");
  await checked("offers:expert UI mode", context.admin.from("profiles").update({ ui_mode: "expert" })
    .eq("id", actor.userId).select("id").single());
  const owner = { userId: actor.userId, tenantId: actor.tenantId };
  const common = { tenant_id: owner.tenantId };
  const prefix = `ARMY-OZ-calc-v3-${campaign}`;
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const suppliers = { zero: randomUUID(), priced: randomUUID(), included: randomUUID() };
  const products = {
    p1: { id: randomUUID(), designation: `${prefix} tube cuivre` },
    p2: { id: randomUUID(), designation: `${prefix} gaine nue` },
    p3: { id: randomUUID(), designation: `${prefix} collier fourni` },
  };
  const offers = {
    p1Zero: { id: randomUUID(), catalogItemId: randomUUID(), supplierId: suppliers.zero, productId: products.p1.id, cents: 0,
      updatedAt: new Date().toISOString() },
    p1Priced: { id: randomUUID(), catalogItemId: randomUUID(), supplierId: suppliers.priced, productId: products.p1.id, cents: 1240,
      updatedAt: new Date(Date.now() - 3_600_000).toISOString() },
    p2Zero: { id: randomUUID(), catalogItemId: randomUUID(), supplierId: suppliers.zero, productId: products.p2.id, cents: 0,
      updatedAt: new Date().toISOString() },
    p3Zero: { id: randomUUID(), catalogItemId: randomUUID(), supplierId: suppliers.included, productId: products.p3.id, cents: 0,
      updatedAt: new Date().toISOString() },
  };
  const deliverySite = { id: randomUUID(), updatedAt: new Date(Date.now() - 1_000).toISOString() };
  // One draft per journey: two editor sessions on one estimate would contend for its edit lock.
  const estimate = () => ({ projectId: randomUUID(), versionId: randomUUID(), sectionId: randomUUID() });
  const estimates = { oz01: estimate(), oz02: estimate(), oz03: estimate() };
  type EstimateKey = keyof typeof estimates;
  type LineExtra = { quantity: number; unit_price_ht_cents?: number; product_id?: string; selected_supplier_price_id?: string };
  const line = (estimateKey: EstimateKey, title: string, unit: string, extra: LineExtra) =>
    ({ estimateKey, id: randomUUID(), title, unit, ...extra });
  const lines = {
    compareP1: line("oz01", products.p1.designation, "ML", { quantity: 2 }),
    compareP2: line("oz01", products.p2.designation, "ml", { quantity: 1 }),
    popover: line("oz01", `${prefix} ligne popover`, "ML", { quantity: 3 }),
    sheet: line("oz01", `${prefix} ligne fiche`, "ens", { quantity: 1 }),
    // Already linked to the unmarked 0 € offer before 2.2: the link stays, the offer is shown
    // ineligible and the 12,40 € peer is the best price and can be retained.
    linkedZero: line("oz01", `${prefix} ligne liée zéro`, "ML",
      { quantity: 1, product_id: products.p1.id, selected_supplier_price_id: offers.p1Zero.id }),
    popoverSquare: line("oz01", `${prefix} ligne m2`, "m2", { quantity: 1 }),
    compareP3: line("oz02", products.p3.designation, "ml", { quantity: 1 }),
    sheetIncluded: line("oz02", `${prefix} ligne incluse`, "ml", { quantity: 1 }),
    purchaseMl: line("oz03", `${prefix} achat ML`, "ML",
      { quantity: 2, unit_price_ht_cents: 1240, product_id: products.p1.id, selected_supplier_price_id: offers.p1Priced.id }),
    purchaseZero: line("oz03", `${prefix} achat zéro`, "ml",
      { quantity: 1, unit_price_ht_cents: 500, product_id: products.p2.id, selected_supplier_price_id: offers.p2Zero.id }),
  };
  const records: PlanRecord[] = [
    ...Object.entries(suppliers).map(([key, id]) => ({ table: "suppliers", row: { ...common, id, name: `${prefix} fournisseur ${key}`, is_active: true } })),
    ...Object.values(products).map((product, index) => ({ table: "products", row: { ...common, id: product.id,
      reference: `${prefix}-P${index + 1}`, designation: product.designation, unit: "ml", unit_price_cents: 0, is_active: true } })),
    ...Object.values(offers).map((offer) => ({ table: "supplier_catalog_items", row: { ...common, id: offer.catalogItemId,
      supplier_id: offer.supplierId, product_id: offer.productId, supplier_sku: `${prefix}-${offer.id.slice(0, 8)}`, is_active: true } })),
    ...Object.values(offers).map((offer) => ({ table: "supplier_pricebook", row: { ...common, id: offer.id,
      supplier_catalog_item_id: offer.catalogItemId, supplier_id: offer.supplierId, product_id: offer.productId,
      supplier_sku: `${prefix}-${offer.id.slice(0, 8)}`, unit: "ml", min_quantity: 1, unit_price_cents: offer.cents, currency: "EUR",
      valid_from: day(0), valid_to: day(30), is_active: true, created_at: offer.updatedAt, updated_at: offer.updatedAt } })),
    { table: "delivery_sites", row: { ...common, id: deliverySite.id, name: `${prefix} chantier`, is_active: true, updated_at: deliverySite.updatedAt } },
    ...Object.entries(estimates).flatMap(([key, entry]) => [
      { table: "estimate_projects", row: { ...common, id: entry.projectId, user_id: owner.userId, name: `${prefix} ${key}` } },
      { table: "estimate_versions", row: { ...common, ...versionDefaults, id: entry.versionId, project_id: entry.projectId,
        title: `${prefix} ${key}`, calc_engine_version: 2, max_section_depth: 1, discount_bp: 0 } },
      { table: "estimate_items", row: { ...common, id: entry.sectionId, version_id: entry.versionId, parent_id: null, item_type: "section",
        position: 0, title: `${prefix} ${key} lot` } },
    ]),
    ...Object.values(lines).map((entry, index) => {
      const price = Number(entry.unit_price_ht_cents ?? 0);
      const quantity = Number(entry.quantity);
      const ht = price * quantity;
      const tax = Math.round(ht * 0.2);
      const owned = estimates[entry.estimateKey];
      return { table: "estimate_items", row: { ...common, id: entry.id, version_id: owned.versionId, parent_id: owned.sectionId,
        item_type: "line", line_nature: "supply_only", position: index + 1, title: entry.title, description: entry.unit,
        quantity, unit_price_ht_cents: price, tax_rate_bp: 2000, k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1,
        ...(entry.product_id ? { product_id: entry.product_id } : {}),
        ...(entry.selected_supplier_price_id ? { selected_supplier_price_id: entry.selected_supplier_price_id } : {}),
        pu_ht_cents: price, line_total_ht_cents: ht, line_tax_cents: tax, line_total_ttc_cents: ht + tax } };
    }),
  ];
  await executePlan(context, "offers", records);
  const fixture = await writeFixture(context, "supplier-offers", { schemaVersion: "calc-v3-supplier-offers-1", status: "ready",
    campaign, apiUrl: context.backend, createdAt: new Date().toISOString(), prefix, owner: { userId: owner.userId, tenantId: owner.tenantId },
    suppliers, products, offers, deliverySite, estimates,
    lines: Object.fromEntries(Object.entries(lines).map(([key, entry]) =>
      [key, { id: entry.id, title: entry.title, unit: entry.unit, estimate: entry.estimateKey }])),
    boundary: "Catalogue records and one draft V2 estimate of the runner's ARMY tenant, seeded for this phase only." });
  return { env: { E2E_SUPPLIER_OFFERS_FIXTURE_PATH: fixture }, secretEnv: {},
    login: { email: actor.email, password: actor.password },
    identities: { owner: publicActor(actor), prefix, suppliers, products, offers, estimates } };
}

// Sub-lot 2.7 (D14, D15, M5; docs/testing/estimate-engine-v3-2.7.md). A dedicated owner whose
// tenant policy is at engine 3 (1,30 / 1,20, rates 20 / 10 / 5,5 / 2,1 %), set by service_role
// through set_tenant_calc_policy, the only writer of lot 2 (P-13), with one active labor role at
// exactly 4,000 cents an hour (§5.1). Its v3 estimates are created by the journey through the
// application. The policy governs only new versions: one v2 draft witness (one 1 u line at
// 20,00 € HT, 20 % VAT, no snapshot) is seeded in the same tenant so that the journey issues a
// contract 1 offer before any v3 and re-verifies it after the v3 emissions.
async function emissionV3Fixtures(context: CalcV3FixtureContext, campaign: string): Promise<CalcV3PhaseFixtures> {
  const actor = await createActor(context, campaign, "emission-v3", { rmo4000: true });
  const reason = `ARMY calc-v3 ${campaign} sous-lot 2.7 émission v3`;
  await checked("emission-v3:tenant policy at engine 3", context.admin.rpc("set_tenant_calc_policy", {
    p_tenant_id: actor.tenantId, p_new_estimate_calc_engine: 3, p_default_sale_coefficient_fo: 1.3,
    p_default_sale_coefficient_mo: 1.2, p_allowed_tax_rates_bp: [2000, 1000, 550, 210], p_change_reason: reason,
    p_actor_user_id: actor.userId,
  }));
  const policy = await checked("emission-v3:policy readback", context.admin.from("tenant_calc_policies")
    .select("new_estimate_calc_engine, default_sale_coefficient_fo, default_sale_coefficient_mo, allowed_tax_rates_bp")
    .eq("tenant_id", actor.tenantId).single());
  if (policy.new_estimate_calc_engine !== 3 || Number(policy.default_sale_coefficient_fo) !== 1.3 ||
    Number(policy.default_sale_coefficient_mo) !== 1.2 || JSON.stringify(policy.allowed_tax_rates_bp) !== "[2000,1000,550,210]") {
    throw new Error("calc-v3 fixture emission-v3: the tenant policy readback differs.");
  }
  // Every new tenant receives the product's global approval rule at 5,000 EUR HT
  // (seed_default_estimate_approval_rule, 20260812223050). S2 and S5 (69,053.55 EUR HT) would
  // be blocked at send by the approval gate, which is outside the emission contract of 2.7
  // and covered by the approval journeys: the rule of this dedicated tenant only is deactivated.
  // `estimate_rules` is absent from the generated types: this one update goes through the untyped client.
  const untyped = context.admin as unknown as SupabaseClient;
  const deactivated = (await checked("emission-v3:default approval rule", untyped.from("estimate_rules")
    .update({ is_active: false }).eq("tenant_id", actor.tenantId).eq("rule_type", "require_approval")
    .eq("scope_type", "global").is("scope_id", null).select("id, threshold_value, is_active"))) as
    Array<{ id: string; threshold_value: number; is_active: boolean }>;
  if (deactivated.length !== 1 || Number(deactivated[0].threshold_value) !== 500000 || deactivated[0].is_active !== false) {
    throw new Error("calc-v3 fixture emission-v3: the dedicated tenant must hold exactly its default approval rule at 5,000 EUR.");
  }
  const owner = { userId: actor.userId, tenantId: actor.tenantId };
  const common = { tenant_id: owner.tenantId };
  const prefix = `ARMY-V3M-calc-v3-${campaign}`;
  const witness = { projectId: randomUUID(), versionId: randomUUID(), sectionId: randomUUID(), lineId: randomUUID(),
    title: `${prefix} témoin v2`, lineTitle: `${prefix} témoin v2 prestation` };
  const today = new Date().toISOString().slice(0, 10);
  const records: PlanRecord[] = [
    { table: "estimate_projects", row: { ...common, id: witness.projectId, user_id: owner.userId, name: witness.title } },
    { table: "estimate_versions", row: { ...common, ...versionDefaults, id: witness.versionId, project_id: witness.projectId,
      title: witness.title, calc_engine_version: 2, max_section_depth: 1, discount_bp: 0, discount_mode: "simple",
      discount_steps: [], contractor_role: "principal", date_devis: today, validite_jours: 30,
      total_ht_cents: 2000, total_tax_cents: 400, total_ttc_cents: 2400 } },
    { table: "estimate_items", row: { ...common, id: witness.sectionId, version_id: witness.versionId, parent_id: null,
      item_type: "section", position: 0, title: `${prefix} lot` } },
    { table: "estimate_items", row: { ...common, id: witness.lineId, version_id: witness.versionId, parent_id: witness.sectionId,
      item_type: "line", line_nature: "supply_only", position: 1, title: witness.lineTitle, description: "u", quantity: 1,
      unit_price_ht_cents: 2000, tax_rate_bp: 2000, k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1, pu_ht_cents: 2000,
      line_total_ht_cents: 2000, line_tax_cents: 400, line_total_ttc_cents: 2400 } },
  ];
  await executePlan(context, "emission-v3", records);
  const engine = await checked("emission-v3:witness engine", context.admin.from("estimate_versions")
    .select("calc_engine_version, status").eq("id", witness.versionId).single());
  if (engine.calc_engine_version !== 2 || engine.status !== "draft") throw new Error("calc-v3 fixture emission-v3: the witness must be a v2 draft.");
  const file = await writeFixture(context, "emission-v3", { schemaVersion: "calc-v3-emission-v3-1", status: "ready", campaign,
    apiUrl: context.backend, createdAt: new Date().toISOString(), prefix, owner: { ...owner, laborRoleId: actor.laborRoleId },
    policy: { engine: 3, saleCoefficientFo: 1.3, saleCoefficientMo: 1.2, allowedTaxRatesBp: [2000, 1000, 550, 210] },
    v2Witness: { ...witness, expected: { ht: 2000, tax: 400, ttc: 2400 } },
    approvalRule: { id: deactivated[0].id, thresholdCents: 500000, isActive: false },
    boundary: "A new owner, its bootstrap tenant at policy 3 without its default approval rule, and one v2 draft witness; every v3 is created by the journey through the application." });
  return { env: { E2E_V3_EMISSION_FIXTURE_PATH: file }, secretEnv: {},
    login: { email: actor.email, password: actor.password },
    identities: { owner: publicActor(actor), prefix, v2Witness: witness, policy: "engine 3, 1,30 / 1,20",
      approvalRule: "default 5,000 EUR global rule deactivated for this tenant" } };
}

/** Prepares the explicit fixtures of one calc-v3 phase on the owned stack. */
export async function prepareCalcV3Fixtures(phase: CalcV3Phase, context: CalcV3FixtureContext): Promise<CalcV3PhaseFixtures> {
  const campaign = randomUUID().slice(0, 8);
  switch (phase) {
    case "journeys": return journeysFixtures(context, campaign);
    case "components": return componentsFixtures(context, campaign, "full");
    case "numeric": return componentsFixtures(context, campaign, "numeric-all");
    case "resume": return resumeFixtures(context, campaign);
    case "access": return accessFixtures(context, campaign);
    case "offers": return offersFixtures(context, campaign);
    case "emission": return { env: {}, secretEnv: {}, identities: { note: "OF journeys create their own ARMY-OFFER estimates through the UI." } };
    case "emission-v3": return emissionV3Fixtures(context, campaign);
  }
}
