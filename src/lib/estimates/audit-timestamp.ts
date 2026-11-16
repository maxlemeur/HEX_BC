/**
 * Date and time of an estimate audit event (fr-FR, to the second); unparsable
 * input is shown as received. Plain module: the editor's client hooks and the
 * events timeline, which can render on the server, both import it.
 */
export function formatEstimateEditorAuditTimestamp(value: string) {
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
