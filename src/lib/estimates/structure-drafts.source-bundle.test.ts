import { beforeEach, describe, expect, it, vi } from "vitest";

// Pagination faults are covered with the real SDK in read-all.test.ts.
vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/affaires/import-flow-server", () => ({
  fetchMappedRowsForImport: vi.fn(),
}));
vi.mock("@/lib/ai/structured-ai", () => ({
  callStructuredAi: vi.fn(),
}));

import { fetchMappedRowsForImport } from "@/lib/affaires/import-flow-server";
import { callStructuredAi } from "@/lib/ai/structured-ai";
import { generateEstimateStructureDraft } from "@/lib/estimates/structure-drafts";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Characterises the sources a structure draft is built from (linked DPGF, history,
// templates, assemblies, primary CCTP, confirmed brief, project notes) through the
// public generation entry point: the source summaries returned and stored, the
// prompt sources sent to the AI provider, the heuristic fallback nodes, and the
// tenant/project-scoped queries in the order they run.

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT_ID = "2bbbbbbb-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_PROJECT_ID = "4bbbbbbb-4444-4444-8444-444444444444";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";
const HISTORY_V2_ID = "a2000000-0000-4000-8000-000000000002";
const HISTORY_V1_ID = "a1000000-0000-4000-8000-000000000001";
const TEMPLATE_FULL_ID = "b1000000-0000-4000-8000-000000000001";
const TEMPLATE_EMPTY_ID = "b2000000-0000-4000-8000-000000000002";
const LATEST_IMPORT_ID = "c2000000-0000-4000-8000-000000000002";
const OLDER_IMPORT_ID = "c1000000-0000-4000-8000-000000000001";
const BRIEF_ID = "d1000000-0000-4000-8000-000000000001";

type Row = Record<string, unknown>;
type QueryCall = { method: string; args: unknown[] };
type RecordedQuery = { table: string; calls: QueryCall[] };
type QueryError = { code: string; message: string; details: string | null; hint: string | null };

const CHAIN_METHODS = ["select", "insert", "update", "delete", "eq", "neq", "gt", "in", "order", "limit"];

function readRows(rows: Row[], calls: QueryCall[]) {
  let result = [...rows];
  const orderKeys: Array<{ column: string; ascending: boolean }> = [];
  let limit: number | null = null;

  for (const { method, args } of calls) {
    const [column, value] = args as [string, unknown];
    // Filters on embedded resources (`tenants.is_active`) are answered by the fixture rows.
    if (["eq", "neq", "gt", "in"].includes(method) && column.includes(".")) continue;
    if (method === "eq") result = result.filter((row) => row[column] === value);
    if (method === "neq") result = result.filter((row) => row[column] !== value);
    if (method === "gt") result = result.filter((row) => String(row[column]) > String(value));
    if (method === "in") {
      result = result.filter((row) => (value as unknown[]).includes(row[column]));
    }
    if (method === "order") {
      const options = args[1] as { ascending?: boolean } | undefined;
      orderKeys.push({ column, ascending: options?.ascending ?? true });
    }
    if (method === "limit") limit = value === undefined ? Number(column) : Number(value);
  }

  result.sort((left, right) => {
    for (const { column, ascending } of orderKeys) {
      const a = left[column] as string | number | boolean;
      const b = right[column] as string | number | boolean;
      if (a === b) continue;
      return (a < b ? -1 : 1) * (ascending ? 1 : -1);
    }
    return 0;
  });

  return limit === null ? result : result.slice(0, limit);
}

/**
 * Supabase stand-in over in-memory tables: it answers `eq`/`neq`/`gt`/`in` filters,
 * `order` and `limit`, records every query with its chained calls, and lets a test
 * fail one read with a PostgREST error. With `holdResults`, every result stays pending
 * until `releaseHeld()`, so a test can see which reads are issued together.
 */
function createSupabaseFake(input: {
  tables: Record<string, Row[]>;
  failRead?: (query: RecordedQuery) => QueryError | null;
  holdResults?: boolean;
}) {
  const queries: RecordedQuery[] = [];
  // Every query or held call, tagged with the number of releases that preceded it.
  const issued: Array<{ release: number; label: string; query?: RecordedQuery }> = [];
  const held: Array<() => void> = [];
  let releases = 0;
  const settle = <T,>(compute: () => T): Promise<T> =>
    input.holdResults
      ? new Promise((done) => held.push(() => done(compute())))
      : Promise.resolve(compute());
  const hold = <T,>(label: string, value: T) => {
    issued.push({ release: releases, label });
    return settle(() => value);
  };
  const releaseHeld = () => {
    releases += 1;
    held.splice(0).forEach((complete) => complete());
  };
  const draftInserts: Row[] = [];
  const draftNodeInserts: Row[][] = [];

  const resolve = (query: RecordedQuery, terminal: "many" | "single" | "maybeSingle") => {
    const write = query.calls.find((call) => ["insert", "update", "delete"].includes(call.method));
    if (write) {
      if (write.method === "insert" && query.table === "estimate_structure_drafts") {
        draftInserts.push(write.args[0] as Row);
        return {
          data: { id: DRAFT_ID, created_at: "2026-03-06T09:01:00.000Z" },
          error: null,
        };
      }
      if (write.method === "insert" && query.table === "estimate_structure_draft_nodes") {
        draftNodeInserts.push(write.args[0] as Row[]);
      }
      return { data: null, error: null };
    }

    const error = input.failRead?.(query) ?? null;
    if (error) return { data: null, error };

    const rows = readRows(input.tables[query.table] ?? [], query.calls);
    if (terminal === "many") return { data: rows, error: null, count: rows.length };
    if (terminal === "maybeSingle") return { data: rows[0] ?? null, error: null };
    return rows[0]
      ? { data: rows[0], error: null }
      : {
          data: null,
          error: { code: "PGRST116", message: "no rows", details: null, hint: null },
        };
  };

  const from = vi.fn((table: string) => {
    const query: RecordedQuery = { table, calls: [] };
    queries.push(query);
    issued.push({ release: releases, label: table, query });
    const builder: Record<string, unknown> = {};
    for (const method of CHAIN_METHODS) {
      builder[method] = (...args: unknown[]) => {
        query.calls.push({ method, args });
        return builder;
      };
    }
    builder.single = () => {
      query.calls.push({ method: "single", args: [] });
      return settle(() => resolve(query, "single"));
    };
    builder.maybeSingle = () => {
      query.calls.push({ method: "maybeSingle", args: [] });
      return settle(() => resolve(query, "maybeSingle"));
    };
    builder.then = (
      onFulfilled: (value: unknown) => unknown,
      onRejected: (reason: unknown) => unknown
    ) => settle(() => resolve(query, "many")).then(onFulfilled, onRejected);
    return builder;
  });

  const rpc = vi.fn(async (functionName: string) => {
    if (functionName === "acquire_estimate_ai_generation_lease") {
      return { data: [{ claimed: true, retry_after_seconds: 0 }], error: null };
    }
    if (functionName === "complete_estimate_ai_generation_lease") {
      return { data: true, error: null };
    }
    throw new Error(`Unexpected RPC ${functionName}`);
  });

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
    },
    from,
    rpc,
  };

  return { supabase, queries, issued, hold, releaseHeld, draftInserts, draftNodeInserts };
}

/**
 * Runs a generation with every read held, releasing them one round at a time, and
 * returns the reads issued in each round: reads in the same round ran concurrently.
 */
async function readRounds(
  fake: ReturnType<typeof createSupabaseFake>,
  run: () => Promise<unknown>
) {
  let finished = false;
  const outcome = run().then(
    () => {
      finished = true;
    },
    (error: unknown) => {
      finished = true;
      return error;
    }
  );
  for (let round = 0; round < 50 && !finished; round += 1) {
    await new Promise((done) => setTimeout(done, 0));
    fake.releaseHeld();
  }
  const error = await outcome;
  const rounds: string[][] = [];
  fake.issued
    .filter(({ query }) =>
      !query?.calls.some((call) => ["insert", "update", "delete"].includes(call.method))
    )
    .forEach(({ release, label }) => {
      (rounds[release] ??= []).push(label);
    });
  return { rounds: rounds.filter(Boolean), error };
}

function describeQuery(query: RecordedQuery) {
  const chain = query.calls
    .map(({ method, args }) => `${method}(${args.map((arg) => JSON.stringify(arg)).join(", ")})`)
    .join(".");
  return `${query.table}.${chain}`;
}

