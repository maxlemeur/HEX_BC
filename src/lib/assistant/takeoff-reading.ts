/** A takeoff line as its job stores it (the columns the assistant reads). */
export type TakeoffLineSource = {
  id: string; designation: string; quantity: number; unit: string; confidence: number | null; evidence: string | null;
  source_file_name: string | null; source_page: number | null; is_verified: boolean; is_excluded: boolean;
  exclusion_reason: string | null;
};

/** Evidence can hold 2 000 characters a line: enough is kept to judge it, and the cut is flagged. */
const EVIDENCE_CHARACTERS = 600;
/** Well under what one tool result may carry (see the loop), whatever the rest of the result weighs. */
const PAGE_CHARACTERS = 90_000;

/**
 * A page of takeoff lines sized to fit one tool result. A page that would be
 * too large is cut after the last line that fits, never dropped whole, and the
 * result says where to resume so that no line is skipped.
 */
export function takeoffLinesPage(items: TakeoffLineSource[], input: { total: number; offset: number; budget?: number }) {
  const budget = input.budget ?? PAGE_CHARACTERS;
  const lines = [];
  let characters = 0;
  for (const item of items) {
    const evidence = item.evidence;
    const cut = evidence !== null && evidence.length > EVIDENCE_CHARACTERS;
    const line = {
      id: item.id, designation: item.designation, quantite: item.quantity, unite: item.unit, confiance: item.confidence,
      preuve: cut ? `${evidence.slice(0, EVIDENCE_CHARACTERS)}…` : evidence, ...(cut ? { preuve_tronquee: true } : {}),
      fichier_source: item.source_file_name, page_source: item.source_page, verifiee: item.is_verified, exclue: item.is_excluded,
      motif_exclusion: item.exclusion_reason,
    };
    const size = JSON.stringify(line).length + 1;
    if (lines.length > 0 && characters + size > budget) break;
    lines.push(line);
    characters += size;
  }
  const remaining = Math.max(0, input.total - input.offset - lines.length);
  return { lignes: lines, lignes_restantes: remaining, prochain_offset: remaining > 0 ? input.offset + lines.length : null };
}
