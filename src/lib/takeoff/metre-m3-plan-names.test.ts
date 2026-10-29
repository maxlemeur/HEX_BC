import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

// Métré — noms de plans : clé de stockage contre libellé métier.
// La clé Storage et `file_name` restent le nom nettoyé (R+1 → R-1, NFC et NFD divergents) :
// les policies 20260305134000_v3_006 et plans.ts assertCanonicalPlanFileStoragePath exigent
// file_name = nom de l'objet Storage. M1a garde à part le nom reçu, en NFC, dans
// metadata.original_file_name (plan-file-display-name.ts), dérivé côté serveur.
// M1b : le chargeur du traitement transmet ce libellé et une référence durable du document
// (fichier du jeu de plans, ou fichier téléversé du job), jamais le nom nettoyé.

vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
  isTakeoffEnabled: vi.fn(),
  getTakeoffChunkingConfigForTenant: vi.fn(),
  getTakeoffLevelCProcessingConfigForTenant: vi.fn(),
}));

import { syncTakeoffPlanSetFromAffaireIntake } from "@/lib/affaires/intake-plan-sync";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import {
  assertTakeoffEnabled,
  getTakeoffChunkingConfigForTenant,
  getTakeoffLevelCProcessingConfigForTenant,
  isTakeoffEnabled,
} from "@/lib/takeoff/feature-flags";
import {
  authenticatedContext,
  createIntakeFake,
  createSupabaseFake,
  intakeDocument,
  M3_JOB_ID,
  M3_PLAN_SET_ID,
  M3_PROJECT_ID,
  M3_TENANT_ID,
  M3_USER_ID,
  takeoffJobRow,
  type FakeQuery,
} from "@/lib/takeoff/metre-m3.test-utils";
import { getPlanFileDisplayName } from "@/lib/takeoff/plan-file-display-name";
import { createPlanFile, parseCreatePlanFileInput } from "@/lib/takeoff/plans";
import { loadTakeoffSource } from "@/lib/takeoff/source-loader";

const ELECTRICITE_NFC = "CVC_R+2_Électricité.pdf".normalize("NFC");
const ELECTRICITE_NFD = "CVC_R+2_Électricité.pdf".normalize("NFD");

// Valeurs obtenues en exécutant le texte source réel de sanitizePdfFilename (plans.ts,
// intake-plan-sync.ts) et sanitizeFilename (server.ts) : les trois donnent le même résultat.
const SANITIZED_NAMES: Array<{ original: string; stored: string }> = [
  { original: "Plan R+1.pdf", stored: "Plan-R-1.pdf" },
  { original: "Plan R-1.pdf", stored: "Plan-R-1.pdf" },
  { original: "PLB R+1 indice B.pdf", stored: "PLB-R-1-indice-B.pdf" },
  { original: "Niveau +3.50.pdf", stored: "Niveau-3.50.pdf" },
  { original: "R+1.pdf", stored: "R-1.pdf" },
  { original: ELECTRICITE_NFC, stored: "CVC_R-2_-lectricit-.pdf" },
  { original: ELECTRICITE_NFD, stored: "CVC_R-2_E-lectricite-.pdf" },
];

function lastSegment(path: string) {
  return path.split("/").filter(Boolean).at(-1);
}

function planSetRow() {
  return {
    id: M3_PLAN_SET_ID,
    created_at: "2026-10-24T00:00:00.000Z",
    updated_at: "2026-10-24T00:00:00.000Z",
    tenant_id: M3_TENANT_ID,
    project_id: M3_PROJECT_ID,
    estimate_version_id: null,
    name: "Plans import",
    description: null,
    metadata: {},
    created_by: M3_USER_ID,
  };
}

/** Faux Supabase de l'enregistrement d'un plan : jeu existant, aucun fichier, insertion en écho. */
function createPlanFileFake() {
  return createSupabaseFake({
    tables: {
      plan_sets: () => ({ data: planSetRow(), error: null }),
      plan_files: (query: FakeQuery) =>
        query.operation === "insert"
          ? {
              data: {
                ...(query.payload as Record<string, unknown>),
                created_at: "2026-10-24T00:00:00.000Z",
                updated_at: "2026-10-24T00:00:00.000Z",
              },
              error: null,
            }
          : { data: [], error: null, count: 0 },
    },
    storage: {
      "plan-files": (call) => ({
        data: { path: call.paths[0], token: "jeton-simule", signedUrl: "https://upload.invalid/simule" },
        error: null,
      }),
    },
  });
}