const SOURCE_TABLES = new Set([
  "dpgf_imports",
  "estimate_templates",
  "estimate_template_items",
  "estimate_assemblies",
  "affaire_briefs",
  "affaire_intake_documents",
  "affaire_brief_source_links",
]);

/** The reads that load the draft sources, in the order they were issued. */
function sourceQueries(queries: RecordedQuery[]) {
  return queries
    .filter((query) => {
      if (SOURCE_TABLES.has(query.table)) return true;
      if (query.table === "estimate_versions") {
        return query.calls.some((call) => call.method === "neq");
      }
      if (query.table === "estimate_items") {
        return query.calls.some((call) => call.method === "in");
      }
      return false;
    })
    .map(describeQuery);
}

function baseTables(options: { projectNotes?: string | null } = {}): Record<string, Row[]> {
  return {
    tenant_memberships: [
      {
        id: "membership-1",
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        role: "engineer",
        is_default: true,
        created_at: "2026-03-06T09:00:00.000Z",
        tenants: { is_active: true, name: "Entreprise test" },
      },
    ],
    estimate_versions: [
      {
        id: VERSION_ID,
        tenant_id: TENANT_ID,
        project_id: PROJECT_ID,
        version_number: 3,
        title: "Version courante",
        status: "draft",
        margin_multiplier: 1,
        tax_rate_bp: 2000,
        updated_at: "2026-03-06T09:00:00.000Z",
        estimate_projects: {
          id: PROJECT_ID,
          tenant_id: TENANT_ID,
          user_id: USER_ID,
          name: "Projet test",
          reference: "REF-01",
          client_name: "Client fictif",
          notes: options.projectNotes ?? null,
          is_archived: false,
        },
      },
    ],
    draft_locks: [
      {
        id: "lock-1",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        user_id: USER_ID,
        locked_at: "2026-03-06T09:00:00.000Z",
        expires_at: "2099-03-06T09:30:00.000Z",
      },
    ],
  };
}

function section(input: {
  id: string;
  versionId: string;
  parentId?: string | null;
  position: number;
  title: string;
  tenantId?: string;
  itemType?: string;
}) {
  return {
    id: input.id,
    tenant_id: input.tenantId ?? TENANT_ID,
    version_id: input.versionId,
    parent_id: input.parentId ?? null,
    item_type: input.itemType ?? "section",
    position: input.position,
    title: input.title,
    created_at: "2026-03-01T09:00:00.000Z",
  };
}

function templateSection(input: {
  id: string;
  templateId: string;
  parentId?: string | null;
  position: number;
  title: string;
}) {
  return {
    id: input.id,
    tenant_id: TENANT_ID,
    template_id: input.templateId,
    parent_id: input.parentId ?? null,
    item_type: "section",
    position: input.position,
    title: input.title,
  };
}

function mappedRow(id: string, rowIndex: number, designation: string | null) {
  return {
    id,
    payload: {
      row_index: rowIndex,
      mapped_row: {
        ...(designation === null ? {} : { designation }),
        quantity: "1",
        unit_price_ht: "10",
      },
    },
  };
}

function cctpDocument(input: {
  id: string;
  fileName: string;
  priority: "primary" | "secondary" | null;
  lots: string[];
  uploadStatus?: string;
  createdAt: string;
}) {
  return {
    id: input.id,
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    file_name: input.fileName,
    document_kind: "cctp",
    upload_status: input.uploadStatus ?? "uploaded",
    classification_status: "classified",
    document_priority: input.priority,
    created_at: input.createdAt,
    extracted_metadata: {
      projectName: null,
      clientName: null,
      deadlineAt: null,
      detectedLots: input.lots,
      detectedVariants: [],
    },
  };
}

function allSourcesTables(): Record<string, Row[]> {
  const tables = baseTables({
    projectNotes: "Gros oeuvre > Fondations\n- Menuiseries / Fenetres; Peinture\nab",
  });

  tables.estimate_versions.push(
    {
      id: HISTORY_V1_ID,
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_number: 1,
      title: null,
    },
    {
      id: HISTORY_V2_ID,
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_number: 2,
      title: "Variante",
    },
    {
      id: "a9000000-0000-4000-8000-000000000009",
      tenant_id: TENANT_ID,
      project_id: OTHER_PROJECT_ID,
      version_number: 9,
      title: "Autre affaire",
    }
  );

  tables.estimate_items = [
    section({ id: "e0000000-0000-4000-8000-000000000001", versionId: VERSION_ID, position: 1, title: "Peinture" }),
    section({ id: "e2000000-0000-4000-8000-000000000001", versionId: HISTORY_V2_ID, position: 1, title: "Gros oeuvre" }),
    section({
      id: "e2000000-0000-4000-8000-000000000002",
      versionId: HISTORY_V2_ID,
      parentId: "e2000000-0000-4000-8000-000000000001",
      position: 1,
      title: "Fondations",
    }),
    section({
      id: "e2000000-0000-4000-8000-000000000003",
      versionId: HISTORY_V2_ID,
      position: 2,
      title: "Ligne ignoree",
      itemType: "item",
    }),
    section({ id: "e1000000-0000-4000-8000-000000000001", versionId: HISTORY_V1_ID, position: 1, title: "Electricite" }),
    section({
      id: "e1000000-0000-4000-8000-000000000002",
      versionId: HISTORY_V1_ID,
      position: 2,
      title: "Section d'un autre tenant",
      tenantId: OTHER_TENANT_ID,
    }),
  ];

  tables.estimate_templates = [
    {
      id: TEMPLATE_EMPTY_ID,
      tenant_id: TENANT_ID,
      name: "Modele vide",
      description: null,
      updated_at: "2026-02-01T09:00:00.000Z",
    },
    {
      id: TEMPLATE_FULL_ID,
      tenant_id: TENANT_ID,
      name: "Modele logement",
      description: "Logement collectif",
      updated_at: "2026-02-10T09:00:00.000Z",
    },
    {
      id: "b9000000-0000-4000-8000-000000000009",
      tenant_id: OTHER_TENANT_ID,
      name: "Modele d'un autre tenant",
      description: null,
      updated_at: "2026-02-11T09:00:00.000Z",
    },
  ];
  tables.estimate_template_items = [
    templateSection({ id: "f1000000-0000-4000-8000-000000000001", templateId: TEMPLATE_FULL_ID, position: 1, title: "Gros oeuvre" }),
    templateSection({
      id: "f1000000-0000-4000-8000-000000000002",
      templateId: TEMPLATE_FULL_ID,
      parentId: "f1000000-0000-4000-8000-000000000001",
      position: 1,
      title: "Maconnerie",
    }),
  ];

  tables.estimate_assemblies = [
    {
      id: "a5000000-0000-4000-8000-000000000001",
      tenant_id: TENANT_ID,
      name: "Electricite",
      description: "Bloc standard",
      updated_at: "2026-02-03T09:00:00.000Z",
    },
    {
      id: "a5000000-0000-4000-8000-000000000002",
      tenant_id: TENANT_ID,
      name: "   ",
      description: null,
      updated_at: "2026-02-02T09:00:00.000Z",
    },
    {
      id: "a5000000-0000-4000-8000-000000000003",
      tenant_id: TENANT_ID,
      name: "Cloisons",
      description: null,
      updated_at: "2026-02-01T09:00:00.000Z",
    },
  ];

  tables.dpgf_imports = [
    {
      id: OLDER_IMPORT_ID,
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      filename: "dpgf-ancien.csv",
      status: "completed",
      created_at: "2026-01-01T09:00:00.000Z",
      parse_mode: "csv",
      row_count: 2,
    },
    {
      id: LATEST_IMPORT_ID,
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      filename: "dpgf-lot-unique.xlsx",
      status: "completed",
      created_at: "2026-02-01T09:00:00.000Z",
      parse_mode: "xlsx",
      row_count: 5,
    },
  ];

  tables.affaire_briefs = [
    {
      id: "d9000000-0000-4000-8000-000000000009",
      project_id: PROJECT_ID,
      status: "brouillon",
      summary: "Brief non confirme",
      project_object: "",
      scope: [],
      lots: [],
      received_pieces: [],
      assumptions: [],
      vigilance_points: [],
      missing_elements: [],
    },
    {
      id: BRIEF_ID,
      project_id: PROJECT_ID,
      status: "confirme",
      summary: "Rehabilitation de 12 logements",
      project_object: "",
      scope: ["Logements", "Parties communes"],
      lots: ["Gros oeuvre", "Electricite"],
      received_pieces: ["CCTP"],
      assumptions: [],
      vigilance_points: ["Amiante"],
      missing_elements: [],
    },
  ];
  tables.affaire_brief_source_links = [
    {
      brief_id: BRIEF_ID,
      source_document_id: "doc-1",
      block_key: "lots",
      entry_index: 0,
      source_file_name: "cctp-lot-1.pdf",
    },
    {
      brief_id: BRIEF_ID,
      source_document_id: "doc-2",
      block_key: "lots",
      entry_index: 0,
      source_file_name: "plan-rdc.pdf",
    },
    {
      brief_id: BRIEF_ID,
      source_document_id: "doc-1",
      block_key: "summary",
      entry_index: 0,
      source_file_name: "cctp-lot-1.pdf",
    },
  ];

  tables.affaire_intake_documents = [
    cctpDocument({
      id: "doc-2",
      fileName: "cctp-annexe.pdf",
      priority: "secondary",
      lots: ["Annexe"],
      createdAt: "2026-02-05T09:00:00.000Z",
    }),
    cctpDocument({
      id: "doc-1",
      fileName: "cctp-lot-1.pdf",
      priority: "primary",
      lots: ["Gros oeuvre", "Menuiseries"],
      createdAt: "2026-02-04T09:00:00.000Z",
    }),
    cctpDocument({
      id: "doc-3",
      fileName: "cctp-en-cours.pdf",
      priority: "primary",
      lots: ["Pas encore televerse"],
      uploadStatus: "pending",
      createdAt: "2026-02-03T09:00:00.000Z",
    }),
  ];

  return tables;
}

