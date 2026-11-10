import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { isZip, openZip } from "./zip";

const text = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);
const LONG = "MergeOne ".repeat(4000);

describe("zip archives", () => {
  it("lists the entries and reads them, stored or deflated", async () => {
    const bytes = zipSync({ "Document.xml": strToU8(LONG), "dossier/note.txt": [strToU8("gardé tel quel"), { level: 0 }], "vide.txt": new Uint8Array() });
    expect(isZip(bytes)).toBe(true);
    const zip = openZip(bytes);
    expect(zip?.names).toEqual(["Document.xml", "dossier/note.txt", "vide.txt"]);
    expect(text(await zip!.read("Document.xml", 1 << 20))).toBe(LONG);
    expect(text(await zip!.read("dossier/note.txt", 64))).toBe("gardé tel quel");
    expect(text(await zip!.read("vide.txt", 64))).toBe("");
    expect(await zip!.read("absent.txt", 64)).toBeNull();
  });

  it("finds its directory behind a comment", async () => {
    const zip = openZip(zipSync({ "a.txt": strToU8("a") }, { comment: "un commentaire à la fin de l’archive" }));
    expect(text(await zip!.read("a.txt", 8))).toBe("a");
  });

  it("does not read an entry larger than what is asked", async () => {
    const zip = openZip(zipSync({ "Document.xml": strToU8(LONG) }));
    expect(await zip!.read("Document.xml", LONG.length - 1)).toBeNull();
    expect(text(await zip!.read("Document.xml", LONG.length))).toBe(LONG);
  });

  it("stops at the size the directory announces, whatever the data unfolds into", async () => {
    const bytes = zipSync({ "bombe.txt": strToU8(LONG) });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // The directory is made to announce 10 bytes for data that unfolds into 36 000.
    for (let at = 0; at + 4 <= bytes.length; at += 1) if (view.getUint32(at, true) === 0x02014b50) view.setUint32(at + 24, 10, true);
    expect(await openZip(bytes)!.read("bombe.txt", 1 << 20)).toBeNull();
  });

  it("gives nothing for damaged data, an encrypted entry or a method it does not know", async () => {
    const damaged = zipSync({ "a.txt": strToU8(LONG) });
    damaged.fill(0xff, 40, 60);
    expect(await openZip(damaged)!.read("a.txt", 1 << 20)).toBeNull();

    for (const [offset, value] of [[8, 1], [10, 12]] as const) {
      const bytes = zipSync({ "a.txt": strToU8(LONG) });
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let at = 0; at + 4 <= bytes.length; at += 1) if (view.getUint32(at, true) === 0x02014b50) view.setUint16(at + offset, value, true);
      expect(await openZip(bytes)!.read("a.txt", 1 << 20), `directory field ${offset}`).toBeNull();
    }
  });

  it("refuses what is not a zip, or a zip cut short", () => {
    expect(isZip(strToU8("0\nSECTION\n"))).toBe(false);
    expect(isZip(new Uint8Array())).toBe(false);
    expect(openZip(strToU8("PK\u0003\u0004 puis rien d’une archive"))).toBeNull();
    const whole = zipSync({ "a.txt": strToU8(LONG), "b.txt": strToU8("b") });
    expect(openZip(whole.subarray(0, whole.length - 30))).toBeNull();
    expect(openZip(new Uint8Array())).toBeNull();
  });

  it("refuses a directory that points outside the file", () => {
    const bytes = zipSync({ "a.txt": strToU8("a") });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(bytes.length - 22 + 16, bytes.length + 100, true);
    expect(openZip(bytes)).toBeNull();
  });
});
