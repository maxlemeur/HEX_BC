import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/affaires/register-server", () => ({
  syncAffaireRegisterFromBrief: vi.fn(),
  syncAffaireRegisterMissingPieces: vi.fn(),
}));

vi.mock("@/lib/takeoff/gemini-client", () => ({
  callGeminiStructured: vi.fn(),
}));

import { getAuthenticatedContext } from "@/lib/estimates/server";
import { syncAffaireRegisterFromBrief } from "@/lib/affaires/register-server";
import {
  mergeGeneratedAffaireBriefWithFallback,
  updateAffaireBrief,
} from "@/lib/affaires/intake-server";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRIEF_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UPLOAD_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DOC_ALPHA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DOC_BETA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DOC_LOT = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const DOC_ASSUMPTION = "99999999-9999-4999-8999-999999999999";
const DOC_VIGILANCE = "88888888-8888-4888-8888-888888888888";
const DOC_SUMMARY = "77777777-7777-4777-8777-777777777777";
const NOW = "2026-03-07T10:00:00.000Z";

function createProjectRow() {
  return {
    id: PROJECT_ID,
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    name: "Residence Horizon",
    reference: "AFF-001",
    client_name: "Client Demo",
    is_archived: false,
  };
}

function createBriefRow() {
  return {
    id: BRIEF_ID,
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    upload_id: UPLOAD_ID,
    created_by: USER_ID,
    updated_by: USER_ID,
    confirmed_by: USER_ID,
    status: "confirme" as const,
    summary: "Ancienne synthese",
    project_object: "Construction d'un batiment tertiaire",
    scope: ["Lot Alpha", "Lot Beta"],
    lots: ["Gros oeuvre"],
    received_pieces: ["Plans · plan.pdf"],
    assumptions: ["Hypothese A", "Hypothese B"],
    vigilance_points: ["Point A", "Point B"],
    missing_elements: ["DPGF manquant"],
    generation_metadata: {},
    last_generated_at: NOW,
    confirmed_at: NOW,
    created_at: NOW,
    updated_at: NOW,
  };
}

function createSourceRows() {
  return [
    {
      id: "10000000-0000-4000-8000-000000000001",
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      brief_id: BRIEF_ID,
      source_document_id: DOC_SUMMARY,
      created_by: USER_ID,
      block_key: "summary" as const,
      entry_index: 0,
      source_file_name: "note-synthese.pdf",
      rationale: null,
      created_at: NOW,
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      brief_id: BRIEF_ID,
      source_document_id: DOC_ALPHA,
      created_by: USER_ID,
      block_key: "scope" as const,
      entry_index: 0,
      source_file_name: "alpha.pdf",
      rationale: null,
      created_at: NOW,
    },
    {
      id: "10000000-0000-4000-8000-000000000003",
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      brief_id: BRIEF_ID,
      source_document_id: DOC_BETA,
      created_by: USER_ID,
      block_key: "scope" as const,
      entry_index: 1,
      source_file_name: "beta.pdf",
      rationale: null,
      created_at: NOW,
    },
    {
      id: "10000000-0000-4000-8000-000000000004",
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      brief_id: BRIEF_ID,
      source_document_id: DOC_ASSUMPTION,
      created_by: USER_ID,
      block_key: "assumptions" as const,
      entry_index: 1,
      source_file_name: "hypothese-b.pdf",
      rationale: null,
      created_at: NOW,
    },
    {
      id: "10000000-0000-4000-8000-000000000005",
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      brief_id: BRIEF_ID,
      source_document_id: DOC_VIGILANCE,
      created_by: USER_ID,
      block_key: "vigilance_points" as const,
      entry_index: 1,
      source_file_name: "point-b.pdf",
      rationale: "Point conserve",
      created_at: NOW,
    },
    {
      id: "10000000-0000-4000-8000-000000000006",
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      brief_id: BRIEF_ID,
      source_document_id: DOC_LOT,
      created_by: USER_ID,
      block_key: "lots" as const,
      entry_index: 0,
      source_file_name: "lot-go.pdf",
      rationale: null,
      created_at: NOW,
    },
  ];
}

