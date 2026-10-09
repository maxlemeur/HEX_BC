import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  EstimateVersionEvent,
  EstimateVersionEventType,
} from "@/lib/estimates/client";

type EstimateEventsTimelineProps = {
  events: EstimateVersionEvent[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
};

const EVENT_LABELS: Record<string, string> = {
  sent: "Envoyé",
  accepted: "Accepté",
  archived: "Archivé",
  rejected: "Rejeté",
  seal_verified: "Sceau vérifié",
  approval_submitted: "Soumission d’approbation",
  approval_rules_evaluated: "Règles d’approbation évaluées",
  approval_status_changed: "Statut d’approbation modifié",
  approval_decided: "Décision d’approbation",
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
    <Card className="p-5 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Historique des statuts
          </h2>
          <p className="text-xs text-muted-foreground">
            Journal non modifiable des transitions et vérifications.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={onRefresh}
          disabled={isLoading}
        >
          {isLoading ? "Chargement…" : "Actualiser"}
        </Button>
      </div>

      {error ? (
        <Alert variant="danger" className="mt-6">
          {error}
        </Alert>
      ) : null}

      <div
        className="table-scroll mt-6"
        role="region"
        aria-label="Historique des statuts de la version"
        tabIndex={0}
      >
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Type</th>
              <th scope="col">Auteur</th>
              <th scope="col">Métadonnées</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <div className="text-sm text-muted-foreground">
                    {isLoading
                      ? "Chargement de l’historique…"
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
                  <td className="text-xs text-muted-foreground">
                    {formatMetadata(event.metadata)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isLoading && events.length > 0 ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          Actualisation de l’historique en cours…
        </p>
      ) : null}
    </Card>
  );
}
