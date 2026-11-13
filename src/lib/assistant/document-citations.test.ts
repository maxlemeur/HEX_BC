import { describe, expect, it } from "vitest";

import { splitAssistantText } from "@/lib/assistant/client-stream";
import { AssistantDocumentLedger, DOCUMENT_READ_LIMITS } from "@/lib/assistant/document-citations";

const cctp = "11111111-1111-4111-8111-111111111111";
const plan = "22222222-2222-4222-8222-222222222222";
const listedOnly = "33333333-3333-4333-8333-333333333333";

/** The model request that carries what was read has succeeded: its pages count as seen. */
function seen(ledger: AssistantDocumentLedger) {
  ledger.requestStarting();
  ledger.requestSucceeded();
  return ledger;
}

function ledger() {
  const read = new AssistantDocumentLedger();
  read.recordRead({ documentId: cctp, fileName: "CCTP plomberie.pdf", pagesTotal: 40, from: 11, to: 20, pages: 10, bytes: 1_000 });
  read.recordRead({ documentId: cctp, fileName: "CCTP plomberie.pdf", pagesTotal: 40, from: 31, to: 32, pages: 2, bytes: 200 });
  read.recordRead({ documentId: plan, fileName: "Plan R+1.png", pagesTotal: 1, from: 1, to: 1, pages: 1, bytes: 300 });
  return seen(read);
}

/** Every document citation the panel would render as a link names a page seen, under the document's own name. */
function linksOf(text: string) {
  return splitAssistantText(text, false).filter((part) => part.type === "document");
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

  it("does not count a page as read until a model request carrying it has succeeded", () => {
    const read = new AssistantDocumentLedger();
    read.recordRead({ documentId: cctp, fileName: "CCTP.pdf", pagesTotal: 3, from: 1, to: 3, pages: 3, bytes: 10 });
    expect(read.resolveCitations(`[[doc:${cctp}/2|a]]`)).toBe("a (source non vérifiée)");
    // Sent, but the request failed (the plan refused the document): still not seen.
    read.requestStarting();
    expect(read.resolveCitations(`[[doc:${cctp}/2|a]]`)).toBe("a (source non vérifiée)");
    read.requestSucceeded();
    expect(read.resolveCitations(`[[doc:${cctp}/2|a]]`)).toBe(`[[doc:${cctp}/2|CCTP.pdf, p. 2]]`);
  });

  it("does not inherit the reads of an earlier answer", () => {
    expect(new AssistantDocumentLedger().resolveCitations(`[[doc:${cctp}/12|a]]`)).toBe("a (source non vérifiée)");
  });

  it("leaves line citations untouched", () => {
    const line = "[[ligne:44444444-4444-4444-8444-444444444444/55555555-5555-4555-8555-555555555555|Tube]]";
    expect(ledger().resolveCitations(`${line} et du texte.`)).toBe(`${line} et du texte.`);
  });

  it("marks a malformed document citation as not verified instead of dropping its warning", () => {
    for (const citation of [
      `[[doc:${cctp}/0|x]]`, `[[doc:${cctp}/-1|x]]`, `[[doc:${cctp}/abc|x]]`, "[[doc:javascript:alert/1|x]]",
      `[[doc:"><img src=y>/1|x]]`, `[[doc:${cctp}/1/2|x]]`, "[[doc:pas-un-id/2|x]]", `[[DOC:${listedOnly}/1|x]]`,
      `[[doc:${cctp}/12|x`,
    ]) expect(ledger().resolveCitations(citation), citation).toBe("x (source non vérifiée)");
  });

  it("leaves no link behind when a citation is nested in another to slip past the check", () => {
    const resolved = ledger().resolveCitations(`Voir [[doc:${listedOnly}/1|[[doc:${listedOnly}/7|Article signé]]]] et [[doc:${listedOnly}/2|[[doc:${cctp}/12|x]]]].`);
    expect(resolved).not.toMatch(new RegExp(`\\[\\[doc:${listedOnly}`));
    expect(resolved).toContain("Article signé (source non vérifiée)");
    expect(resolved).toContain(`[[doc:${cctp}/12|CCTP plomberie.pdf, p. 12]]`);
  });

  it("forms no unchecked link out of what is left once the citations around it are removed", () => {
    // Pages 2 and 3 of U were read; page 9 was not.
    const read = new AssistantDocumentLedger();
    read.recordRead({ documentId: cctp, fileName: "CCTP.pdf", pagesTotal: 12, from: 2, to: 3, pages: 2, bytes: 10 });
    seen(read);
    for (const forged of [
      `[[[doc:${listedOnly}/1|[doc:${cctp}/9|Article inventé]]`,
      `[[[doc:${cctp}/0|[doc:${cctp}/9|lu p.9]]`,
    ]) {
      const resolved = read.resolveCitations(forged);
      expect(linksOf(resolved), resolved).toEqual([]);
      expect(resolved).toContain("(source non vérifiée)");
    }
  });

  it("keeps visible a refused citation nested in a kept one", () => {
    const resolved = ledger().resolveCitations(`[[doc:${cctp}/12|a [[doc:${cctp}/99|b]] c]]`);
    expect(resolved).toContain("b (source non vérifiée)");
    expect(resolved).toContain(`[[doc:${cctp}/12|CCTP plomberie.pdf, p. 12]]`);
  });

  it("checks an identifier written in capitals like any other", () => {
    expect(ledger().resolveCitations(`[[doc:${cctp.toUpperCase()}/12|a]] [[doc:${listedOnly.toUpperCase()}/1|b]]`))
      .toBe(`[[doc:${cctp}/12|CCTP plomberie.pdf, p. 12]] b (source non vérifiée)`);
  });

  it("never lets a generated nested or malformed string become a link to an unseen page or under a chosen label", () => {
    const read = ledger();
    const pieces = ["[[doc:", "[[DOC:", "[", "]", "]]", "|", `${cctp}/12`, `${cctp}/25`, `${cctp}/0`, `${listedOnly}/1`, `${plan}/1`,
      "/", "x", " ", "\n", "CCTP plomberie.pdf, p. 12", "(source non vérifiée)", "", ""];
    let seed = 7;
    const next = () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed; };
    const allowed = new Set([`${cctp}:12`, `${cctp}:11`, `${cctp}:31`, `${cctp}:32`, `${plan}:1`, ...Array.from({ length: 10 }, (_, index) => `${cctp}:${11 + index}`)]);
    for (let round = 0; round < 3_000; round += 1) {
      const text = Array.from({ length: 4 + (next() % 14) }, () => pieces[next() % pieces.length]).join("");
      const resolved = read.resolveCitations(text);
      for (const link of linksOf(resolved)) {
        expect(allowed.has(`${link.documentId}:${link.page}`), `${JSON.stringify(text)} → ${JSON.stringify(resolved)}`).toBe(true);
        const name = link.documentId === plan ? "Plan R+1.png" : "CCTP plomberie.pdf";
        expect(link.label, JSON.stringify(text)).toBe(`${name}, p. ${link.page}`);
      }
    }
  });

  it("counts the pages and bytes spent by the answer", () => {
    expect(ledger().budget()).toEqual({ pagesLeft: DOCUMENT_READ_LIMITS.pagesPerTurn - 13, bytesLeft: DOCUMENT_READ_LIMITS.bytesPerTurn - 1_500 });
  });
});
