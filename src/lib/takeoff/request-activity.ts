/**
 * The sources (plan copies, dossier pieces) the member may read, by the same rules as their own policies: a plan's or a
 * piece's name and pages are shown only for those; otherwise a neutral « Plan N ». `all`: the member reads every plan
 * file of the affaire (its owner or an administrator).
 */
export type TakeoffVisibleSources = "all" | { planFiles: ReadonlySet<string>; documents: ReadonlySet<string> };

export function isTakeoffSourceVisible(visible: TakeoffVisibleSources, ...ids: Array<string | null | undefined>) {
  if (visible === "all") return true;
  return ids.some((id) => Boolean(id) && (visible.planFiles.has(id!.toLowerCase()) || visible.documents.has(id!.toLowerCase())));
}

/** A list of named pieces with the names the member may not read replaced by « Plan N » (its rank in the list). */
export function maskTakeoffPieces<T extends { id: string; name: string }>(pieces: ReadonlyArray<T>, visible: TakeoffVisibleSources): T[] {
  return pieces.map((piece, index) => isTakeoffSourceVisible(visible, piece.id) ? piece : { ...piece, name: `Plan ${index + 1}` });
}

/** The dossier's changes since a seal, each name shown only to a member who may read its source. */
export function maskTakeoffDossierChange<T extends { added: Array<{ id: string; name: string }>; replaced: Array<{ id: string; name: string }>;
  removed: Array<{ id: string; name: string }> }>(change: T | null, visible: TakeoffVisibleSources): T | null {
  if (!change) return null;
  return { ...change, added: maskTakeoffPieces(change.added, visible), replaced: maskTakeoffPieces(change.replaced, visible),
    removed: maskTakeoffPieces(change.removed, visible) };
}
