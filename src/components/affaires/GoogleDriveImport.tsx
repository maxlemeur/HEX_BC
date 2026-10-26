"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, CircleCheckIcon, FileTextIcon, FolderIcon, FolderOpenIcon, HardDriveIcon, RefreshCwIcon, SearchIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { DRIVE_FOLDER_MIME, DRIVE_MAX_BATCH_BYTES, DRIVE_MAX_FILES, driveFileRejection,
  type DriveFile, type DriveHistory, type DriveImportResult, type DriveListing, type DriveSelection } from "@/lib/affaires/google-drive/contracts";
import { connectGoogleDrive, prepareGoogleIdentity, revokeGoogleDrive } from "@/lib/affaires/google-drive/identity";

type State = { enabled: boolean; clientId?: string; projectName: string; tenantId: string; history: DriveHistory[] };
type Choice = DriveSelection & { file: DriveFile; folderId: string; folderName: string };
async function responseData<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "Google Drive est indisponible.");
  return payload.data as T;
}
function fileSize(file: DriveFile) { return file.size ? `${(Number(file.size) / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} Mo` : "Taille inconnue"; }
const OPEN_EVENT = "affaire-open-google-drive-import";
/** Opens the affaire's mounted import dialog from another surface, which may unmount once copies arrive. */
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
  const [state, setState] = useState<State>();
  const [identityReady, setIdentityReady] = useState(false);
  const [listing, setListing] = useState<DriveListing>();
  const [trail, setTrail] = useState<DriveFile[]>([]);
  const [selected, setSelected] = useState<Choice[]>([]);
  const [results, setResults] = useState<DriveImportResult[]>([]);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingFolder, setLoadingFolder] = useState(false);
  const folderHeading = useRef<HTMLHeadingElement>(null);
  const session = useRef<{ token: string; expiresAt: number } | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  const generation = useRef(0);
  const mounted = useRef(true);
  const completedUploads = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; session.current = undefined; controller.current?.abort(); };
  }, []);
  useEffect(() => { folderHeading.current?.focus(); }, [listing?.folder.id]);
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
  function close() {
    if (busy) return;
    generation.current++;
    controller.current?.abort(); session.current = undefined;
    setOpen(false); setListing(undefined); setSelected([]); setResults([]); setTrail([]); setStep(1); setMessage("");
    const uploadId = [...completedUploads.current].at(-1);
    completedUploads.current.clear();
    if (uploadId) onUploadComplete(uploadId);
  }
  async function loadFolder(folderId: string, append = false) {
    const actionGeneration = generation.current;
    const abort = controller.current;
    const active = session.current;
    if (!active || Date.now() >= active.expiresAt) throw new Error("Connexion expirée. Reconnectez Google Drive.");
    setLoadingFolder(true);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        signal: abort?.signal, body: JSON.stringify({ action: "list", token: active.token,
          folderId, ...(append && listing?.nextPageToken ? { pageToken: listing.nextPageToken } : {}) }) });
      const data = await responseData<{ listing: DriveListing }>(response);
      if (!mounted.current || abort?.signal.aborted || actionGeneration !== generation.current) return;
      setListing((prior) => append && prior ? { ...data.listing, files: [...prior.files, ...data.listing.files] } : data.listing);
      if (!append) {
        setSearch("");
        setTrail((prior) => { const index = prior.findIndex((folder) => folder.id === data.listing.folder.id);
          return index >= 0 ? prior.slice(0, index + 1) : folderId === "root" ? [data.listing.folder] : [...prior, data.listing.folder]; });
      }
    } finally { if (mounted.current && actionGeneration === generation.current) setLoadingFolder(false); }
  }
  async function run(action: () => Promise<void>) {
    const current = generation.current;
    setBusy(true); setMessage(""); controller.current = new AbortController();
    try { await action(); }
    catch (error) { if (mounted.current && current === generation.current) setMessage(error instanceof Error ? error.message : "Action interrompue."); }
    finally { if (mounted.current && current === generation.current) setBusy(false); }
  }
  async function disconnect() {
    generation.current++;
    const token = session.current?.token;
    session.current = undefined; controller.current?.abort();
    setListing(undefined); setTrail([]); setSelected([]); setBusy(false); setLoadingFolder(false); setStep(1);
    setMessage("Connexion fermée. Les copies déjà importées restent dans l'affaire. Une copie en cours de stockage peut avoir été conservée.");
    onRefresh?.();
    if (token) { try { await revokeGoogleDrive(token); } catch (error) { if (mounted.current) setMessage((error as Error).message); } }
  }
  async function importSelection(files = selected) {
    const active = session.current;
    const abort = controller.current;
    const current = generation.current;
    if (!active || Date.now() >= active.expiresAt) throw new Error("Connexion expirée. Reconnectez Google Drive.");
    const fresh: DriveImportResult[] = [];
    try {
      const data = await responseData<{ results: DriveImportResult[]; uploads: string[] }>(await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: abort?.signal,
        body: JSON.stringify({ action: "import", token: active.token, folderId: files[0].folderId,
          files: files.map(({ id, version, newVersion, folderId }) => ({ id, version, newVersion, folderId })) }),
      }));
      if (!mounted.current || abort?.signal.aborted || current !== generation.current) return;
      fresh.push(...data.results);
      data.uploads.forEach((uploadId) => completedUploads.current.add(uploadId));
    } catch (error) {
      if (abort?.signal.aborted || current !== generation.current) return;
      fresh.push(...files.map(({ file }) => ({ fileId: file.id, name: file.name, status: "failed" as const,
        message: error instanceof Error ? error.message : "Import interrompu. Reprenez cette pièce." })));
    }
    if (!mounted.current || abort?.signal.aborted || current !== generation.current) return;
    setResults((prior) => [...prior.filter((result) => !fresh.some((item) => item.fileId === result.fileId)), ...fresh]);
    setSelected(files.filter((file) => fresh.some((result) => result.fileId === file.id && result.status === "failed")));
    setStep(3); onRefresh?.();
    const data = await responseData<State>(await fetch(endpoint, { cache: "no-store", signal: abort?.signal }));
    if (mounted.current && !abort?.signal.aborted && current === generation.current) setState(data);
  }
  const bytes = selected.reduce((sum, { file }) => sum + Number(file.size ?? 0), 0);
  const selectionValid = selected.length > 0 && selected.length <= DRIVE_MAX_FILES && bytes <= DRIVE_MAX_BATCH_BYTES;
  const versionsValid = selected.every((choice) => !state?.history.some((entry) => entry.source.fileId === choice.id && entry.source.revision !== choice.version) || choice.newVersion || state?.history.some((entry) => entry.source.fileId === choice.id && entry.source.revision === choice.version));
  const folderCount = listing?.files.filter((file) => file.mimeType === DRIVE_FOLDER_MIME).length ?? 0;
  const fileCount = (listing?.files.length ?? 0) - folderCount;
  function toggle(file: DriveFile) {
    if (!listing) return;
    setSelected((prior) => prior.some((item) => item.id === file.id) ? prior.filter((item) => item.id !== file.id)
      : [...prior, { id: file.id, version: file.version!, newVersion: false, file, folderId: listing.folder.id, folderName: listing.folder.name }]);
  }
  return <>
    {showTrigger && <button type="button" className="btn btn-primary mt-3 gap-2" onClick={openDialog}><HardDriveIcon size={16} aria-hidden="true" />Ajouter depuis Google Drive</button>}
    <Dialog open={open} onOpenChange={(value) => { if (!value) close(); }}>
      <DialogContent size="xl" showCloseButton={!busy} className="gap-0 overflow-hidden p-0 sm:p-0" finalFocus={() => opener.current?.isConnected ? opener.current : fallbackFocus?.current ?? true}>
        <DialogHeader className="p-5 sm:p-6"><DialogTitle className="flex items-center gap-3"><HardDriveIcon className="text-primary" aria-hidden="true" />Ajouter depuis Google Drive</DialogTitle><DialogDescription>Choisissez vos fichiers, puis conservez une copie dans l’affaire.</DialogDescription></DialogHeader>
        <ol className="flex gap-5 border-b border-border px-5 text-xs sm:px-6" aria-label="Étapes de l’import">{["Sélectionner", "Vérifier l’import", "Résultat"].map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={`flex items-center gap-2 border-b-2 py-3 ${step === index + 1 ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground"}`}><span className="flex size-5 items-center justify-center rounded-full bg-muted text-micro">{step > index + 1 ? <CheckIcon size={12} aria-hidden="true" /> : index + 1}</span>{label}</li>)}</ol>
        <div className="min-h-0 overflow-y-auto">
          {state && <p className="border-b border-border bg-surface-subtle px-5 py-3 text-xs text-muted-foreground">Destination : <strong className="text-foreground">{state.projectName}</strong></p>}
          {!state && !message && <p className="p-6">Chargement…</p>}
          {state && !state.enabled && <p role="status" className="p-6">Connexion réelle en attente de validation OAuth pour ce POC. Aucun accès Google activé.</p>}
          {state?.enabled && !listing && <div className="space-y-4 p-6"><p className="text-sm text-muted-foreground">Google demandera la lecture seule de Drive. Seuls les fichiers confirmés seront copiés dans cette affaire.</p><button type="button" className="btn btn-primary" disabled={busy || !identityReady} onClick={() => void run(async () => {
            const current = generation.current; const connection = await connectGoogleDrive(state.clientId!);
            if (!mounted.current || current !== generation.current) { await revokeGoogleDrive(connection.token); return; }
            session.current = connection; await loadFolder("root");
          })}>Connecter Google Drive</button></div>}
          {listing && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2 text-xs text-muted-foreground"><span>Compte : {listing.account.displayName} ({listing.account.emailAddress})</span><button type="button" className="text-primary underline" onClick={() => void disconnect()}>Déconnecter et révoquer</button></div>}
          {listing && step === 1 && <>
            <div className="grid sm:grid-cols-[200px_minmax(0,1fr)]">
              <aside className="border-b border-border bg-surface-subtle p-3 sm:border-r sm:border-b-0"><p className="mb-3 px-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">Dossiers Google Drive</p><button className="btn btn-ghost w-full justify-start text-xs" disabled={busy} onClick={() => void run(() => loadFolder("root"))}><HardDriveIcon size={14} aria-hidden="true" />Mon Drive</button>{trail.map((folder) => <button key={folder.id} type="button" className={`mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${folder.id === listing.folder.id ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted"}`} disabled={busy} onClick={() => void run(() => loadFolder(folder.id))}><FolderOpenIcon size={15} aria-hidden="true" /><span className="truncate">{folder.name}</span></button>)}</aside>
              <div className="min-w-0 p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 ref={folderHeading} tabIndex={-1} className="text-sm font-semibold outline-none">Dossier ouvert : {listing.folder.name}</h3><div className="flex gap-2">{listing.folder.parents?.[0] && <button type="button" className="text-xs text-primary" disabled={busy} onClick={() => void run(() => loadFolder(listing.folder.parents![0]))}><ArrowLeftIcon size={14} aria-hidden="true" />Retour au dossier parent</button>}<button type="button" className="text-xs text-primary" disabled={busy} onClick={() => void run(() => loadFolder(listing.folder.id))}><RefreshCwIcon size={14} aria-hidden="true" />Actualiser le dossier</button></div></div>
                <p role="status" className="mb-3 text-xs text-muted-foreground">{loadingFolder ? "Chargement du dossier…" : `Contenu affiché : ${folderCount} ${folderCount === 1 ? "dossier" : "dossiers"} · ${fileCount} ${fileCount === 1 ? "fichier" : "fichiers"}.`}</p>
                <label className="mb-3 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-muted-foreground"><SearchIcon size={14} aria-hidden="true" /><input className="min-w-0 flex-1 bg-transparent text-xs outline-none" aria-label="Rechercher dans le dossier Drive" placeholder="Rechercher dans ce dossier" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
                <ul aria-label="Pièces du dossier Google Drive" aria-busy={loadingFolder}>{listing.files.filter((file) => file.name.toLocaleLowerCase("fr").includes(search.toLocaleLowerCase("fr"))).map((file) => {
                  if (file.mimeType === DRIVE_FOLDER_MIME && !file.driveId) return <li key={file.id} className="border-b border-border-subtle"><button type="button" className="flex w-full items-center gap-3 p-3 text-left text-sm text-primary hover:bg-muted" disabled={busy} onClick={() => void run(() => loadFolder(file.id))}><FolderIcon size={19} aria-hidden="true" />Ouvrir le dossier {file.name}<ArrowRightIcon className="ml-auto" size={14} aria-hidden="true" /></button></li>;
                  const rejection = driveFileRejection(file); const choice = selected.find((item) => item.id === file.id);
                  const prior = state?.history.filter((item) => item.source.fileId === file.id) ?? [];
                  return <li key={file.id} className={`border-b border-border-subtle p-3 ${choice ? "bg-primary/5" : ""}`}><label className="flex items-center gap-3"><input type="checkbox" aria-label={`Sélectionner ${file.name}`} checked={Boolean(choice)} disabled={busy || Boolean(rejection)} onChange={() => toggle(file)} /><FileTextIcon size={19} className="shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block break-all text-xs font-medium">{file.name}</span><span className="text-micro text-muted-foreground">{fileSize(file)}</span></span>{prior.some((item) => item.source.revision === file.version) && <Badge variant="neutral">Déjà importé</Badge>}</label>{rejection && <p className="mt-1 pl-7 text-xs text-warning">{rejection}</p>}</li>;
                })}</ul>{listing.files.length === 0 && <p className="py-8 text-center text-muted-foreground">Ce dossier est vide.</p>}{listing.nextPageToken && <button type="button" className="btn btn-secondary mt-3" disabled={busy} onClick={() => void run(() => loadFolder(listing.folder.id, true))}>Afficher la suite</button>}
              </div>
            </div><div className="flex flex-wrap justify-between gap-2 border-t border-border bg-surface-subtle px-5 py-3 text-xs"><p><strong>{selected.length} pièce(s) · {(bytes / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} Mo sélectionnés</strong><span className="mt-1 block text-micro text-muted-foreground">La sélection est conservée entre les dossiers.</span></p><button type="button" disabled={busy} className="text-primary underline" onClick={() => { setSelected([]); setResults([]); }}>Annuler la sélection</button></div>
          </>}
          {step === 2 && <div className="space-y-4 p-5"><p className="rounded-lg border border-border bg-surface-subtle p-3 text-xs">Confirmez les fichiers à copier dans <strong>{state?.projectName}</strong>. Le classement démarre après l’enregistrement.</p>{selected.map((choice) => { const prior = state?.history.filter((item) => item.source.fileId === choice.id) ?? []; const same = prior.some((item) => item.source.revision === choice.version); return <div key={choice.id} className="border-b border-border-subtle pb-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><p className="break-all text-xs font-medium">{choice.file.name}</p><p className="text-micro text-muted-foreground">{choice.folderName} · {fileSize(choice.file)}</p></div>{same && <Badge variant="neutral">Même révision · ignorée</Badge>}</div>{prior.length > 0 && !same && <label className="mt-2 flex items-start gap-2 text-xs text-warning"><input type="checkbox" checked={choice.newVersion} disabled={busy} onChange={(event) => setSelected((items) => items.map((item) => item.id === choice.id ? { ...item, newVersion: event.target.checked } : item))} />Importer explicitement une nouvelle version de {choice.file.name}, en conservant la précédente</label>}</div>; })}<p className="flex gap-2 text-xs text-muted-foreground"><ShieldCheckIcon size={16} className="shrink-0" aria-hidden="true" />Les copies sont enregistrées automatiquement à la confirmation. Les fichiers d’origine dans Drive restent inchangés.</p></div>}
          {step === 3 && <div className="space-y-3 p-5"><h3 className="font-semibold">{results.some((result) => result.status === "failed") ? "Import terminé avec des pièces à reprendre" : "Vos pièces sont dans l’affaire"}</h3><ul aria-live="polite">{results.map((result) => <li key={result.fileId} className="flex items-start gap-3 border-b border-border-subtle py-3">{result.status === "failed" ? <TriangleAlertIcon className="shrink-0 text-warning" size={17} aria-hidden="true" /> : <CircleCheckIcon className="shrink-0 text-success" size={17} aria-hidden="true" />}<span className="min-w-0 break-all text-xs">{result.name} : {result.message}</span></li>)}</ul><p className="text-xs text-muted-foreground">Les DPGF restent à prévisualiser et à confirmer avant toute création de lignes de chiffrage.</p>{results.some((result) => result.status === "failed") && <button type="button" className="btn btn-secondary" disabled={busy || !selectionValid} onClick={() => void run(() => importSelection())}>Reprendre les pièces en échec sélectionnées</button>}</div>}
          {message && <p role="alert" className="mx-5 my-3 rounded-lg border border-warning/30 bg-warning-subtle p-3 text-sm text-warning">{message}</p>}
          {busy && !loadingFolder && <p role="status" className="px-5 py-3 text-sm text-primary">Opération en cours… Les copies réussies seront conservées.</p>}
          {open && state && state.history.length > 0 && <details className="mx-5 mb-4 rounded-lg border border-border p-3 text-xs"><summary className="cursor-pointer font-medium">Copies Google Drive et versions importées</summary><ul className="mt-3 space-y-3">{state.history.map(({ documentId, source }) => <li key={documentId}><a href={source.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline">{source.sourceName}</a> · révision {source.revision}<p className="mt-1 text-muted-foreground">Importée le {new Date(source.importedAt).toLocaleString("fr-FR")} · dossier {source.folderName ?? source.folderId}</p></li>)}</ul></details>}
        </div>
        <div className="border-t border-border px-5 py-3"><p className="mb-3 text-micro text-muted-foreground">PDF, PNG/JPEG/WebP, TXT, CSV, EML, XLS/XLSX, DOC/DOCX · 50 Mo / pièce · 20 pièces et 100 Mo / lot. Analyse des tableurs : 10 Mo. Google Docs/Sheets/Slides, raccourcis et Drives partagés exclus.</p>{(selected.length > DRIVE_MAX_FILES || bytes > DRIVE_MAX_BATCH_BYTES) && <p role="alert" className="mb-2 text-xs text-warning">Réduisez le lot à 20 pièces et 100 Mo.</p>}<div className="flex flex-wrap justify-end gap-2">{step === 2 && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setStep(1)}>Modifier la sélection</button>}<button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>{step === 3 ? "Voir les documents de l’affaire" : "Annuler"}</button>{listing && step === 1 && <button type="button" className="btn btn-primary" disabled={busy || !selectionValid} onClick={() => setStep(2)}>Vérifier la sélection<ArrowRightIcon size={14} aria-hidden="true" /></button>}{step === 2 && <button type="button" className="btn btn-primary" disabled={busy || !selectionValid || !versionsValid} onClick={() => void run(() => importSelection())}>Confirmer et importer les copies</button>}</div></div>
      </DialogContent>
    </Dialog>
  </>;
}
