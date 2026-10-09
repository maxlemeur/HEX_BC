import type {
  EstimateVersionEvent,
  EstimateVersionEventType,
} from "@/lib/estimates/client";
import { CircleXIcon } from "lucide-react";

type EstimateEventsTimelineProps = {
  events: EstimateVersionEvent[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
};

const EVENT_LABELS: Record<string, string> = {
  sent: "Envoyé",
  accepted: "Accepte",
  archived: "Archive",
  rejected: "Rejete",
  seal_verified: "Sceau vérifié",
  approval_submitted: "Soumission d'approbation",
  approval_rules_evaluated: "Règles d'approbation evaluees",
  approval_status_changed: "Statut d'approbation modifie",
  approval_decided: "Décision d'approbation",
};

function toEventLabel(value: string) {
  if (value in EVENT_LABELS) {
    return EVENT_LABELS[value as EstimateVersionEventType];
  }

  return value;
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString("fr-FR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function normalizeMetadataKey(key: string) {
  return key.replace(/_/g, " ");
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "oui" : "non";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "-";
  if (typeof value === "string") return value.trim().length > 0 ? value : "-";

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((entry) => formatMetadataValue(entry))
      .filter((entry) => entry !== "-")
      .join(", ");
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "-";
  }
}

function formatMetadata(metadata: Record<string, unknown>) {
  const entries = Object.entries(metadata).filter(
    ([, value]) => value !== null && value !== undefined
  );

  if (entries.length === 0) {
    return "-";
  }

  return entries
    .map(([key, value]) => `${normalizeMetadataKey(key)}: ${formatMetadataValue(value)}`)
    .join(" | ");
}

export function EstimateEventsTimeline({
  events,
  isLoading,
  error,
  onRefresh,
}: EstimateEventsTimelineProps) {
  return (
    <div className="dashboard-card p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            Timeline statut
          </h2>
          <p className="text-xs text-muted-foreground">
            Historique append-only des transitions et vérifications.
          </p>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
        >
          {isLoading ? "Chargement..." : "Actualiser"}
        </button>
      </div>

      {error ? (
        <div className="alert alert-error mt-6">
          <CircleXIcon aria-hidden="true" size={20} />
          {error}
        </div>
      ) : null}

      <div className="table-scroll mt-6">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Auteur</th>
              <th>Metadonnees</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <div className="text-sm text-muted-foreground">
                    {isLoading
                      ? "Chargement de la timeline..."
                      : "Aucun événement pour cette version."}
                  </div>
                </td>
              </tr>
            ) : (
              events.map((event) => (
                <tr key={event.id}>
                  <td>{formatTimestamp(event.occurredAt)}</td>
                  <td className="font-medium">{toEventLabel(event.eventType)}</td>
                  <td>{event.actorName ?? event.createdBy ?? "-"}</td>
                  <td className="text-xs text-slate-600">
                    {formatMetadata(event.metadata)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isLoading && events.length > 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Actualisation de la timeline en cours...
        </p>
      ) : null}
    </div>
  );
}
