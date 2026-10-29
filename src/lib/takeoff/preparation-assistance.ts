import { z } from "zod";

import {
  TAKEOFF_PREPARATION_OBJECTIVES,
  takeoffPreparationSchema,
  type TakeoffPreparation,
} from "@/lib/takeoff/preparation";

export const preparationProposalFieldSchema = z.enum([
  "objective", "scope.lots", "scope.networks", "scope.levels", "scope.zones",
  "scope.inclusions", "scope.exclusions", "conventions.unit",
]);
export type TakeoffPreparationProposal = {
  id: string;
  field: z.infer<typeof preparationProposalFieldSchema>;
  values: string[];
  source_document_ids: string[];
  explanation: string;
  status: "proposed";
};
export type TakeoffPreparationQuestionProposal = {
  id: string;
  question: string;
  source_document_ids: string[];
  explanation: string;
  status: "proposed";
};
export type TakeoffPreparationAssistanceCapabilities = {
  writing: {
    status: "available" | "unavailable";
    provider: "chatgpt" | "gemini" | null;
    billing: "chatgpt_plan" | "api" | null;
    message: string;
  };
  decisions: {
    status: "disabled" | "not_configured" | "available";
    billing: "separate_api";
    model: string;
    message: string;
  };
};
export type TakeoffPreparationAssistance = {
  status: "available" | "unavailable" | "failed";
  message: string;
  capabilities: TakeoffPreparationAssistanceCapabilities;
  proposals: TakeoffPreparationProposal[];
  questions: TakeoffPreparationQuestionProposal[];
  provenance: {
    tenant_id: string;
    project_id: string;
    revision: number | null;
    source_fingerprint: string;
    preparation_fingerprint: string;
    generated_at: string;
    provider: "chatgpt" | "gemini" | null;
    model: string | null;
    prompt_version: string;
    token_count: number | null;
  };
  decisions: {
    status: "available" | "partial" | "unavailable" | "failed";
    message: string;
    document_classifications: Array<{
      document_id: string;
      document_kind: "dpgf" | "plans" | "cctp" | "bpu_dqe" | "annexes" | "emails" | "a_classer" | null;
      status: "proposed" | "to_review";
    }>;
    ordered_question_ids: string[];
    next_action: "scope" | "sources" | "conventions" | "recap" | null;
    request_fingerprint: string | null;
    model: string | null;
    usage: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
  };
};

/** An explicit user acceptance adds draft content; it never confirms or replaces it. */
export function applyTakeoffPreparationProposal(
  preparation: TakeoffPreparation,
  proposal: TakeoffPreparationProposal,
): TakeoffPreparation {
  if (!proposal.source_document_ids.length || proposal.source_document_ids.some((id) =>
    !preparation.sources.some((source) => source.document_id === id))) return preparation;
  const values = [...new Set(proposal.values.map((value) => value.trim()).filter(Boolean))];
  if (!values.length) return preparation;
  if (proposal.field === "objective") {
    const objective = values[0];
    if (preparation.objective || preparation.objective_confirmed || !Object.hasOwn(TAKEOFF_PREPARATION_OBJECTIVES, objective)) return preparation;
    return takeoffPreparationSchema.parse({ ...preparation, objective });
  }
  if (proposal.field === "conventions.unit") {
    if (preparation.conventions.confirmed || preparation.conventions.unit) return preparation;
    return takeoffPreparationSchema.parse({ ...preparation, conventions: { ...preparation.conventions, unit: values[0] } });
  }
  if (preparation.scope.confirmed) return preparation;
  const key = proposal.field.slice("scope.".length) as Exclude<keyof TakeoffPreparation["scope"], "confirmed">;
  return takeoffPreparationSchema.parse({ ...preparation, scope: {
    ...preparation.scope, [key]: [...new Set([...preparation.scope[key], ...values])],
  } });
}

export function createTakeoffPreparationQuestion(
  preparation: TakeoffPreparation,
  proposal: TakeoffPreparationQuestionProposal,
): TakeoffPreparation {
  if (preparation.unknowns.some((unknown) => unknown.id === proposal.id || unknown.question === proposal.question) ||
      proposal.source_document_ids.some((id) => !preparation.sources.some((source) => source.document_id === id))) return preparation;
  return takeoffPreparationSchema.parse({ ...preparation, unknowns: [...preparation.unknowns, {
    id: proposal.id, question: proposal.question, impact: "reservation", status: "open",
    answer: null, responsible: null, source_document_id: proposal.source_document_ids[0] ?? null, page: null,
  }] });
}

export function attachTakeoffPreparationAssistanceProvenance(
  preparation: TakeoffPreparation,
  assistance: TakeoffPreparationAssistance,
  acceptedProposalId: string,
): TakeoffPreparation {
  const proposal = [...assistance.proposals, ...assistance.questions].find((candidate) => candidate.id === acceptedProposalId);
  if (!proposal) return preparation;
  const current = preparation.assistance;
  const sameRequest = current?.provenance.preparation_fingerprint === assistance.provenance.preparation_fingerprint;
  const ids = [...new Set([...(sameRequest ? current.accepted_proposal_ids : []), acceptedProposalId])].slice(0, 200);
  return takeoffPreparationSchema.parse({ ...preparation, assistance: {
    provenance: { ...assistance.provenance,
      decisions_request_fingerprint: assistance.decisions.request_fingerprint,
      decisions_model: assistance.decisions.model,
    }, accepted_proposal_ids: ids,
  } });
}

/** Stable advice changes presentation only; every question remains in the result. */
export function orderTakeoffPreparationQuestions<T extends { id: string }>(
  questions: T[],
  orderedIds: string[],
): T[] {
  const ranks = new Map(orderedIds.map((id, index) => [id, index]));
  return questions.map((question, index) => ({ question, index }))
    .sort((left, right) => (ranks.get(left.question.id) ?? Number.MAX_SAFE_INTEGER) -
      (ranks.get(right.question.id) ?? Number.MAX_SAFE_INTEGER) || left.index - right.index)
    .map(({ question }) => question);
}
