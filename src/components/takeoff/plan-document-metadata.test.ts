import { describe, expect, it } from "vitest";

import {
  findConflictingActivePlanSetIds,
  findPlanFileDuplicates,
  mergePlanDocumentMetadata,
  readPlanDocumentMetadata,
} from "@/components/takeoff/plan-document-metadata";
import type { PlanFileListItem, PlanSetListItem } from "@/lib/takeoff/types";

function makePlanSet(
  id: string,
  metadata: Record<string, unknown>
): PlanSetListItem {
  return {
    id,
    created_at: "2026-07-18T08:00:00.000Z",
    updated_at: "2026-07-18T08:00:00.000Z",
    tenant_id: "tenant-1",
    project_id: "project-1",
    estimate_version_id: null,
    name: `Jeu ${id}`,
    description: null,
    metadata,
    created_by: null,
    file_count: 1,
    total_size_bytes: 1024,
  };
}

function makePlanFile(
  id: string,
  input: { fileName: string; fileHash: string | null; size?: number }
): PlanFileListItem {
  return {
    id,
    created_at: "2026-07-18T08:00:00.000Z",
    updated_at: "2026-07-18T08:00:00.000Z",
    tenant_id: "tenant-1",
    plan_set_id: "set-1",
    file_path: `plans/${id}.pdf`,
    file_name: input.fileName,
    file_type: "application/pdf",
    file_size_bytes: input.size ?? 1024,
    page_count: 2,
    file_hash: input.fileHash,
    metadata: {},
    created_by: null,
  };
}

describe("plan document metadata", () => {
  it("reads supported aliases without inventing absent values", () => {
    expect(
      readPlanDocumentMetadata({
        revisionIndex: " C ",
        document_date: "2026-07-12T10:00:00.000Z",
        lotLabel: "CVC",
        area: "R+1",
        revisionStatus: "actif",
      })
    ).toEqual({
      revision: "C",
      revisionDate: "2026-07-12",
      lot: "CVC",
      zone: "R+1",
      status: "active",
    });

    expect(readPlanDocumentMetadata({})).toEqual({
      revision: null,
      revisionDate: null,
      lot: null,
      zone: null,
      status: "unknown",
    });
  });

  it("updates canonical revision fields while preserving unrelated metadata", () => {
    expect(
      mergePlanDocumentMetadata(
        {
          provider: "gemini",
          revisionIndex: "A",
          lotLabel: "Archi",
        },
        {
          revision: "B",
          revisionDate: "2026-07-18",
          lot: "Structure",
          zone: "Sous-sol",
          status: "active",
        }
      )
    ).toEqual({
      provider: "gemini",
      revision: "B",
      revision_date: "2026-07-18",
      lot: "Structure",
      zone: "Sous-sol",
      revision_status: "active",
    });
  });

  it("finds multiple active revisions only inside a known lot/zone scope", () => {
    const ids = findConflictingActivePlanSetIds([
      makePlanSet("set-a", {
        lot: "CVC",
        zone: "RDC",
        revision_status: "active",
      }),
      makePlanSet("set-b", {
        lot: "cvc",
        zone: "rdc",
        revision_status: "active",
      }),
      makePlanSet("set-c", {
        lot: "CVC",
        zone: "R+1",
        revision_status: "active",
      }),
      makePlanSet("set-unknown", { revision_status: "active" }),
    ]);

    expect([...ids].sort()).toEqual(["set-a", "set-b"]);
  });

  it("distinguishes exact hash duplicates from possible name/size duplicates", () => {
    const duplicates = findPlanFileDuplicates([
      makePlanFile("file-a", { fileName: "plan-a.pdf", fileHash: "sha-1" }),
      makePlanFile("file-b", { fileName: "plan-b.pdf", fileHash: "sha-1" }),
      makePlanFile("file-c", { fileName: "plan-c.pdf", fileHash: null }),
      makePlanFile("file-d", { fileName: "PLAN-C.pdf", fileHash: null }),
    ]);

    expect(duplicates.get("file-a")).toEqual({
      kind: "exact",
      matchingFileNames: ["plan-b.pdf"],
    });
    expect(duplicates.get("file-c")).toEqual({
      kind: "possible",
      matchingFileNames: ["PLAN-C.pdf"],
    });
  });
});
