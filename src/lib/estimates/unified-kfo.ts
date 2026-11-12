import { decimalFromLiteral, formatScaled, multiply, roundHalfUpToScale } from "@/lib/estimates/engine-v3/decimal";

/** TI-534: a single supply coefficient, before selling margin. */
export const KFO_HELP =
  "Coefficient fourniture. Il intègre les pertes, le transport et l’ajustement lié au volume acheté. Vous pouvez aussi y intégrer d’autres éléments prévus dans votre chiffrage. Il ajuste le coût de fourniture avant marge et ne s’applique pas à la main-d’œuvre.";

/** Read the effective historical coefficient without imposing a writable-column bound. */
export function effectiveKfoValue(kFo: number | null | undefined, provision: number | null | undefined): number {
  const effective = multiply(decimalFromLiteral(String(kFo ?? 1), "K FO", 6),
    decimalFromLiteral(String(provision ?? 1), "provision FO", 3));
  return Number(formatScaled(roundHalfUpToScale(effective, 6), 6));
}
