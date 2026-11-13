import { describe, expect, it } from "vitest";

import { AssistantDocumentLedger } from "@/lib/assistant/document-citations";

const cctp = "11111111-1111-4111-8111-111111111111";
const plan = "22222222-2222-4222-8222-222222222222";
const listedOnly = "33333333-3333-4333-8333-333333333333";

function ledger() {
  const read = new AssistantDocumentLedger();
  read.recordRead({ documentId: cctp, fileName: "CCTP plomberie.pdf", pagesTotal: 40, from: 11, to: 20, pages: 10, bytes: 1_000 });
  read.recordRead({ documentId: cctp, fileName: "CCTP plomberie.pdf", pagesTotal: 40, from: 31, to: 32, pages: 2, bytes: 200 });
  read.recordRead({ documentId: plan, fileName: "Plan R+1.png", pagesTotal: 1, from: 1, to: 1, pages: 1, bytes: 300 });
  return read;
}

describe("document citations of an answer", () => {
  it("keeps a citation of a page this answer read, under the document's own name", () => {
    expect(ledger().resolveCitations(`Le CCTP impose du cuivre [[doc:${cctp}/12|art. 4.2]].`))
      .toBe(`Le CCTP impose du cuivre [[doc:${cctp}/12|CCTP plomberie.pdf, p. 12]].`);
    expect(ledger().resolveCitations(`Voir [[doc:${plan}/1|plan]] et [[doc:${cctp}/32|annexe]].`))
      .toBe(`Voir [[doc:${plan}/1|Plan R+1.png, p. 1]] et [[doc:${cctp}/32|CCTP plomberie.pdf, p. 32]].`);
  });

  it("turns a citation of a page that was not read into plain text that says so", () => {
    expect(ledger().resolveCitations(`Selon [[doc:${cctp}/25|art. 7]], rien.`)).toBe("Selon art. 7 (source non vérifiée), rien.");
    expect(ledger().resolveCitations(`Selon [[doc:${cctp}/99|art. 9]].`)).toBe("Selon art. 9 (source non vérifiée).");
  });

  it("turns a citation of a document this answer did not read into plain text, even one of the affaire", () => {
    expect(ledger().resolveCitations(`Voir [[doc:${listedOnly}/1|DPGF]].`)).toBe("Voir DPGF (source non vérifiée).");
  });

  it("leaves line citations and text that only looks like a citation untouched", () => {
    const line = "[[ligne:44444444-4444-4444-8444-444444444444/55555555-5555-4555-8555-555555555555|Tube]]";
    expect(ledger().resolveCitations(`${line} et [[doc:pas-un-id/2|x]].`)).toBe(`${line} et [[doc:pas-un-id/2|x]].`);
  });

  it("counts the pages and bytes spent by the answer", () => {
    expect(ledger().budget()).toEqual({ pagesLeft: 30 - 13, bytesLeft: 16 * 1024 * 1024 - 1_500 });
  });
  it("leaves no link behind when a citation is nested in another to slip past the check", () => {
    const resolved = ledger().resolveCitations(`Voir [[doc:${listedOnly}/1|[[doc:${listedOnly}/7|Article signé]]]] et [[doc:${listedOnly}/2|[[doc:${cctp}/12|x]]]].`);
    expect(resolved).not.toMatch(new RegExp(`\\[\\[doc:${listedOnly}`));
    expect(resolved).toContain("Article signé (source non vérifiée)");
    // A page that was read stays its own link, under the document's name.
    expect(resolved).toContain(`[[doc:${cctp}/12|CCTP plomberie.pdf, p. 12]]`);
  });

  it("checks an identifier written in capitals like any other", () => {
    expect(ledger().resolveCitations(`[[doc:${cctp.toUpperCase()}/12|a]] [[doc:${listedOnly.toUpperCase()}/1|b]]`))
      .toBe(`[[doc:${cctp}/12|CCTP plomberie.pdf, p. 12]] b (source non vérifiée)`);
  });
});
