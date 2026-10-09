"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { DownloadIcon, XIcon } from "lucide-react";

import { LoadingState } from "@/components/layout/loading-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import type { DevisItem } from "./DevisList";

type DevisPreviewModalProps = {
  open: boolean;
  onClose: () => void;
  devis: DevisItem | null;
};

type EmailAddress = {
  name?: string | null;
  address?: string | null;
};

type EmailPreview = {
  subject: string;
  from: string;
  to: string;
  date: string;
  text: string;
  html: string;
  attachments: EmailAttachment[];
};

type EmailAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  content: Uint8Array | null;
};

type ParsedEmailResponse = {
  subject?: string | null;
  from?: EmailAddress | EmailAddress[] | null;
  to?: EmailAddress[] | null;
  date?: string | null;
  text?: string | null;
  html?: string | null;
  attachments?: Array<{
    filename?: string | null;
    mimeType?: string | null;
    content?: unknown;
    size?: number | null;
  }> | null;
};

function isPreviewableType(mimeType: string, filename?: string): boolean {
  const normalizedFilename = filename?.toLowerCase();
  const isEmlFile = mimeType === "message/rfc822" || normalizedFilename?.endsWith(".eml");

  return (
    mimeType.startsWith("image/") ||
    mimeType === "application/pdf" ||
    Boolean(isEmlFile)
  );
}

function formatEmailDate(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function formatAddress(address?: EmailAddress | null) {
  if (!address) return "";
  const name = address.name?.trim();
  const email = address.address?.trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || "";
}

function formatAddressList(value?: EmailAddress | EmailAddress[] | null) {
  if (!value) return "";
  const list = Array.isArray(value) ? value : [value];
  return list.map(formatAddress).filter(Boolean).join(", ");
}

function buildEmailHtmlDocument(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:;" />
<style>body{margin:0;padding:16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;background:#fff;}img{max-width:100%;height:auto;}</style>
</head><body>${html}</body></html>`;
}

function isAttachmentPreviewable(attachment: EmailAttachment) {
  const mimeType = attachment.mimeType?.toLowerCase() ?? "";
  if (mimeType.startsWith("image/")) return true;
  if (mimeType === "application/pdf") return true;
  const filename = attachment.filename.toLowerCase();
  return filename.endsWith(".png")
    || filename.endsWith(".jpg")
    || filename.endsWith(".jpeg")
    || filename.endsWith(".webp")
    || filename.endsWith(".gif")
    || filename.endsWith(".pdf");
}

function toUint8Array(value: unknown): Uint8Array | null {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return new Uint8Array(value);
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  return null;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function formatAttachmentSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} o`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} Ko`;
  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(1)} Mo`;
}

const emailPreviewFetcher = async ([, downloadUrl]: readonly [string, string]) => {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error("fetch failed");
  }

  const buffer = await response.arrayBuffer();
  const { default: PostalMime } = await import("postal-mime");
  const parser = new PostalMime();
  const parsed = (await parser.parse(buffer)) as ParsedEmailResponse;

  const attachments = (parsed.attachments ?? []).map((attachment, index) => {
    const content = toUint8Array(attachment.content);
    const size = attachment.size ?? content?.byteLength ?? 0;
    const filename = attachment.filename?.trim() || `piece-jointe-${index + 1}`;
    return {
      id: `${index}-${filename}`,
      filename,
      mimeType: attachment.mimeType?.trim() || "application/octet-stream",
      size,
      content,
    };
  });

  return {
    subject: parsed.subject?.trim() || "(Sans objet)",
    from: formatAddressList(parsed.from),
    to: formatAddressList(parsed.to),
    date: formatEmailDate(parsed.date ?? undefined),
    text: parsed.text?.trim() || "",
    html: parsed.html?.trim() || "",
    attachments,
  } satisfies EmailPreview;
};