async function registerPlanFile(fileName: string, metadata: Record<string, unknown> = {}) {
  const fake = createPlanFileFake();
  vi.mocked(getAuthenticatedContext).mockResolvedValue(authenticatedContext(fake) as never);
  const result = await createPlanFile(
    M3_PLAN_SET_ID,
    parseCreatePlanFileInput({
      file_name: fileName,
      file_type: "application/pdf",
      file_size_bytes: 2048,
      metadata,
    })
  );
  const [insert] = fake.writesTo("plan_files");
  return {
    fake,
    result,
    insertedRow: insert?.payload as Record<string, unknown>,
  };
}

async function createPdfBlob() {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  return new Blob([new Uint8Array(await pdf.save())], { type: "application/pdf" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  vi.mocked(isTakeoffEnabled).mockResolvedValue(true);
  vi.mocked(getTakeoffChunkingConfigForTenant).mockResolvedValue({ maxPdfPages: 50 } as never);
  vi.mocked(getTakeoffLevelCProcessingConfigForTenant).mockResolvedValue({ maxPdfPages: 50 } as never);
});

describe("enregistrement d'un plan (createPlanFile) : clé de stockage nettoyée, libellé d'origine à part", () => {
  it.each(SANITIZED_NAMES)("« $original » est enregistré « $stored », clé Storage cohérente", async ({ original, stored }) => {
    const { fake, result, insertedRow } = await registerPlanFile(original);

    expect(insertedRow.file_name).toBe(stored);
    expect(lastSegment(String(insertedRow.file_path))).toBe(stored);
    expect(String(insertedRow.file_path)).toBe(
      `${M3_TENANT_ID}/${M3_PLAN_SET_ID}/${String(insertedRow.id)}/${stored}`
    );
    // L'URL d'upload signée vise exactement le chemin enregistré.
    expect(fake.storageCalls).toEqual([
      { bucket: "plan-files", method: "createSignedUploadUrl", paths: [insertedRow.file_path] },
    ]);
    expect(result.plan_file.file_name).toBe(stored);
    // Le nom reçu est gardé à part, en NFC, sans toucher à la clé.
    expect(insertedRow.metadata).toEqual({ original_file_name: original.normalize("NFC") });
  });

  it("confond R+1 et R-1 : deux plans distincts portent le même file_name", async () => {
    const upper = await registerPlanFile("Plan R+1.pdf");
    const lower = await registerPlanFile("Plan R-1.pdf");

    expect(upper.insertedRow.file_name).toBe(lower.insertedRow.file_name);
    // Seul l'identifiant de fichier, dans le chemin, les distingue.
    expect(upper.insertedRow.file_path).not.toBe(lower.insertedRow.file_path);
  });

  it("dérive le libellé du nom reçu : une métadonnée client contradictoire ne le remplace pas", async () => {
    const { insertedRow } = await registerPlanFile("Plan R+1.pdf", {
      original_file_name: "Plan R-1.pdf",
      revision: "B",
    });

    expect(insertedRow.metadata).toEqual({ revision: "B", original_file_name: "Plan R+1.pdf" });
  });
});

describe("synchronisation des plans du dossier d'affaire (intake)", () => {
  it("nettoie la clé et garde le nom du document d'origine comme libellé", async () => {
    const { fake, planFiles } = createIntakeFake();

    await syncTakeoffPlanSetFromAffaireIntake({
      supabase: fake.client as never,
      project: { id: M3_PROJECT_ID, tenant_id: M3_TENANT_ID },
      documents: [intakeDocument({ id: "doc-r-plus-1", fileName: "PLB R+1 indice B.pdf" })],
    });

    expect(planFiles).toHaveLength(1);
    expect(planFiles[0]).toMatchObject({
      file_name: "PLB-R-1-indice-B.pdf",
      metadata: {
        source: "affaire-intake",
        intake_document_id: "doc-r-plus-1",
        intake_upload_id: "upload-m3",
        original_file_name: "PLB R+1 indice B.pdf",
      },
    });
    expect(lastSegment(String(planFiles[0]?.file_path))).toBe("PLB-R-1-indice-B.pdf");
  });
});

describe("M1b — chargeur de source du traitement (loadTakeoffSource)", () => {
  it("téléversement direct : le libellé du job est transmis, plus le résidu <uuid>-<nom nettoyé> du chemin", async () => {
    // Format réel du chemin (server.ts, création) : <empreinte 64 hex>-<uuid>-<nom nettoyé>.
    // Les tests du processeur utilisent <empreinte>-<nom> sans uuid : ce résidu n'y apparaît pas.
    const uuid = "0f0e0d0c-0b0a-4908-8706-050403020100";
    const job = takeoffJobRow({
      status: "processing",
      source_file_name: "Plan R+1.pdf",
      source_file_path: `${M3_TENANT_ID}/${M3_JOB_ID}/${"a".repeat(64)}-${uuid}-Plan-R-1.pdf`,
    });
    const fake = createSupabaseFake({
      storage: { "takeoff-files": async () => ({ data: await createPdfBlob(), error: null }) },
    });

    const source = await loadTakeoffSource({ supabase: fake.client as never, job: job as never, level: "B" });

    expect(source.fileName).toBe("Plan R+1.pdf");
    expect(source.fileName).not.toContain(uuid);
    expect(source.mimeType).toBe("application/pdf");
    expect(source.sourceDocument).toEqual({ kind: "job_upload", job_id: M3_JOB_ID });
  });

  it("téléversement direct sans type connu : le type vient du nom stocké, le libellé reste celui du job", async () => {
    const uuid = "0f0e0d0c-0b0a-4908-8706-050403020100";
    const job = takeoffJobRow({
      status: "processing",
      level: "A",
      source_file_name: "Métré R+1",
      source_file_type: null,
      source_file_path: `${M3_TENANT_ID}/${M3_JOB_ID}/${"a".repeat(64)}-${uuid}-Metre-R-1.csv`,
    });
    const fake = createSupabaseFake({
      storage: { "takeoff-files": async () => ({ data: new Blob(["designation;quantite\n"]), error: null }) },
    });

    const source = await loadTakeoffSource({ supabase: fake.client as never, job: job as never, level: "A" });

    expect(source.mimeType).toBe("text/csv");
    expect(source.fileName).toBe("Métré R+1");
    expect(source.sourceDocument).toEqual({ kind: "job_upload", job_id: M3_JOB_ID });
  });

  it("jeu de plans multi-fichiers : les pages issues de R+1 et R-1 gardent leur libellé et leur fichier", async () => {
    const planFileRows = [
      { id: "f1", file_path: `${M3_TENANT_ID}/${M3_PLAN_SET_ID}/f1/Plan-R-1.pdf`, file_name: "Plan-R-1.pdf",
        metadata: { original_file_name: "Plan R+1.pdf" } },
      { id: "f2", file_path: `${M3_TENANT_ID}/${M3_PLAN_SET_ID}/f2/Plan-R-1.pdf`, file_name: "Plan-R-1.pdf",
        metadata: { original_file_name: "Plan R-1.pdf" } },
    ].map((row) => ({ ...row, file_type: "application/pdf", file_size_bytes: 2048, page_count: 1 }));
    const fake = createSupabaseFake({
      tables: { plan_files: () => ({ data: planFileRows, error: null, count: planFileRows.length }) },
      storage: { "plan-files": async () => ({ data: await createPdfBlob(), error: null }) },
    });
    const job = takeoffJobRow({ status: "processing", plan_set_id: M3_PLAN_SET_ID, source_file_path: null });

    const source = await loadTakeoffSource({ supabase: fake.client as never, job: job as never, level: "B" });

    expect(source.fileName).toBe(`plan-set-${M3_PLAN_SET_ID}.pdf`);
    expect(source.sourceFileNamesByPage).toEqual(["Plan R+1.pdf", "Plan R-1.pdf"]);
    expect(source.sourceDocumentsByPage).toEqual([
      { kind: "plan_file", plan_file_id: "f1" },
      { kind: "plan_file", plan_file_id: "f2" },
    ]);
  });

  it("jeu de plans d'un seul fichier : son libellé et sa référence nomment la source", async () => {
    const planFileRows = [
      { id: "f1", file_path: `${M3_TENANT_ID}/${M3_PLAN_SET_ID}/f1/PLB-R-1-indice-B.pdf`, file_name: "PLB-R-1-indice-B.pdf",
        metadata: { original_file_name: "PLB R+1 indice B.pdf" }, file_type: "application/pdf", file_size_bytes: 2048, page_count: 1 },
    ];
    const fake = createSupabaseFake({
      tables: { plan_files: () => ({ data: planFileRows, error: null, count: planFileRows.length }) },
      storage: { "plan-files": async () => ({ data: await createPdfBlob(), error: null }) },
    });
    const job = takeoffJobRow({ status: "processing", plan_set_id: M3_PLAN_SET_ID, source_file_path: null });

    const source = await loadTakeoffSource({ supabase: fake.client as never, job: job as never, level: "B" });

    expect(source.fileName).toBe("PLB R+1 indice B.pdf");
    expect(source.sourceDocument).toEqual({ kind: "plan_file", plan_file_id: "f1" });
  });
});

describe("M1a — libellé d'origine conservé, clé Storage inchangée", () => {
  it("les formes NFC et NFD d'un même nom donnent le même libellé, malgré deux clés différentes", async () => {
    const nfc = await registerPlanFile(ELECTRICITE_NFC);
    const nfd = await registerPlanFile(ELECTRICITE_NFD);

    expect(nfc.insertedRow.file_name).not.toBe(nfd.insertedRow.file_name);
    expect(getPlanFileDisplayName(nfc.insertedRow as never)).toBe(ELECTRICITE_NFC);
    expect(getPlanFileDisplayName(nfd.insertedRow as never)).toBe(ELECTRICITE_NFC);
  });
});

// M1b — continuité de provenance et identité. Couvert ailleurs, avec le même contrat :
// - prompt, items et résultat : processor.test.ts, « carries the original label and the upload
//   reference… » (les preuves lisent source_file_name des items) ;
// - résidu <uuid>-<nom nettoyé> : le premier test du chargeur ci-dessus ;
// - comparaison de jobs par référence durable : server.compare.test.ts, « pairs jobs by document
//   reference ».
describe("M1b — identité de document", () => {
  it("deux révisions déposées sous le même libellé restent deux documents : la référence est le fichier, pas le nom", async () => {
    const planFileRows = [
      { id: "rev-a", file_path: `${M3_TENANT_ID}/${M3_PLAN_SET_ID}/rev-a/Plan-R-1.pdf`, file_name: "Plan-R-1.pdf",
        metadata: { original_file_name: "Plan R+1.pdf" } },
      { id: "rev-b", file_path: `${M3_TENANT_ID}/${M3_PLAN_SET_ID}/rev-b/Plan-R-1.pdf`, file_name: "Plan-R-1.pdf",
        metadata: { original_file_name: "Plan R+1.pdf" } },
    ].map((row) => ({ ...row, file_type: "application/pdf", file_size_bytes: 2048, page_count: 1 }));
    const fake = createSupabaseFake({
      tables: { plan_files: () => ({ data: planFileRows, error: null, count: planFileRows.length }) },
      storage: { "plan-files": async () => ({ data: await createPdfBlob(), error: null }) },
    });
    const job = takeoffJobRow({ status: "processing", plan_set_id: M3_PLAN_SET_ID, source_file_path: null });

    const source = await loadTakeoffSource({ supabase: fake.client as never, job: job as never, level: "B" });

    expect(source.sourceFileNamesByPage).toEqual(["Plan R+1.pdf", "Plan R+1.pdf"]);
    expect(source.sourceDocumentsByPage).toEqual([
      { kind: "plan_file", plan_file_id: "rev-a" },
      { kind: "plan_file", plan_file_id: "rev-b" },
    ]);
  });
});
