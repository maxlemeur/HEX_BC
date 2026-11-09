import { readFile } from "node:fs/promises";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/ai/structured-ai", () => ({ callStructuredAi: vi.fn() }));
vi.mock("@/lib/affaires/intake-decisions", async (original) => ({
  ...await original<typeof import("@/lib/affaires/intake-decisions")>(), classifyAutonomousAffaireDocument: vi.fn(),
}));
import { classifyAutonomousAffaireDocument } from "@/lib/affaires/intake-decisions";
import { callStructuredAi } from "@/lib/ai/structured-ai";
import { __securityTesting__ } from "@/lib/affaires/intake-server";
import { createEmptyAffaireIntakeExtractedMetadata } from "@/lib/affaires/intake";

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("MERGEONE_INTAKE_DECISIONS", "0");
  vi.mocked(callStructuredAi).mockResolvedValue({ data: { documentKind: "cctp", confidence: 0.9, issues: [],
    extractedMetadata: createEmptyAffaireIntakeExtractedMetadata() } } as never);
});

for (const extension of ["doc", "docx"]) describe(`Word ${extension}`, () => {
  it("sends real extracted text and table cells to AI, never the binary document", async () => {
    const bytes = await readFile(`e2e/fixtures/word/intake-word.${extension}`);
    const result = await __securityTesting__.classifyAffaireIntakeDocument({ fileName: `piece.${extension}`,
      mimeType: extension === "doc" ? "application/msword" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: new Uint8Array(bytes).buffer });
    expect(result.analysisSucceeded).toBe(true);
    expect(callStructuredAi).toHaveBeenCalledOnce();
    const file = vi.mocked(callStructuredAi).mock.calls[0][0].files![0];
    expect(file.mimeType).toBe("text/plain");
    const text = Buffer.from(file.data, "base64").toString("utf8");
    expect(text).toContain("Résidence des Tilleuls");
    expect(text).toContain("Tube cuivre DN20");
    expect(text).toContain("12 mètres");
    expect(text.length).toBeLessThanOrEqual(12_000);
  });
});

it("explains a malformed Word file instead of calling it an unsupported format", async () => {
  const result = await __securityTesting__.classifyAffaireIntakeDocument({ fileName: "casse.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: new Uint8Array([1, 2, 3]).buffer });
  expect(callStructuredAi).not.toHaveBeenCalled();
  expect(result.result.issues.join(" ")).toMatch(/Word.*(invalide|corrompu)/);
});

it("guards renamed ZIP documents before decompression and never calls AI", async () => {
  const bytes = Buffer.from(await readFile("e2e/fixtures/word/intake-word.docx"));
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  expect(central).toBeGreaterThan(0);
  bytes.writeUInt32LE(64 * 1024 * 1024, central + 24);
  const result = await __securityTesting__.classifyAffaireIntakeDocument({ fileName: "archive-renommee.doc",
    mimeType: "application/msword", bytes: new Uint8Array(bytes).buffer });
  expect(callStructuredAi).not.toHaveBeenCalled();
  expect(result.analysisFailure).toMatchObject({ code: "WORD_LIMIT", scope: "document" });
});

for (const [label, offset, value] of [["sector size", 30, 30], ["FAT allocation", 44, 0x7fffffff]] as const) {
  it(`rejects forged OLE ${label} before allocating from declared sizes`, async () => {
    const bytes = Buffer.from(await readFile("e2e/fixtures/word/intake-word.doc"));
    if (offset === 30) bytes.writeUInt16LE(value, offset); else bytes.writeUInt32LE(value, offset);
    const result = await __securityTesting__.classifyAffaireIntakeDocument({ fileName: "forge.doc",
      mimeType: "application/msword", bytes: new Uint8Array(bytes).buffer });
    expect(callStructuredAi).not.toHaveBeenCalled();
    expect(result.analysisFailure).toMatchObject({ code: "WORD_INVALID", scope: "document" });
  });
}

it("identifies encrypted legacy Word before any provider request", async () => {
  const bytes = Buffer.from(await readFile("e2e/fixtures/word/intake-word.doc"));
  const directory = bytes.indexOf(Buffer.from("WordDocument\0", "utf16le"));
  expect(directory).toBeGreaterThan(0);
  const sector = bytes.readUInt32LE(directory + 116);
  const start = (sector + 1) * 2 ** bytes.readUInt16LE(30);
  bytes.writeUInt16LE(bytes.readUInt16LE(start + 10) | 0x0100, start + 10);
  const result = await __securityTesting__.classifyAffaireIntakeDocument({ fileName: "protege.doc",
    mimeType: "application/msword", bytes: new Uint8Array(bytes).buffer });
  expect(callStructuredAi).not.toHaveBeenCalled();
  expect(result.analysisFailure).toMatchObject({ code: "WORD_PROTECTED", scope: "document" });
});

for (const source of ["ai", "heuristic"] as const) it(`keeps Word reader warnings with Decisions ${source}`, async () => {
  vi.stubEnv("MERGEONE_INTAKE_DECISIONS", "1");
  vi.mocked(classifyAutonomousAffaireDocument).mockResolvedValue({ source,
    result: { documentKind: "cctp", confidence: 0.9, issues: [], extractedMetadata: createEmptyAffaireIntakeExtractedMetadata() } });
  const bytes = await readFile("e2e/fixtures/word/intake-word.docx");
  const result = await __securityTesting__.classifyAffaireIntakeDocument({ fileName: "piece.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: new Uint8Array(bytes).buffer });
  expect(result.result.issues.join(" ")).toContain("les images et certaines zones de texte ne sont pas lues");
});
