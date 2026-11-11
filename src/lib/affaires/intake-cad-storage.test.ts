import { describe, expect, it } from "vitest";

import { __securityTesting__ } from "@/lib/affaires/intake-server";

// The storage reads the type of the body it receives, not the option beside it,
// and the bucket lists the types it takes: a browser that names a DXF
// "image/vnd.dxf", as Chromium does on Linux, had its original refused.
describe("what the storage receives of a deposited file", () => {
  it("stores a CAD original as plain bytes, whatever type the browser gave it", async () => {
    for (const [name, type] of [["Réseaux.dxf", "image/vnd.dxf"], ["Plan.dwg", "image/vnd.dwg"], ["Maquette.rvt", ""], ["Chaufferie.FCStd", "application/zip"], ["Maquette.ifc", "application/x-step"]]) {
      const stored = __securityTesting__.toStoredUpload(new File(["0\nEOF\n"], name, { type }));
      expect(stored.mimeType).toBe("application/octet-stream");
      expect(stored.body.type).toBe("application/octet-stream");
      expect(stored.body.name).toBe(name);
      expect(await stored.body.text()).toBe("0\nEOF\n");
    }
  });

  it("stores another piece under the type the dossier records for it", () => {
    const pdf = new File(["%PDF"], "CCTP.pdf", { type: "application/pdf" });
    expect(__securityTesting__.toStoredUpload(pdf)).toEqual({ mimeType: "application/pdf", body: pdf });
    expect(__securityTesting__.toStoredUpload(pdf).body).toBe(pdf);

    const untyped = __securityTesting__.toStoredUpload(new File(["%PDF"], "DPGF.pdf", { type: "" }));
    expect(untyped.mimeType).toBe("application/pdf");
    expect(untyped.body.type).toBe("application/pdf");
  });
});
