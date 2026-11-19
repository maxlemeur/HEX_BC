"use client";

import { useEffect, useState } from "react";
import { ScanText } from "lucide-react";

import { affaireIntakeFileUrl } from "@/lib/affaires/intake";
import {
  INTAKE_TRANSCRIPTION_MAX_PAGES,
  intakeTranscriptionFailureMessage,
  type IntakeTranscription,
} from "@/lib/affaires/intake-transcription";
import { plural } from "@/lib/text/plural";

const POLL_MS = 4_000;
/** About ten minutes: an analysis that runs longer is shown at the next opening. */
const POLLS = 150;

/** A passage the model could not read, shown as such. */
function TranscribedText({ text }: { text: string }) {
  const parts = text.split(/(\[illisible\])/gi);
  return (
    <pre className="document-transcription-text">
      {parts.map((part, index) =>
        /^\[illisible\]$/i.test(part) ? (
          <mark key={index} className="document-transcription-illegible">{part}</mark>
        ) : (
          part
        ),
      )}
    </pre>
  );
}

/**
 * The text read automatically in an image or in the scanned pages of a PDF when
 * it arrived. It is never verified: it is a reading aid, and the piece above
 * stays the source. Nothing is shown for a piece that has no reading.
 */
export function IntakeDocumentTranscription({
  projectId,
  documentId,
  refreshKey,
}: {
  projectId: string;
  documentId: string;
  /** Read again when the piece's analysis changes (the reading follows it). */
  refreshKey: string;
}) {
  const [transcription, setTranscription] = useState<IntakeTranscription | null>(null);
  const [pending, setPending] = useState(false);
  const endpoint = affaireIntakeFileUrl(projectId, documentId, "transcription");
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const read = () => void fetch(endpoint, { cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as { data?: { transcription?: IntakeTranscription | null; pending?: boolean } };
        if (abort.signal.aborted) return;
        setTranscription(payload.data?.transcription ?? null);
        const waiting = payload.data?.pending === true && polls < POLLS;
        setPending(waiting);
        // The reading follows the piece's analysis (its lot, or a retry): asked again until it ends.
        if (waiting) {
          polls += 1;
          timer = setTimeout(read, POLL_MS);
        }
      })
      // A reading aid that cannot be read leaves the preview as it is.
      .catch(() => undefined);
    read();
    return () => {
      abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [endpoint, refreshKey]);

  if (pending) {
    return (
      <p className="document-transcription document-transcription-pending" role="status" data-testid="document-transcription-pending">
        <ScanText size={14} aria-hidden="true" />
        Analyse de la pièce en cours : une transcription automatique peut suivre.
      </p>
    );
  }
  if (!transcription) return null;
  const read = transcription.pages;
  const illegible = read.reduce((total, page) => total + page.illegible, 0);
  const unread = transcription.pagesNeeded - read.length;
  const failure = intakeTranscriptionFailureMessage(transcription.errorCode);
  const multiPage = transcription.pagesNeeded > 1 || read.some((page) => page.page > 1);
  return (
    <details className="document-transcription" data-testid="document-transcription" data-status={transcription.status}>
      <summary>
        <ScanText size={14} aria-hidden="true" />
        <span>Transcription automatique</span>
        <span className="document-transcription-badge">Non vérifiée</span>
      </summary>
      <div className="document-transcription-body">
        <p className="document-transcription-note">
          Texte lu par l’IA à l’arrivée de la pièce. Vérifiez toute quantité ou tout prix sur le document avant de
          l’utiliser.
          {illegible > 0 && ` ${plural(illegible, "passage")} non lu${illegible > 1 ? "s" : ""} avec certitude.`}
        </p>
        {(unread > 0 || failure) && (
          <p className="document-transcription-warning" role="status">
            {unread > 0 && `${plural(unread, "page")} non lue${unread > 1 ? "s" : ""}. `}
            {failure}
            {transcription.pagesSkipped > 0 && ` Au plus ${INTAKE_TRANSCRIPTION_MAX_PAGES} pages scannées sont lues par pièce.`}
          </p>
        )}
        {read.map((page) => (
          <section key={page.page} aria-label={multiPage ? `Page ${page.page}` : "Texte lu"}>
            {multiPage && <h3>Page {page.page}</h3>}
            {page.text ? (
              <TranscribedText text={page.text} />
            ) : (
              <p className="document-transcription-note">Aucun texte sur cette page.</p>
            )}
          </section>
        ))}
      </div>
    </details>
  );
}