function createSupabaseContext() {
  const projectRow = createProjectRow();
  const briefRow = createBriefRow();
  const sourceRows = createSourceRows();
  const updatedBriefPayloads: unknown[] = [];
  const deletedBriefIds: string[] = [];
  const insertedSourcePayloads: Array<Record<string, unknown>> = [];
  const insertedEventPayloads: Array<Record<string, unknown>> = [];
  let sourceTableCallCount = 0;

  const from = vi.fn((table: string) => {
    if (table === "estimate_projects") {
      const builder = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn(async () => ({
          data: projectRow,
          error: null,
        })),
      };

      builder.select.mockReturnValue(builder);
      builder.eq.mockReturnValue(builder);

      return builder;
    }

    if (table === "affaire_briefs") {
      return {
        select: vi.fn(() => {
          const builder = {
            eq: vi.fn(),
            order: vi.fn(() => ({
              maybeSingle: async () => ({
                data: briefRow,
                error: null,
              }),
            })),
          };

          builder.eq.mockReturnValue(builder);

          return builder;
        }),
        update: vi.fn((values: unknown) => {
          updatedBriefPayloads.push(values);
          return {
            eq: vi.fn(async () => ({
              error: null,
            })),
          };
        }),
      };
    }

    if (table === "affaire_brief_source_links") {
      sourceTableCallCount += 1;

      if (sourceTableCallCount === 1) {
        return {
          select: vi.fn(() => {
            const builder = {
              eq: vi.fn(),
              order: vi.fn(async () => ({
                data: sourceRows,
                error: null,
              })),
            };

            builder.eq.mockReturnValue(builder);

            return builder;
          }),
        };
      }

      if (sourceTableCallCount === 2) {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(async (_column: string, value: string) => {
              deletedBriefIds.push(value);
              return { error: null };
            }),
          })),
        };
      }

      if (sourceTableCallCount === 3) {
        return {
          insert: vi.fn(async (values: Array<Record<string, unknown>>) => {
            insertedSourcePayloads.push(...values);
            return { error: null };
          }),
        };
      }
    }

    if (table === "affaire_intake_events") {
      return {
        insert: vi.fn(async (values: Record<string, unknown>) => {
          insertedEventPayloads.push(values);
          return { error: null };
        }),
      };
    }

    throw new Error(`Unexpected from() table call: ${table}`);
  });

  return {
    context: {
      supabase: { from },
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "engineer",
    },
    updatedBriefPayloads,
    deletedBriefIds,
    insertedSourcePayloads,
    insertedEventPayloads,
  };
}

