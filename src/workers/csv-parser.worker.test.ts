import { describe, expect, it } from "vitest";

import { decodeCsvBuffer } from "@/workers/csv-parser.worker";

function latin1Buffer(value: string): ArrayBuffer {
  const bytes = Uint8Array.from(value.split("").map((char) => char.charCodeAt(0) & 0xff));
  return bytes.buffer;
}

describe("csv parser worker encoding detection", () => {

  it("falls back to windows-1252 when utf-8 decoding contains replacements", () => {
    const cp1252Buffer = latin1Buffer("ID;Caracteristique\nA1;Bride à collerettes T11\n");
    const result = decodeCsvBuffer(cp1252Buffer);

    expect(result.detectedEncoding).toBe("windows-1252");
    expect(result.text).toContain("Bride à collerettes");
    expect(result.text).not.toContain("�");
  });
});
