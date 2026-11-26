import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryRestApi } from "@/test/in-memory-rest-api";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createOptionalServiceRoleClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@react-pdf/renderer", () => ({
  Document: "Document",
  Page: "Page",
  Text: "Text",
  View: "View",
  Image: "Image",
  StyleSheet: { create: <T,>(styles: T) => styles },
  renderToBuffer: vi.fn(),
}));

import { loadEstimateReading } from "@/lib/assistant/estimate-reading-server";
import { ApiError } from "@/lib/http/api-response";
import {
  fetchGeneratedOuvrageDraft,
  fetchGeneratedOuvrageSubdetailDraft,
  generateOuvragesFromText,
  insertGeneratedOuvrages,
  listResumableGeneratedOuvrageDrafts,
  rejectGeneratedOuvrageDraft,
} from "@/lib/estimates/generated-ouvrages";
import { readEstimateLineOfferChoiceSuggestion } from "@/lib/estimates/offer-choice-server";
import {
  generateEstimatePdfNow,
  getEstimatePdfLayoutConfiguration,
  getEstimatePdfStatus,
  markEstimatePdfFailed,
  markEstimatePdfProcessing,
  resolveEstimatePdfPreviewLayout,
} from "@/lib/estimates/pdf-generator";
import { DEFAULT_ESTIMATE_PDF_LAYOUT } from "@/lib/estimates/pdf-layout";
import { listEstimateApprovalDecisionJournal } from "@/lib/estimates/approval-decision-journal-server";
import { getEstimateApprovalSummary } from "@/lib/estimates/approval-summary-server";
import {
  applyEstimateStructureDraft,
  generateEstimateStructureDraft,
  getEstimateStructureDraft,
} from "@/lib/estimates/structure-drafts";
import { getEstimateVersionDetails } from "@/lib/estimates/version-read-server";
import { listEstimateVersionVariants } from "@/lib/estimates/version-list-server";
import {
  fetchVersionZeroDraftSummary,
  generateVersionZeroDraft,
  materializeVersionZeroDraft,
} from "@/lib/estimates/version-zero-drafts";
import { createOptionalServiceRoleClient, createServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Who reaches an estimate version, entered through the functions production calls. Each rule
// below is the one decided for its entry points; a copy of the access rule that answers
// differently for one role makes its row fail.

type Row = Record<string, unknown>;
type Person = "owner" | "admin" | "director" | "member" | "outsider";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT_ID = "23232323-2323-4323-8323-232323232323";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "55555555-5555-4555-8555-555555555555";
const DRAFT_ID = "66666666-6666-4666-8666-666666666666";
const LOCK_SESSION_ID = "77777777-7777-4777-8777-777777777777";
const OPERATION_KEY = "88888888-8888-4888-8888-888888888888";

const PEOPLE: Record<Person, { userId: string; tenantId: string; role: string }> = {
  // The owner is an engineer: owning the project is what admits them, not their role.
  owner: { userId: "11111111-1111-4111-8111-111111111111", tenantId: TENANT_ID, role: "engineer" },
  admin: { userId: "11111111-1111-4111-8111-111111111112", tenantId: TENANT_ID, role: "admin" },
  director: { userId: "11111111-1111-4111-8111-111111111113", tenantId: TENANT_ID, role: "director" },
  member: { userId: "11111111-1111-4111-8111-111111111114", tenantId: TENANT_ID, role: "engineer" },
  // An admin of another tenant: the tenant boundary holds whatever the role.
  outsider: { userId: "11111111-1111-4111-8111-111111111115", tenantId: OTHER_TENANT_ID, role: "admin" },
};

function membership(person: Person): Row {
  const { userId, tenantId, role } = PEOPLE[person];
  return {
    id: `m-${userId}`,
    tenant_id: tenantId,
    user_id: userId,
    role,
    is_default: true,
    created_at: "2026-11-01T10:00:00.000Z",
    updated_at: "2026-11-01T10:00:00.000Z",
    tenants: { is_active: true, name: "Tenant fictif" },
    // The fixture filters on flat columns: the active-tenant join filter reads this key.
    "tenants.is_active": true,
  };
}

function projectRow(isArchived: boolean): Row {
  return {
    id: PROJECT_ID,
    tenant_id: TENANT_ID,
    user_id: PEOPLE.owner.userId,
    name: "Affaire fictive",
    reference: "REF-FICTIVE",
    estimate_reference: null,
    site_address: null,
    client_name: "Client fictif",
    notes: null,
    is_archived: isArchived,
  };
}

function versionRow(isArchived: boolean): Row {
  return {
    id: VERSION_ID,
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    version_number: 1,
    status: "draft",
    title: "Version fictive",
    updated_at: "2026-11-02T09:00:00.000Z",
    content_revision: 1,
    calc_engine_version: 3,
    calc_snapshot_content_revision: null,
    calc_snapshot_context: null,
    parent_version_id: null,
    variant_label: null,
    margin_multiplier: 1,
    margin_mode: "fixed",
    margin_bp: 0,
    discount_bp: 0,
    discount_amount_cents: null,
    tax_rate_bp: 2000,
    rounding_mode: "none",
    rounding_step_cents: 1,
    sale_coefficient_fo: 1.3,
    sale_coefficient_mo: 1.2,
    total_ht_cents: 0,
    total_tax_cents: 0,
    total_ttc_cents: 0,
    currency: "EUR",
    exclusions: null,
    approval_status: "not_required",
    approval_summary: null,
    approval_evaluated_at: null,
    estimate_projects: projectRow(isArchived),
  };
}

function signIn(person: Person, isArchived: boolean) {
  const tables: Record<string, Row[]> = {
    tenant_memberships: (Object.keys(PEOPLE) as Person[]).map(membership),
    // The affaire itself, read by the entry points that follow the affaire rule.
    estimate_projects: [projectRow(isArchived)],
    estimate_versions: [versionRow(isArchived)],
    estimate_items: [
      { id: ITEM_ID, tenant_id: TENANT_ID, version_id: VERSION_ID, item_type: "line", source_metadata: null },
    ],
  };
  const api = createInMemoryRestApi(tables, {
    "rpc/read_estimate_version_items": () => [],
  });
  const from = api.client.from.bind(api.client);
  const rpc = ((name: string, ...args: unknown[]) =>
    // No application was recorded under the operation key: insertion goes on to its access check.
    name === "get_generated_ouvrage_application_receipt"
      ? Promise.resolve({ data: null, error: null })
      : (api.client.rpc as (...rpcArgs: unknown[]) => unknown)(name, ...args)) as typeof api.client.rpc;
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: PEOPLE[person].userId } }, error: null }),
    },
    from,
    rpc,
    storage: api.client.storage,
  } as never);
  vi.mocked(createServiceRoleClient).mockReturnValue({ from, rpc } as never);
  vi.mocked(createOptionalServiceRoleClient).mockReturnValue(null);
}