export function DevisPreviewModal({ open, onClose, devis }: DevisPreviewModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeAttachmentId, setActiveAttachmentId] = useState<string | null>(null);

  const mimeType = devis?.mimeType ?? "";
  const originalFilename = devis?.originalFilename ?? "";
  const downloadUrl = devis?.downloadUrl ?? null;
  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";
  const normalizedFilename = originalFilename.toLowerCase();
  const isEmail = mimeType === "message/rfc822" || normalizedFilename.endsWith(".eml");
  const canPreview = isPreviewableType(mimeType, originalFilename) && Boolean(downloadUrl);
  const shouldLoadEmailPreview = open && isEmail && Boolean(downloadUrl);

  const {
    data: emailPreviewData,
    error: emailPreviewError,
    isLoading: isEmailPreviewLoading,
  } = useSWR(
    shouldLoadEmailPreview ? (["devis-email-preview", downloadUrl] as const) : null,
    emailPreviewFetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );

  const emailPreview = emailPreviewData ?? null;
  const previewError = error ?? (emailPreviewError ? "Impossible de lire l’email." : null);
  const isPreviewLoading = isEmail ? isEmailPreviewLoading : loading;

  function handleLoad() {
    setLoading(false);
  }

  function handleError() {
    setLoading(false);
    setError("Impossible de charger le fichier.");
  }

  function handleDownload() {
    if (downloadUrl) {
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    }
  }

  const activeAttachment =
    emailPreview?.attachments.find((attachment) => attachment.id === activeAttachmentId) ?? null;
  const activeAttachmentUrl = useMemo(() => {
    if (!activeAttachment?.content) return null;
    const previewBlob = new Blob([toArrayBuffer(activeAttachment.content)], {
      type: activeAttachment.mimeType || "application/octet-stream",
    });
    return URL.createObjectURL(previewBlob);
  }, [activeAttachment]);

  useEffect(() => {
    if (!activeAttachmentUrl) return undefined;
    return () => URL.revokeObjectURL(activeAttachmentUrl);
  }, [activeAttachmentUrl]);

  function handleAttachmentDownload(attachment: EmailAttachment) {
    if (!attachment.content) return;
    const blob = new Blob([toArrayBuffer(attachment.content)], {
      type: attachment.mimeType || "application/octet-stream",
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = attachment.filename || "piece-jointe";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  return (
    <Dialog
      open={open && devis !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      {devis ? (
        <DialogContent
          size="full"
          showCloseButton={false}
          className="h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 sm:p-0"
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate">{devis.name}</DialogTitle>
              <DialogDescription className="truncate font-mono text-xs">{devis.originalFilename}</DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="md"
                leftIcon={<DownloadIcon aria-hidden="true" />}
                onClick={handleDownload}
                disabled={!devis.downloadUrl}
              >
                Télécharger
              </Button>
              <DialogClose render={<Button variant="ghost" size="icon" aria-label="Fermer l’aperçu" />}>
                <XIcon aria-hidden="true" />
              </DialogClose>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted p-4">
            {!canPreview ? (
              <div className="text-center">
                <p className="text-lg font-medium text-foreground">Aperçu non disponible</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Ce type de fichier ({devis.mimeType}) ne peut pas être prévisualisé.
                </p>
                <Button
                  variant="primary"
                  size="lg"
                  className="mt-4"
                  leftIcon={<DownloadIcon aria-hidden="true" />}
                  onClick={handleDownload}
                  disabled={!devis.downloadUrl}
                >
                  Télécharger le fichier
                </Button>
              </div>
            ) : (
              <>
                {isPreviewLoading ? <LoadingState label="Chargement de l’aperçu…" /> : null}

                {previewError ? (
                  <div className="text-center">
                    <p className="text-lg font-medium text-foreground">{previewError}</p>
                    <Button variant="primary" size="lg" className="mt-4" onClick={handleDownload}>
                      Télécharger à la place
                    </Button>
                  </div>
                ) : null}

                {isEmail && emailPreview && !isPreviewLoading && !previewError ? (
                  <div className="w-full max-w-5xl space-y-4 self-start">
                    <div className="rounded-lg border border-border bg-surface p-4 text-sm">
                      <p className="text-base font-semibold text-foreground">{emailPreview.subject}</p>
                      <dl className="mt-3 space-y-1 text-xs">
                        {emailPreview.from ? (
                          <div className="flex flex-wrap gap-2">
                            <dt className="text-muted-foreground">De :</dt>
                            <dd className="break-all text-foreground-secondary">{emailPreview.from}</dd>
                          </div>
                        ) : null}
                        {emailPreview.to ? (
                          <div className="flex flex-wrap gap-2">
                            <dt className="text-muted-foreground">À :</dt>
                            <dd className="break-all text-foreground-secondary">{emailPreview.to}</dd>
                          </div>
                        ) : null}
                        {emailPreview.date ? (
                          <div className="flex flex-wrap gap-2">
                            <dt className="text-muted-foreground">Date :</dt>
                            <dd className="text-foreground-secondary">{emailPreview.date}</dd>
                          </div>
                        ) : null}
                      </dl>
                    </div>

                    {emailPreview.text ? (
                      <div className="rounded-lg border border-border bg-surface p-5 text-sm text-foreground shadow-card">
                        <pre className="whitespace-pre-wrap font-sans leading-relaxed">{emailPreview.text}</pre>
                      </div>
                    ) : emailPreview.html ? (
                      <iframe
                        title={devis.name}
                        className="h-[70vh] w-full rounded-lg border border-border bg-surface shadow-card"
                        sandbox=""
                        referrerPolicy="no-referrer"
                        srcDoc={buildEmailHtmlDocument(emailPreview.html)}
                        onLoad={handleLoad}
                      />
                    ) : (
                      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted-foreground">
                        Aucun contenu d’email à afficher.
                      </div>
                    )}

                    {emailPreview.attachments.length > 0 ? (
                      <div className="rounded-lg border border-border bg-surface p-4 text-sm">
                        <p className="text-sm font-semibold text-foreground">
                          Pièces jointes ({emailPreview.attachments.length})
                        </p>
                        <ul className="mt-3 space-y-2">
                          {emailPreview.attachments.map((attachment) => (
                            <li
                              key={attachment.id}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm text-foreground">{attachment.filename}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {attachment.mimeType}
                                  {attachment.size > 0 ? ` · ${formatAttachmentSize(attachment.size)}` : ""}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  aria-pressed={activeAttachmentId === attachment.id}
                                  onClick={() => {
                                    if (!isAttachmentPreviewable(attachment) || !attachment.content) return;
                                    setActiveAttachmentId((current) =>
                                      current === attachment.id ? null : attachment.id
                                    );
                                  }}
                                  disabled={!attachment.content || !isAttachmentPreviewable(attachment)}
                                >
                                  Aperçu
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleAttachmentDownload(attachment)}
                                  disabled={!attachment.content}
                                >
                                  Télécharger
                                </Button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {activeAttachment && activeAttachmentUrl && isAttachmentPreviewable(activeAttachment) ? (
                      <div className="rounded-lg border border-border bg-surface p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-foreground">Aperçu de la pièce jointe</p>
                          <Button variant="ghost" size="sm" onClick={() => setActiveAttachmentId(null)}>
                            Fermer
                          </Button>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{activeAttachment.filename}</p>
                        <div className="mt-3 rounded-lg bg-surface">
                          {activeAttachment.mimeType.startsWith("image/") ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={activeAttachmentUrl}
                              alt={activeAttachment.filename}
                              className="max-h-[70vh] w-full object-contain"
                            />
                          ) : (
                            <iframe
                              src={`${activeAttachmentUrl}#toolbar=1&navpanes=0`}
                              title={activeAttachment.filename}
                              className="h-[70vh] w-full rounded-lg bg-surface"
                            />
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {isImage && devis.downloadUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={devis.downloadUrl}
                    alt={devis.name}
                    className={cn(
                      "max-h-full max-w-full object-contain",
                      (isPreviewLoading || previewError) && "hidden"
                    )}
                    onLoad={handleLoad}
                    onError={handleError}
                  />
                ) : null}

                {isPdf && devis.downloadUrl ? (
                  <iframe
                    src={`${devis.downloadUrl}#toolbar=1&navpanes=0`}
                    title={devis.name}
                    className={cn(
                      "h-full w-full rounded-lg bg-surface",
                      (isPreviewLoading || previewError) && "hidden"
                    )}
                    onLoad={handleLoad}
                    onError={handleError}
                  />
                ) : null}
              </>
            )}
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

export { isPreviewableType };
