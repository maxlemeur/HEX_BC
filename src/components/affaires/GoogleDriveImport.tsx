"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon, CircleCheckIcon, ExternalLinkIcon, FileTextIcon, FolderIcon, FolderOpenIcon, HardDriveIcon, Link2Icon, RefreshCwIcon, SearchIcon, ShieldCheckIcon, TriangleAlertIcon, UsersIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { DRIVE_FOLDER_MIME, DRIVE_MAX_FILES, DRIVE_OAUTH_OUTCOMES, DRIVE_OAUTH_START_PATH, driveFileRejection,
  type DriveFile, type DriveLinkResult, type DriveListing, type DriveLocation, type DriveOAuthOutcome, type DriveState } from "@/lib/affaires/google-drive/contracts";

type Choice = { file: DriveFile; folder?: { id: string; name: string } };
async function responseData<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "Google Drive est indisponible.");
  return payload.data as T;
}
function fileSize(file: DriveFile) { return file.size ? `${(Number(file.size) / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} Mo` : "Taille inconnue"; }
const OPEN_EVENT = "affaire-open-google-drive-import";
const LAST_ACCOUNT_KEY = "mergeone.google-drive.last-connection";
const ROOT: DriveLocation = { kind: "folder", folderId: "root" };
// Per-viewer convenience only: the accounts themselves are kept on the server.
function rememberedConnection() { try { return window.localStorage.getItem(LAST_ACCOUNT_KEY); } catch { return null; } }
function rememberConnection(id: string) { try { window.localStorage.setItem(LAST_ACCOUNT_KEY, id); } catch { /* storage unavailable */ } }
function folderTarget(file: DriveFile) {
  if (file.mimeType === DRIVE_FOLDER_MIME) return file.id;
  return file.shortcutDetails?.targetMimeType === DRIVE_FOLDER_MIME ? file.shortcutDetails.targetId : null;
}
function locationTitle(listing: DriveListing) {
  return listing.location.kind === "shared_with_me" ? "Partagés avec moi" : listing.location.kind === "shared_drives" ? "Drives partagés"
    : listing.location.folderId === "root" ? "Mon Drive" : listing.folder?.name ?? "Dossier";
}
async function fetchDriveState(endpoint: string, signal?: AbortSignal) {
  return responseData<DriveState>(await fetch(endpoint, { signal, cache: "no-store" }));
}
async function listDrive(endpoint: string, account: string, location: DriveLocation, pageToken?: string, signal?: AbortSignal) {
  return (await responseData<{ listing: DriveListing }>(await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
    signal, body: JSON.stringify({ action: "list", connectionId: account, location, ...(pageToken ? { pageToken } : {}) }) }))).listing;
}
/** Opens the affaire's mounted Drive dialog from another surface, which may unmount once links arrive. */
export function openGoogleDriveImport(projectId: string) {
  document.dispatchEvent(new CustomEvent<{ projectId: string }>(OPEN_EVENT, { detail: { projectId } }));
}
export function GoogleDriveImport({ projectId, onUploadComplete, onRefresh, showTrigger = true, fallbackFocus }: {
  projectId: string; onUploadComplete: (uploadId: string) => void; onRefresh?: () => void; showTrigger?: boolean;
  /** Receives focus on close when the control that opened the dialog left the page meanwhile. */
  fallbackFocus?: React.RefObject<HTMLElement | null>;
}) {
  const endpoint = `/api/affaires/${projectId}/intake/google-drive`;
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  function openDialog() { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setOpen(true); }
  useEffect(() => {
    const openFor = (event: Event) => { if ((event as CustomEvent<{ projectId: string }>).detail?.projectId === projectId) openDialog(); };
    document.addEventListener(OPEN_EVENT, openFor);
    return () => document.removeEventListener(OPEN_EVENT, openFor);
  }, [projectId]);
  const [state, setState] = useState<DriveState>();
  const [connectionId, setConnectionId] = useState<string>();
  const [listing, setListing] = useState<DriveListing>();
  const [trail, setTrail] = useState<DriveFile[]>([]);
  const [selected, setSelected] = useState<Choice[]>([]);
  const [results, setResults] = useState<DriveLinkResult[]>([]);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingFolder, setLoadingFolder] = useState(false);
  const folderHeading = useRef<HTMLHeadingElement>(null);
  const controller = useRef<AbortController | undefined>(undefined);
  const generation = useRef(0);
  const runs = useRef(0);
  const mounted = useRef(true);
  const returned = useRef<{ outcome: DriveOAuthOutcome; connectionId: string | null } | null>(null);
  const completedUploads = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    // Back from Google: reopen on the account just added, then clean the address bar.
    const parameters = new URLSearchParams(window.location.search);
    const outcome = parameters.get("drive");
    if (outcome && outcome in DRIVE_OAUTH_OUTCOMES) {
      returned.current = { outcome: outcome as DriveOAuthOutcome, connectionId: parameters.get("driveConnection") };
      parameters.delete("drive"); parameters.delete("driveConnection");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${parameters.toString() ? `?${parameters}` : ""}${window.location.hash}`);
      openDialog();
    }
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => { folderHeading.current?.focus(); }, [listing?.folder?.id, listing?.location.kind]);
  const connectUrl = () => `${DRIVE_OAUTH_START_PATH}?returnTo=${encodeURIComponent(window.location.pathname)}`;
  const loadState = (signal?: AbortSignal) => fetchDriveState(endpoint, signal);
  const list = (account: string, location: DriveLocation, pageToken?: string, signal?: AbortSignal) =>
    listDrive(endpoint, account, location, pageToken, signal);
  async function loadLocation(location: DriveLocation, append = false, account = connectionId) {
    if (!account) return;
    const actionGeneration = generation.current;
    const abort = controller.current;
    setLoadingFolder(true);
    try {
      const data = await list(account, location, append ? listing?.nextPageToken : undefined, abort?.signal);
      if (!mounted.current || abort?.signal.aborted || actionGeneration !== generation.current) return;
      setListing((prior) => append && prior ? { ...data, files: [...prior.files, ...data.files] } : data);
      if (!append) {
        setSearch("");
        const folder = data.folder;
        setTrail((prior) => {
          if (!folder || location.kind !== "folder" || location.folderId === "root") return [];
          const index = prior.findIndex((item) => item.id === folder.id);
          return index >= 0 ? prior.slice(0, index + 1) : [...prior, folder];
        });
      }
    } finally { if (mounted.current && actionGeneration === generation.current) setLoadingFolder(false); }
  }
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    controller.current = abort;
    const back = returned.current;
    returned.current = null;
    if (back) (back.outcome === "connected" ? setNotice : setMessage)(DRIVE_OAUTH_OUTCOMES[back.outcome]);
    // An account switched or removed meanwhile supersedes this first listing.
    const initial = generation.current;
    const current = () => !abort.signal.aborted && initial === generation.current;
    void fetchDriveState(endpoint, abort.signal).then(async (data) => {
      if (abort.signal.aborted) return;
      setState(data);
      const ids = data.connections.map((connection) => connection.id);
      const linkedAccount = data.folder?.connectionId && ids.includes(data.folder.connectionId) ? data.folder.connectionId : null;
      const account = [back?.connectionId, linkedAccount, rememberedConnection(), ids[0]].find((id): id is string => Boolean(id && ids.includes(id)));
      if (!data.enabled || !account) return;
      setConnectionId(account); rememberConnection(account);
      // Straight back to the affaire's Drive folder; My Drive when it is not reachable from this account.
      const start: DriveLocation = data.folder && !back?.connectionId ? { kind: "folder", folderId: data.folder.folderId } : ROOT;
      setLoadingFolder(true);
      try {
        const first = await listDrive(endpoint, account, start, undefined, abort.signal).catch(async (error: Error) => {
          if (start === ROOT || !current()) throw error;
          setMessage(`Dossier de l'affaire inaccessible avec ce compte : ${error.message}`);
          return listDrive(endpoint, account, ROOT, undefined, abort.signal);
        });
        if (current()) setListing(first);
      } finally { if (current()) setLoadingFolder(false); }
    }).catch((error: Error) => { if (current()) setMessage(error.message); });
    return () => abort.abort();
  }, [endpoint, open]);
  function close() {
    if (busy) return;
    generation.current++;
    controller.current?.abort();
    setOpen(false); setListing(undefined); setSelected([]); setResults([]); setTrail([]); setMessage(""); setNotice("");
    const uploadId = [...completedUploads.current].at(-1);
    completedUploads.current.clear();
    if (uploadId) onUploadComplete(uploadId);
  }
  async function run(action: () => Promise<void>) {
    // Its own counter: switching or removing an account starts a new browsing generation itself.
    const current = ++runs.current;
    setBusy(true); setMessage(""); setNotice(""); controller.current = new AbortController();
    try { await action(); }
    catch (error) { if (mounted.current && current === runs.current) setMessage(error instanceof Error ? error.message : "Action interrompue."); }
    finally { if (mounted.current && current === runs.current) setBusy(false); }
  }
  async function post<T>(body: Record<string, unknown>) {
    return responseData<T>(await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      signal: controller.current?.signal, body: JSON.stringify(body) }));
  }
  async function refreshState() {
    const data = await loadState(controller.current?.signal);
    if (mounted.current) setState(data);
  }
  async function switchAccount(id: string) {
    generation.current++;
    setConnectionId(id); rememberConnection(id); setSelected([]); setResults([]); setTrail([]); setListing(undefined);
    await loadLocation(ROOT, false, id);
  }
  async function disconnect() {
    const account = state?.connections.find((connection) => connection.id === connectionId);
    if (!account) return;
    const { revoked, stillUsed } = await post<{ revoked: boolean; stillUsed: boolean }>({ action: "disconnect", connectionId: account.id });
    generation.current++;
    setListing(undefined); setTrail([]); setSelected([]); setConnectionId(undefined);
    setNotice(revoked ? `Compte ${account.email} retiré. Les fichiers déjà liés restent dans l'affaire.`
      : stillUsed ? `Compte ${account.email} retiré. Il reste connecté ailleurs dans MergeOne : son accès Google n'est pas révoqué.`
      : `Compte ${account.email} retiré de MergeOne. Vérifiez la révocation dans votre compte Google.`);
    const data = await loadState(controller.current?.signal);
    setState(data);
    const next = data.connections[0]?.id;
    if (next) { setConnectionId(next); rememberConnection(next); await loadLocation(ROOT, false, next); }
  }
  async function linkFolder() {
    if (!connectionId || listing?.location.kind !== "folder" || !listing.folder) return;
    await post({ action: "link_folder", connectionId, folderId: listing.folder.id });
    await refreshState();
    setNotice(`« ${listing.folder.name} » est le dossier Drive de l'affaire. Il s'ouvrira directement à votre retour.`);
  }
  async function unlinkFolder() {
    await post({ action: "unlink_folder" });
    await refreshState();
    setNotice("Dossier Drive délié. Les fichiers déjà liés restent dans l'affaire.");
  }
  async function linkSelection(files = selected) {
    if (!connectionId) return;
    const abort = controller.current;
    const current = generation.current;
    let fresh: DriveLinkResult[];
    try {
      const data = await post<{ results: DriveLinkResult[]; uploads: string[] }>({ action: "link_files", connectionId,
        files: files.map(({ file, folder }) => ({ id: file.id, ...(folder ? { folderId: folder.id } : {}) })) });
      fresh = data.results;
      data.uploads.forEach((uploadId) => completedUploads.current.add(uploadId));
    } catch (error) {
      if (abort?.signal.aborted || current !== generation.current) return;
      fresh = files.map(({ file }) => ({ fileId: file.id, name: file.name, status: "failed" as const,
        message: error instanceof Error ? error.message : "Lien interrompu. Réessayez." }));
    }
    if (!mounted.current || abort?.signal.aborted || current !== generation.current) return;
    setResults(fresh);
    setSelected(files.filter(({ file }) => fresh.some((result) => result.fileId === file.id && result.status === "failed")));
    onRefresh?.();
    await refreshState();
  }
  const account = state?.connections.find((connection) => connection.id === connectionId);
  const linkedIds = new Set(state?.links.filter((link) => link.source.connectionAvailable).map((link) => link.source.fileId));
  // Links whose Google account was removed: choosing them again attaches them to this account.
  const orphanIds = new Set(state?.links.filter((link) => !link.source.connectionAvailable).map((link) => link.source.fileId));
  const selectionValid = selected.length > 0 && selected.length <= DRIVE_MAX_FILES;
  const folderCount = listing?.files.filter((file) => folderTarget(file)).length ?? 0;
  const fileCount = (listing?.files.length ?? 0) - folderCount;
  const currentFolder = listing?.location.kind === "folder" && listing.location.folderId !== "root" ? listing.folder : undefined;
  const isAffaireFolder = Boolean(currentFolder && state?.folder?.folderId === currentFolder.id);
  function toggle(file: DriveFile) {
    setSelected((prior) => prior.some((item) => item.file.id === file.id) ? prior.filter((item) => item.file.id !== file.id)
      : [...prior, { file, folder: currentFolder ? { id: currentFolder.id, name: currentFolder.name } : undefined }]);
  }
  const navigation = (label: string, location: DriveLocation, icon: React.ReactNode, active: boolean) => <button type="button" className={`mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${active ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted"}`} disabled={busy} onClick={() => void run(() => loadLocation(location))}>{icon}<span className="truncate">{label}</span></button>;
  return <>
    {showTrigger && <button type="button" className="btn btn-primary mt-3 gap-2" onClick={openDialog}><HardDriveIcon size={16} aria-hidden="true" />Ajouter depuis Google Drive</button>}
    <Dialog open={open} onOpenChange={(value) => { if (!value) close(); }}>
      <DialogContent size="xl" showCloseButton={!busy} className="gap-0 overflow-hidden p-0 sm:p-0" finalFocus={() => opener.current?.isConnected ? opener.current : fallbackFocus?.current ?? true}>
        <DialogHeader className="p-5 sm:p-6"><DialogTitle className="flex items-center gap-3"><HardDriveIcon className="text-primary" aria-hidden="true" />Ajouter depuis Google Drive</DialogTitle><DialogDescription>Liez vos fichiers Drive à l’affaire : MergeOne garde le lien, le fichier reste dans Drive.</DialogDescription></DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {state && <p className="border-b border-border bg-surface-subtle px-5 py-3 text-xs text-muted-foreground">Destination : <strong className="text-foreground">{state.projectName}</strong></p>}
          {!state && !message && <p className="p-6">Chargement…</p>}
          {state && !state.enabled && <p role="status" className="p-6">Connexion réelle en attente de validation OAuth pour ce POC. Aucun accès Google activé.</p>}
          {state?.enabled && state.connections.length === 0 && <div className="space-y-4 p-6"><p className="text-sm text-muted-foreground">Ajoutez un compte Google pour parcourir son Drive. Il reste enregistré pour vos prochaines visites ; Google demandera la lecture seule de Drive.</p><a className="btn btn-primary" href={connectUrl()}>Ajouter un compte Google</a></div>}
          {state?.enabled && state.connections.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2 text-xs text-muted-foreground">
            <label className="flex items-center gap-2">Compte Google<select className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground" value={connectionId ?? ""} disabled={busy} onChange={(event) => void run(() => switchAccount(event.target.value))}>{state.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.displayName} ({connection.email})</option>)}</select></label>
            <span className="flex flex-wrap gap-3"><a className="text-primary underline" href={connectUrl()}>Ajouter un compte</a>{account && <button type="button" className="text-primary underline" disabled={busy} onClick={() => void run(disconnect)}>Retirer ce compte</button>}</span>
          </div>}
          {account?.status === "reconnect_required" && <p role="alert" className="mx-5 mt-3 rounded-lg border border-warning/30 bg-warning-subtle p-3 text-sm text-warning">L’accès Google de {account.email} a expiré ou a été révoqué. <a className="underline" href={connectUrl()}>Reconnecter ce compte</a></p>}
          {state?.folder && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2 text-xs"><span className="flex items-center gap-2 text-muted-foreground"><Link2Icon size={14} aria-hidden="true" />Dossier Drive de l’affaire : <a href={state.folder.url} target="_blank" rel="noreferrer" className="font-medium text-primary underline">{state.folder.folderName}<ExternalLinkIcon className="ml-1 inline" size={12} aria-hidden="true" /></a></span>{state.enabled && <button type="button" className="text-primary underline" disabled={busy} onClick={() => void run(unlinkFolder)}>Délier le dossier</button>}</div>}
          {listing && results.length === 0 && <>
            <div className="grid sm:grid-cols-[200px_minmax(0,1fr)]">
              <aside className="border-b border-border bg-surface-subtle p-3 sm:border-r sm:border-b-0"><p className="mb-3 px-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">Google Drive</p>
                {state?.folder && navigation("Dossier de l’affaire", { kind: "folder", folderId: state.folder.folderId }, <Link2Icon size={15} aria-hidden="true" />, isAffaireFolder)}
                {navigation("Mon Drive", ROOT, <HardDriveIcon size={15} aria-hidden="true" />, listing.location.kind === "folder" && listing.location.folderId === "root")}
                {navigation("Partagés avec moi", { kind: "shared_with_me" }, <UsersIcon size={15} aria-hidden="true" />, listing.location.kind === "shared_with_me")}
                {navigation("Drives partagés", { kind: "shared_drives" }, <FolderIcon size={15} aria-hidden="true" />, listing.location.kind === "shared_drives")}
                {trail.map((folder) => <button key={folder.id} type="button" className={`mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 pl-5 text-left text-xs ${folder.id === listing.folder?.id ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted"}`} disabled={busy} onClick={() => void run(() => loadLocation({ kind: "folder", folderId: folder.id }))}><FolderOpenIcon size={15} aria-hidden="true" /><span className="truncate">{folder.name}</span></button>)}
              </aside>
              <div className="min-w-0 p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 ref={folderHeading} tabIndex={-1} className="text-sm font-semibold outline-none">Dossier ouvert : {locationTitle(listing)}</h3><div className="flex flex-wrap gap-2">{currentFolder?.parents?.[0] && <button type="button" className="text-xs text-primary" disabled={busy} onClick={() => void run(() => loadLocation({ kind: "folder", folderId: currentFolder.parents![0] }))}><ArrowLeftIcon size={14} aria-hidden="true" />Retour au dossier parent</button>}<button type="button" className="text-xs text-primary" disabled={busy} onClick={() => void run(() => loadLocation(listing.location))}><RefreshCwIcon size={14} aria-hidden="true" />Actualiser</button>{currentFolder && (isAffaireFolder ? <Badge variant="neutral">Dossier de l’affaire</Badge> : <button type="button" className="text-xs text-primary underline" disabled={busy} onClick={() => void run(linkFolder)}>Lier ce dossier à l’affaire</button>)}</div></div>
                <p role="status" className="mb-3 text-xs text-muted-foreground">{loadingFolder ? "Chargement du dossier…" : `Contenu affiché : ${folderCount} ${folderCount === 1 ? "dossier" : "dossiers"} · ${fileCount} ${fileCount === 1 ? "fichier" : "fichiers"}.`}</p>
                <label className="mb-3 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-muted-foreground"><SearchIcon size={14} aria-hidden="true" /><input className="min-w-0 flex-1 bg-transparent text-xs outline-none" aria-label="Rechercher dans le dossier Drive" placeholder="Rechercher dans ce dossier" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
                <ul aria-label="Pièces du dossier Google Drive" aria-busy={loadingFolder}>{listing.files.filter((file) => file.name.toLocaleLowerCase("fr").includes(search.toLocaleLowerCase("fr"))).map((file) => {
                  const target = folderTarget(file);
                  if (target) return <li key={file.id} className="border-b border-border-subtle"><button type="button" className="flex w-full items-center gap-3 p-3 text-left text-sm text-primary hover:bg-muted" disabled={busy} onClick={() => void run(() => loadLocation({ kind: "folder", folderId: target }))}><FolderIcon size={19} aria-hidden="true" />Ouvrir le dossier {file.name}<ArrowRightIcon className="ml-auto" size={14} aria-hidden="true" /></button></li>;
                  const rejection = driveFileRejection(file); const chosen = selected.some((item) => item.file.id === file.id);
                  const linked = linkedIds.has(file.id);
                  return <li key={file.id} className={`border-b border-border-subtle p-3 ${chosen ? "bg-primary/5" : ""}`}><label className="flex items-center gap-3"><input type="checkbox" aria-label={`Sélectionner ${file.name}`} checked={chosen} disabled={busy || linked || Boolean(rejection)} onChange={() => toggle(file)} /><FileTextIcon size={19} className="shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block break-all text-xs font-medium">{file.name}</span><span className="text-micro text-muted-foreground">{fileSize(file)}</span></span>{linked && <Badge variant="neutral">Déjà lié</Badge>}</label>{rejection && !linked && <p className="mt-1 pl-7 text-xs text-warning">{rejection}</p>}{orphanIds.has(file.id) && !rejection && <p className="mt-1 pl-7 text-xs text-muted-foreground">Déjà lié, sans compte Google : sélectionnez-le pour le rattacher à ce compte.</p>}</li>;
                })}</ul>{listing.files.length === 0 && <p className="py-8 text-center text-muted-foreground">Ce dossier est vide.</p>}{listing.nextPageToken && <button type="button" className="btn btn-secondary mt-3" disabled={busy} onClick={() => void run(() => loadLocation(listing.location, true))}>Afficher la suite</button>}
              </div>
            </div><div className="flex flex-wrap justify-between gap-2 border-t border-border bg-surface-subtle px-5 py-3 text-xs"><p><strong>{selected.length} fichier(s) sélectionné(s)</strong><span className="mt-1 block text-micro text-muted-foreground">La sélection est conservée entre les dossiers.</span></p><button type="button" disabled={busy} className="text-primary underline" onClick={() => setSelected([])}>Annuler la sélection</button></div>
          </>}
          {results.length > 0 && <div className="space-y-3 p-5"><h3 className="font-semibold">{results.some((result) => result.status === "failed") ? "Liens enregistrés avec des fichiers à reprendre" : "Vos fichiers sont liés à l’affaire"}</h3><ul aria-live="polite">{results.map((result) => <li key={result.fileId} className="flex items-start gap-3 border-b border-border-subtle py-3">{result.status === "failed" ? <TriangleAlertIcon className="shrink-0 text-warning" size={17} aria-hidden="true" /> : <CircleCheckIcon className="shrink-0 text-success" size={17} aria-hidden="true" />}<span className="min-w-0 break-all text-xs">{result.name} : {result.message}</span></li>)}</ul><p className="text-xs text-muted-foreground">Les DPGF restent à prévisualiser et à confirmer avant toute création de lignes de chiffrage.</p><div className="flex flex-wrap gap-2">{selected.length > 0 && <button type="button" className="btn btn-secondary" disabled={busy || !selectionValid} onClick={() => void run(() => linkSelection())}>Reprendre les fichiers en échec</button>}<button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setResults([]); setSelected([]); }}>Lier d’autres fichiers</button></div></div>}
          {notice && <p role="status" className="mx-5 my-3 rounded-lg border border-success-border bg-success-subtle p-3 text-sm text-success">{notice}</p>}
          {message && <p role="alert" className="mx-5 my-3 rounded-lg border border-warning/30 bg-warning-subtle p-3 text-sm text-warning">{message}</p>}
          {busy && !loadingFolder && <p role="status" className="px-5 py-3 text-sm text-primary">Opération en cours…</p>}
          {open && state && state.links.length > 0 && <details className="mx-5 mb-4 rounded-lg border border-border p-3 text-xs"><summary className="cursor-pointer font-medium">Fichiers Drive liés à l’affaire</summary><ul className="mt-3 space-y-3">{state.links.map(({ documentId, source }) => <li key={documentId}><a href={source.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline">{source.sourceName}</a>{source.revision && <> · révision {source.revision}</>}<p className="mt-1 text-muted-foreground">Lié le {new Date(source.linkedAt).toLocaleString("fr-FR")}{source.folderName && <> · dossier {source.folderName}</>}</p></li>)}</ul></details>}
        </div>
        <div className="border-t border-border px-5 py-3"><p className="mb-3 flex gap-2 text-micro text-muted-foreground"><ShieldCheckIcon size={14} className="shrink-0" aria-hidden="true" />PDF, PNG/JPEG/WebP, TXT, CSV, EML, XLS/XLSX, DOC/DOCX · 50 Mo / fichier · 20 fichiers par lien. Aucune copie : l’analyse lit le fichier dans Drive. Google Docs/Sheets/Slides exclus.</p>{selected.length > DRIVE_MAX_FILES && <p role="alert" className="mb-2 text-xs text-warning">Réduisez la sélection à 20 fichiers.</p>}<div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>{results.length ? "Voir les documents de l’affaire" : "Fermer"}</button>{listing && results.length === 0 && <button type="button" className="btn btn-primary" disabled={busy || !selectionValid} onClick={() => void run(() => linkSelection())}>Lier à l’affaire<ArrowRightIcon size={14} aria-hidden="true" /></button>}</div></div>
      </DialogContent>
    </Dialog>
  </>;
}