const HIDDEN = "404 NOT_FOUND: Version de chiffrage introuvable.";
const ARCHIVED = "409 CONFLICT: Cette affaire est archivée.";
const WRITER_ROLE_REQUIRED =
  "403 ESTIMATE_WRITE_ROLE_REQUIRED: Cette action est réservée aux administrateurs et aux chiffreurs.";
// Refusals met after the access rule, on the fixture's single draft version without lock, draft or recorded work.
const LOCK_REQUIRED = "409 LOCK_REQUIRED: Un verrou actif est requis pour modifier cette version brouillon.";
const NO_SUCH_DRAFT = "404 NOT_FOUND: Ressource introuvable.";
const ENGINE_3_UNAVAILABLE =
  "EstimateEngineUnavailableError: Ce devis utilise le moteur de calcul 3, pas encore disponible pour cette action.";
const REVIEW_UNREADABLE =
  "503 GENERATED_OUVRAGE_READ_UNAVAILABLE: Impossible de vérifier le travail enregistré. Réessayez la lecture.";
const OUTCOME_UNREADABLE =
  "503 GENERATED_OUVRAGE_OUTCOME_UNKNOWN: Le résultat de cette opération doit être vérifié. Conservez la même demande avant de réessayer.";
const PDF_CLAIM_UNREADABLE = "400 ESTIMATE_PDF_GENERATION_INVALID_RESPONSE: La base a renvoye une tentative PDF incomplete.";
const EDITOR_READ_UNREADABLE = "Error: Les données du chiffrage sont invalides. Rechargez le devis.";

