import { describe, expect, it } from "vitest";

import { inConversationOrder } from "@/lib/assistant/thread-order";

const question = (id: string) => ({ id, role: "user" as const, reply_to: null });
const answer = (id: string, replyTo: string) => ({ id, role: "assistant" as const, reply_to: replyTo });
const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

describe("assistant conversation order", () => {
  it("puts each answer under its question when a second tab's answer was saved first", () => {
    // Saved in this order: question A, question B (second tab), answer B, then answer A.
    const saved = [question("qa"), question("qb"), answer("rb", "qb"), answer("ra", "qa")];
    expect(ids(inConversationOrder(saved))).toEqual(["qa", "ra", "qb", "rb"]);
  });

  it("keeps every attempt at a question under it, in the order they were saved", () => {
    const saved = [question("qa"), answer("ra1", "qa"), question("qb"), answer("rb", "qb"), answer("ra2", "qa")];
    expect(ids(inConversationOrder(saved))).toEqual(["qa", "ra1", "ra2", "qb", "rb"]);
  });

  it("drops an answer whose question is older than the messages read, instead of showing it first", () => {
    const saved = [answer("r0", "q0"), question("qa"), answer("ra", "qa")];
    expect(ids(inConversationOrder(saved))).toEqual(["qa", "ra"]);
  });
});
