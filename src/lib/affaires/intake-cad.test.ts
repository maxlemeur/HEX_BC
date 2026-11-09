import { describe, expect, it } from "vitest";

import {
  AFFAIRE_INTAKE_ALLOWED_EXTENSIONS,
  AFFAIRE_INTAKE_CAD_NOTICE,
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

  it.each(["dpgf.dwg", "cctp.dxf", "maquette.rvt"])("does not infer readable business content from %s", (name) => {
    const result = getHeuristicAffaireDocumentClassification({ fileName: name });
    expect(result.documentKind).toBe("plans");
    expect(result.confidence).toBeLessThan(0.65);
    expect(result.issues).toContain(AFFAIRE_INTAKE_CAD_NOTICE);
    expect(result.extractedMetadata.detectedLots).toEqual([]);
  });

  it("allows a downloadable original on Drive but keeps ordinary MIME validation", () => {
    const file = { id: "cad", name: "plan.dwg", mimeType: "application/octet-stream", size: "12", version: "1" };
    expect(driveFileRejection(file)).toBeNull();
    expect(driveFileRejection({ ...file, name: "plan.pdf" })).toBe("Format non pris en charge.");
    expect(driveFileRejection({ ...file, capabilities: { canDownload: false } })).toBe("Lecture interdite par le propriétaire.");
  });
});