describe("affaire intake server brief regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves trailing fallback rows when the model returns fewer brief entries", () => {
    const result = mergeGeneratedAffaireBriefWithFallback({
      generated: {
        summary: {
          text: "Synthese AI",
          sourceDocumentIds: [DOC_ALPHA],
        },
        projectObject: {
          text: "Objet AI",
          sourceDocumentIds: [DOC_ALPHA],
        },
        scope: [
          {
            text: "Lot Alpha AI",
            sourceDocumentIds: [DOC_ALPHA],
          },
        ],
        lots: [],
        receivedPieces: [],
        assumptions: [],
        vigilancePoints: [],
        missingElements: [],
      },
      fallback: {
        summary: {
          text: "Synthese fallback",
          sourceDocumentIds: [DOC_ALPHA],
        },
        projectObject: {
          text: "Objet fallback",
          sourceDocumentIds: [DOC_ALPHA],
        },
        scope: [
          {
            text: "Lot Alpha fallback",
            sourceDocumentIds: [DOC_ALPHA],
          },
          {
            text: "Lot Beta fallback",
            sourceDocumentIds: [DOC_BETA],
          },
        ],
        lots: [],
        receivedPieces: [],
        assumptions: [],
        vigilancePoints: [],
        missingElements: [],
      },
      documents: [
        {
          id: DOC_ALPHA,
          file_name: "alpha.pdf",
          document_kind: "plans",
          confidence: 0.9,
          issues: [],
          extracted_metadata: {
            projectName: null,
            clientName: null,
            deadlineAt: null,
            detectedLots: [],
            detectedVariants: [],
          },
        },
        {
          id: DOC_BETA,
          file_name: "beta.pdf",
          document_kind: "cctp",
          confidence: 0.8,
          issues: [],
          extracted_metadata: {
            projectName: null,
            clientName: null,
            deadlineAt: null,
            detectedLots: [],
            detectedVariants: [],
          },
        },
      ],
    });

    expect(result.scope).toEqual([
      {
        text: "Lot Alpha AI",
        sourceDocumentIds: [DOC_ALPHA],
      },
      {
        text: "Lot Beta fallback",
        sourceDocumentIds: [DOC_BETA],
      },
    ]);
  });

  it("rebuilds brief source links and resyncs assumptions after manual edits", async () => {
    const { context, updatedBriefPayloads, deletedBriefIds, insertedSourcePayloads, insertedEventPayloads } =
      createSupabaseContext();

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await updateAffaireBrief({
      projectId: PROJECT_ID,
      summary: "Synthese reecrite",
      scope: ["Lot Beta", "Lot Gamma"],
      vigilancePoints: ["Point B"],
      assumptions: ["Hypothese B", "Hypothese C"],
    });

    expect(result).toEqual({
      ok: true,
      status: "a_confirmer",
    });
    expect(updatedBriefPayloads).toEqual([
      expect.objectContaining({
        summary: "Synthese reecrite",
        scope: ["Lot Beta", "Lot Gamma"],
        vigilance_points: ["Point B"],
        assumptions: ["Hypothese B", "Hypothese C"],
        status: "a_confirmer",
        confirmed_at: null,
        confirmed_by: null,
        updated_by: USER_ID,
      }),
    ]);
    expect(deletedBriefIds).toEqual([BRIEF_ID]);
    expect(insertedSourcePayloads).toEqual([
      expect.objectContaining({
        brief_id: BRIEF_ID,
        block_key: "scope",
        entry_index: 0,
        source_document_id: DOC_BETA,
        created_by: USER_ID,
      }),
      expect.objectContaining({
        brief_id: BRIEF_ID,
        block_key: "assumptions",
        entry_index: 0,
        source_document_id: DOC_ASSUMPTION,
        created_by: USER_ID,
      }),
      expect.objectContaining({
        brief_id: BRIEF_ID,
        block_key: "vigilance_points",
        entry_index: 0,
        source_document_id: DOC_VIGILANCE,
        rationale: "Point conserve",
        created_by: USER_ID,
      }),
      expect.objectContaining({
        brief_id: BRIEF_ID,
        block_key: "lots",
        entry_index: 0,
        source_document_id: DOC_LOT,
        created_by: USER_ID,
      }),
    ]);
    expect(insertedSourcePayloads).toHaveLength(4);
    expect(insertedSourcePayloads).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          block_key: "summary",
        }),
        expect.objectContaining({
          block_key: "scope",
          source_document_id: DOC_ALPHA,
        }),
      ])
    );
    expect(syncAffaireRegisterFromBrief).toHaveBeenCalledWith({
      supabase: context.supabase,
      project: createProjectRow(),
      assumptions: ["Hypothese B", "Hypothese C"],
      sources: [
        expect.objectContaining({
          blockKey: "scope",
          entryIndex: 0,
          sourceDocumentId: DOC_BETA,
        }),
        expect.objectContaining({
          blockKey: "assumptions",
          entryIndex: 0,
          sourceDocumentId: DOC_ASSUMPTION,
        }),
        expect.objectContaining({
          blockKey: "vigilance_points",
          entryIndex: 0,
          sourceDocumentId: DOC_VIGILANCE,
        }),
        expect.objectContaining({
          blockKey: "lots",
          entryIndex: 0,
          sourceDocumentId: DOC_LOT,
        }),
      ],
      actorUserId: USER_ID,
    });
    expect(insertedEventPayloads).toEqual([
      expect.objectContaining({
        upload_id: UPLOAD_ID,
        actor_user_id: USER_ID,
        event_type: "brief.updated",
        after_payload: expect.objectContaining({
          status: "a_confirmer",
          summary: "Synthese reecrite",
          scope_count: 2,
          assumption_count: 2,
        }),
      }),
    ]);
  });

  it("keeps confirmed briefs confirmed when a save normalizes to the same content", async () => {
    const { context, updatedBriefPayloads, deletedBriefIds, insertedSourcePayloads, insertedEventPayloads } =
      createSupabaseContext();

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await updateAffaireBrief({
      projectId: PROJECT_ID,
      summary: "  Ancienne synthese  ",
      scope: ["Lot Alpha", " Lot Beta ", "Lot Alpha"],
      vigilancePoints: ["Point A", "Point B"],
      assumptions: ["Hypothese A", " Hypothese B "],
    });

    expect(result).toEqual({
      ok: true,
      status: "confirme",
    });
    expect(updatedBriefPayloads).toEqual([]);
    expect(deletedBriefIds).toEqual([]);
    expect(insertedSourcePayloads).toEqual([]);
    expect(insertedEventPayloads).toEqual([]);
    expect(syncAffaireRegisterFromBrief).not.toHaveBeenCalled();
  });
});