function signatureOf(error: unknown) {
  if (error instanceof ApiError) return `${error.status} ${error.code}: ${error.message}`;
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

type EntryPoint = {
  name: string;
  call: () => Promise<unknown>;
  /** The refusals this entry point meets after the access rule: the version was reached. */
  afterAccess?: string[];
  /** How this entry point answers a version it hides, when it words it its own way. */
  hiddenAs?: string;
  /** People a role check refuses before the access rule is asked. */
  refusedBefore?: Partial<Record<Person, string>>;
};

/** What the person meets: the version, a 404 that does not tell it exists, the archived refusal, or anything else. */
async function outcomeOf(entryPoint: EntryPoint): Promise<string> {
  try {
    await entryPoint.call();
    return "reached";
  } catch (error) {
    const signature = signatureOf(error);
    if (signature === (entryPoint.hiddenAs ?? HIDDEN)) return "hidden";
    if (signature === ARCHIVED) return "archived";
    if (entryPoint.afterAccess?.includes(signature)) return "reached";
    return `refused ${signature}`;
  }
}

type Expected = Record<Person, string>;

const EDITOR: Expected = { owner: "reached", admin: "reached", director: "hidden", member: "hidden", outsider: "hidden" };
const EDITOR_ON_ARCHIVED: Expected = { ...EDITOR, owner: "archived", admin: "archived" };
const EDITOR_OR_APPROVAL_READER: Expected = { ...EDITOR, director: "reached" };
const AFFAIRE_READER: Expected = { ...EDITOR, director: "reached" };
const HIDDEN_FROM_EVERYONE: Expected = { owner: "hidden", admin: "hidden", director: "hidden", member: "hidden", outsider: "hidden" };
const WRITERS_ONLY = { director: WRITER_ROLE_REQUIRED };

const RULES: Array<{ rule: string; entryPoints: EntryPoint[]; active: Expected; archived: Expected }> = [
  {
    rule: "editor reads and writes: the project's owner or an admin, archived project included",
    entryPoints: [
      { name: "getEstimateVersionDetails", call: () => getEstimateVersionDetails(VERSION_ID), afterAccess: [EDITOR_READ_UNREADABLE] },
      {
        name: "readEstimateLineOfferChoiceSuggestion",
        call: () => readEstimateLineOfferChoiceSuggestion({ versionId: VERSION_ID, itemId: ITEM_ID }),
      },
    ],
    active: EDITOR,
    archived: EDITOR,
  },
  {
    // The assistant's estimate tools follow the affaire read rule (`requireAffaireAccess`), not this loader.
    rule: "assistant estimate reads: the affaire's read rule, owner, admin or director, refused to everyone on an archived affaire",
    entryPoints: [
      {
        name: "loadEstimateReading (assistant)",
        call: () => loadEstimateReading({ versionId: VERSION_ID, projectId: PROJECT_ID }),
        // An archived affaire is answered like a missing one, with the same words.
        hiddenAs: "AssistantToolError: Ce devis est introuvable ou vous n’y avez pas accès.",
      },
    ],
    active: AFFAIRE_READER,
    archived: HIDDEN_FROM_EVERYONE,
  },
  {
    rule: "AI drafts (structure, version zero, generated ouvrages): the editor's rule, refused on an archived project",
    entryPoints: [
      { name: "getEstimateStructureDraft", call: () => getEstimateStructureDraft(VERSION_ID, DRAFT_ID), afterAccess: [NO_SUCH_DRAFT] },
      {
        name: "generateEstimateStructureDraft",
        call: () => generateEstimateStructureDraft(VERSION_ID, {} as never),
        afterAccess: [LOCK_REQUIRED],
        refusedBefore: WRITERS_ONLY,
      },
      {
        name: "applyEstimateStructureDraft",
        call: () => applyEstimateStructureDraft(VERSION_ID, DRAFT_ID, { mode: "append", selected_root_node_ids: [] } as never),
        afterAccess: [LOCK_REQUIRED],
        refusedBefore: WRITERS_ONLY,
      },
      { name: "fetchVersionZeroDraftSummary", call: () => fetchVersionZeroDraftSummary({ versionId: VERSION_ID }) },
      {
        name: "generateVersionZeroDraft",
        call: () => generateVersionZeroDraft({ versionId: VERSION_ID, ai: { source: "fallback" } }),
        afterAccess: [ENGINE_3_UNAVAILABLE],
        refusedBefore: WRITERS_ONLY,
      },
      {
        name: "materializeVersionZeroDraft",
        call: () => materializeVersionZeroDraft({ versionId: VERSION_ID, draftId: DRAFT_ID }),
        afterAccess: [ENGINE_3_UNAVAILABLE],
        refusedBefore: WRITERS_ONLY,
      },
      { name: "listResumableGeneratedOuvrageDrafts", call: () => listResumableGeneratedOuvrageDrafts({ versionId: VERSION_ID }) },
      {
        name: "fetchGeneratedOuvrageDraft",
        call: () => fetchGeneratedOuvrageDraft({ versionId: VERSION_ID, draftId: DRAFT_ID }),
        afterAccess: [NO_SUCH_DRAFT],
      },
      {
        name: "fetchGeneratedOuvrageSubdetailDraft",
        call: () => fetchGeneratedOuvrageSubdetailDraft({ versionId: VERSION_ID, draftId: DRAFT_ID, candidateId: ITEM_ID }),
        afterAccess: [REVIEW_UNREADABLE],
      },
      {
        name: "generateOuvragesFromText",
        call: () => generateOuvragesFromText({
          projectId: PROJECT_ID, versionId: VERSION_ID, draftLockSessionId: LOCK_SESSION_ID,
          sourceKind: "free_text", sourceText: "Cloison fictive",
        } as never),
        afterAccess: [LOCK_REQUIRED],
        refusedBefore: WRITERS_ONLY,
      },
      {
        name: "insertGeneratedOuvrages",
        call: () => insertGeneratedOuvrages({
          versionId: VERSION_ID, draftId: DRAFT_ID, draftLockSessionId: LOCK_SESSION_ID, operationKey: OPERATION_KEY,
          expectedUpdatedAt: "2026-11-02T09:00:00.000Z",
          acceptedCandidates: [{
            candidateId: ITEM_ID, designation: "Cloison fictive", unit: null, quantity: null, lotId: null,
            reviewToken: "a".repeat(64),
          }],
        }),
        afterAccess: [LOCK_REQUIRED, REVIEW_UNREADABLE],
        refusedBefore: WRITERS_ONLY,
      },
      {
        name: "rejectGeneratedOuvrageDraft",
        call: () => rejectGeneratedOuvrageDraft({
          versionId: VERSION_ID, draftLockSessionId: LOCK_SESSION_ID, draftId: DRAFT_ID, candidateId: ITEM_ID,
        }),
        afterAccess: [OUTCOME_UNREADABLE],
        refusedBefore: WRITERS_ONLY,
      },
    ],
    active: EDITOR,
    archived: EDITOR_ON_ARCHIVED,
  },
  {
    rule: "PDF, approval reads and version listing: the editor's rule, and a director as the approval workflow lets them read",
    entryPoints: [
      { name: "getEstimatePdfStatus", call: () => getEstimatePdfStatus(VERSION_ID) },
      { name: "getEstimatePdfLayoutConfiguration", call: () => getEstimatePdfLayoutConfiguration(VERSION_ID) },
      {
        name: "resolveEstimatePdfPreviewLayout",
        call: () => resolveEstimatePdfPreviewLayout(VERSION_ID, DEFAULT_ESTIMATE_PDF_LAYOUT),
      },
      {
        name: "markEstimatePdfProcessing",
        call: () => markEstimatePdfProcessing(VERSION_ID, LOCK_SESSION_ID),
        // Preparing a PDF also requires the writer role, asked after the access rule.
        afterAccess: [LOCK_REQUIRED, WRITER_ROLE_REQUIRED],
      },
      {
        name: "markEstimatePdfFailed",
        call: () => markEstimatePdfFailed(VERSION_ID, "rendu interrompu", { token: DRAFT_ID, purpose: "manual", dispatchId: null, contentRevision: 1 }),
      },
      { name: "generateEstimatePdfNow", call: () => generateEstimatePdfNow(VERSION_ID), afterAccess: [PDF_CLAIM_UNREADABLE] },
      { name: "getEstimateApprovalSummary", call: () => getEstimateApprovalSummary(VERSION_ID) },
      { name: "listEstimateApprovalDecisionJournal", call: () => listEstimateApprovalDecisionJournal({ versionId: VERSION_ID }) },
      { name: "listEstimateVersionVariants", call: () => listEstimateVersionVariants(VERSION_ID) },
    ],
    active: EDITOR_OR_APPROVAL_READER,
    archived: EDITOR_OR_APPROVAL_READER,
  },
];

const PEOPLE_ORDER = Object.keys(PEOPLE) as Person[];

describe.each(RULES)("$rule", ({ entryPoints, active, archived }) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe.each(entryPoints)("$name", (entryPoint) => {
    it.each([
      { project: "active", isArchived: false, rule: active },
      { project: "archived", isArchived: true, rule: archived },
    ])("on an $project project", async ({ isArchived, rule }) => {
      const expected: Expected = { ...rule };
      for (const [person, refusal] of Object.entries(entryPoint.refusedBefore ?? {})) {
        expected[person as Person] = `refused ${refusal}`;
      }
      const outcomes: Partial<Expected> = {};
      for (const person of PEOPLE_ORDER) {
        signIn(person, isArchived);
        outcomes[person] = await outcomeOf(entryPoint);
      }
      expect(outcomes).toEqual(expected);
    });
  });
});
