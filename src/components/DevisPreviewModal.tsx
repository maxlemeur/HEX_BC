"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

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

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--slate-200)] border-t-[var(--brand-orange)]" />
      <p className="text-sm text-[var(--slate-500)]">Chargement...</p>
    </div>
  );
}

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

export function DevisPreviewModal({ open, onClose, devis }: DevisPreviewModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emailPreview, setEmailPreview] = useState<EmailPreview | null>(null);
  const [activeAttachmentId, setActiveAttachmentId] = useState<string | null>(null);
  const [activeAttachmentUrl, setActiveAttachmentUrl] = useState<string | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (open) {
      setLoading(true);
      setError(null);
      setEmailPreview(null);
      setActiveAttachmentId(null);
      setActiveAttachmentUrl(null);
    }
  }, [open, devis?.id]);

  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const mimeType = devis?.mimeType ?? "";
  const originalFilename = devis?.originalFilename ?? "";
  const downloadUrl = devis?.downloadUrl ?? null;
  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";
  const normalizedFilename = originalFilename.toLowerCase();
  const isEmail = mimeType === "message/rfc822" || normalizedFilename.endsWith(".eml");
  const canPreview = isPreviewableType(mimeType, originalFilename) && Boolean(downloadUrl);

  useEffect(() => {
    if (!open || !isEmail || !downloadUrl) return;

    let isActive = true;
    setLoading(true);
    setError(null);
    setEmailPreview(null);

    const loadEmail = async () => {
      try {
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          throw new Error("fetch failed");
        }
        const buffer = await response.arrayBuffer();
        const { default: PostalMime } = await import("postal-mime");
        const parser = new PostalMime();
        const parsed = (await parser.parse(buffer)) as {
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

        if (!isActive) return;

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

        setEmailPreview({
          subject: parsed.subject?.trim() || "(Sans objet)",
          from: formatAddressList(parsed.from),
          to: formatAddressList(parsed.to),
          date: formatEmailDate(parsed.date ?? undefined),
          text: parsed.text?.trim() || "",
          html: parsed.html?.trim() || "",
          attachments,
        });
        setLoading(false);
      } catch {
        if (!isActive) return;
        setError("Impossible de lire l'email.");
        setLoading(false);
      }
    };

    loadEmail();

    return () => {
      isActive = false;
    };
  }, [open, isEmail, downloadUrl]);

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

  useEffect(() => {
    if (!activeAttachment || !activeAttachment.content) {
      setActiveAttachmentUrl(null);
      return undefined;
    }

    const previewBlob = new Blob([toArrayBuffer(activeAttachment.content)], {
      type: activeAttachment.mimeType || "application/octet-stream",
    });
    const objectUrl = URL.createObjectURL(previewBlob);
    setActiveAttachmentUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [activeAttachment]);

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

  if (!open || !devis || !portalTarget) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col" role="dialog" aria-modal="true" aria-labelledby="devis-preview-title">
      <div
        className="absolute inset-0 bg-slate-900/80"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      />

      <div className="relative z-10 flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-white/10 bg-slate-900 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="devis-preview-title" className="truncate text-lg font-semibold text-white">
              {devis.name}
            </h2>
            <p className="text-sm text-slate-400">
              {devis.originalFilename}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/20"
              type="button"
              onClick={handleDownload}
              disabled={!devis.downloadUrl}
            >
              <DownloadIcon className="h-4 w-4" />
              Telecharger
            </button>
            <button
              className="flex items-center justify-center rounded-lg bg-white/10 p-2 text-white transition hover:bg-white/20"
              type="button"
              onClick={onClose}
              aria-label="Fermer"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex flex-1 items-center justify-center overflow-auto bg-slate-800 p-4">
          {!canPreview ? (
            <div className="text-center">
              <p className="text-lg font-medium text-white">
                Apercu non disponible
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Ce type de fichier ({devis.mimeType}) ne peut pas etre previsualise.
              </p>
              <button
                className="btn btn-primary mt-4"
                type="button"
                onClick={handleDownload}
                disabled={!devis.downloadUrl}
              >
                <DownloadIcon className="h-4 w-4" />
                Telecharger le fichier
              </button>
            </div>
          ) : (
            <>
              {loading && <LoadingSpinner />}

              {error && (
                <div className="text-center">
                  <p className="text-lg font-medium text-white">{error}</p>
                  <button
                    className="btn btn-primary mt-4"
                    type="button"
                    onClick={handleDownload}
                  >
                    Telecharger a la place
                  </button>
                </div>
              )}

              {isEmail && emailPreview && !loading && !error && (
                <div className="w-full max-w-5xl space-y-4">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                    <div className="text-base font-semibold text-white">
                      {emailPreview.subject}
                    </div>
                    <div className="mt-3 space-y-1 text-xs text-slate-300">
                      {emailPreview.from && (
                        <div className="flex flex-wrap gap-2">
                          <span className="text-slate-400">De :</span>
                          <span className="break-all text-slate-100">{emailPreview.from}</span>
                        </div>
                      )}
                      {emailPreview.to && (
                        <div className="flex flex-wrap gap-2">
                          <span className="text-slate-400">A :</span>
                          <span className="break-all text-slate-100">{emailPreview.to}</span>
                        </div>
                      )}
                      {emailPreview.date && (
                        <div className="flex flex-wrap gap-2">
                          <span className="text-slate-400">Date :</span>
                          <span className="text-slate-100">{emailPreview.date}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {emailPreview.text ? (
                    <div className="rounded-xl bg-white p-5 text-sm text-slate-900 shadow-lg">
                      <pre className="whitespace-pre-wrap leading-relaxed">
                        {emailPreview.text}
                      </pre>
                    </div>
                  ) : emailPreview.html ? (
                    <iframe
                      title={devis.name}
                      className="h-[70vh] w-full rounded-xl bg-white shadow-lg"
                      sandbox=""
                      referrerPolicy="no-referrer"
                      srcDoc={buildEmailHtmlDocument(emailPreview.html)}
                      onLoad={handleLoad}
                    />
                  ) : (
                    <div className="rounded-xl bg-white/5 p-6 text-center text-sm text-slate-200">
                      Aucun contenu d&apos;email a afficher.
                    </div>
                  )}

                  {emailPreview.attachments.length > 0 && (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                      <div className="text-sm font-semibold text-white">
                        Pieces jointes ({emailPreview.attachments.length})
                      </div>
                      <div className="mt-3 space-y-2">
                        {emailPreview.attachments.map((attachment) => (
                          <div
                            key={attachment.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm text-white">
                                {attachment.filename}
                              </div>
                              <div className="mt-0.5 text-xs text-slate-400">
                                {attachment.mimeType}
                                {attachment.size > 0 ? ` · ${formatAttachmentSize(attachment.size)}` : ""}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20 disabled:opacity-50"
                                type="button"
                                onClick={() => {
                                  if (!isAttachmentPreviewable(attachment) || !attachment.content) return;
                                  setActiveAttachmentId((current) =>
                                    current === attachment.id ? null : attachment.id
                                  );
                                }}
                                disabled={!attachment.content || !isAttachmentPreviewable(attachment)}
                              >
                                Apercu
                              </button>
                              <button
                                className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20 disabled:opacity-50"
                                type="button"
                                onClick={() => handleAttachmentDownload(attachment)}
                                disabled={!attachment.content}
                              >
                                Telecharger
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeAttachment && activeAttachmentUrl && isAttachmentPreviewable(activeAttachment) && (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-white">
                          Apercu de la piece jointe
                        </div>
                        <button
                          className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20"
                          type="button"
                          onClick={() => setActiveAttachmentId(null)}
                        >
                          Fermer
                        </button>
                      </div>
                        <p className="mt-1 text-xs text-slate-400">
                          {activeAttachment.filename}
                        </p>
                        <div className="mt-3 rounded-lg bg-white">
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
                            className="h-[70vh] w-full rounded-lg bg-white"
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {isImage && devis.downloadUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={devis.downloadUrl}
                  alt={devis.name}
                  className={`max-h-full max-w-full object-contain ${loading || error ? "hidden" : ""}`}
                  onLoad={handleLoad}
                  onError={handleError}
                />
              )}

              {isPdf && devis.downloadUrl && (
                <iframe
                  src={`${devis.downloadUrl}#toolbar=1&navpanes=0`}
                  title={devis.name}
                  className={`h-full w-full rounded-lg bg-white ${loading || error ? "hidden" : ""}`}
                  onLoad={handleLoad}
                  onError={handleError}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    portalTarget
  );
}

export { isPreviewableType };
