/** What one answer may read of the affaire's documents: per read and over the whole answer (one user turn). */
export const DOCUMENT_READ_LIMITS = {
  /** Pages of a PDF sent before the next model request, by one read or several. */
  pagesPerRead: 10,
  /** Bytes sent before the next model request (before base64), by one read or several. */
  bytesPerRead: 8 * 1024 * 1024,
  /** Pages and bytes read over one answer. */
  pagesPerTurn: 30,
  bytesPerTurn: 16 * 1024 * 1024,
  /**
   * Pages and bytes sent over one answer, counting every request. Nothing is
   * stored at the provider, so each request sends again all that was read
   * before it: this is the bound on what a question costs.
   */
  pageSendsPerTurn: 60,
  byteSendsPerTurn: 32 * 1024 * 1024,
  /** Characters of a text file given by one read. */
  textCharacters: 60_000,
};
export type DocumentReadLimits = typeof DOCUMENT_READ_LIMITS;

export const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/**
 * `[[doc:<documentId>/<page>|<label>]]`, the citation of a page of an affaire's
 * document, as the panel renders it. The label cannot hold a bracket or a bar.
 */
export const DOCUMENT_CITATION_SOURCE = `\\[\\[doc:(${UUID_PATTERN})/([1-9][0-9]{0,4})\\|([^\\[\\]|\\n]{1,160})\\]\\]`;

/**
 * Anything the model wrote that looks like a document citation, however
 * malformed: no bracket or bar inside, so that nested ones resolve from the
 * innermost out, and an unterminated one counts up to the end of its line.
 */
