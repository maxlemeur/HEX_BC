import "server-only";

import { createHash } from "node:crypto";

/** Deterministic IDs fence competing creators without changing existing plan sets. */
export function stableImportPlanSetId(tenantId: string, projectId: string, versionId: string | null) {
  const scope = versionId ?? "project";
  const bytes = createHash("sha256")
    .update(`mergeone:import-plan-set:v1:${tenantId}:${projectId}:${scope}`)
    .digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}


/** A source generation has one copy in a given affair-wide plan set. */
export function stableIntakePlanFileId(tenantId: string, setId: string, documentId: string, storagePath: string, generation: string | null) {
  const bytes = createHash("sha256")
    .update(JSON.stringify(["mergeone:intake-plan-file:v1", tenantId, setId, documentId, storagePath, generation]))
    .digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
