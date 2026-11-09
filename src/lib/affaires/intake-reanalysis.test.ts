import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn() }));
vi.mock("@/lib/ai/structured-ai", () => ({ callStructuredAi: vi.fn() }));
vi.mock("@/lib/affaires/intake-decisions", async (original) => ({
  ...await original<typeof import("@/lib/affaires/intake-decisions")>(),
  getIntakeAnalysisAvailability: vi.fn(async () => ({ available: true, provider: "chatgpt", message: "Ready" })),
}));

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { callStructuredAi } from "@/lib/ai/structured-ai";
import { retryAffaireDocumentAnalysis } from "@/lib/affaires/intake-server";
import { canRetryDossierDocument, type DossierDocument } from "@/lib/affaires/document-triage";
import { createEmptyAffaireIntakeExtractedMetadata } from "@/lib/affaires/intake";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tenantId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const userId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const documentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const uploadId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const manualDate = "2026-11-09T10:00:00.000Z";
type Row = Record<string, unknown>;
let document: Row;
let downloadFails: boolean;
let events: Row[];
let clock: number;

function database() {
  const project = { id: projectId, tenant_id: tenantId, user_id: userId, is_archived: false };
  const lot = { id: uploadId, tenant_id: tenantId, project_id: projectId, status: "ready" };
  return {
    storage: { from: () => ({ download: async () => ({ data: downloadFails ? null : new Blob(["%PDF-fixture"]), error: null }) }) },
    from(table: string) {
      let update: Row | undefined;
      let insert: Row | undefined;
      const filters: Array<(row: Row) => boolean> = [];
      const execute = async () => {
        if (insert) { events.push(insert); return { data: null, error: null }; }
        const row = table === "estimate_projects" ? project : table === "affaire_intake_uploads" ? lot : document;
        if (!filters.every(filter => filter(row))) return { data: null, error: null };
        if (update) Object.assign(row, update, { updated_at: new Date(++clock).toISOString() });
        return { data: { ...row }, error: null };
      };
      const query = {
        select() { return query; },
        update(values: Row) { update = values; return query; },
        insert(values: Row) { insert = values; return query; },
        eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
        is(key: string, value: unknown) { filters.push(row => (row[key] ?? null) === value); return query; },
        or() { filters.push(row => row.classification_source !== "manual"); return query; },
        maybeSingle: execute,
        then(resolve: (result: Awaited<ReturnType<typeof execute>>) => unknown) { return execute().then(resolve); },
      };
      return query;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MERGEONE_INTAKE_DECISIONS", "0");
  downloadFails = false; events = []; clock = Date.now();
  document = { id: documentId, tenant_id: tenantId, project_id: projectId, upload_id: uploadId,
    storage_path: "owned/plan.pdf", file_name: "plan.pdf", mime_type: "application/pdf", size_bytes: 12,
    upload_status: "uploaded", classification_status: "classified", document_kind: "annexes", document_priority: "secondary",
    classification_source: "manual", confidence: 1, classified_by: userId, classified_at: manualDate,
    manually_overridden_at: manualDate, issues: [], extracted_metadata: createEmptyAffaireIntakeExtractedMetadata(),
    updated_at: manualDate, deleted_at: null, deletion_token: null };
  vi.mocked(getAuthenticatedContext).mockResolvedValue({ userId, tenantId, tenantRole: "admin", supabase: database() } as never);
  vi.mocked(callStructuredAi).mockResolvedValue({ data: { documentKind: "plans", confidence: 0.97, issues: [],
    extractedMetadata: { ...createEmptyAffaireIntakeExtractedMetadata(), clientName: "Client fictif" } } } as never);
});

const retry = () => retryAffaireDocumentAnalysis({ projectId, documentId });
const manualFields = () => ({ document_kind: document.document_kind, classification_source: document.classification_source,
  confidence: document.confidence, classified_by: document.classified_by, classified_at: document.classified_at,
  manually_overridden_at: document.manually_overridden_at });

describe("reanalysis preserves human classification", () => {
  it("offers retry for an uploaded manually validated document", () => {
    expect(canRetryDossierDocument({ fileName: "plan.pdf", uploadStatus: "uploaded", classificationStatus: "classified",
      detectedCategory: "annexes", classificationSource: "manual", manuallyOverriddenAt: manualDate } as DossierDocument)).toBe(true);
  });
  it("calls AI and saves its extraction without changing any manual classification field", async () => {
    const before = manualFields();
    await expect(retry()).resolves.toMatchObject({ analyzed: true, usedFallback: false, preservedManualClassification: true });
    expect(callStructuredAi).toHaveBeenCalledOnce();
    expect(manualFields()).toEqual(before);
    expect(document.classification_status).toBe("classified");
    expect(document.extracted_metadata).toMatchObject({ clientName: "Client fictif" });
    expect(events[0].after_payload).toMatchObject({ document_kind: "annexes", proposed_document_kind: "plans", analysis_source: "ai" });
  });
  it("keeps a failed provider from replacing the manual classification or existing extraction", async () => {
    document.extracted_metadata = { ...createEmptyAffaireIntakeExtractedMetadata(), clientName: "Client conservé" };
    const before = manualFields();
    vi.mocked(callStructuredAi).mockRejectedValue(new Error("Fixture provider unavailable"));
    await expect(retry()).resolves.toMatchObject({ usedFallback: true, preservedManualClassification: true });
    expect(manualFields()).toEqual(before);
    expect(document.classification_status).toBe("classified");
    expect(document.extracted_metadata).toMatchObject({ clientName: "Client conservé" });
  });
  it("restores the validated state when reading the file fails", async () => {
    const before = manualFields(); downloadFails = true;
    await expect(retry()).resolves.toMatchObject({ analyzed: false, usedFallback: true,
      failure: { code: "DOCUMENT_UNREADABLE", scope: "document", message: expect.stringMatching(/ne peut pas être lu/) } });
    expect(manualFields()).toEqual(before);
    expect(document.classification_status).toBe("classified");
  });
  it("does not overwrite a new manual choice committed during AI execution", async () => {
    vi.mocked(callStructuredAi).mockImplementation(async () => {
      Object.assign(document, { document_kind: "cctp", classification_status: "classified", updated_at: new Date(++clock).toISOString() });
      return { data: { documentKind: "plans", confidence: 0.9, issues: [], extractedMetadata: createEmptyAffaireIntakeExtractedMetadata() } } as never;
    });
    await expect(retry()).rejects.toThrow(/a changé/);
    expect(document.document_kind).toBe("cctp");
    expect(document.classification_status).toBe("classified");
    expect(events).toEqual([]);
  });
  it("also permits a previously automatic validated classification, keeping its new proposal unconfirmed", async () => {
    Object.assign(document, { classification_source: "ai", manually_overridden_at: null });
    await expect(retry()).resolves.toMatchObject({ analyzed: true, preservedManualClassification: false });
    expect(document.classification_status).toBe("ambiguous");
    expect(document.document_kind).toBe("plans");
  });
  it("refuses active processing and cross-tenant documents before a provider call", async () => {
    document.classification_status = "processing"; document.updated_at = new Date().toISOString();
    await expect(retry()).rejects.toThrow(/plus disponible/);
    expect(callStructuredAi).not.toHaveBeenCalled();
    document.tenant_id = "other-tenant";
    await expect(retry()).rejects.toThrow(/introuvable/);
    expect(callStructuredAi).not.toHaveBeenCalled();
  });
});


describe("reanalysis lease preserves the validated source while AI runs", () => {
  it("does not change a validated manual classification during the provider request", async () => {
    const before = manualFields();
    vi.mocked(callStructuredAi).mockImplementation(async () => {
      expect(document.classification_status).toBe("classified");
      expect(manualFields()).toEqual(before);
      expect(canRetryDossierDocument({ fileName: "plan.pdf", uploadStatus: "uploaded", classificationStatus: "classified",
        confidence: 1, issues: document.issues, classificationUpdatedAt: document.updated_at } as DossierDocument)).toBe(false);
      return { data: { documentKind: "plans", confidence: 0.9, issues: [], extractedMetadata: createEmptyAffaireIntakeExtractedMetadata() } } as never;
    });
    await expect(retry()).resolves.toMatchObject({ usedFallback: false });
  });
  it("retains extracted AI facts when the filename resolves an uncertain AI category", async () => {
    document.file_name = "PLAN_etage.pdf";
    vi.mocked(callStructuredAi).mockResolvedValue({ data: { documentKind: "a_classer", confidence: 0.4, issues: [],
      extractedMetadata: { ...createEmptyAffaireIntakeExtractedMetadata(), clientName: "Client extrait par IA" } } } as never);
    await expect(retry()).resolves.toMatchObject({ usedFallback: false });
    expect(document.extracted_metadata).toMatchObject({ clientName: "Client extrait par IA" });
    expect(events[0].after_payload).toMatchObject({ analysis_source: "ai" });
  });
  it("refuses an active analysis marker and allows an expired reservation", async () => {
    document.issues = ["Analyse IA en cours."]; document.updated_at = new Date().toISOString();
    await expect(retry()).rejects.toThrow(/en cours/);
    expect(callStructuredAi).not.toHaveBeenCalled();
    document.updated_at = manualDate;
    await expect(retry()).resolves.toMatchObject({ analyzed: true });
  });
});


it("persists an AI category proposal separately from the protected human category", async () => {
  await retry();
  expect(document.document_kind).toBe("annexes");
  expect(document.extracted_metadata).toMatchObject({ aiCategoryProposal: {
    category: "plans", confidence: 0.97,
  } });
});
