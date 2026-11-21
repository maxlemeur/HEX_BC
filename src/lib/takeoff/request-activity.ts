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

/**
 * A list of named pieces where a piece the member may not read is « Plan N » (its rank in the list) with an opaque
 * identifier, `hidden:[list:]N`, the same at each read of the same list: never its source's name or identifier.
 */
export function maskTakeoffPieces<T extends { id: string; name: string }>(pieces: ReadonlyArray<T>, visible: TakeoffVisibleSources,
  list?: string): T[] {
  return pieces.map((piece, index) => isTakeoffSourceVisible(visible, piece.id) ? piece
    : { ...piece, id: `hidden:${list ? `${list}:` : ""}${index + 1}`, name: `Plan ${index + 1}` });
}

/** The dossier's changes since a seal, each name and identifier shown only to a member who may read its source. */
export function maskTakeoffDossierChange<T extends { added: Array<{ id: string; name: string }>; replaced: Array<{ id: string; name: string }>;
  removed: Array<{ id: string; name: string }> }>(change: T | null, visible: TakeoffVisibleSources): T | null {
  if (!change) return null;
  return { ...change, added: maskTakeoffPieces(change.added, visible, "added"),
    replaced: maskTakeoffPieces(change.replaced, visible, "replaced"), removed: maskTakeoffPieces(change.removed, visible, "removed") };
}
