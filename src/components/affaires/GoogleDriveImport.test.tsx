import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { GoogleDriveImport, openGoogleDriveImport } from "./GoogleDriveImport";
import type { DriveFile, DriveListing, DriveLocation, DriveState } from "@/lib/affaires/google-drive/contracts";

const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const OTHER_ACCOUNT = "33333333-3333-4333-8333-333333333333";
const folder: DriveFile = { id: "folder_demo", name: "Dossier fictif", mimeType: "application/vnd.google-apps.folder", parents: ["root_demo"] };
const plan: DriveFile = { id: "plan_demo", name: "plan.pdf", mimeType: "application/pdf", size: "5", version: "1", parents: [folder.id] };
const native: DriveFile = { id: "native_demo", name: "Plan natif", mimeType: "application/vnd.google-apps.document", version: "1", parents: [folder.id] };
const cctp: DriveFile = { id: "cctp_demo", name: "cctp.pdf", mimeType: "application/pdf", size: "6", version: "1", parents: [folder.id] };
const shared: DriveFile = { id: "maxime_demo", name: "Drive de Maxime", mimeType: "application/vnd.google-apps.folder" };
const connection = (id = ACCOUNT, email = "poc@example.invalid") => ({ id, email, displayName: "Compte fictif", status: "active" as const });
const affaireFolder = { folderId: folder.id, folderName: folder.name, sharedDriveId: null, connectionId: ACCOUNT, linkedAt: "2026-10-28T10:00:00.000Z", url: "https://drive.google.com/drive/folders/folder_demo" };

type Request = { action: string; connectionId?: string; location?: DriveLocation; files?: Array<{ id: string; folderId?: string }>; folderId?: string };
function response(data: unknown) { return new Response(JSON.stringify({ ok: true, data })); }
function failure(message: string, status = 422) { return new Response(JSON.stringify({ ok: false, error: { message } }), { status }); }
const posted = (action: string) => vi.mocked(fetch).mock.calls.filter(([, options]) => options?.body)
  .map(([, options]) => JSON.parse(String(options!.body)) as Request).filter((request) => request.action === action);

// A fake of the affaire's Drive route: accounts and links live on the "server", never a Google token.
let state: DriveState;
let folders: Record<string, DriveFile[]>;
let answer: (request: Request) => Promise<Response> | Response | undefined;
function listingFor(location: DriveLocation): DriveListing {
  if (location.kind === "shared_with_me") return { location, files: [shared] };
  if (location.kind === "shared_drives") return { location, files: [] };
  if (location.folderId === "root") return { location, folder: { id: "root_demo", name: "Mon Drive", mimeType: folder.mimeType }, files: [folder] };
  const current = [folder, shared, ...Object.values(folders).flat()].find((item) => item.id === location.folderId);
  return { location, folder: current, files: folders[location.folderId] ?? [] };
}
async function serve(request: Request) {
  const custom = await answer(request);
  if (custom) return custom;
  if (request.action === "list") return response({ listing: listingFor(request.location!) });
  if (request.action === "link_folder") {
    state = { ...state, folder: { ...affaireFolder, folderId: request.folderId!, folderName: listingFor({ kind: "folder", folderId: request.folderId! }).folder!.name } };
    return response({ folder: state.folder });
  }
  if (request.action === "unlink_folder") { state = { ...state, folder: null }; return response({ folder: null }); }
  if (request.action === "disconnect") {
    state = { ...state, connections: state.connections.filter((item) => item.id !== request.connectionId) };
    return response({ revoked: true });
  }
  const files = request.files!;
  state = { ...state, links: [...state.links, ...files.map((file) => ({ documentId: `document_${file.id}`, uploadId: "upload_demo", source: {
    provider: "google_drive" as const, fileId: file.id, sourceName: `${file.id}.pdf`, sourceUrl: `https://drive.google.com/file/d/${file.id}/view`,
    folderId: file.folderId ?? null, folderName: null, revision: "1", linkedAt: "2026-10-28T10:00:00.000Z", connectionAvailable: true } }))] };
  return response({ results: files.map((file) => ({ fileId: file.id, name: file.id === cctp.id ? cctp.name : plan.name, status: "linked", message: "Lien enregistré. Analyse en cours." })), uploads: ["upload_demo"] });
}
async function openPanel() { await userEvent.click(screen.getByRole("button", { name: "Ajouter depuis Google Drive" })); }
async function openOnAffaireFolder() {
  await openPanel();
  return screen.findByRole("heading", { name: "Dossier ouvert : Dossier fictif" });
}

