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
  beforeEach(() => {
    state = { enabled: true, projectName: "Affaire fictive", connections: [connection()], folder: affaireFolder, links: [] };
    folders = { [folder.id]: [plan, native] };
    answer = () => undefined;
    window.localStorage.clear();
    window.history.replaceState(null, "", "/dashboard/affaires/project_demo");
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, options?: RequestInit) => options?.body ? serve(JSON.parse(String(options.body))) : response(state)));
    onUploadComplete.mockClear();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

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
