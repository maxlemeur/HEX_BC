import type { RevisionChange } from "@/lib/takeoff/contribution-revision-contracts";
import type { ItemSendAnswer } from "@/lib/takeoff/item-send-plan";

/** Feed the ordinary planner the parts the revision preview resolved. Its
 * dependency list still comes from the unmodified, sealed reading. */
export function revisionAdditionAnswers(
  answers: readonly ItemSendAnswer[],
  changes: readonly RevisionChange[],
): ItemSendAnswer[] {
  const additions = new Map(changes.map((change) => [change.answer_id, change]));
  return answers
    .filter((answer) => additions.has(answer.answerId))
    .map((answer) => {
      const change = additions.get(answer.answerId);
      const first = change?.parts[0];
      if (!change || !first) return answer;
      return {
        ...answer,
        quantitySource: first.kind === "verified_count" ? "verified_count" : undefined,
        verifiedCount:
          first.kind === "verified_count" && first.marks_revision !== null
            ? {
                quantity: first.quantity,
                pages: first.pages,
                unit: first.unit,
                marksRevision: first.marks_revision,
              }
            : null,
        decision: { kind: "accepted", revision: answer.decision?.revision ?? 1 },
        entry: first.kind === "entered" ? answer.entry : null,
        observations:
          first.kind === "measured"
            ? change.parts.flatMap((part) =>
                part.observation_id
                  ? [
                      {
                        observationId: part.observation_id,
                        role: "contribution" as const,
                        source: "model" as const,
                        quantity: part.quantity,
                        unit: part.unit,
                        page: part.pages[0] ?? null,
                        measurementBasis: part.basis,
                      },
                    ]
                  : [],
              )
            : answer.observations,
      };
    });
}
