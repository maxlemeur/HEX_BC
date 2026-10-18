import type { V3ConvertedLine } from "@/lib/estimates/client";

const HOURS_FORMAT = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 });
const LISTED_LINES = 5;

/**
 * Sous-lot 2.8b (A6, A7, P-12) : lignes v1/v2 dont les heures changent en entrant dans une v3 par une copie de
 * section, listées comme pour un modèle (`converted_lines`) : heures de la source → heures dérivées de h/u.
 */
export function describeV3ConvertedLines(lines: readonly V3ConvertedLine[] | undefined): string | null {
  if (!lines || lines.length === 0) return null;
  const listed = lines.slice(0, LISTED_LINES).map((line) =>
    `${line.title} : ${HOURS_FORMAT.format(line.templateHours)} h → ${HOURS_FORMAT.format(line.convertedHours)} h`);
  const others = lines.length - listed.length;
  return `Heures converties au moteur de calcul 3 (h / Q au demi supérieur) : ${listed.join(" ; ")}` +
    `${others > 0 ? ` ; et ${others} autre${others > 1 ? "s" : ""}` : ""}.`;
}
