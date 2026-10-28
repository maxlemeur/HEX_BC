import { z } from "zod";

import {
  takeoffDpgfComparisonEvidenceKindSchema,
  takeoffDpgfComparisonEvidenceTypeSchema,
} from "@/lib/takeoff/dpgf-comparison-contracts";

const uuid = z.string().uuid();
const sameUuid = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

export const takeoffLineEvidenceStatusSchema = z.enum(["active", "invalidated", "replaced"]);
export const takeoffLineEvidenceSchema = z.object({
  evidence_id: uuid, type: takeoffDpgfComparisonEvidenceTypeSchema, kind: takeoffDpgfComparisonEvidenceKindSchema,
  label: z.string(), source: z.string(), source_file_name: z.string().nullable(),
  source_page: z.number().int().positive().nullable(), confidence_score: z.number().min(0).max(1).nullable(),
  note: z.string().nullable(), created_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  author_name: z.string().nullable(), status: takeoffLineEvidenceStatusSchema,
  supersedes_evidence_id: uuid.nullable(), replaced_by_evidence_id: uuid.nullable(),
}).superRefine((evidence, context) => {
  if ((evidence.status === "replaced") !== (evidence.replaced_by_evidence_id !== null)
    || (evidence.supersedes_evidence_id !== null && sameUuid(evidence.supersedes_evidence_id, evidence.evidence_id))
    || (evidence.replaced_by_evidence_id !== null && sameUuid(evidence.replaced_by_evidence_id, evidence.evidence_id))) {
    context.addIssue({ code: "custom", message: "Historique de preuve incohérent." });
  }
});

export const takeoffLineEvidencePanelResponseSchema = z.object({
  line_id: uuid, version_id: uuid, job_id: uuid,
  evidences: z.array(takeoffLineEvidenceSchema), history: z.array(takeoffLineEvidenceSchema),
}).superRefine((panel, context) => {
  const ids = [...panel.evidences, ...panel.history].map((evidence) => evidence.evidence_id.toLowerCase());
  if (new Set(ids).size !== ids.length || panel.evidences.some((evidence) => evidence.status !== "active")
    || panel.history.some((evidence) => evidence.status === "active")) {
    context.addIssue({ code: "custom", message: "Répartition des preuves et de leur historique incohérente." });
  }
});

export type TakeoffLineEvidenceStatus = z.infer<typeof takeoffLineEvidenceStatusSchema>;
export type TakeoffLineEvidence = z.infer<typeof takeoffLineEvidenceSchema>;
export type TakeoffLineEvidencePanelResponse = z.infer<typeof takeoffLineEvidencePanelResponseSchema>;

export function parseTakeoffLineEvidencePanelResponse(payload: unknown, identity: {
  jobId: string; versionId: string; lineId: string;
}): TakeoffLineEvidencePanelResponse {
  const result = takeoffLineEvidencePanelResponseSchema.safeParse(payload);
  if (!result.success || !sameUuid(result.data.job_id, identity.jobId) || !sameUuid(result.data.version_id, identity.versionId)
    || !sameUuid(result.data.line_id, identity.lineId)) {
    throw new Error("La réponse du panneau preuves est invalide. Rechargez les preuves avant toute nouvelle action.");
  }
  return result.data;
}
