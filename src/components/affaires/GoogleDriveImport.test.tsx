import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/affaires/google-drive/identity", () => ({
  prepareGoogleIdentity: vi.fn().mockResolvedValue(undefined), connectGoogleDrive: vi.fn(), revokeGoogleDrive: vi.fn().mockResolvedValue(undefined),
}));
import { act } from "react";
import { GoogleDriveImport, openGoogleDriveImport } from "./GoogleDriveImport";
import { connectGoogleDrive, revokeGoogleDrive } from "@/lib/affaires/google-drive/identity";

const state = { enabled: true, clientId: "fictitious-client", tenantId: "tenant_demo", projectName: "Affaire fictive", history: [] };
const listing = { folder: { id: "folder_demo", name: "Dossier fictif", mimeType: "application/vnd.google-apps.folder" },
  account: { displayName: "Compte fictif", emailAddress: "poc@example.invalid" }, files: [
    { id: "plan_demo", name: "plan.pdf", mimeType: "application/pdf", size: "5", version: "1" },
    { id: "native_demo", name: "Plan natif", mimeType: "application/vnd.google-apps.document", version: "1" },
  ] };
function response(data: unknown) { return new Response(JSON.stringify({ ok: true, data })); }
async function openPanel() { await userEvent.click(screen.getByText("Ajouter depuis Google Drive")); }
async function connect() {
  await openPanel();
  await waitFor(() => expect(screen.getByRole("button", { name: "Connecter Google Drive" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Connecter Google Drive" }));
  await screen.findByText("Compte : Compte fictif (poc@example.invalid)");
}
describe("GoogleDriveImport (identity and API simulated)", () => {
  const onUploadComplete = vi.fn();
  const onRefresh = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, options?: RequestInit) => {
      if (!options?.body) return response(state);
      const request = JSON.parse(String(options.body));
      if (request.action === "list") return response({ listing });
      return response({ results: [{ fileId: "plan_demo", name: "plan.pdf", status: "imported", message: "Copie importée." }], uploads: ["upload_demo"] });
    }));
    vi.mocked(connectGoogleDrive).mockReset().mockResolvedValue({ token: "fictitious-memory-token", expiresAt: Date.now() + 60_000 });
    onUploadComplete.mockClear(); onRefresh.mockClear();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it("makes no request while closed and exposes the disabled configuration without contacting Google", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ ...state, enabled: false, clientId: undefined }));
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    expect(fetch).not.toHaveBeenCalled();
    await openPanel();
    expect(await screen.findByText(/Aucun accès Google activé/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Connecter Google Drive" })).toBeNull();
    expect(connectGoogleDrive).not.toHaveBeenCalled();
  });
  it("requires folder connection, compatible selection and explicit confirmation", async () => {
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} onRefresh={onRefresh} />);
    await connect();
    expect(screen.getByText("Destination :", { exact: false })).toHaveTextContent("Affaire fictive");
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[1]).toBeDisabled();
    await userEvent.click(checkboxes[0]);
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => String(options?.body).includes('"action":"import"'))).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Vérifier la sélection" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer et importer les copies" }));
    await screen.findByText("plan.pdf : Copie importée.");
    expect(onUploadComplete).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Voir les documents de l’affaire" }));
    expect(onUploadComplete).toHaveBeenCalledWith("upload_demo");
    const requests = vi.mocked(fetch).mock.calls;
    expect(requests.every(([url]) => !String(url).includes("fictitious-memory-token"))).toBe(true);
    expect(document.body.textContent).not.toContain("fictitious-memory-token");
  });
  it("shows the folder being browsed, announces loading and lets users return to its parent without importing", async () => {
    const folder = { id: "child_demo", name: "Archives", mimeType: "application/vnd.google-apps.folder", parents: [listing.folder.id] };
    let finishNavigation: (result: Response) => void = () => { throw new Error("Navigation not started"); };
    vi.mocked(fetch).mockImplementation(async (_url: unknown, options?: RequestInit) => {
      if (!options?.body) return response(state);
      const request = JSON.parse(String(options.body));
      if (request.folderId === folder.id) return new Promise<Response>((resolve) => { finishNavigation = resolve; });
      return response({ listing: { ...listing, files: [...listing.files, folder] } });
    });
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    await connect();
    await userEvent.click(screen.getAllByRole("checkbox")[0]);
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir le dossier Archives" }));
    expect(screen.getByRole("status")).toHaveTextContent("Chargement du dossier…");
    expect(screen.getByRole("heading", { name: "Dossier ouvert : Dossier fictif" })).toBeVisible();
    finishNavigation(response({ listing: { ...listing, folder, files: [listing.files[0]] } }));
    const heading = await screen.findByRole("heading", { name: "Dossier ouvert : Archives" });
    expect(heading).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Contenu affiché : 0 dossiers · 1 fichier.");
    expect(screen.getByRole("button", { name: "Vérifier la sélection" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Retour au dossier parent" }));
    expect(await screen.findByRole("heading", { name: "Dossier ouvert : Dossier fictif" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Contenu affiché : 1 dossier · 2 fichiers.");
    expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => String(options?.body).includes('"action":"import"'))).toHaveLength(0);
    expect(onUploadComplete).not.toHaveBeenCalled();
  });
  it("keeps the current folder and selection visible when opening another folder fails", async () => {
    const folder = { id: "missing_demo", name: "Dossier inaccessible", mimeType: "application/vnd.google-apps.folder" };
    vi.mocked(fetch).mockImplementation(async (_url: unknown, options?: RequestInit) => {
      if (!options?.body) return response(state);
      const request = JSON.parse(String(options.body));
      if (request.folderId === folder.id) return new Response(JSON.stringify({ ok: false, error: { message: "Dossier inaccessible." } }), { status: 422 });
      return response({ listing: { ...listing, files: [...listing.files, folder] } });
    });
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    await connect();
    await userEvent.click(screen.getAllByRole("checkbox")[0]);
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir le dossier Dossier inaccessible" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Dossier inaccessible.");
    expect(screen.getByRole("heading", { name: "Dossier ouvert : Dossier fictif" })).toBeVisible();
    expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
    expect(screen.getByRole("button", { name: "Ouvrir le dossier Dossier inaccessible" })).toBeEnabled();
    expect(screen.getByRole("status")).not.toHaveTextContent("Chargement du dossier…");
    expect(onUploadComplete).not.toHaveBeenCalled();
  });
  it("keeps the panel open on a partial failure and only refreshes the workspace", async () => {
    const cctp = { id: "cctp_demo", name: "cctp.pdf", mimeType: "application/pdf", size: "5", version: "1" };
    let imports = 0;
    vi.mocked(fetch).mockImplementation(async (_url: unknown, options?: RequestInit) => {
      if (!options?.body) return response(state);
      if (JSON.parse(String(options.body)).action === "list") return response({ listing: { ...listing, files: [listing.files[0], cctp] } });
      if (++imports > 1) return response({ results: [{ fileId: "cctp_demo", name: "cctp.pdf", status: "imported", message: "Copie importée." }], uploads: ["upload_retry"] });
      return response({ results: [{ fileId: "plan_demo", name: "plan.pdf", status: "imported", message: "Copie importée." },
        { fileId: "cctp_demo", name: "cctp.pdf", status: "failed", message: "Copie non finalisée. Reprenez cette pièce." }], uploads: ["upload_demo"] });
    });
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} onRefresh={onRefresh} />);
    await connect();
    for (const checkbox of screen.getAllByRole("checkbox")) await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole("button", { name: "Vérifier la sélection" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer et importer les copies" }));
    expect(await screen.findByText("cctp.pdf : Copie non finalisée. Reprenez cette pièce.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reprendre les pièces en échec sélectionnées" })).toBeEnabled();
    // A completed upload makes IntakeWorkspace close the dropzone, which unmounts this panel.
    expect(onUploadComplete).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Reprendre les pièces en échec sélectionnées" }));
    await screen.findByText("cctp.pdf : Copie importée.");
    expect(onUploadComplete).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("button", { name: "Voir les documents de l’affaire" }));
    expect(onUploadComplete).toHaveBeenCalledWith("upload_retry");
  });
  it("cancels selection without an import", async () => {
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    await connect();
    await userEvent.click(screen.getAllByRole("checkbox")[0]);
    await userEvent.click(screen.getByRole("button", { name: "Annuler la sélection" }));
    expect(screen.getByRole("button", { name: "Vérifier la sélection" })).toBeDisabled();
    expect(onUploadComplete).not.toHaveBeenCalled();
  });
  it("reports consent refusal and imports nothing", async () => {
    vi.mocked(connectGoogleDrive).mockRejectedValue(new Error("Consentement refusé."));
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    await openPanel();
    await waitFor(() => expect(screen.getByRole("button", { name: "Connecter Google Drive" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Connecter Google Drive" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Consentement refusé.");
    expect(onUploadComplete).not.toHaveBeenCalled();
  });
  it("clears the local connection and revokes only on an explicit disconnect", async () => {
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    await connect();
    expect(revokeGoogleDrive).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Déconnecter et révoquer" }));
    expect(revokeGoogleDrive).toHaveBeenCalledWith("fictitious-memory-token");
    expect(screen.queryByText("Compte : Compte fictif (poc@example.invalid)")).toBeNull();
    expect(onUploadComplete).not.toHaveBeenCalled();
  });
  it("keeps selections across folders in one lot with each validated source folder", async () => {
    const child = { id: "cctp_folder", name: "CCTP", mimeType: "application/vnd.google-apps.folder", parents: [listing.folder.id] };
    const cctp = { id: "cctp_demo", name: "cctp.pdf", mimeType: "application/pdf", size: "6", version: "1" };
    vi.mocked(fetch).mockImplementation(async (_url: unknown, options?: RequestInit) => {
      if (!options?.body) return response(state);
      const request = JSON.parse(String(options.body));
      if (request.action === "list") return response({ listing: request.folderId === child.id
        ? { ...listing, folder: child, files: [cctp] } : { ...listing, files: [...listing.files, child] } });
      return response({ results: request.files.map((file: { id: string }) => ({ fileId: file.id, name: file.id === cctp.id ? cctp.name : "plan.pdf", status: "imported", message: "Copie importée." })), uploads: [request.folderId] });
    });
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} onRefresh={onRefresh} />);
    await connect();
    await userEvent.click(screen.getByRole("checkbox", { name: "Sélectionner plan.pdf" }));
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir le dossier CCTP" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Sélectionner cctp.pdf" }));
    expect(screen.getByText(/2 pièce\(s\)/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Vérifier la sélection" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer et importer les copies" }));
    await screen.findByText("cctp.pdf : Copie importée.");
    const imports = vi.mocked(fetch).mock.calls.filter(([, options]) => String(options?.body).includes('"action":"import"')).map(([, options]) => JSON.parse(String(options?.body)));
    expect(imports).toHaveLength(1);
    expect(imports[0].files).toEqual([expect.objectContaining({ id: "plan_demo", folderId: listing.folder.id }), expect.objectContaining({ id: cctp.id, folderId: child.id })]);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
  it("opens without its own trigger only when another surface asks for this affaire", async () => {
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} showTrigger={false} />);
    expect(screen.queryByRole("button", { name: "Ajouter depuis Google Drive" })).toBeNull();
    act(() => openGoogleDriveImport("other_project"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    act(() => openGoogleDriveImport("project_demo"));
    expect(await screen.findByRole("dialog", { name: "Ajouter depuis Google Drive" })).toBeVisible();
    expect(await screen.findByText("Destination :", { exact: false })).toHaveTextContent("Affaire fictive");
  });

});