/** Mapped rows past the 40-line DPGF cap, listed in reverse row order. */
function overCapMappedRows() {
  return Array.from({ length: 45 }, (_, index) =>
    mappedRow(`row-${String(index).padStart(2, "0")}`, 45 - index, `Lot ${index} > Ouvrage ${index}`)
  ) as never;
}

/** Every source, with enough template sections to push the bundle past its 80-entry cap. */
function overCapTables() {
  const tables = allSourcesTables();
  tables.estimate_assemblies = [
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `a6000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`,
      tenant_id: TENANT_ID,
      name: "Ouvrage repete",
      description: "Meme description",
      updated_at: `2026-02-${String(20 - index).padStart(2, "0")}T09:00:00.000Z`,
    })),
    {
      id: "a6000000-0000-4000-8000-000000000099",
      tenant_id: TENANT_ID,
      name: "Ouvrage unique",
      description: null,
      updated_at: "2026-01-01T09:00:00.000Z",
    },
  ];
  tables.estimate_templates.push(
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `b7000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`,
      tenant_id: TENANT_ID,
      name: `Modele ${index}`,
      description: null,
      updated_at: `2026-03-${String(10 + index).padStart(2, "0")}T09:00:00.000Z`,
    }))
  );
  tables.estimate_template_items.push(
    ...Array.from({ length: 24 }, (_, index) =>
      templateSection({
        id: `f7000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`,
        templateId: `b7000000-0000-4000-8000-0000000000${String(index % 8).padStart(2, "0")}`,
        position: index,
        title: `Chapitre modele ${index}`,
      })
    )
  );
  return tables;
}

/** The prompt lines listing one source's entries. */
function promptEntriesFor(prompt: string, sourceLabel: string) {
  const lines = promptBlock(prompt, "Sources:");
  const start = lines.findIndex((line) => line.startsWith(`- ${sourceLabel} [`));
  const next = lines.findIndex((line, index) => index > start && line.startsWith("- "));
  return lines.slice(start + 1, next === -1 ? undefined : next);
}

function historyVersion(id: string, versionNumber: number, title: string | null) {
  return { id, tenant_id: TENANT_ID, project_id: PROJECT_ID, version_number: versionNumber, title };
}

function template(id: string, name: string, description: string | null, updatedAt: string) {
  return { id, tenant_id: TENANT_ID, name, description, updated_at: updatedAt };
}

const READ_REFUSED: QueryError = { code: "XX000", message: "lecture refusee", details: null, hint: null };

function providerFailure() {
  return Object.assign(new Error("Analyse IA indisponible."), { code: "AI_LOCAL_DISABLED" });
}

function promptSent() {
  const [[options]] = vi.mocked(callStructuredAi).mock.calls;
  return (options as { prompt: string }).prompt;
}

function promptBlock(prompt: string, heading: string) {
  const lines = prompt.split("\n");
  const start = lines.indexOf(heading);
  const end = lines.indexOf("", start);
  return lines.slice(start + 1, end);
}

/** Inserted draft nodes with their random ids replaced by their position in the insert. */
function insertedNodes(rows: Row[]) {
  const position = new Map(rows.map((row, index) => [row.id, index]));
  return rows.map((row) => ({
    at: position.get(row.id),
    parent: row.parent_node_id === null ? null : position.get(row.parent_node_id),
    level: row.hierarchy_level,
    order: row.order_index,
    label: row.label,
    confidence: row.confidence,
    action: row.default_action,
    duplicate: row.duplicate_match_path,
    provenance: row.provenance,
    facts: row.facts,
    hypotheses: row.hypotheses,
    inferences: row.inferences,
  }));
}

async function generate(fake: ReturnType<typeof createSupabaseFake>) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fake.supabase as never);
  return generateEstimateStructureDraft(VERSION_ID, { strategy: "hybrid" });
}