describe("GoogleDriveImport (route and Google simulated)", () => {
  const onUploadComplete = vi.fn();
  const onRefresh = vi.fn();
  beforeEach(() => {
    state = { enabled: true, projectName: "Affaire fictive", connections: [connection()], folder: affaireFolder, links: [] };
    folders = { [folder.id]: [plan, native] };
    answer = () => undefined;
    window.localStorage.clear();
    window.history.replaceState(null, "", "/dashboard/affaires/project_demo");
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, options?: RequestInit) => options?.body ? serve(JSON.parse(String(options.body))) : response(state)));
    onUploadComplete.mockClear(); onRefresh.mockClear();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("makes no request while closed and shows the disabled configuration without any Google access", async () => {
    state = { ...state, enabled: false, connections: [] };
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    expect(fetch).not.toHaveBeenCalled();
    await openPanel();
    expect(await screen.findByText(/Aucun accès Google activé/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Ajouter un compte Google" })).toBeNull();
    expect(posted("list")).toHaveLength(0);
  });
  it("offers to add a Google account through the server and comes back to this affaire", async () => {
    state = { ...state, connections: [], folder: null };
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    await openPanel();
    const add = await screen.findByRole("link", { name: "Ajouter un compte Google" });
    expect(add).toHaveAttribute("href", "/api/google-drive/oauth/start?returnTo=%2Fdashboard%2Faffaires%2Fproject_demo");
    expect(screen.getByText(/reste enregistré pour vos prochaines visites/)).toBeVisible();
    expect(posted("list")).toHaveLength(0);
  });
  it("reopens on the account just added and cleans the address", async () => {
    state = { ...state, connections: [connection(), connection(OTHER_ACCOUNT, "maxime@example.invalid")] };
    window.history.replaceState(null, "", `/dashboard/affaires/project_demo?tab=documents&drive=connected&driveConnection=${OTHER_ACCOUNT}`);
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} showTrigger={false} />);
    expect(await screen.findByRole("dialog", { name: "Ajouter depuis Google Drive" })).toBeVisible();
    expect(await screen.findByText("Compte Google ajouté. Il reste enregistré pour vos prochaines visites.")).toBeVisible();
    expect(window.location.search).toBe("?tab=documents");
    expect(await screen.findByRole("heading", { name: "Dossier ouvert : Mon Drive" })).toBeVisible();
    expect(posted("list")).toEqual([{ action: "list", connectionId: OTHER_ACCOUNT, location: { kind: "folder", folderId: "root" } }]);
    expect(screen.getByRole("combobox", { name: "Compte Google" })).toHaveValue(OTHER_ACCOUNT);
  });
  it("reports a refused consent coming back from Google", async () => {
    state = { ...state, connections: [] };
    window.history.replaceState(null, "", "/dashboard/affaires/project_demo?drive=refused");
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} showTrigger={false} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Connexion Google annulée. Aucun compte ajouté.");
    expect(window.location.search).toBe("");
    expect(posted("list")).toHaveLength(0);
  });
  it("opens straight on the affaire's Drive folder with the stored account and links files without a copy", async () => {
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} onRefresh={onRefresh} />);
    await openOnAffaireFolder();
    expect(posted("list")[0]).toEqual({ action: "list", connectionId: ACCOUNT, location: { kind: "folder", folderId: folder.id } });
    expect(screen.getByText("Dossier Drive de l’affaire :", { exact: false })).toHaveTextContent("Dossier fictif");
    expect(screen.getByRole("button", { name: "Dossier de l’affaire" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Sélectionner Plan natif" })).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "Sélectionner plan.pdf" }));
    await userEvent.click(screen.getByRole("button", { name: "Lier à l’affaire" }));
    await screen.findByText("plan.pdf : Lien enregistré. Analyse en cours.");
    expect(screen.getByRole("heading", { name: "Vos fichiers sont liés à l’affaire" })).toBeVisible();
    expect(posted("link_files")).toEqual([{ action: "link_files", connectionId: ACCOUNT, files: [{ id: plan.id, folderId: folder.id }] }]);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onUploadComplete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Voir les documents de l’affaire" }));
    expect(onUploadComplete).toHaveBeenCalledWith("upload_demo");
    // Back on the affaire later: the same account and folder, with the linked file marked.
    await openOnAffaireFolder();
    expect(screen.getByRole("checkbox", { name: "Sélectionner plan.pdf" })).toBeDisabled();
    expect(screen.getByText("Déjà lié")).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url) === "/api/affaires/project_demo/intake/google-drive")).toBe(true);
  });
  it("offers to attach a link whose Google account was removed to the current account", async () => {
    state = { ...state, links: [{ documentId: "document_plan", uploadId: "upload_old", source: { provider: "google_drive", fileId: plan.id, sourceName: plan.name,
      sourceUrl: "https://drive.google.com/file/d/plan_demo/view", folderId: folder.id, folderName: folder.name, revision: "1",
      linkedAt: "2026-10-28T10:00:00.000Z", connectionAvailable: false } }] };
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    await openOnAffaireFolder();
    expect(screen.queryByText("Déjà lié")).toBeNull();
    expect(screen.getByText("Déjà lié, sans compte Google : sélectionnez-le pour le rattacher à ce compte.")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Sélectionner plan.pdf" })).toBeEnabled();
  });
  it("browses files shared with the member, such as a colleague's Drive", async () => {
    folders["maxime_demo"] = [cctp];
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    await openOnAffaireFolder();
    await userEvent.click(screen.getByRole("button", { name: "Partagés avec moi" }));
    expect(await screen.findByRole("heading", { name: "Dossier ouvert : Partagés avec moi" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir le dossier Drive de Maxime" }));
    expect(await screen.findByRole("heading", { name: "Dossier ouvert : Drive de Maxime" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Sélectionner cctp.pdf" })).toBeEnabled();
    expect(posted("list").map((request) => request.location)).toEqual([{ kind: "folder", folderId: folder.id }, { kind: "shared_with_me" }, { kind: "folder", folderId: "maxime_demo" }]);
  });
  it("remembers another folder as the affaire's Drive folder, then unlinks it", async () => {
    folders["maxime_demo"] = [cctp];
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    await openOnAffaireFolder();
    expect(screen.queryByRole("button", { name: "Lier ce dossier à l’affaire" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Partagés avec moi" }));
    await userEvent.click(await screen.findByRole("button", { name: "Ouvrir le dossier Drive de Maxime" }));
    await userEvent.click(await screen.findByRole("button", { name: "Lier ce dossier à l’affaire" }));
    expect(await screen.findByText("« Drive de Maxime » est le dossier Drive de l'affaire. Il s'ouvrira directement à votre retour.")).toBeVisible();
    expect(posted("link_folder")).toEqual([{ action: "link_folder", connectionId: ACCOUNT, folderId: "maxime_demo" }]);
    expect(screen.getByText("Dossier Drive de l’affaire :", { exact: false })).toHaveTextContent("Drive de Maxime");
    await userEvent.click(screen.getByRole("button", { name: "Délier le dossier" }));
    expect(await screen.findByText("Dossier Drive délié. Les fichiers déjà liés restent dans l'affaire.")).toBeVisible();
    expect(screen.queryByText("Dossier Drive de l’affaire :", { exact: false })).toBeNull();
  });
  it("falls back to My Drive when the affaire's folder is unreachable with this account", async () => {
    answer = (request) => request.location?.kind === "folder" && request.location.folderId === folder.id ? failure("Dossier inaccessible.", 404) : undefined;
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    await openPanel();
    expect(await screen.findByRole("heading", { name: "Dossier ouvert : Mon Drive" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Dossier de l'affaire inaccessible avec ce compte : Dossier inaccessible.");
  });
  it("announces folder loading, keeps the selection and returns to the parent folder", async () => {
    const archives: DriveFile = { id: "child_demo", name: "Archives", mimeType: folder.mimeType, parents: [folder.id] };
    folders[folder.id] = [plan, native, archives];
    folders[archives.id] = [cctp];
    let finishNavigation: (result: Response) => void = () => { throw new Error("Navigation not started"); };
    answer = (request) => request.location?.kind === "folder" && request.location.folderId === archives.id
      ? new Promise<Response>((resolve) => { finishNavigation = resolve; }) : undefined;
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    await openOnAffaireFolder();
    await userEvent.click(screen.getByRole("checkbox", { name: "Sélectionner plan.pdf" }));
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir le dossier Archives" }));
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("Chargement du dossier…");
    finishNavigation(response({ listing: listingFor({ kind: "folder", folderId: archives.id }) }));
    expect(await screen.findByRole("heading", { name: "Dossier ouvert : Archives" })).toHaveFocus();
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("Contenu affiché : 0 dossiers · 1 fichier.");
    await userEvent.click(screen.getByRole("checkbox", { name: "Sélectionner cctp.pdf" }));
    expect(screen.getByText("2 fichier(s) sélectionné(s)")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Retour au dossier parent" }));
    expect(await screen.findByRole("heading", { name: "Dossier ouvert : Dossier fictif" })).toHaveFocus();
    expect(screen.getByRole("checkbox", { name: "Sélectionner plan.pdf" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Lier à l’affaire" }));
    await screen.findByText("cctp.pdf : Lien enregistré. Analyse en cours.");
    // One lot, each file with the folder it was chosen in.
    expect(posted("link_files")[0].files).toEqual([{ id: plan.id, folderId: folder.id }, { id: cctp.id, folderId: archives.id }]);
  });
  it("keeps the current folder and selection when another folder cannot be opened", async () => {
    const missing: DriveFile = { id: "missing_demo", name: "Dossier inaccessible", mimeType: folder.mimeType };
    folders[folder.id] = [plan, missing];
    answer = (request) => request.location?.kind === "folder" && request.location.folderId === missing.id ? failure("Dossier inaccessible.") : undefined;
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    await openOnAffaireFolder();
    await userEvent.click(screen.getByRole("checkbox", { name: "Sélectionner plan.pdf" }));
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir le dossier Dossier inaccessible" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Dossier inaccessible.");
    expect(screen.getByRole("heading", { name: "Dossier ouvert : Dossier fictif" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Sélectionner plan.pdf" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Ouvrir le dossier Dossier inaccessible" })).toBeEnabled();
  });
  it("keeps the dialog open on a partial failure and retries only the failed files", async () => {
    folders[folder.id] = [plan, cctp];
    let links = 0;
    answer = (request) => {
      if (request.action !== "link_files" || ++links > 1) return undefined;
      return response({ results: [{ fileId: plan.id, name: plan.name, status: "linked", message: "Lien enregistré. Analyse en cours." },
        { fileId: cctp.id, name: cctp.name, status: "failed", message: "Lien non enregistré. Réessayez." }], uploads: ["upload_first"] });
    };
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} onRefresh={onRefresh} />);
    await openOnAffaireFolder();
    await userEvent.click(screen.getByRole("checkbox", { name: "Sélectionner plan.pdf" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Sélectionner cctp.pdf" }));
    await userEvent.click(screen.getByRole("button", { name: "Lier à l’affaire" }));
    expect(await screen.findByText("cctp.pdf : Lien non enregistré. Réessayez.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Liens enregistrés avec des fichiers à reprendre" })).toBeVisible();
    expect(onUploadComplete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reprendre les fichiers en échec" }));
    await screen.findByText("cctp.pdf : Lien enregistré. Analyse en cours.");
    expect(posted("link_files").map((request) => request.files)).toEqual([[{ id: plan.id, folderId: folder.id }, { id: cctp.id, folderId: folder.id }], [{ id: cctp.id, folderId: folder.id }]]);
    expect(onRefresh).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("button", { name: "Voir les documents de l’affaire" }));
    expect(onUploadComplete).toHaveBeenCalledWith("upload_demo");
  });
  it("switches between stored accounts and remembers the last one on this browser", async () => {
    state = { ...state, folder: null, connections: [connection(), connection(OTHER_ACCOUNT, "maxime@example.invalid")] };
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    await openPanel();
    await screen.findByRole("heading", { name: "Dossier ouvert : Mon Drive" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Compte Google" }), OTHER_ACCOUNT);
    await waitFor(() => expect(posted("list").at(-1)).toEqual({ action: "list", connectionId: OTHER_ACCOUNT, location: { kind: "folder", folderId: "root" } }));
    expect(window.localStorage.getItem("mergeone.google-drive.last-connection")).toBe(OTHER_ACCOUNT);
    // The switch ends the busy state: the panel stays usable without a reload.
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Compte Google" })).toBeEnabled());
    for (const button of screen.getAllByRole("button", { name: "Fermer" })) expect(button).toBeEnabled();
  });
  it("keeps the account chosen during a slow first listing, not the late answer of the previous one", async () => {
    state = { ...state, folder: null, connections: [connection(), connection(OTHER_ACCOUNT, "maxime@example.invalid")] };
    let release!: () => void;
    const slow = new Promise<void>((resolve) => { release = resolve; });
    answer = (request) => {
      if (request.action !== "list") return undefined;
      if (request.connectionId === OTHER_ACCOUNT) return response({ listing: { location: request.location, folder: { id: "root_demo", name: "Mon Drive", mimeType: folder.mimeType }, files: [shared] } });
      return slow.then(() => response({ listing: listingFor(request.location!) }));
    };
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    await openPanel();
    await waitFor(() => expect(posted("list")).toHaveLength(1));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Compte Google" }), OTHER_ACCOUNT);
    expect(await screen.findByRole("button", { name: "Ouvrir le dossier Drive de Maxime" })).toBeVisible();
    // Let the first account's late answer arrive.
    await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(screen.queryByRole("button", { name: "Ouvrir le dossier Dossier fictif" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ouvrir le dossier Drive de Maxime" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Compte Google" })).toHaveValue(OTHER_ACCOUNT);
  });
  it("asks to reconnect an account whose access Google revoked", async () => {
    state = { ...state, connections: [{ ...connection(), status: "reconnect_required" }] };
    answer = (request) => request.action === "list" ? failure("Accès Google expiré. Reconnectez ce compte.", 401) : undefined;
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    await openPanel();
    expect(await screen.findByRole("link", { name: "Reconnecter ce compte" })).toHaveAttribute("href", expect.stringContaining("/api/google-drive/oauth/start"));
  });
  it("removes a stored account only on an explicit request and keeps the linked files", async () => {
    render(<GoogleDriveImport projectId="project_demo" onUploadComplete={onUploadComplete} />);
    await openOnAffaireFolder();
    expect(posted("disconnect")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Retirer ce compte" }));
    expect(await screen.findByText("Compte poc@example.invalid retiré. Les fichiers déjà liés restent dans l'affaire.")).toBeVisible();
    expect(posted("disconnect")).toEqual([{ action: "disconnect", connectionId: ACCOUNT }]);
    expect(screen.getByRole("link", { name: "Ajouter un compte Google" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /Dossier ouvert/ })).toBeNull();
    for (const button of screen.getAllByRole("button", { name: "Fermer" })) expect(button).toBeEnabled();
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
