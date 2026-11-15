/**
 * Filename-safe form of a document title: spaces become underscores, characters
 * that Windows or macOS refuse become dashes, and repeated or edge separators go.
 */
export function sanitizeDownloadFilename(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/_{2,}/g, "_")
    .replace(/-+/g, "-")
    .replace(/^[_-]+|[_-]+$/g, "");
}

/** `YYYY-MM-DD` (UTC) of a date string for a filename, or "" when it does not parse. */
export function formatFilenameDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().split("T")[0];
}
