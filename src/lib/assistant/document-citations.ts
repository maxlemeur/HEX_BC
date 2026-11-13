/** What one answer may read of the affaire's documents: per read and over the whole answer (one user turn). */
export const DOCUMENT_READ_LIMITS = {
  /** Pages of a PDF sent by one read. */
  pagesPerRead: 10,
  /** Bytes of the file sent by one read (before base64). */
  bytesPerRead: 8 * 1024 * 1024,
  /**
   * Pages and bytes over one answer. Without storage at the provider every
   * request of the answer sends again what was read before it, so this bound
   * is what keeps the cost of a question in check.
   */
  pagesPerTurn: 30,
  bytesPerTurn: 16 * 1024 * 1024,
  /** Characters of a text file given by one read. */
  textCharacters: 60_000,
};
export type DocumentReadLimits = typeof DOCUMENT_READ_LIMITS;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** `[[doc:<documentId>/<page>|<label>]]`, the citation of a page of an affaire's document. */
export const DOCUMENT_CITATION_SOURCE = `\\[\\[doc:(${UUID})/([1-9][0-9]{0,4})\\|([^\\]\\n]{1,160})\\]\\]`;

type Read = { fileName: string; pages: Set<number> };

/**
 * The documents one answer actually read, page by page, and what it has left
 * to spend. At the end of the answer it decides which citations are kept: only
 * a page this answer sent to the model can be cited as a link.
 */
export class AssistantDocumentLedger {
  private readonly reads = new Map<string, Read>();
  private pagesSpent = 0;
  private bytesSpent = 0;

  constructor(private readonly limits: DocumentReadLimits = DOCUMENT_READ_LIMITS) {}

  budget(limits: DocumentReadLimits = this.limits) {
    return { pagesLeft: limits.pagesPerTurn - this.pagesSpent, bytesLeft: limits.bytesPerTurn - this.bytesSpent };
  }

  recordRead(read: { documentId: string; fileName: string; pagesTotal: number; from: number; to: number; pages: number; bytes: number }) {
    const documentId = read.documentId.toLowerCase();
    // The name becomes a citation label: nothing in it may close or split the citation.
    const fileName = read.fileName.replace(/[[\]|\r\n]+/g, " ").trim().slice(0, 140) || "Pièce";
    const entry = this.reads.get(documentId) ?? { fileName, pages: new Set<number>() };
    for (let page = read.from; page <= Math.min(read.to, read.pagesTotal); page += 1) entry.pages.add(page);
    this.reads.set(documentId, entry);
    this.pagesSpent += read.pages;
    this.bytesSpent += read.bytes;
  }

  /**
   * Keeps a citation of a page this answer read, under the document's own name
   * (never a label the model wrote), and turns any other one into plain text
   * that says it was not verified: a model can name a page it never saw.
   */
  resolveCitations(text: string) {
    return text.replace(new RegExp(DOCUMENT_CITATION_SOURCE, "gi"), (_match, documentId: string, rawPage: string, label: string) => {
      const page = Number(rawPage);
      const read = this.reads.get(documentId.toLowerCase());
      if (read?.pages.has(page)) return `[[doc:${documentId.toLowerCase()}/${page}|${read.fileName}, p. ${page}]]`;
      return `${label.trim()} (source non vérifiée)`;
    });
  }
}
