"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { AffaireIntakeWorkspace as WorkspaceData } from "@/lib/affaires/intake-server";
import { IntakeDropzone } from "./IntakeDropzone";
import { IntakeDocumentCard } from "./IntakeDocumentCard";
import { IntakeMissingPieces } from "./IntakeMissingPieces";

type IntakeWorkspaceProps = {
  projectId: string;
  workspace: WorkspaceData | null;
};

const FILTER_PARAM = "intakeFilter";
const FILTER_A_REVOIR = "a_revoir";
const AUTO_REFRESH_INTERVAL_MS = 4_000;
const AUTO_REFRESH_MAX_MS = 60_000;
const UPLOAD_REFRESH_INTERVAL_MS = 2_000;
const UPLOAD_REFRESH_MAX_ATTEMPTS = 15;

function isDocumentProcessing(doc: WorkspaceData["documents"][number]) {
  return doc.confidence === 0 && doc.detectedCategory === "a_classer" && doc.issues.length === 0;
}

function isDocumentNeedsReview(doc: WorkspaceData["documents"][number]) {
  return (
    (doc.detectedCategory === "a_classer" || doc.confidence < 0.65) &&
    !isDocumentProcessing(doc)
  );
}

export function IntakeWorkspace({ projectId, workspace }: IntakeWorkspaceProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showDropzone, setShowDropzone] = useState(!workspace?.uploadId);
  const [announcement, setAnnouncement] = useState("");
  const [activeFilter, setActiveFilter] = useState<string | null>(
    searchParams.get(FILTER_PARAM)
  );
  const [pendingUploadId, setPendingUploadId] = useState<string | null>(null);

  const isFilterActive = activeFilter === FILTER_A_REVOIR;

  const handleUploadComplete = useCallback((uploadId: string) => {
    setShowDropzone(false);
    setPendingUploadId(uploadId);
    setAnnouncement("Upload termine. Actualisation du workspace...");
    router.refresh();
  }, [router]);

  const handleReclassified = useCallback(() => {
    router.refresh();
  }, [router]);

  // Auto-refresh while documents are still being classified
  const autoRefreshStartRef = useRef<number | null>(null);
  const hasProcessingDocs = workspace?.documents.some(isDocumentProcessing) ?? false;

  useEffect(() => {
    setActiveFilter(searchParams.get(FILTER_PARAM));
  }, [searchParams]);

  useEffect(() => {
    if (!hasProcessingDocs) {
      autoRefreshStartRef.current = null;
      return;
    }

    if (autoRefreshStartRef.current === null) {
      autoRefreshStartRef.current = Date.now();
    }

    const interval = setInterval(() => {
      const elapsed = Date.now() - (autoRefreshStartRef.current ?? Date.now());
      if (elapsed > AUTO_REFRESH_MAX_MS) {
        clearInterval(interval);
        setAnnouncement("La classification prend plus de temps que prevu. Rafraichissez la page manuellement.");
        return;
      }
      router.refresh();
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [hasProcessingDocs, router]);

  useEffect(() => {
    if (!pendingUploadId) {
      return;
    }

    if (workspace?.uploadId === pendingUploadId) {
      setPendingUploadId(null);
      setAnnouncement("");
      return;
    }

    let attempts = 0;
    const interval = setInterval(() => {
      attempts += 1;
      router.refresh();

      if (attempts >= UPLOAD_REFRESH_MAX_ATTEMPTS) {
        clearInterval(interval);
        setPendingUploadId(null);
        setAnnouncement(
          "L'upload est termine mais le workspace n'est pas encore a jour. Rafraichissez la page si necessaire."
        );
      }
    }, UPLOAD_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [pendingUploadId, router, workspace?.uploadId]);

  const documents = workspace?.documents ?? [];
  const filteredDocuments = isFilterActive
    ? documents.filter(isDocumentNeedsReview)
    : documents;
  const needsReviewCount = documents.filter(isDocumentNeedsReview).length;
  const processingCount = documents.filter(isDocumentProcessing).length;
  const hasDocuments = documents.length > 0;

  const toggleFilter = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());

    if (activeFilter === FILTER_A_REVOIR) {
      params.delete(FILTER_PARAM);
      setActiveFilter(null);
    } else {
      params.set(FILTER_PARAM, FILTER_A_REVOIR);
      setActiveFilter(FILTER_A_REVOIR);
    }

    const query = params.toString();
    const nextUrl = query ? `${pathname}?${query}` : pathname;

    window.history.replaceState(window.history.state, "", nextUrl);
  }, [activeFilter, pathname, searchParams]);

  return (
    <section className="dashboard-card p-5 animate-fade-in" aria-label="Intake dossier affaire">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">
            Dossier d&apos;affaire
          </h2>
          {hasDocuments && (
            <p className="mt-0.5 text-xs text-[var(--slate-500)]">
              {documents.length} document{documents.length > 1 ? "s" : ""}
              {processingCount > 0 && ` — ${processingCount} en cours d'analyse`}
              {needsReviewCount > 0 && ` — ${needsReviewCount} a revoir`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* "A revoir" filter toggle */}
          {needsReviewCount > 0 && (
            <button
              type="button"
              onClick={toggleFilter}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                isFilterActive
                  ? "bg-[var(--warning)]/10 text-[var(--warning)] ring-1 ring-[var(--warning)]/30"
                  : "text-[var(--slate-600)] hover:bg-[var(--slate-100)]"
              }`}
              aria-pressed={isFilterActive}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              A revoir ({needsReviewCount})
            </button>
          )}

          {/* Add files button */}
          {hasDocuments && (
            <button
              type="button"
              onClick={() => setShowDropzone((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--brand-blue)] transition-colors hover:bg-[var(--brand-blue)]/5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" x2="12" y1="5" y2="19" />
                <line x1="5" x2="19" y1="12" y2="12" />
              </svg>
              {showDropzone ? "Masquer" : "Ajouter des fichiers"}
            </button>
          )}
        </div>
      </div>

      {/* Dropzone */}
      {(showDropzone || !hasDocuments) && (
        <div className={hasDocuments ? "mb-4" : ""}>
          <IntakeDropzone
            projectId={projectId}
            onUploadComplete={handleUploadComplete}
            compact={hasDocuments}
          />
        </div>
      )}

      {/* Processing banner */}
      {processingCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/5 px-3 py-2 text-sm text-[var(--brand-blue)]">
          <svg className="h-4 w-4 animate-spin shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
          </svg>
          Classification IA en cours pour {processingCount} document{processingCount > 1 ? "s" : ""}...
        </div>
      )}

      {/* Missing pieces */}
      {workspace && workspace.missingPieces.length > 0 && (
        <div className="mb-4">
          <IntakeMissingPieces pieces={workspace.missingPieces} />
        </div>
      )}

      {/* Document list */}
      {filteredDocuments.length > 0 && (
        <div className="space-y-2">
          {filteredDocuments.map((doc) => (
            <IntakeDocumentCard
              key={doc.documentId}
              document={doc}
              projectId={projectId}
              onReclassified={handleReclassified}
            />
          ))}
        </div>
      )}

      {/* Empty filter state */}
      {isFilterActive && filteredDocuments.length === 0 && hasDocuments && (
        <div className="py-6 text-center">
          <p className="text-sm text-[var(--slate-500)]">
            Tous les documents sont correctement classes.
          </p>
          <button
            type="button"
            onClick={toggleFilter}
            className="mt-2 text-xs font-medium text-[var(--brand-blue)] hover:underline"
          >
            Voir tous les documents
          </button>
        </div>
      )}

      {/* Live announcements */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </section>
  );
}
