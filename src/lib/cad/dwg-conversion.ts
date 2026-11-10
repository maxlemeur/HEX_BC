// What the server and the screen share about turning a DWG into a DXF: why a
// conversion did not happen, and how that is said.

export type DwgConversionErrorReason = "empty" | "too_large" | "not_dwg" | "old_format" | "timeout" | "output_too_large" | "busy" | "failed";

export class DwgConversionError extends Error {
  constructor(readonly reason: DwgConversionErrorReason) {
    super(`DWG conversion: ${reason}`);
    this.name = "DwgConversionError";
  }
}

/** « AC1032 » for a DWG of the 2018 format; null for a file that is not a DWG. */
export function dwgFormatCode(bytes: Uint8Array): string | null {
  if (bytes.byteLength < 6) return null;
  const code = String.fromCharCode(...bytes.subarray(0, 6));
  return /^AC(\d{4}|\d\.\d\d)$/.test(code) ? code : null;
}

const CONVERSION_MESSAGES: Record<DwgConversionErrorReason, string> = {
  empty: "Ce fichier est vide.",
  too_large: "Ce DWG dépasse 50 Mo : il n’est pas converti.",
  not_dwg: "Ce fichier porte l’extension DWG mais n’en a pas le contenu.",
  old_format: "Ce DWG est enregistré dans un format antérieur à AutoCAD R13, que MergeOne ne convertit pas. Enregistrez-le au format DWG 2000 ou plus récent, ou en DXF, puis déposez-le à nouveau.",
  timeout: "La conversion de ce DWG prend trop de temps. Déposez ce plan en DXF pour le visualiser.",
  output_too_large: "Une fois converti, le dessin de ce DWG dépasse 50 Mo : il n’est pas affiché.",
  busy: "Le serveur convertit déjà plusieurs DWG. Réessayez dans un instant.",
  failed: "Ce DWG n’a pas pu être converti. Déposez ce plan en DXF pour le visualiser.",
};

export function dwgConversionMessage(reason: DwgConversionErrorReason): string {
  return CONVERSION_MESSAGES[reason];
}
