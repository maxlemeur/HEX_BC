import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import type { DossierDocument } from "@/lib/affaires/document-triage";
import { IntakeDocumentPreview } from "./IntakeDocumentPreview";

type CadProps = { url: string; fileName: string; canManage: boolean; expanded: boolean; onDrawingChange?(drawn: boolean): void };

const cad = vi.hoisted(() => ({ props: null as CadProps | null }));

vi.mock("./IntakeCadPreview", () => ({
  IntakeCadPreview: (props: CadProps) => {
    cad.props = props;
    return <div data-testid="cad-preview" data-expanded={props.expanded} />;
  },
}));
vi.mock("./IntakePdfPreview", () => ({
  IntakePdfPreview: ({ name }: { name: string }) => <div data-testid="pdf-preview">{name}</div>,
}));

const PROJECT = "11111111-1111-4111-8111-111111111111", DOCUMENT = "22222222-2222-4222-8222-222222222222";
const ENDPOINT = `/api/affaires/${PROJECT}/intake/files/${DOCUMENT}/preview`;

/** What the preview reads of a document of the dossier. */
function dossierDocument(fileName: string, mimeType: string, rest: Partial<DossierDocument> = {}): DossierDocument {
  return { documentId: DOCUMENT, fileName, mimeType, uploadStatus: "uploaded", isBeingDeleted: false, sizeBytes: 2_097_152, driveSource: null, ...rest } as DossierDocument;
}

function installFetch() {
  const fetchMock = vi.fn(async () => new Response(new Blob(["%PDF"], { type: "application/pdf" })));
  vi.stubGlobal("fetch", fetchMock);
  // jsdom makes no address for a blob: the test lends it the two functions, and takes them back.
  const before = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:piece"), revokeObjectURL: vi.fn() });
  onTestFinished(() => void Object.assign(URL, before));
  return fetchMock;
}

afterEach(() => {
  cad.props = null;
  vi.unstubAllGlobals();
});

describe("IntakeDocumentPreview", () => {
  it("reads a CAD original in the browser, from its download", async () => {
    const fetchMock = installFetch();
    render(<IntakeDocumentPreview projectId={PROJECT} document={dossierDocument("Réseaux.dxf", "image/vnd.dxf")} canManage />);
    // The reader is fetched when a drawing is opened: the pages that show none do not carry it.
    expect(screen.getByRole("status")).toHaveTextContent("Lecture du plan…");
    expect(await screen.findByTestId("cad-preview")).toBeInTheDocument();
    expect(cad.props).toMatchObject({ url: `${ENDPOINT}?download=1`, fileName: "Réseaux.dxf", canManage: true, expanded: false });
    // The preview route is not asked for a picture of it.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Télécharger" })).toHaveAttribute("href", `${ENDPOINT}?download=1`);
  });

  it("opens the large view of a drawing once it is drawn, and only its own", async () => {
    installFetch();
    render(<IntakeDocumentPreview projectId={PROJECT} document={dossierDocument("Réseaux.dxf", "image/vnd.dxf")} />);
    await screen.findByTestId("cad-preview");
    expect(cad.props?.canManage).toBe(false);
    expect(screen.getByRole("button", { name: "Agrandir le document" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Agrandir" })).toBeNull();

    act(() => cad.props?.onDrawingChange?.(true));
    expect(screen.getByRole("button", { name: "Agrandir le document" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Agrandir" }));
    expect(screen.getByTestId("cad-preview")).toHaveAttribute("data-expanded", "true");
    // The large view is the drawing's: the dialog of the other formats stays closed.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not read a CAD original that is not in the dossier", () => {
    installFetch();
    render(<IntakeDocumentPreview projectId={PROJECT} document={dossierDocument("Plan.dwg", "image/vnd.dwg", { uploadStatus: "rejected" })} />);
    expect(screen.queryByTestId("cad-preview")).toBeNull();
    expect(screen.getByText("Ce fichier n’est pas disponible.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Télécharger" })).toBeNull();
  });

  it("shows the other formats as before, in their own dialog", async () => {
    const fetchMock = installFetch();
    render(<IntakeDocumentPreview projectId={PROJECT} document={dossierDocument("CCTP.pdf", "application/pdf")} />);
    expect(await screen.findByTestId("pdf-preview")).toHaveTextContent("CCTP.pdf");
    expect(fetchMock).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ cache: "no-store" }));
    expect(screen.queryByTestId("cad-preview")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Agrandir" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Aperçu de la pièce du dossier.");
  });
});