describe("generateEstimateStructureDraft sources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchMappedRowsForImport).mockResolvedValue([]);
    vi.mocked(callStructuredAi).mockRejectedValue(providerFailure());
  });

  it("reports every source as unavailable and skips the provider when the affaire has none", async () => {
    const fake = createSupabaseFake({ tables: baseTables() });

    const result = await generate(fake);

    expect(result.sources).toEqual([
      { kind: "linked_dpgf", label: "DPGF lie", available: false, used: false, detail: "Aucun DPGF lie disponible." },
      { kind: "historical_versions", label: "Versions historiques", available: false, used: false, detail: "Aucun historique exploitable." },
      { kind: "template_library", label: "Bibliotheque templates", available: false, used: false, detail: "Aucun template disponible." },
      { kind: "assembly_library", label: "Bibliotheque ouvrages", available: false, used: false, detail: "Aucun ouvrage disponible." },
      { kind: "primary_cctp", label: "CCTP principal", available: false, used: false, detail: "Aucun CCTP principal exploitable dans l'intake." },
      { kind: "confirmed_brief", label: "Brief confirme", available: false, used: false, detail: "Aucun brief confirme disponible." },
      { kind: "project_notes", label: "Notes affaire", available: false, used: false, detail: "Aucune note affaire exploitable." },
    ]);
    expect(result.nodes).toEqual([]);
    expect(fake.draftInserts).toHaveLength(1);
    expect(fake.draftInserts[0].source_overview).toEqual(result.sources);
    expect(fake.draftInserts[0].generation_metadata).toMatchObject({
      used_fallback: true,
      source_entry_count: 0,
      failure_code: "ESTIMATE_STRUCTURE_DRAFT_NO_SOURCES",
    });
    expect(fake.draftNodeInserts).toEqual([]);
    expect(vi.mocked(fetchMappedRowsForImport)).not.toHaveBeenCalled();
    expect(vi.mocked(callStructuredAi)).not.toHaveBeenCalled();
    expect(sourceQueries(fake.queries)).toEqual([
      `dpgf_imports.select("id, filename, status, created_at, parse_mode, row_count").eq("tenant_id", "${TENANT_ID}").eq("project_id", "${PROJECT_ID}").order("created_at", {"ascending":false}).limit(1).maybeSingle()`,
      `estimate_versions.select("id, version_number, title").eq("tenant_id", "${TENANT_ID}").eq("project_id", "${PROJECT_ID}").neq("id", "${VERSION_ID}").order("version_number", {"ascending":false}).limit(5)`,
      `estimate_templates.select("id, name, description, updated_at").eq("tenant_id", "${TENANT_ID}").order("updated_at", {"ascending":false}).limit(10)`,
      `estimate_assemblies.select("id, name, description, updated_at").eq("tenant_id", "${TENANT_ID}").order("updated_at", {"ascending":false}).limit(12)`,
      `affaire_briefs.select("id, tenant_id, project_id, status, summary, project_object, scope, lots, received_pieces, assumptions, vigilance_points, missing_elements, updated_at").eq("project_id", "${PROJECT_ID}").eq("status", "confirme").maybeSingle()`,
      `affaire_intake_documents.select("id, file_name, document_kind, upload_status, classification_status, document_priority, extracted_metadata", {"count":"exact"}).eq("tenant_id", "${TENANT_ID}").eq("project_id", "${PROJECT_ID}").eq("document_kind", "cctp").eq("upload_status", "uploaded").eq("classification_status", "classified").order("created_at", {"ascending":true}).order("id", {"ascending":true})`,
    ]);
  });

  it("assembles every available source into summaries, prompt sources and fallback nodes", async () => {
    vi.mocked(fetchMappedRowsForImport).mockResolvedValue([
      mappedRow("row-c", 3, "Electricite > Eclairage"),
      mappedRow("row-b", 3, "Electricite > Tableau general"),
      mappedRow("row-a", 2, "Plomberie / Sanitaires"),
      mappedRow("row-d", 4, "Divers"),
      mappedRow("row-e", 5, null),
    ] as never);
    const fake = createSupabaseFake({ tables: allSourcesTables() });

    const result = await generate(fake);

    expect(vi.mocked(fetchMappedRowsForImport)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchMappedRowsForImport)).toHaveBeenCalledWith({
      supabase: fake.supabase,
      importId: LATEST_IMPORT_ID,
      tenantId: TENANT_ID,
    });
    expect(result.sources).toEqual([
      { kind: "linked_dpgf", label: "DPGF lie", available: true, used: true, detail: "dpgf-lot-unique.xlsx · 4 ligne(s) retenue(s)" },
      { kind: "historical_versions", label: "Versions historiques", available: true, used: true, detail: "2 version(s) analysee(s)" },
      { kind: "template_library", label: "Bibliotheque templates", available: true, used: true, detail: "2 template(s) pris en compte" },
      { kind: "assembly_library", label: "Bibliotheque ouvrages", available: true, used: true, detail: "3 ouvrage(s) explores" },
      {
        kind: "primary_cctp",
        label: "CCTP principal",
        available: true,
        used: true,
        detail: "cctp-lot-1.pdf expose 2 lot(s) detecte(s) reutilisables pour une structure préliminaire.",
      },
      { kind: "confirmed_brief", label: "Brief confirme", available: true, used: true, detail: "3 lien(s) de source relies au brief" },
      { kind: "project_notes", label: "Notes affaire", available: true, used: true, detail: "Contexte projet local utilise en fallback du brief E21." },
    ]);
    expect(fake.draftInserts[0].source_overview).toEqual(result.sources);
    expect(fake.draftInserts[0].generation_metadata).toMatchObject({
      used_fallback: true,
      source_entry_count: 23,
      failure_code: "AI_LOCAL_DISABLED",
    });

    expect(promptBlock(promptSent(), "Sources:")).toMatchInlineSnapshot(`
      [
        "- DPGF lie [linked_dpgf] (dpgf-lot-unique.xlsx · 4 ligne(s) retenue(s))",
        "  - Plomberie > Sanitaires :: Plomberie / Sanitaires",
        "  - Electricite > Tableau general :: Electricite > Tableau general",
        "  - Electricite > Eclairage :: Electricite > Eclairage",
        "  - Divers :: Divers",
        "- Versions historiques [historical_versions] (2 version(s) analysee(s))",
        "  - Gros oeuvre :: Variante",
        "  - Gros oeuvre > Fondations :: Variante",
        "  - Electricite",
        "- Bibliotheque templates [template_library] (2 template(s) pris en compte)",
        "  - Gros oeuvre :: Logement collectif",
        "  - Gros oeuvre > Maconnerie :: Logement collectif",
        "- Bibliotheque ouvrages [assembly_library] (3 ouvrage(s) explores)",
        "  - Electricite :: Bloc standard",
        "  - Cloisons",
        "- CCTP principal [primary_cctp] (cctp-lot-1.pdf expose 2 lot(s) detecte(s) reutilisables pour une structure préliminaire.)",
        "  - Gros oeuvre :: cctp-lot-1.pdf",
        "  - Menuiseries :: cctp-lot-1.pdf",
        "- Brief confirme [confirmed_brief] (3 lien(s) de source relies au brief)",
        "  - Brief confirme > Rehabilitation de 12 logements :: cctp-lot-1.pdf",
        "  - Brief confirme > Logements",
        "  - Brief confirme > Parties communes",
        "  - Brief confirme > Gros oeuvre :: cctp-lot-1.pdf · plan-rdc.pdf",
        "  - Brief confirme > Electricite",
        "  - Brief confirme > CCTP",
        "  - Brief confirme > Amiante",
        "- Notes affaire [project_notes] (Contexte projet local utilise en fallback du brief E21.)",
        "  - Gros oeuvre > Fondations :: Gros oeuvre > Fondations",
        "  - Menuiseries > Fenetres :: Menuiseries > Fenetres",
        "  - Peinture :: Peinture",
      ]
    `);
    expect(promptBlock(promptSent(), "Proposition heuristique initiale:")).toMatchInlineSnapshot(`
      [
        "- Brief confirme",
        "  - Amiante",
        "  - CCTP",
        "  - Electricite",
        "  - Gros oeuvre",
        "  - Logements",
        "  - Parties communes",
        "  - Rehabilitation de 12 logements",
        "- Gros oeuvre",
        "  - Fondations",
        "  - Maconnerie",
        "- Electricite",
        "  - Eclairage",
        "  - Tableau general",
        "- Menuiseries",
        "  - Fenetres",
        "- Divers",
        "- Plomberie",
        "  - Sanitaires",
        "- Peinture",
        "- Cloisons",
      ]
    `);
    expect(fake.draftNodeInserts).toHaveLength(1);
    expect(insertedNodes(fake.draftNodeInserts[0])).toMatchInlineSnapshot(`
      [
        {
          "action": "create",
          "at": 0,
          "confidence": 0.84,
          "duplicate": null,
          "facts": [
            "Brief confirme: Rehabilitation de 12 logements",
            "Brief confirme: Logements",
            "Brief confirme: Parties communes",
            "Brief confirme: Gros oeuvre",
          ],
          "hypotheses": [],
          "inferences": [
            "Titre consolide à partir de 7 source(s).",
          ],
          "label": "Brief confirme",
          "level": 1,
          "order": 0,
          "parent": null,
          "provenance": [
            {
              "excerpt": "cctp-lot-1.pdf",
              "label": "Brief confirme",
              "type": "brief",
            },
            {
              "excerpt": null,
              "label": "Brief confirme",
              "type": "brief",
            },
            {
              "excerpt": "cctp-lot-1.pdf · plan-rdc.pdf",
              "label": "Brief confirme",
              "type": "brief",
            },
          ],
        },
        {
          "action": "create",
          "at": 1,
          "confidence": 0.5875,
          "duplicate": null,
          "facts": [
            "Brief confirme: Amiante",
          ],
          "hypotheses": [],
          "inferences": [
            "Titre consolide à partir de 1 source(s).",
          ],
          "label": "Amiante",
          "level": 2,
          "order": 0,
          "parent": 0,
          "provenance": [
            {
              "excerpt": null,
              "label": "Brief confirme",
              "type": "brief",
            },
          ],
        },
        {
          "action": "create",
          "at": 2,
          "confidence": 0.5875,
          "duplicate": null,
          "facts": [
            "Brief confirme: CCTP",
          ],
          "hypotheses": [],
          "inferences": [
            "Titre consolide à partir de 1 source(s).",
          ],
          "label": "CCTP",
          "level": 2,
          "order": 1,
          "parent": 0,
          "provenance": [
            {
              "excerpt": null,
              "label": "Brief confirme",
              "type": "brief",
            },
          ],
        },
        {
          "action": "create",
          "at": 3,
          "confidence": 0.5875,
          "duplicate": null,
          "facts": [
            "Brief confirme: Electricite",
          ],
          "hypotheses": [],
          "inferences": [
            "Titre consolide à partir de 1 source(s).",
          ],
          "label": "Electricite",
          "level": 2,
          "order": 2,
          "parent": 0,
          "provenance": [
            {
              "excerpt": null,
              "label": "Brief confirme",
              "type": "brief",
            },
          ],
        },
        {
          "action": "create",
          "at": 4,
          "confidence": 0.5875,
          "duplicate": null,
          "facts": [
            "Brief confirme: Gros oeuvre",
          ],
          "hypotheses": [],
          "inferences": [
            "Titre consolide à partir de 1 source(s).",
          ],
          "label": "Gros oeuvre",
          "level": 2,
          "order": 3,
          "parent": 0,
          "provenance": [
            {
              "excerpt": "cctp-lot-1.pdf · plan-rdc.pdf",
              "label": "Brief confirme",
              "type": "brief",
            },
          ],
        },
        {
          "action": "create",
          "at": 5,
          "confidence": 0.5875,
          "duplicate": null,
          "facts": [
            "Brief confirme: Logements",
          ],
          "hypotheses": [],
          "inferences": [
            "Titre consolide à partir de 1 source(s).",
          ],
          "label": "Logements",
          "level": 2,
          "order": 4,
          "parent": 0,
          "provenance": [
            {
              "excerpt": null,
              "label": "Brief confirme",
              "type": "brief",
            },
          ],
        },
        {
          "action": "create",
          "at": 6,
          "confidence": 0.5875,
          "duplicate": null,
          "facts": [
            "Brief confirme: Parties communes",
          ],
          "hypotheses": [],
          "inferences": [
            "Titre consolide à partir de 1 source(s).",
          ],
          "label": "Parties communes",
          "level": 2,
          "order": 5,
          "parent": 0,
          "provenance": [
            {
              "excerpt": null,
              "label": "Brief confirme",
              "type": "brief",
            },
          ],
        },
        {
          "action": "create",
          "at": 7,
          "confidence": 0.5875,
          "duplicate": null,
          "facts": [
            "Brief confirme: Rehabilitation de 12 logements",
          ],
          "hypotheses": [],
          "inferences": [
            "Titre consolide à partir de 1 source(s).",
          ],
          "label": "Rehabilitation de 12 logements",
          "level": 2,
          "order": 6,
          "parent": 0,
          "provenance": [
            {
              "excerpt": "cctp-lot-1.pdf",
              "label": "Brief confirme",
              "type": "brief",
            },
          ],
        },
        {
          "action": "create",
          "at": 8,
          "confidence": 0.92,
          "duplicate": null,
          "facts": [
            "Observe dans V2: Gros oeuvre",
            "Observe dans V2: Gros oeuvre > Fondations",
            "Template "Modele logement" contient Gros oeuvre",
            "Template "Modele logement" contient Gros oeuvre > Maconnerie",
          ],
          "hypotheses": [],
          "inferences": [
            "Structure historisee sur une version précédente.",
            "Structure standardisee issue de la bibliotheque.",
            "Signal structurel issu du CCTP principal retenu par l'intake.",
            "Élément issu du contexte affaire local, à confirmer humainement.",
          ],
          "label": "Gros oeuvre",
          "level": 1,
          "order": 1,
          "parent": null,
          "provenance": [
            {
              "excerpt": "Variante",
              "label": "V2",
              "type": "history",
            },
            {
              "excerpt": "Logement collectif",
              "label": "Modele logement",
              "type": "template",
            },
            {
              "excerpt": "cctp-lot-1.pdf",
              "label": "CCTP principal",
              "type": "cctp",
            },
            {
              "excerpt": "Gros oeuvre > Fondations",
              "label": "Notes affaire",
              "type": "brief",
            },
          ],
        },
        {
          "action": "create",
          "at": 9,
          "confidence": 0.7974999999999999,
          "duplicate": null,
          "facts": [
            "Observe dans V2: Gros oeuvre > Fondations",
            "Notes affaire: Gros oeuvre > Fondations",
          ],
          "hypotheses": [],
          "inferences": [
            "Structure historisee sur une version précédente.",
            "Élément issu du contexte affaire local, à confirmer humainement.",
          ],
          "label": "Fondations",
          "level": 2,
          "order": 0,
          "parent": 8,
          "provenance": [
            {
              "excerpt": "Variante",
              "label": "V2",
              "type": "history",
            },
            {
              "excerpt": "Gros oeuvre > Fondations",
              "label": "Notes affaire",
              "type": "brief",
            },
          ],
        },
        {
          "action": "create",
          "at": 10,
          "confidence": 0.5775,
          "duplicate": null,
          "facts": [
            "Template "Modele logement" contient Gros oeuvre > Maconnerie",
          ],
          "hypotheses": [],
          "inferences": [
            "Structure standardisee issue de la bibliotheque.",
          ],
          "label": "Maconnerie",
          "level": 2,
          "order": 1,
          "parent": 8,
          "provenance": [
            {
              "excerpt": "Logement collectif",
              "label": "Modele logement",
              "type": "template",
            },
          ],
        },
        {
          "action": "create",
          "at": 11,
          "confidence": 0.92,
          "duplicate": null,
          "facts": [
            "Observe dans V1: Electricite",
            "Ligne DPGF détectée: Electricite > Tableau general",
            "Ligne DPGF détectée: Electricite > Eclairage",
            "Ouvrage disponible: Electricite",
          ],
          "hypotheses": [
            "Chapitrage propose à partir du libelle DPGF.",
            "L'ouvrage peut constituer un lot autonome ou un sous-chapitre.",
          ],
          "inferences": [
            "Structure historisee sur une version précédente.",
            "Sous-structure deduite depuis "Electricite > Tableau general".",
            "Sous-structure deduite depuis "Electricite > Eclairage".",
            "Regroupement propose à partir du catalogue d'ouvrages.",
          ],
          "label": "Electricite",
          "level": 1,
          "order": 2,
          "parent": null,
          "provenance": [
            {
              "excerpt": null,
              "label": "V1",
              "type": "history",
            },
            {
              "excerpt": "Electricite > Tableau general",
              "label": "dpgf-lot-unique.xlsx",
              "type": "dpgf",
            },
            {
              "excerpt": "Electricite > Eclairage",
              "label": "dpgf-lot-unique.xlsx",
              "type": "dpgf",
            },
            {
              "excerpt": "Bloc standard",
              "label": "Electricite",
              "type": "assembly",
            },
          ],
        },
        {
          "action": "create",
          "at": 12,
          "confidence": 0.5650000000000001,
          "duplicate": null,
          "facts": [
            "Ligne DPGF détectée: Electricite > Eclairage",
          ],
          "hypotheses": [
            "Chapitrage propose à partir du libelle DPGF.",
          ],
          "inferences": [
            "Sous-structure deduite depuis "Electricite > Eclairage".",
          ],
          "label": "Eclairage",
          "level": 2,
          "order": 0,
          "parent": 11,
          "provenance": [
            {
              "excerpt": "Electricite > Eclairage",
              "label": "dpgf-lot-unique.xlsx",
              "type": "dpgf",
            },
          ],
        },
        {
          "action": "create",
          "at": 13,
          "confidence": 0.5650000000000001,
          "duplicate": null,
          "facts": [
            "Ligne DPGF détectée: Electricite > Tableau general",
          ],
          "hypotheses": [
            "Chapitrage propose à partir du libelle DPGF.",
          ],
          "inferences": [
            "Sous-structure deduite depuis "Electricite > Tableau general".",
          ],
          "label": "Tableau general",
          "level": 2,
          "order": 1,
          "parent": 11,
          "provenance": [
            {
              "excerpt": "Electricite > Tableau general",
              "label": "dpgf-lot-unique.xlsx",
              "type": "dpgf",
            },
          ],
        },
        {
          "action": "create",
          "at": 14,
          "confidence": 0.8624999999999999,
          "duplicate": null,
          "facts": [
            "Lot detecte dans le CCTP principal: Menuiseries",
            "Notes affaire: Menuiseries > Fenetres",
          ],
          "hypotheses": [],
          "inferences": [
            "Signal structurel issu du CCTP principal retenu par l'intake.",
            "Élément issu du contexte affaire local, à confirmer humainement.",
          ],
          "label": "Menuiseries",
          "level": 1,
          "order": 3,
          "parent": null,
          "provenance": [
            {
              "excerpt": "cctp-lot-1.pdf",
              "label": "CCTP principal",
              "type": "cctp",
            },
            {
              "excerpt": "Menuiseries > Fenetres",
              "label": "Notes affaire",
              "type": "brief",
            },
          ],
        },
        {
          "action": "create",
          "at": 15,
          "confidence": 0.5575,
          "duplicate": null,
          "facts": [
            "Notes affaire: Menuiseries > Fenetres",
          ],
          "hypotheses": [],
          "inferences": [
            "Élément issu du contexte affaire local, à confirmer humainement.",
          ],
          "label": "Fenetres",
          "level": 2,
          "order": 0,
          "parent": 14,
          "provenance": [
            {
              "excerpt": "Menuiseries > Fenetres",
              "label": "Notes affaire",
              "type": "brief",
            },
          ],
        },
        {
          "action": "create",
          "at": 16,
          "confidence": 0.645,
          "duplicate": null,
          "facts": [
            "Ligne DPGF détectée: Divers",
          ],
          "hypotheses": [],
          "inferences": [
            "Titre consolide à partir de 1 source(s).",
          ],
          "label": "Divers",
          "level": 1,
          "order": 4,
          "parent": null,
          "provenance": [
            {
              "excerpt": "Divers",
              "label": "dpgf-lot-unique.xlsx",
              "type": "dpgf",
            },
          ],
        },
        {
          "action": "create",
          "at": 17,
          "confidence": 0.645,
          "duplicate": null,
          "facts": [
            "Ligne DPGF détectée: Plomberie / Sanitaires",
          ],
          "hypotheses": [
            "Chapitrage propose à partir du libelle DPGF.",
          ],
          "inferences": [
            "Sous-structure deduite depuis "Plomberie / Sanitaires".",
          ],
          "label": "Plomberie",
          "level": 1,
          "order": 5,
          "parent": null,
          "provenance": [
            {
              "excerpt": "Plomberie / Sanitaires",
              "label": "dpgf-lot-unique.xlsx",
              "type": "dpgf",
            },
          ],
        },
        {
          "action": "create",
          "at": 18,
          "confidence": 0.5650000000000001,
          "duplicate": null,
          "facts": [
            "Ligne DPGF détectée: Plomberie / Sanitaires",
          ],
          "hypotheses": [
            "Chapitrage propose à partir du libelle DPGF.",
          ],
          "inferences": [
            "Sous-structure deduite depuis "Plomberie / Sanitaires".",
          ],
          "label": "Sanitaires",
          "level": 2,
          "order": 0,
          "parent": 17,
          "provenance": [
            {
              "excerpt": "Plomberie / Sanitaires",
              "label": "dpgf-lot-unique.xlsx",
              "type": "dpgf",
            },
          ],
        },
        {
          "action": "merge",
          "at": 19,
          "confidence": 0.6375,
          "duplicate": "Peinture",
          "facts": [
            "Notes affaire: Peinture",
          ],
          "hypotheses": [],
          "inferences": [
            "Élément issu du contexte affaire local, à confirmer humainement.",
          ],
          "label": "Peinture",
          "level": 1,
          "order": 6,
          "parent": null,
          "provenance": [
            {
              "excerpt": "Peinture",
              "label": "Notes affaire",
              "type": "brief",
            },
          ],
        },
        {
          "action": "create",
          "at": 20,
          "confidence": 0.6325,
          "duplicate": null,
          "facts": [
            "Ouvrage disponible: Cloisons",
          ],
          "hypotheses": [
            "L'ouvrage peut constituer un lot autonome ou un sous-chapitre.",
          ],
          "inferences": [
            "Regroupement propose à partir du catalogue d'ouvrages.",
          ],
          "label": "Cloisons",
          "level": 1,
          "order": 7,
          "parent": null,
          "provenance": [
            {
              "excerpt": null,
              "label": "Cloisons",
              "type": "assembly",
            },
          ],
        },
      ]
    `);

    expect(sourceQueries(fake.queries)).toEqual([
      `dpgf_imports.select("id, filename, status, created_at, parse_mode, row_count").eq("tenant_id", "${TENANT_ID}").eq("project_id", "${PROJECT_ID}").order("created_at", {"ascending":false}).limit(1).maybeSingle()`,
      `estimate_versions.select("id, version_number, title").eq("tenant_id", "${TENANT_ID}").eq("project_id", "${PROJECT_ID}").neq("id", "${VERSION_ID}").order("version_number", {"ascending":false}).limit(5)`,
      `estimate_templates.select("id, name, description, updated_at").eq("tenant_id", "${TENANT_ID}").order("updated_at", {"ascending":false}).limit(10)`,
      `estimate_assemblies.select("id, name, description, updated_at").eq("tenant_id", "${TENANT_ID}").order("updated_at", {"ascending":false}).limit(12)`,
      `estimate_items.select("id, version_id, parent_id, item_type, title, position", {"count":"exact"}).eq("tenant_id", "${TENANT_ID}").eq("item_type", "section").in("version_id", ["${HISTORY_V2_ID}","${HISTORY_V1_ID}"])`,
      `estimate_template_items.select("id, template_id, parent_id, item_type, title, position", {"count":"exact"}).eq("tenant_id", "${TENANT_ID}").eq("item_type", "section").in("template_id", ["${TEMPLATE_FULL_ID}","${TEMPLATE_EMPTY_ID}"])`,
      `affaire_briefs.select("id, tenant_id, project_id, status, summary, project_object, scope, lots, received_pieces, assumptions, vigilance_points, missing_elements, updated_at").eq("project_id", "${PROJECT_ID}").eq("status", "confirme").maybeSingle()`,
      `affaire_intake_documents.select("id, file_name, document_kind, upload_status, classification_status, document_priority, extracted_metadata", {"count":"exact"}).eq("tenant_id", "${TENANT_ID}").eq("project_id", "${PROJECT_ID}").eq("document_kind", "cctp").eq("upload_status", "uploaded").eq("classification_status", "classified").order("created_at", {"ascending":true}).order("id", {"ascending":true})`,
      `affaire_brief_source_links.select("source_document_id, block_key, entry_index, source_file_name").eq("brief_id", "${BRIEF_ID}")`,
    ]);
  });

  it("marks sources available but unused when they yield no structure", async () => {
    vi.mocked(fetchMappedRowsForImport).mockRejectedValue(new Error("lecture des lignes impossible"));
    const tables = allSourcesTables();
    tables.estimate_items = [];
    tables.estimate_template_items = [];
    tables.estimate_assemblies = [
      {
        id: "a5000000-0000-4000-8000-000000000002",
        tenant_id: TENANT_ID,
        name: "   ",
        description: null,
        updated_at: "2026-02-02T09:00:00.000Z",
      },
    ];
    tables.affaire_briefs = [
      {
        id: BRIEF_ID,
        project_id: PROJECT_ID,
        status: "confirme",
        summary: "",
        project_object: "Objet sans liens",
        scope: [],
        lots: [],
        received_pieces: [],
        assumptions: [],
        vigilance_points: [],
        missing_elements: [],
      },
    ];
    tables.affaire_brief_source_links = [];
    tables.affaire_intake_documents = [
      cctpDocument({
        id: "doc-1",
        fileName: "cctp-sans-lots.pdf",
        priority: "primary",
        lots: [],
        createdAt: "2026-02-04T09:00:00.000Z",
      }),
    ];
    tables.estimate_versions[0].estimate_projects = {
      ...(tables.estimate_versions[0].estimate_projects as Row),
      notes: "   ",
    };
    const fake = createSupabaseFake({ tables });

    const result = await generate(fake);

    expect(result.sources).toEqual([
      { kind: "linked_dpgf", label: "DPGF lie", available: true, used: false, detail: "dpgf-lot-unique.xlsx · 0 ligne(s) retenue(s)" },
      { kind: "historical_versions", label: "Versions historiques", available: true, used: false, detail: "2 version(s) analysee(s)" },
      { kind: "template_library", label: "Bibliotheque templates", available: true, used: false, detail: "2 template(s) pris en compte" },
      { kind: "assembly_library", label: "Bibliotheque ouvrages", available: true, used: true, detail: "1 ouvrage(s) explores" },
      {
        kind: "primary_cctp",
        label: "CCTP principal",
        available: true,
        used: false,
        detail: "cctp-sans-lots.pdf est bien principal, mais ne remonte pas encore de lot defendable pour ouvrir la structure automatiquement.",
      },
      { kind: "confirmed_brief", label: "Brief confirme", available: true, used: false, detail: "Brief confirme sans liens de source exploites" },
      { kind: "project_notes", label: "Notes affaire", available: false, used: false, detail: "Aucune note affaire exploitable." },
    ]);
    expect(fake.draftInserts[0].generation_metadata).toMatchObject({ source_entry_count: 1 });
    expect(promptBlock(promptSent(), "Sources:")).toMatchInlineSnapshot(`
      [
        "- DPGF lie [linked_dpgf] (dpgf-lot-unique.xlsx · 0 ligne(s) retenue(s))",
        "- Versions historiques [historical_versions] (2 version(s) analysee(s))",
        "- Bibliotheque templates [template_library] (2 template(s) pris en compte)",
        "- Bibliotheque ouvrages [assembly_library] (1 ouvrage(s) explores)",
        "- CCTP principal [primary_cctp] (cctp-sans-lots.pdf est bien principal, mais ne remonte pas encore de lot defendable pour ouvrir la structure automatiquement.)",
        "- Brief confirme [confirmed_brief] (Brief confirme sans liens de source exploites)",
        "  - Brief confirme > Objet sans liens",
      ]
    `);
  });

  it("keeps the first 40 DPGF lines, dedupes identical entries and caps the bundle at 80 entries", async () => {
    vi.mocked(fetchMappedRowsForImport).mockResolvedValue(overCapMappedRows());
    const tables = overCapTables();
    const fake = createSupabaseFake({ tables });

    const result = await generate(fake);

    expect(result.sources[0]).toEqual({
      kind: "linked_dpgf",
      label: "DPGF lie",
      available: true,
      used: true,
      detail: "dpgf-lot-unique.xlsx · 40 ligne(s) retenue(s)",
    });
    expect(result.sources[2].detail).toBe("10 template(s) pris en compte");
    expect(result.sources[3].detail).toBe("11 ouvrage(s) explores");
    expect(fake.draftInserts[0].generation_metadata).toMatchObject({ source_entry_count: 80 });
    expect(promptBlock(promptSent(), "Sources:")).toMatchInlineSnapshot(`
      [
        "- DPGF lie [linked_dpgf] (dpgf-lot-unique.xlsx · 40 ligne(s) retenue(s))",
        "  - Lot 44 > Ouvrage 44 :: Lot 44 > Ouvrage 44",
        "  - Lot 43 > Ouvrage 43 :: Lot 43 > Ouvrage 43",
        "  - Lot 42 > Ouvrage 42 :: Lot 42 > Ouvrage 42",
        "  - Lot 41 > Ouvrage 41 :: Lot 41 > Ouvrage 41",
        "  - Lot 40 > Ouvrage 40 :: Lot 40 > Ouvrage 40",
        "  - Lot 39 > Ouvrage 39 :: Lot 39 > Ouvrage 39",
        "  - Lot 38 > Ouvrage 38 :: Lot 38 > Ouvrage 38",
        "  - Lot 37 > Ouvrage 37 :: Lot 37 > Ouvrage 37",
        "  - Lot 36 > Ouvrage 36 :: Lot 36 > Ouvrage 36",
        "  - Lot 35 > Ouvrage 35 :: Lot 35 > Ouvrage 35",
        "  - Lot 34 > Ouvrage 34 :: Lot 34 > Ouvrage 34",
        "  - Lot 33 > Ouvrage 33 :: Lot 33 > Ouvrage 33",
        "- Versions historiques [historical_versions] (2 version(s) analysee(s))",
        "  - Gros oeuvre :: Variante",
        "  - Gros oeuvre > Fondations :: Variante",
        "  - Electricite",
        "- Bibliotheque templates [template_library] (10 template(s) pris en compte)",
        "  - Chapitre modele 7",
        "  - Chapitre modele 15",
        "  - Chapitre modele 23",
        "  - Chapitre modele 6",
        "  - Chapitre modele 14",
        "  - Chapitre modele 22",
        "  - Chapitre modele 5",
        "  - Chapitre modele 13",
        "  - Chapitre modele 21",
        "  - Chapitre modele 4",
        "  - Chapitre modele 12",
        "  - Chapitre modele 20",
        "- Bibliotheque ouvrages [assembly_library] (11 ouvrage(s) explores)",
        "- CCTP principal [primary_cctp] (cctp-lot-1.pdf expose 2 lot(s) detecte(s) reutilisables pour une structure préliminaire.)",
        "  - Gros oeuvre :: cctp-lot-1.pdf",
        "  - Menuiseries :: cctp-lot-1.pdf",
        "- Brief confirme [confirmed_brief] (3 lien(s) de source relies au brief)",
        "  - Brief confirme > Rehabilitation de 12 logements :: cctp-lot-1.pdf",
        "  - Brief confirme > Logements",
        "  - Brief confirme > Parties communes",
        "  - Brief confirme > Gros oeuvre :: cctp-lot-1.pdf · plan-rdc.pdf",
        "  - Brief confirme > Electricite",
        "  - Brief confirme > CCTP",
        "  - Brief confirme > Amiante",
        "- Notes affaire [project_notes] (Contexte projet local utilise en fallback du brief E21.)",
        "  - Gros oeuvre > Fondations :: Gros oeuvre > Fondations",
        "  - Menuiseries > Fenetres :: Menuiseries > Fenetres",
      ]
    `);
  });

  const SOURCE_FAILURES: Array<{
    name: string;
    message: string;
    matches: (query: RecordedQuery) => boolean;
    queriedTables: string[];
  }> = [
    {
      name: "the linked DPGF import",
      message: "Impossible de charger la source DPGF liée.",
      matches: (query) => query.table === "dpgf_imports",
      queriedTables: ["dpgf_imports", "estimate_versions", "estimate_templates", "estimate_assemblies"],
    },
    {
      name: "the historical versions",
      message: "Impossible de charger les historiques de structure.",
      matches: (query) =>
        query.table === "estimate_versions" && query.calls.some((call) => call.method === "neq"),
      queriedTables: ["dpgf_imports", "estimate_versions", "estimate_templates", "estimate_assemblies"],
    },
    {
      name: "the template library",
      message: "Impossible de charger la bibliotheque de templates.",
      matches: (query) => query.table === "estimate_templates",
      queriedTables: ["dpgf_imports", "estimate_versions", "estimate_templates", "estimate_assemblies"],
    },
    {
      name: "the assembly library",
      message: "Impossible de charger la bibliotheque d'ouvrages.",
      matches: (query) => query.table === "estimate_assemblies",
      queriedTables: ["dpgf_imports", "estimate_versions", "estimate_templates", "estimate_assemblies"],
    },
    {
      name: "the historical sections",
      message: "Impossible de charger les sections historiques.",
      matches: (query) =>
        query.table === "estimate_items" && query.calls.some((call) => call.method === "in"),
      queriedTables: [
        "dpgf_imports",
        "estimate_versions",
        "estimate_templates",
        "estimate_assemblies",
        "estimate_items",
        "estimate_template_items",
      ],
    },
    {
      name: "the template sections",
      message: "Impossible de charger les sections templates.",
      matches: (query) => query.table === "estimate_template_items",
      queriedTables: [
        "dpgf_imports",
        "estimate_versions",
        "estimate_templates",
        "estimate_assemblies",
        "estimate_items",
        "estimate_template_items",
      ],
    },
    {
      name: "the confirmed brief",
      message: "Impossible de charger le brief affaire confirme.",
      matches: (query) => query.table === "affaire_briefs",
      queriedTables: [
        "dpgf_imports",
        "estimate_versions",
        "estimate_templates",
        "estimate_assemblies",
        "estimate_items",
        "estimate_template_items",
        "affaire_briefs",
        "affaire_intake_documents",
      ],
    },
    {
      name: "the primary CCTP documents",
      message: "Impossible de charger le CCTP principal de l'intake.",
      matches: (query) => query.table === "affaire_intake_documents",
      queriedTables: [
        "dpgf_imports",
        "estimate_versions",
        "estimate_templates",
        "estimate_assemblies",
        "estimate_items",
        "estimate_template_items",
        "affaire_briefs",
        "affaire_intake_documents",
      ],
    },
    {
      name: "the confirmed brief source links",
      message: "Impossible de charger les sources du brief affaire confirme.",
      matches: (query) => query.table === "affaire_brief_source_links",
      queriedTables: [
        "dpgf_imports",
        "estimate_versions",
        "estimate_templates",
        "estimate_assemblies",
        "estimate_items",
        "estimate_template_items",
        "affaire_briefs",
        "affaire_intake_documents",
        "affaire_brief_source_links",
      ],
    },
  ];

  it.each(SOURCE_FAILURES)(
    "stops before any draft write when $name cannot be read",
    async ({ message, matches, queriedTables }) => {
      const fake = createSupabaseFake({
        tables: allSourcesTables(),
        failRead: (query) =>
          matches(query)
            ? { code: "XX000", message: "lecture refusee", details: null, hint: null }
            : null,
      });

      await expect(generate(fake)).rejects.toMatchObject({
        status: 400,
        code: "BAD_REQUEST",
        message,
      });
      expect(sourceQueries(fake.queries).map((query) => query.split(".")[0])).toEqual(
        queriedTables
      );
      expect(fake.supabase.rpc).not.toHaveBeenCalled();
      expect(fake.draftInserts).toEqual([]);
      expect(vi.mocked(callStructuredAi)).not.toHaveBeenCalled();
    }
  );

  it("reports the first failing library read in check order when several fail together", async () => {
    const fake = createSupabaseFake({
      tables: allSourcesTables(),
      failRead: (query) =>
        ["estimate_assemblies", "estimate_templates"].includes(query.table) ||
        (query.table === "estimate_versions" && query.calls.some((call) => call.method === "neq"))
          ? { code: "XX000", message: "lecture refusee", details: null, hint: null }
          : null,
    });

    await expect(generate(fake)).rejects.toMatchObject({
      message: "Impossible de charger les historiques de structure.",
    });
  });

  it("reports the historical sections before the template sections when both fail", async () => {
    const fake = createSupabaseFake({
      tables: allSourcesTables(),
      failRead: (query) =>
        query.table === "estimate_template_items" ||
        (query.table === "estimate_items" && query.calls.some((call) => call.method === "in"))
          ? { code: "XX000", message: "lecture refusee", details: null, hint: null }
          : null,
    });

    await expect(generate(fake)).rejects.toMatchObject({
      message: "Impossible de charger les sections historiques.",
    });
  });

  it("maps a row-level security refusal on a source read to an access error", async () => {
    const fake = createSupabaseFake({
      tables: allSourcesTables(),
      failRead: (query) =>
        query.table === "affaire_brief_source_links"
          ? { code: "42501", message: "permission denied", details: null, hint: null }
          : null,
    });

    await expect(generate(fake)).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });

  it("issues each source batch concurrently and waits for it before the next one", async () => {
    const fake = createSupabaseFake({ tables: allSourcesTables(), holdResults: true });
    vi.mocked(fetchMappedRowsForImport).mockImplementation(() =>
      fake.hold("fetchMappedRowsForImport", [mappedRow("row-a", 2, "Plomberie / Sanitaires")] as never)
    );

    const { rounds, error } = await readRounds(fake, () => generate(fake));

    expect(error).toBeUndefined();
    expect(rounds).toEqual([
      ["tenant_memberships"],
      ["estimate_versions"],
      ["draft_locks"],
      ["estimate_items"],
      ["dpgf_imports", "estimate_versions", "estimate_templates", "estimate_assemblies"],
      ["estimate_items", "estimate_template_items", "fetchMappedRowsForImport"],
      ["affaire_briefs", "affaire_intake_documents"],
      ["affaire_brief_source_links"],
    ]);
  });

  it("dedupes entries on kind, label, normalized path and excerpt before counting them", async () => {
    const tables = allSourcesTables();
    tables.estimate_templates.push(
      template("b3000000-0000-4000-8000-000000000003", "Modele logement", "Logement collectif", "2026-02-09T09:00:00.000Z"),
      template("b4000000-0000-4000-8000-000000000004", "Modele logement", "Autre description", "2026-02-08T09:00:00.000Z"),
      template("b5000000-0000-4000-8000-000000000005", "Modele bis", "Logement collectif", "2026-02-07T09:00:00.000Z")
    );
    tables.estimate_template_items.push(
      // Same template name, description and normalized paths as "Modele logement": two duplicates.
      templateSection({ id: "f3000000-0000-4000-8000-000000000001", templateId: "b3000000-0000-4000-8000-000000000003", position: 1, title: "GROS OEUVRE" }),
      templateSection({
        id: "f3000000-0000-4000-8000-000000000002",
        templateId: "b3000000-0000-4000-8000-000000000003",
        parentId: "f3000000-0000-4000-8000-000000000001",
        position: 1,
        title: "Maconnerie",
      }),
      // Differs only by excerpt, then only by label: both are kept.
      templateSection({ id: "f4000000-0000-4000-8000-000000000001", templateId: "b4000000-0000-4000-8000-000000000004", position: 1, title: "Gros oeuvre" }),
      templateSection({ id: "f5000000-0000-4000-8000-000000000001", templateId: "b5000000-0000-4000-8000-000000000005", position: 1, title: "Gros oeuvre" })
    );
    const fake = createSupabaseFake({ tables });

    const result = await generate(fake);

    expect(result.sources[2].detail).toBe("5 template(s) pris en compte");
    // 19 entries for allSourcesTables without DPGF rows, plus 4 template entries of which 2
    // are duplicates.
    expect(fake.draftInserts[0].generation_metadata).toMatchObject({ source_entry_count: 21 });
    expect(promptEntriesFor(promptSent(), "Bibliotheque templates")).toEqual([
      "  - GROS OEUVRE :: Logement collectif",
      "  - GROS OEUVRE > Maconnerie :: Logement collectif",
      "  - Gros oeuvre :: Autre description",
      "  - Gros oeuvre :: Logement collectif",
    ]);
  });

  it("applies the 80-entry cap after dedupe", async () => {
    vi.mocked(fetchMappedRowsForImport).mockResolvedValue(overCapMappedRows());
    const tables = overCapTables();
    // Two more copies of V2 (same number, title and sections): four duplicates of the
    // heaviest entries, which a cap applied first would keep and then remove.
    tables.estimate_versions.push(
      historyVersion("a3000000-0000-4000-8000-000000000003", 2, "Variante"),
      historyVersion("a4000000-0000-4000-8000-000000000004", 2, "Variante")
    );
    ["a3000000-0000-4000-8000-000000000003", "a4000000-0000-4000-8000-000000000004"].forEach((versionId, index) => {
      tables.estimate_items.push(
        section({ id: `e${index + 3}000000-0000-4000-8000-000000000001`, versionId, position: 1, title: "Gros oeuvre" }),
        section({
          id: `e${index + 3}000000-0000-4000-8000-000000000002`,
          versionId,
          parentId: `e${index + 3}000000-0000-4000-8000-000000000001`,
          position: 1,
          title: "Fondations",
        })
      );
    });
    const fake = createSupabaseFake({ tables });

    const result = await generate(fake);

    expect(result.sources[1].detail).toBe("4 version(s) analysee(s)");
    expect(fake.draftInserts[0].generation_metadata).toMatchObject({ source_entry_count: 80 });
    expect(promptEntriesFor(promptSent(), "Versions historiques")).toEqual([
      "  - Gros oeuvre :: Variante",
      "  - Gros oeuvre > Fondations :: Variante",
      "  - Electricite",
    ]);
  });

  it("reports the confirmed brief before the CCTP documents when both fail", async () => {
    const fake = createSupabaseFake({
      tables: allSourcesTables(),
      failRead: (query) =>
        ["affaire_briefs", "affaire_intake_documents"].includes(query.table) ? READ_REFUSED : null,
    });

    await expect(generate(fake)).rejects.toMatchObject({
      message: "Impossible de charger le brief affaire confirme.",
    });
  });

  it("uses a confirmed brief that has a summary but no source links", async () => {
    const tables = allSourcesTables();
    tables.affaire_brief_source_links = [];
    const fake = createSupabaseFake({ tables });

    const result = await generate(fake);

    expect(result.sources[5]).toEqual({
      kind: "confirmed_brief",
      label: "Brief confirme",
      available: true,
      used: true,
      detail: "Brief confirme sans liens de source exploites",
    });
  });

  it("stops before the brief and CCTP reads when the linked DPGF rows cannot be normalized", async () => {
    vi.mocked(fetchMappedRowsForImport).mockResolvedValue([null] as never);
    const fake = createSupabaseFake({ tables: allSourcesTables() });

    await expect(generate(fake)).rejects.toBeInstanceOf(TypeError);
    expect(sourceQueries(fake.queries).map((query) => query.split(".")[0])).toEqual([
      "dpgf_imports",
      "estimate_versions",
      "estimate_templates",
      "estimate_assemblies",
      "estimate_items",
      "estimate_template_items",
    ]);
    expect(fake.draftInserts).toEqual([]);
  });
});
