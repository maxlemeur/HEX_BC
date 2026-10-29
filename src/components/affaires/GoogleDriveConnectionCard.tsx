"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { PageSection } from "@/components/layout/page-section";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  driveConnectionStateSchema,
  DRIVE_OAUTH_OUTCOMES,
  type DriveOAuthOutcome,
  type DriveConnectionRequest,
} from "@/lib/affaires/google-drive/contracts";
import { openGooglePicker } from "./google-picker";

type State = z.infer<typeof driveConnectionStateSchema>;
const endpoint = "/api/google-drive/connection";
async function result(response: Response) {
  const payload = z
    .object({
      ok: z.boolean(),
      data: z.unknown().optional(),
      error: z.object({ message: z.string() }).passthrough().optional(),
    })
    .parse(await response.json());
  if (!response.ok || !payload.ok)
    throw new Error(
      payload.error?.message ?? "La demande Google Drive a échoué.",
    );
  return payload.data;
}
export function GoogleDriveConnectionCard() {
  const [state, setState] = useState<State>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<{ id: string; name: string }>();
  const [content, setContent] = useState("");
  const [newName, setNewName] = useState("");
  const lifetime = useRef<AbortController | undefined>(undefined);
  const loadedGrant = useRef<string | undefined>(undefined);
  const draftFileId = useRef<string | undefined>(undefined);
  const load = useCallback(async (signal?: AbortSignal) => {
    const data = driveConnectionStateSchema.parse(
      await result(await fetch(endpoint, { cache: "no-store", signal })),
    );
    if (!signal?.aborted) {
      setState(data);
      const grant = data.connection ? `${data.connection.id}:${data.connection.grantVersion}` : undefined;
      if (loadedGrant.current !== grant) {
        setFile(undefined);
      }
      loadedGrant.current = grant;
    }
    return data;
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("drive");
    if (outcome && outcome in DRIVE_OAUTH_OUTCOMES) {
      setNotice(DRIVE_OAUTH_OUTCOMES[outcome as DriveOAuthOutcome]);
      params.delete("drive");
      params.delete("driveConnection");
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${params.size ? `?${params}` : ""}`,
      );
    }
    void load(controller.signal).catch((cause) => {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Impossible de lire la connexion Drive.",
        );
    });
    return () => controller.abort();
  }, [load]);
  async function post(body: DriveConnectionRequest) {
    return result(
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: lifetime.current?.signal,
      }),
    );
  }
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (cause) {
      if (!lifetime.current?.signal.aborted) {
        setError(
          cause instanceof Error ? cause.message : "Action interrompue.",
        );
        await load(lifetime.current?.signal).catch(() => undefined);
      }
    } finally {
      if (!lifetime.current?.signal.aborted) setBusy(false);
    }
  }
  const account = state?.connection;
  const own = account
    ? { connectionId: account.id, grantVersion: account.grantVersion }
    : undefined;
  const connect = (purpose: "read" | "write") =>
    `/api/google-drive/oauth/start?returnTo=%2Fdashboard%2Fprofile&purpose=${purpose}`;
  async function selectFile() {
    if (!own) return;
    const picker = z
      .object({
        accessToken: z.string(),
        apiKey: z.string(),
        projectNumber: z.string(),
      })
      .parse(await post({ action: "picker", ...own }));
    const files = await openGooglePicker({
      ...picker,
      signal: lifetime.current?.signal,
    });
    if (files.length > 1)
      throw new Error("Choisissez un seul fichier pour cette opération.");
    if (!files[0]) return;
    setFile(files[0]);
    if (draftFileId.current !== files[0].id) {
      setContent("");
      setNewName(files[0].name);
    }
    draftFileId.current = files[0].id;
  }
  async function write(action: "comment" | "rename") {
    if (!own || !file) return;
    try {
      await post(
      action === "comment"
        ? { action, ...own, fileId: file.id, content }
        : { action, ...own, fileId: file.id, name: newName },
      );
    } catch (cause) {
      throw new Error(`${cause instanceof Error ? cause.message : "Réponse interrompue."} Vérifiez le fichier dans Google Drive avant de réessayer.`);
    }
    if (action === "rename") setFile({ ...file, name: newName.trim() });
    setNotice("Opération enregistrée dans Google Drive.");
    if (action === "comment") setContent("");
  }
  return (
    <PageSection title="Google Drive">
      <p className="mb-4 text-sm text-muted-foreground">
        Un seul compte Google pour votre profil dans cette entreprise. La
        connexion démarre en lecture seule.
      </p>
      {error && <Alert variant="danger">{error}</Alert>}
      {notice && (
        <p role="status" className="mb-4 text-sm text-foreground">
          {notice}
        </p>
      )}
      {!state ? (
        <p role="status">Chargement de la connexion…</p>
      ) : (
        <>
          {!state.enabled && (
            <p className="mb-4 text-sm text-muted-foreground">
              La connexion Google Drive attend la configuration de cet
              environnement.
            </p>
          )}
          {!account ? (
            state.enabled && (
              <a
                className={buttonVariants({ variant: "outline" })}
                href={connect("read")}
              >
                Connecter Google Drive
              </a>
            )
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-border p-4">
                <p className="break-all font-medium">{account.email}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {account.status === "reconnect_required"
                    ? "À reconnecter"
                    : account.writeEnabled
                      ? "Lecture et écriture"
                      : "Lecture seule"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Connecté le{" "}
                  {new Date(account.connectedAt).toLocaleDateString("fr-FR")}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                La lecture permet de parcourir et importer les fichiers dans les
                affaires. Google autorise la gestion des fichiers que vous
                choisissez, y compris leur modification et leur suppression
                selon vos droits. MergeOne propose ici de les commenter ou de
                les renommer.
              </p>
              {account.writeEnabled && (
                <p className="text-sm text-muted-foreground">
                  La reconnexion conserve l’écriture déjà activée. Pour la désactiver,
                  choisissez « Revenir à la lecture seule ».
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                {state.enabled && (
                  <a
                    className={buttonVariants({ variant: "outline" })}
                    aria-disabled={busy}
                    href={busy ? undefined : connect("read")}
                  >
                    Reconnecter la lecture
                  </a>
                )}
                {account.writeEnabled ? (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await post({ action: "disable_write", ...own! });
                        await load(lifetime.current?.signal);
                        setNotice(
                          "Écriture désactivée dans MergeOne. La lecture reste disponible.",
                        );
                      })
                    }
                  >
                    Revenir à la lecture seule
                  </Button>
                ) : (
                  state.writingAvailable &&
                  account.status === "active" && (
                    <a
                      className={buttonVariants({ variant: "outline" })}
                      aria-disabled={busy}
                      href={busy ? undefined : connect("write")}
                    >
                      Activer l’écriture
                    </a>
                  )
                )}
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await post({ action: "disconnect", ...own! });
                      await load(lifetime.current?.signal);
                      setNotice(
                        "Compte retiré. Les liens et copies restent dans les affaires. La révocation dans Google peut aussi couper vos autres connexions à MergeOne.",
                      );
                    })
                  }
                >
                  Retirer le compte Google
                </Button>
              </div>
              {!account.writeEnabled && !state.writingAvailable && (
                <p className="text-sm text-muted-foreground">
                  L’écriture sera disponible après configuration du sélecteur
                  Google.
                </p>
              )}
              {account.writeEnabled && state.enabled && (
                <div className="space-y-3 rounded-xl border border-border p-4">
                  <p className="text-sm text-muted-foreground">
                    Google autorise la gestion des fichiers choisis. MergeOne
                    propose ici des opérations explicites de commentaire et de
                    renommage.
                  </p>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run(selectFile)}
                  >
                    Choisir un fichier à modifier
                  </Button>
                  {file && (
                    <>
                      <p className="break-all font-medium">{file.name}</p>
                      <label className="block text-sm">
                        Commentaire
                        <textarea
                          className="mt-1 w-full rounded border border-border bg-background p-2"
                          value={content}
                          maxLength={4000}
                          onChange={(event) => setContent(event.target.value)}
                          disabled={busy}
                        />
                      </label>
                      <Button
                        disabled={busy || !content.trim()}
                        onClick={() => void run(() => write("comment"))}
                      >
                        Ajouter le commentaire
                      </Button>
                      <label className="block text-sm">
                        Nouveau nom
                        <input
                          className="mt-1 w-full rounded border border-border bg-background p-2"
                          value={newName}
                          maxLength={255}
                          onChange={(event) => setNewName(event.target.value)}
                          disabled={busy}
                        />
                      </label>
                      <Button
                        variant="outline"
                        disabled={
                          busy || !newName.trim() || newName === file.name
                        }
                        onClick={() => void run(() => write("rename"))}
                      >
                        Renommer dans Drive
                      </Button>
                    </>
                  )}
                </div>
              )}
              <a
                className="text-sm text-primary underline"
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noreferrer"
              >
                Gérer les autorisations dans Google
              </a>
              <p className="text-xs text-muted-foreground">Révoquer MergeOne dans Google peut aussi couper les autres connexions de ce compte à l’application.</p>
            </div>
          )}
          <Button
            variant="ghost"
            className="mt-3"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await load(lifetime.current?.signal);
              })
            }
          >
            Actualiser
          </Button>
        </>
      )}
    </PageSection>
  );
}
