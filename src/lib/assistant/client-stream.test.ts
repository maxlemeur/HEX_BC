import { describe, expect, it } from "vitest";

import { readAssistantStream, splitAssistantText } from "@/lib/assistant/client-stream";

function response(text: string, chunk = 5) {
  const encoded = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let index = 0; index < encoded.length; index += chunk) controller.enqueue(encoded.slice(index, index + chunk));
    controller.close();
  } }));
}

describe("assistant stream in the browser", () => {
  it("delivers each event once, whatever the network chunks, accents included", async () => {
    const events: unknown[] = [];
    await readAssistantStream(response(
      `data: ${JSON.stringify({ type: "text", delta: "Le déboursé " })}\n\n`
      + `data: ${JSON.stringify({ type: "tool_started", callId: "c1", name: "lire_devis", activity: "Lecture du devis" })}\r\n\r\n`
      + `data: ${JSON.stringify({ type: "done", message: null, error: null })}\n\n`,
    ), (event) => { events.push(event); });
    expect(events).toEqual([
      { type: "text", delta: "Le déboursé " },
      { type: "tool_started", callId: "c1", name: "lire_devis", activity: "Lecture du devis" },
      { type: "done", message: null, error: null },
    ]);
  });

  it("ignores a truncated last event instead of failing the whole answer", async () => {
    const events: unknown[] = [];
    await readAssistantStream(response(`data: ${JSON.stringify({ type: "text", delta: "ok" })}\n\ndata: {"type":"te`), (event) => { events.push(event); });
    expect(events).toEqual([{ type: "text", delta: "ok" }]);
  });
});

describe("assistant answer text", () => {
  const id = "0b9d6c1e-3f4a-4c2b-9d7e-1a2b3c4d5e6f";
  const versionId = "7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

  it("turns a line citation into a link part and keeps the text around it", () => {
    expect(splitAssistantText(`Le prix de [[ligne:${versionId}/${id}|Tube cuivre Ø22]] vient du catalogue.`, false)).toEqual([
      { type: "text", value: "Le prix de " },
      { type: "line", versionId, id, label: "Tube cuivre Ø22" },
      { type: "text", value: " vient du catalogue." },
    ]);
  });

  it("shows a malformed citation as plain text", () => {
    expect(splitAssistantText("Voir [[ligne:pas-un-id|Tube]] et [[autre]].", false))
      .toEqual([{ type: "text", value: "Voir [[ligne:pas-un-id|Tube]] et [[autre]]." }]);
    // A line without the estimate it belongs to cannot be opened: it stays text.
    expect(splitAssistantText(`[[ligne:${id}|Tube]]`, false)).toEqual([{ type: "text", value: `[[ligne:${id}|Tube]]` }]);
  });

  it("hides a citation still being written while the answer streams", () => {
    expect(splitAssistantText(`Le prix de [[ligne:${versionId}/${id}|Tube cu`, true)).toEqual([{ type: "text", value: "Le prix de " }]);
    expect(splitAssistantText("Le prix de [", true)).toEqual([{ type: "text", value: "Le prix de " }]);
    // Once the answer is final, nothing is hidden.
    expect(splitAssistantText("Le prix de [[ligne:", false)).toEqual([{ type: "text", value: "Le prix de [[ligne:" }]);
  });
  it("turns a document citation into a document part with its page", () => {
    const documentId = "11111111-1111-4111-8111-111111111111";
    expect(splitAssistantText(`Le CCTP impose du cuivre [[doc:${documentId}/12|CCTP plomberie.pdf, p. 12]].`, false)).toEqual([
      { type: "text", value: "Le CCTP impose du cuivre " },
      { type: "document", documentId, page: 12, label: "CCTP plomberie.pdf, p. 12" },
      { type: "text", value: "." },
    ]);
    // Page 0 is no page.
    expect(splitAssistantText(`[[doc:${documentId}/0|x]]`, false)).toEqual([{ type: "text", value: `[[doc:${documentId}/0|x]]` }]);
  });
});