const CITATION_CANDIDATE = /\[\[doc:([^[\]|\n]{0,200})\|([^[\]|\n]{0,200})(\]\]|(?=\n)|$)/gi;
/** What is left of a citation that resolved to nothing: its opening, reference and bar. */
const CITATION_OPENING = /\[\[doc:[^[\]|\n]{0,200}\|?/i;
const VALID_REFERENCE = new RegExp(`^(${UUID_PATTERN})/([1-9][0-9]{0,4})$`, "i");
const UNVERIFIED = "(source non vérifiée)";
/** Characters of the private use area hold kept citations while the rest is cleaned; a model's own are dropped. */
const KEPT = /(\d+)/g;
const HOLDS_KEPT = /\d+/;

type Pages = { pages: number; bytes: number };

/**
 * The documents one answer reads and what they cost, and the judge of its
 * citations. A read is first unsent; the next model request carries it; once
 * that request succeeds its pages are seen, and only a page seen can be cited
 * as a link. Every document read stays in the request's input, so every
 * request sends again all that was read: the ledger counts those sends.
 */
export class AssistantDocumentLedger {
  private readonly names = new Map<string, string>();
  private readonly seenPages = new Map<string, Set<number>>();
  private unsent: Array<{ documentId: string; pages: number[] }> = [];
  private inFlight: Array<{ documentId: string; pages: number[] }> = [];
  private spent: Pages = { pages: 0, bytes: 0 };
  private round: Pages = { pages: 0, bytes: 0 };
  private sent: Pages = { pages: 0, bytes: 0 };

  constructor(private readonly limits: DocumentReadLimits = DOCUMENT_READ_LIMITS) {}

  /** What the answer has left to read. */
  budget(limits: DocumentReadLimits = this.limits) {
    return { pagesLeft: limits.pagesPerTurn - this.spent.pages, bytesLeft: limits.bytesPerTurn - this.spent.bytes };
  }

  /** What the next read may send: what the answer has left, within one read's worth before the next request. */
  readAllowance(limits: DocumentReadLimits = this.limits) {
    const left = this.budget(limits);
    return {
      pagesLeft: Math.min(left.pagesLeft, limits.pagesPerRead - this.round.pages),
      bytesLeft: Math.min(left.bytesLeft, limits.bytesPerRead - this.round.bytes),
    };
  }

  recordRead(read: { documentId: string; fileName: string; pagesTotal: number; from: number; to: number; pages: number; bytes: number }) {
    const documentId = read.documentId.toLowerCase();
    // The name becomes a citation label: nothing in it may close or split the citation.
    if (!this.names.has(documentId)) {
      this.names.set(documentId, read.fileName.replace(/[[\]|\r\n]+/g, " ").trim().slice(0, 140) || "Pièce");
    }
    const pages = [];
    for (let page = read.from; page <= Math.min(read.to, read.pagesTotal); page += 1) pages.push(page);
    this.unsent.push({ documentId, pages });
    this.spent = { pages: this.spent.pages + read.pages, bytes: this.spent.bytes + read.bytes };
    this.round = { pages: this.round.pages + read.pages, bytes: this.round.bytes + read.bytes };
  }

  /**
   * Whether the next request may still offer tools. Past the answer's budget,
   * or when one more read and one more request could go over what an answer
   * may send, the next request is the last: the model must answer.
   */
  allowsMoreReads(limits: DocumentReadLimits = this.limits) {
    const left = this.budget(limits);
    if (left.pagesLeft <= 0 || left.bytesLeft <= 0) return false;
    // This request carries all that was read; the one after it carries that and at most one more read's worth.
    const pages = this.sent.pages + 2 * this.spent.pages + Math.min(limits.pagesPerRead, left.pagesLeft);
    const bytes = this.sent.bytes + 2 * this.spent.bytes + Math.min(limits.bytesPerRead, left.bytesLeft);
    return pages <= limits.pageSendsPerTurn && bytes <= limits.byteSendsPerTurn;
  }

  /** A model request is sent: it carries every document read so far. */
  requestStarting() {
    this.sent = { pages: this.sent.pages + this.spent.pages, bytes: this.sent.bytes + this.spent.bytes };
    this.inFlight.push(...this.unsent);
    this.unsent = [];
    this.round = { pages: 0, bytes: 0 };
  }

  /** That request succeeded: the model has seen the pages it carried. */
  requestSucceeded() {
    for (const read of this.inFlight) {
      const pages = this.seenPages.get(read.documentId) ?? new Set<number>();
      for (const page of read.pages) pages.add(page);
      this.seenPages.set(read.documentId, pages);
    }
    this.inFlight = [];
  }

  /**
   * Keeps a citation of a page the model has seen, under the document's own
   * name (never a label the model wrote), and turns any other one, malformed
   * ones included, into its label followed by « (source non vérifiée) ».
   * Nested citations resolve from the innermost out; nothing left of a
   * citation can then form a new one, and none survives unchecked.
   */
  resolveCitations(text: string) {
    const kept: string[] = [];
    const resolve = (value: string) => value.replace(CITATION_CANDIDATE, (_match, reference: string, label: string, closing: string) => {
      const valid = VALID_REFERENCE.exec(reference.trim());
      const documentId = valid?.[1]?.toLowerCase();
      const page = Number(valid?.[2]);
      const visible = label.trim();
      // Only a complete citation can be kept: an unterminated one is the model's text, not a source.
      if (closing === "]]" && documentId && this.seenPages.get(documentId)?.has(page)) {
        kept.push(`[[doc:${documentId}/${page}|${this.names.get(documentId)}, p. ${page}]]`);
        // What a kept citation held besides its own label (a refused or a kept citation) stays visible before it.
        const held = HOLDS_KEPT.test(visible) || visible.includes(UNVERIFIED);
        return `${held ? `${visible} ` : ""}\uE000${kept.length - 1}\uE001`;
      }
      if (!visible) return UNVERIFIED;
      return visible.endsWith(UNVERIFIED) ? visible : `${visible} ${UNVERIFIED}`;
    });
    // Resolve, then drop one opening that belongs to no citation, until nothing changes: dropping it can join what
    // is around it into a new citation, which is then checked like any other. None is left unchecked at the end.
    let current = text.replace(/[\uE000\uE001]/g, "");
    for (let previous = ""; previous !== current;) {
      previous = current;
      for (let resolved = resolve(current); resolved !== current; resolved = resolve(current)) current = resolved;
      current = current.replace(CITATION_OPENING, "");
    }
    return current.replace(KEPT, (_match, index: string) => kept[Number(index)] ?? "");
  }
}
