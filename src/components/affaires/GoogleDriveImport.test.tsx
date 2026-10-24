import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/affaires/google-drive/identity", () => ({
  prepareGoogleIdentity: vi.fn().mockResolvedValue(undefined), connectGoogleDrive: vi.fn(), revokeGoogleDrive: vi.fn().mockResolvedValue(undefined),
}));
import { GoogleDriveImport } from "./GoogleDriveImport";
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
  await userEvent.click(screen.getByRole("button", { name: "Connecter ce dossier" }));
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
    await userEvent.click(screen.getByRole("button", { name: "Confirmer et importer les copies" }));
    await screen.findByText("plan.pdf : Copie importée.");
    expect(onUploadComplete).toHaveBeenCalledWith("upload_demo");
    expect(onRefresh).not.toHaveBeenCalled();
    const requests = vi.mocked(fetch).mock.calls;
    expect(requests.every(([url]) => !String(url).includes("fictitious-memory-token"))).toBe(true);
    expect(document.body.textContent).not.toContain("fictitious-memory-token");
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
    await userEvent.click(screen.getByRole("button", { name: "Confirmer et importer les copies" }));
    expect(await screen.findByText("cctp.pdf : Copie non finalisée. Reprenez cette pièce.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reprendre les pièces en échec sélectionnées" })).toBeEnabled();
    // A completed upload makes IntakeWorkspace close the dropzone, which unmounts this panel.
    expect(onUploadComplete).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Reprendre les pièces en échec sélectionnées" }));
    await screen.findByText("cctp.pdf : Copie importée.");
    expect(onUploadComplete).toHaveBeenCalledWith("upload_retry");
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
  it("cancels selection without an import", async () => {
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    await connect();
    await userEvent.click(screen.getAllByRole("checkbox")[0]);
    await userEvent.click(screen.getByRole("button", { name: "Annuler la sélection" }));
    expect(screen.getByRole("button", { name: "Confirmer et importer les copies" })).toBeDisabled();
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
});
