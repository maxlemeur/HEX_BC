"use client";
import { useEffect, useRef, useState } from "react";
import { DRIVE_FOLDER_MIME, DRIVE_MAX_BATCH_BYTES, DRIVE_MAX_FILES, driveFileRejection,
  type DriveFile, type DriveHistory, type DriveImportResult, type DriveListing, type DriveSelection } from "@/lib/affaires/google-drive/contracts";
import { connectGoogleDrive, prepareGoogleIdentity, revokeGoogleDrive } from "@/lib/affaires/google-drive/identity";

type State = { enabled: boolean; clientId?: string; projectName: string; tenantId: string; history: DriveHistory[] };
async function responseData<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "Google Drive est indisponible.");
  return payload.data as T;
}
export function GoogleDriveImport({ projectId, onUploadComplete, onRefresh }: {
  projectId: string; onUploadComplete: (uploadId: string) => void; onRefresh?: () => void;
}) {
  const endpoint = `/api/affaires/${projectId}/intake/google-drive`;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>();
  const [identityReady, setIdentityReady] = useState(false);
  const [listing, setListing] = useState<DriveListing>();
  const [connectedFolder, setConnectedFolder] = useState<string>();
  const [selected, setSelected] = useState<DriveSelection[]>([]);
  const [results, setResults] = useState<DriveImportResult[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingFolder, setLoadingFolder] = useState(false);
  const folderHeading = useRef<HTMLHeadingElement>(null);
  const session = useRef<{ token: string; expiresAt: number } | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; session.current = undefined; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    folderHeading.current?.focus();
  }, [listing?.folder.id]);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    void fetch(endpoint, { signal: abort.signal, cache: "no-store" }).then(responseData<State>).then(async (data) => {
      if (abort.signal.aborted) return;
      setState(data);
      if (data.enabled) { await prepareGoogleIdentity(); if (!abort.signal.aborted) setIdentityReady(true); }
    }).catch((error: Error) => { if (!abort.signal.aborted) setMessage(error.message); });
    return () => abort.abort();
  }, [endpoint, open]);
  async function loadFolder(folderId: string, append = false) {
    const actionGeneration = generation.current;
    const actionController = controller.current;
    const active = session.current;
    if (!active || Date.now() >= active.expiresAt) throw new Error("Connexion expirée. Reconnectez Google Drive.");
    setLoadingFolder(true);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        signal: actionController?.signal, body: JSON.stringify({ action: "list", token: active.token,
          folderId, ...(append && listing?.nextPageToken ? { pageToken: listing.nextPageToken } : {}) }) });
      const data = await responseData<{ listing: DriveListing }>(response);
      if (!mounted.current || actionController?.signal.aborted || actionGeneration !== generation.current) return;
      setListing((prior) => append && prior ? { ...data.listing, files: [...prior.files, ...data.listing.files] } : data.listing);
      if (!append) { setSelected([]); setConnectedFolder(undefined); }
    } finally {
      if (mounted.current && actionGeneration === generation.current) setLoadingFolder(false);
    }
  }
  async function run(action: () => Promise<void>) {
    const current = generation.current;
    setBusy(true); setMessage("");
    controller.current = new AbortController();
    try { await action(); }
    catch (error) { if (mounted.current && current === generation.current) setMessage(error instanceof Error ? error.message : "Action interrompue."); }
    finally { if (mounted.current && current === generation.current) setBusy(false); }
  }
  async function disconnect() {
    generation.current++;
    const token = session.current?.token;
    session.current = undefined;
    controller.current?.abort();
    setListing(undefined); setConnectedFolder(undefined); setSelected([]); setBusy(false); setLoadingFolder(false);
    setMessage("Connexion fermée. Les copies déjà importées restent dans l'affaire. Une copie en cours de stockage peut avoir été conservée.");
    if (token) { try { await revokeGoogleDrive(token); } catch (error) { if (mounted.current) setMessage((error as Error).message); } }
  }
  async function importSelection(files = selected) {
    const active = session.current;
    if (!active || Date.now() >= active.expiresAt || !listing || connectedFolder !== listing.folder.id) throw new Error("Reconnectez le dossier avant l'import.");
    const data = await responseData<{ results: DriveImportResult[]; uploads: string[] }>(await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.current?.signal,
      body: JSON.stringify({ action: "import", token: active.token, folderId: connectedFolder, files }),
    }));
    if (!mounted.current || controller.current?.signal.aborted) return;
    // Preserve successful results when only failures are retried.
    const merged = [...results.filter((result) => !data.results.some((item) => item.fileId === result.fileId)), ...data.results];
    setResults(merged);
    setSelected(files.filter((file) => data.results.some((result) => result.fileId === file.id && result.status === "failed")));
    // A completed upload closes the intake dropzone and unmounts this panel. While a failure
    // remains, only refresh the workspace so its message, selection and connection stay here.
    if (merged.some((result) => result.status === "failed")) onRefresh?.();
    else data.uploads.forEach((uploadId) => onUploadComplete(uploadId));
    setState(await responseData<State>(await fetch(endpoint, { cache: "no-store", signal: controller.current?.signal })));
  }
  const filesById = new Map(listing?.files.map((file) => [file.id, file]));
  const bytes = selected.reduce((sum, file) => sum + Number(filesById.get(file.id)?.size ?? 0), 0);
  const parentFolderId = listing?.folder.parents?.[0];
  const folderCount = listing?.files.filter((file) => file.mimeType === DRIVE_FOLDER_MIME).length ?? 0;
  const fileCount = (listing?.files.length ?? 0) - folderCount;
  const selectionValid = selected.length > 0 && selected.length <= DRIVE_MAX_FILES && bytes <= DRIVE_MAX_BATCH_BYTES;
  function toggle(file: DriveFile) {
    setSelected((prior) => prior.some((item) => item.id === file.id) ? prior.filter((item) => item.id !== file.id)
      : [...prior, { id: file.id, version: file.version!, newVersion: false }]);
  }
  return <details className="mt-3 rounded-lg border border-slate-200 p-3" open={open}
    onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-medium">Ajouter depuis Google Drive</summary>
    {open && <div className="mt-3 space-y-3">
      <p>Connectez votre dossier, choisissez les pièces puis confirmez une copie dans cette affaire. Les plans rejoignent le classement documentaire et le métré existants.</p>
      <p className="text-sm text-slate-600">PDF, images PNG/JPEG/WebP, TXT, CSV, EML, XLS/XLSX, DOC/DOCX · 50 Mo par pièce · 20 pièces et 100 Mo par lot. L’analyse des tableurs est limitée à 10 Mo. Google Docs/Sheets/Slides, raccourcis et Drives partagés exclus.</p>
      {state && <p>Destination : <strong>{state.projectName}</strong> · tenant <code>{state.tenantId}</code></p>}
      {!state && !message && <p>Chargement…</p>}
      {state && !state.enabled && <p role="status">Connexion réelle en attente de validation OAuth pour ce POC. Aucun accès Google activé.</p>}
      {state?.enabled && !listing && <>
        <p className="text-sm">Google demandera la lecture seule de Drive. MergeOne parcourt le dossier choisi et ne charge que les pièces confirmées. Le jeton reste en mémoire jusqu’à la fermeture ou l’expiration.</p>
        <button type="button" className="btn btn-secondary" disabled={busy || !identityReady} onClick={() => void run(async () => {
          const actionGeneration = generation.current;
          const connection = await connectGoogleDrive(state.clientId!);
          if (!mounted.current || actionGeneration !== generation.current) { await revokeGoogleDrive(connection.token); return; }
          session.current = connection; await loadFolder("root");
        })}>Connecter Google Drive</button>
      </>}
      {listing && <>
        <p>Compte : {listing.account.displayName} ({listing.account.emailAddress})</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(() => loadFolder("root"))}>Mon Drive</button>
          {parentFolderId && <button type="button" className="btn btn-secondary" disabled={busy}
            onClick={() => void run(() => loadFolder(parentFolderId))}>Retour au dossier parent</button>}
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(() => loadFolder(listing.folder.id))}>Actualiser le dossier</button>
          <button type="button" className="btn btn-secondary" onClick={() => void disconnect()}>Déconnecter et révoquer</button>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h3 ref={folderHeading} tabIndex={-1} className="font-semibold">Dossier ouvert : {listing.folder.name}</h3>
          <p role="status" className="mt-1 text-sm text-slate-600">{loadingFolder ? "Chargement du dossier…" :
            `Contenu affiché : ${folderCount} ${folderCount === 1 ? "dossier" : "dossiers"} · ${fileCount} ${fileCount === 1 ? "fichier" : "fichiers"}.`}</p>
        </div>
        <p className="text-sm text-slate-600">Ouvrir un dossier affiche son contenu ici. Pour sélectionner ses fichiers à copier, cliquez sur « Connecter ce dossier ».</p>
        <button type="button" className="btn btn-secondary" disabled={busy || connectedFolder === listing.folder.id} onClick={() => {
          setConnectedFolder(listing.folder.id); setSelected([]); setResults([]);
        }}>{connectedFolder === listing.folder.id ? "Dossier connecté" : "Connecter ce dossier"}</button>
        <ul className="space-y-2" aria-label="Pièces du dossier Google Drive" aria-busy={loadingFolder}>
          {listing.files.map((file) => {
            if (file.mimeType === DRIVE_FOLDER_MIME && !file.driveId) return <li key={file.id}>
              <button type="button" className="text-left underline" disabled={busy} onClick={() => void run(() => loadFolder(file.id))}>Ouvrir le dossier {file.name}</button>
            </li>;
            const rejection = driveFileRejection(file);
            const choice = selected.find((item) => item.id === file.id);
            const prior = state?.history.filter((item) => item.source.fileId === file.id) ?? [];
            return <li key={file.id}>
              <label><input type="checkbox" checked={Boolean(choice)} disabled={busy || Boolean(rejection) || connectedFolder !== listing.folder.id}
                onChange={() => toggle(file)} /> {file.name} · {file.mimeType} · {file.size ? `${(Number(file.size) / 1024 / 1024).toFixed(2)} Mo` : "taille inconnue"}</label>
              {rejection && <p className="text-sm text-amber-800">{rejection}</p>}
              {prior.some((item) => item.source.revision === file.version) && <p className="text-sm">Cette révision est déjà importée ; elle sera ignorée.</p>}
              {choice && prior.length > 0 && !prior.some((item) => item.source.revision === file.version) && <label className="block">
                <input type="checkbox" checked={choice.newVersion} disabled={busy} onChange={(event) => setSelected((items) => items.map((item) => item.id === file.id ? { ...item, newVersion: event.target.checked } : item))} /> Importer explicitement une nouvelle version de {file.name}, en conservant la précédente
              </label>}
            </li>;
          })}
        </ul>
        {listing.files.length === 0 && <p>Ce dossier est vide.</p>}
        {listing.nextPageToken && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(() => loadFolder(listing.folder.id, true))}>Afficher la suite</button>}
        <p>{selected.length} pièce(s) · {(bytes / 1024 / 1024).toFixed(2)} Mo sélectionnés pour {state?.projectName}.</p>
        {(selected.length > DRIVE_MAX_FILES || bytes > DRIVE_MAX_BATCH_BYTES) && <p role="alert">Réduisez le lot à 20 pièces et 100 Mo.</p>}
        <button type="button" className="btn btn-primary" disabled={busy || !selectionValid || connectedFolder !== listing.folder.id}
          onClick={() => void run(() => importSelection())}>{busy && !loadingFolder ? "Opération en cours…" : "Confirmer et importer les copies"}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setSelected([]); setResults([]); }}>Annuler la sélection</button>
      </>}
      {message && <p role="alert">{message}</p>}
      <ul aria-live="polite">{results.map((result) => <li key={result.fileId}>{result.name} : {result.message}</li>)}</ul>
      {results.some((result) => result.status === "failed") && listing && <button type="button" className="btn btn-secondary" disabled={busy || !selectionValid}
        onClick={() => void run(() => importSelection())}>Reprendre les pièces en échec sélectionnées</button>}
      {state && state.history.length > 0 && <details><summary>Copies Google Drive et versions importées</summary>
        <ul>{state.history.map(({ documentId, source }) => <li key={documentId} className="mt-2 text-sm">
          <a href={source.sourceUrl} target="_blank" rel="noreferrer" className="underline">{source.sourceName}</a> · révision {source.revision} · importée le {source.importedAt}
          <p>SHA-256 : <code className="break-all">{source.sha256}</code> · utilisateur {source.importedBy}</p>
        </li>)}</ul><p>Les modifications Drive ne changent pas ces copies. La suppression d’une copie est une action distincte.</p>
      </details>}
    </div>}
  </details>;
}
