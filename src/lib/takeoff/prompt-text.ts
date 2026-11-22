/**
 * A text of the dossier as a prompt receives it (M1b): on one line (control characters, line breaks and repeated
 * spaces become one space) and at most `max` characters, so that a file name or a label of a DPGF can neither add a
 * line to the prompt nor lengthen it without bound. Empty after cleaning: the fallback.
 */
export function promptLine(value: string | null | undefined, max: number, fallback = ""): string {
  if (!value) return fallback;
  const normalized = Array.from(value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu, " ").trim())
    .slice(0, max)
    .join("")
    .trim();
  return normalized.length > 0 ? normalized : fallback;
}
