import { describe, expect, it } from "vitest";

import {
  AFFAIRE_INTAKE_ALLOWED_EXTENSIONS,
  AFFAIRE_INTAKE_CAD_NOTICE,
  AFFAIRE_INTAKE_DWG_NOTICE,
  AFFAIRE_INTAKE_DXF_NOTICE,
  affaireIntakeCadNotice,
  affaireIntakeFileUrl,
  getAffaireIntakeAllowedMimeTypes,
  getHeuristicAffaireDocumentClassification,
  inferAffaireIntakeMimeType,
} from "@/lib/affaires/intake";
import { validateFileForUpload } from "@/lib/file-validation";
import { driveFileRejection } from "@/lib/affaires/google-drive/contracts";

function validate(name: string, type: string, size = 10) {
  const file = new File([new Uint8Array(size)], name, { type });
  return validateFileForUpload(file, {
    allowedExtensions: [...AFFAIRE_INTAKE_ALLOWED_EXTENSIONS],
    allowedMimeTypes: [...getAffaireIntakeAllowedMimeTypes(name)],
    maxFileSizeBytes: 50 * 1024 * 1024,
  });
}

describe("CAD/BIM dossier originals", () => {
  it.each([
    ["réseaux.DWG", "image/vnd.dwg"],
    ["réseaux.dwg", "application/acad"],
    ["réseaux.dxf", "image/vnd.dxf"],
    ["réseaux.dxf", "text/plain"],
    ["maquette.rvt", "application/octet-stream"],
    ["maquette.rvt", ""],
  ])("accepts the original %s with browser MIME %s", (name, type) => {
    expect(validate(name, type)).toEqual({ valid: true });
    expect(inferAffaireIntakeMimeType(name)).toBe("application/octet-stream");
  });

  it("does not broaden generic binary acceptance to other extensions or accept executable MIME", () => {
    expect(validate("document.pdf", "application/octet-stream").valid).toBe(false);
    expect(validate("programme.exe", "application/octet-stream").valid).toBe(false);
    expect(validate("plan.dwg", "application/x-msdownload").valid).toBe(false);
    expect(validate("plan.dxf", "image/png").valid).toBe(false);
    expect(validate("maquette.rvt", "application/octet-stream", 0).valid).toBe(false);
  });

  it.each([
    ["dpgf.dwg", AFFAIRE_INTAKE_DWG_NOTICE],
    ["cctp.dxf", AFFAIRE_INTAKE_DXF_NOTICE],
    ["maquette.rvt", AFFAIRE_INTAKE_CAD_NOTICE],
  ])("does not infer readable business content from %s", (name, notice) => {
    const result = getHeuristicAffaireDocumentClassification({ fileName: name });
    expect(result.documentKind).toBe("plans");
    expect(result.confidence).toBeLessThan(0.65);
    expect(result.issues).toEqual([notice]);
    expect(result.extractedMetadata.detectedLots).toEqual([]);
  });

  it("tells a DXF and a DWG, which MergeOne reads, from the original it only keeps", () => {
    expect(affaireIntakeCadNotice("Réseaux EF.DXF")).toBe(AFFAIRE_INTAKE_DXF_NOTICE);
    expect(affaireIntakeCadNotice("réseaux.DWG")).toBe(AFFAIRE_INTAKE_DWG_NOTICE);
    expect(affaireIntakeCadNotice("maquette.rvt")).toBe(AFFAIRE_INTAKE_CAD_NOTICE);
    expect(affaireIntakeCadNotice("plan.dxf.pdf")).toBeNull();
    expect(AFFAIRE_INTAKE_DXF_NOTICE).not.toContain("non disponibles");
    expect(AFFAIRE_INTAKE_DWG_NOTICE).not.toContain("non disponibles");
    expect(AFFAIRE_INTAKE_CAD_NOTICE).toContain("Aperçu et métré non disponibles");
  });

  it("asks for a piece and for the drawing of a DWG under the same document, whatever its identifier holds", () => {
    expect(affaireIntakeFileUrl("affaire-1", "piece-2", "preview")).toBe("/api/affaires/affaire-1/intake/files/piece-2/preview");
    expect(affaireIntakeFileUrl("affaire-1", "piece-2", "drawing")).toBe("/api/affaires/affaire-1/intake/files/piece-2/drawing");
    // An identifier that ends like a route, or holds a path, stays one segment.
    expect(affaireIntakeFileUrl("a/b", "preview/../x?y#z", "drawing")).toBe("/api/affaires/a%2Fb/intake/files/preview%2F..%2Fx%3Fy%23z/drawing");
  });

  it("allows a downloadable original on Drive but keeps ordinary MIME validation", () => {
    const file = { id: "cad", name: "plan.dwg", mimeType: "application/octet-stream", size: "12", version: "1" };
    expect(driveFileRejection(file)).toBeNull();
    expect(driveFileRejection({ ...file, name: "plan.pdf" })).toBe("Format non pris en charge.");
    expect(driveFileRejection({ ...file, capabilities: { canDownload: false } })).toBe("Lecture interdite par le propriétaire.");
  });
});
