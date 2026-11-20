import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));
vi.mock("@/components/EstimateDocument", () => ({ EstimateDocument: vi.fn(() => null) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ getUserContext: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/estimates/read-all-items-server", () => ({
  readAllEstimateItems: vi.fn(),
  assertEstimateVersionUnchanged: vi.fn(),
}));
vi.mock("@/lib/estimates/approval-summary-server", () => ({
  getEstimateApprovalSummary: vi.fn(async () => null),
}));
vi.mock("@/lib/estimates/approval-decision-journal-server", () => ({
  listEstimateApprovalDecisionJournal: vi.fn(async () => null),
}));
vi.mock("@/lib/estimates/version-list-server", () => ({
  listEstimateProjectVersions: vi.fn(async () => ({ items: [], pagination: { page: 1, pageSize: 10, total: 0 } })),
  listEstimateVersionVariants: vi.fn(async () => ({ base_version_id: null, items: [] })),
}));
vi.mock("@/lib/estimates/version-seal-server", () => ({ verifyEstimateSeal: vi.fn() }));
vi.mock("@/lib/affaires/server", () => ({ fetchAffaireHubPlansSummary: vi.fn(async () => null) }));
vi.mock("@/lib/affaires/register-server", () => ({ fetchAffaireRegisterSummary: vi.fn(async () => null) }));
vi.mock("@/lib/estimates/pdf-generator", async () => {
  const { DEFAULT_ESTIMATE_PDF_LAYOUT } = await import("@/lib/estimates/pdf-layout");
  return { resolveEstimatePdfPreviewLayout: vi.fn(async () => ({ layout: DEFAULT_ESTIMATE_PDF_LAYOUT })) };
});

import { EstimateDocument } from "@/components/EstimateDocument";
import { getUserContext } from "@/lib/auth/server";
import { readAllEstimateItems } from "@/lib/estimates/read-all-items-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  SENT_ESTIMATE_IDS,
  SENT_ENGINE_1_LINE,
  SENT_ESTIMATE_LIVE_HT_CENTS,
  SENT_ESTIMATE_PROJECT,
  SENT_ESTIMATE_STORED,
  SENT_ENGINE_1_VERSION,
  TODAY_LABOR_ROLE,
} from "@/test/fixtures/sent-estimate";

import EstimateDetailPage from "./page";
import PrintEstimatePage from "./print/page";

// The database as the tenant has it today: the role costs 15,00 €/h, 12,00 €/h when the estimate was sent.
function createSupabase(status: string) {
  const tables: Record<string, unknown[]> = {
    estimate_versions: [{ ...SENT_ENGINE_1_VERSION, status, estimate_projects: SENT_ESTIMATE_PROJECT }],
    labor_roles: [TODAY_LABOR_ROLE],
    estimate_emails: [],
  };
  return {
    from(table: string) {
      if (!(table in tables)) throw new Error(`Unexpected table: ${table}`);
      const rows = tables[table];
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        single: async () => ({ data: rows[0], error: null }),
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return builder;
    },
  };
}

function findElement(node: unknown, type: unknown): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  if (node.type === type) return node;
  return findElement(node.props.children, type);
}

const PAGES = [
  ["detail page", (status: string) => render(EstimateDetailPage, status)],
  ["print page", (status: string) => render(PrintEstimatePage, status)],
] as const;

async function render(
  page: (props: { params: Promise<{ versionId: string }> }) => Promise<unknown>,
  status: string
) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue(createSupabase(status) as never);
  const tree = await page({ params: Promise.resolve({ versionId: SENT_ESTIMATE_IDS.version }) });
  const document = findElement(tree, EstimateDocument);
  if (!document) throw new Error("The page renders no estimate document.");
  return document.props;
}

describe.each(PAGES)("%s amounts", (_name, renderDocument) => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserContext).mockResolvedValue({
      tenantId: SENT_ESTIMATE_IDS.tenant,
      userEmail: "utilisateur@example.com",
      profile: { tenant_role: "engineer", full_name: "Utilisateur fictif", job_title: null, phone: null, work_email: null },
    } as never);
    vi.mocked(readAllEstimateItems).mockResolvedValue([SENT_ENGINE_1_LINE] as never);
  });

  it("calculates an engine-1 draft with today's hourly rate", async () => {
    const document = await renderDocument("draft");
    expect(document.preserveStoredSnapshot).toBe(false);
    expect(document.totalHtCents).toBe(SENT_ESTIMATE_LIVE_HT_CENTS);
  });

  it.each(["sent", "accepted"])("shows a %s engine-1 version with its stored amounts", async (status) => {
    const document = await renderDocument(status);
    expect(document.preserveStoredSnapshot).toBe(true);
    expect([document.totalHtCents, document.totalTaxCents, document.totalTtcCents]).toEqual([
      SENT_ESTIMATE_STORED.htCents,
      SENT_ESTIMATE_STORED.taxCents,
      SENT_ESTIMATE_STORED.ttcCents,
    ]);
  });
});
