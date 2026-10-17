/**
 * Lot 2, sous-lot 2.4 - erreurs nommées du moteur v3 (conception §4, D13).
 *
 * Les codes `ESTIMATE_V3_INPUT_INVALID` et `ESTIMATE_AMOUNT_OVERFLOW` sont partagés avec le jumeau
 * SQL (code dans le message levé, SQLSTATE 22023 et 22003). `ESTIMATE_V3_STORED_INCOHERENT` est
 * propre à la relecture TS d'une v3 figée.
 */

export const ESTIMATE_V3_INPUT_INVALID = "ESTIMATE_V3_INPUT_INVALID";
export const ESTIMATE_AMOUNT_OVERFLOW = "ESTIMATE_AMOUNT_OVERFLOW";
export const ESTIMATE_V3_STORED_INCOHERENT = "ESTIMATE_V3_STORED_INCOHERENT";

export type EstimateV3ErrorCode =
  | typeof ESTIMATE_V3_INPUT_INVALID
  | typeof ESTIMATE_AMOUNT_OVERFLOW
  | typeof ESTIMATE_V3_STORED_INCOHERENT;

const SQLSTATE_BY_CODE: Record<EstimateV3ErrorCode, string> = {
  ESTIMATE_V3_INPUT_INVALID: "22023",
  ESTIMATE_AMOUNT_OVERFLOW: "22003",
  ESTIMATE_V3_STORED_INCOHERENT: "XX000",
};

export class EstimateV3Error extends Error {
  readonly code: EstimateV3ErrorCode;
  /** SQLSTATE du jumeau SQL pour le même refus (parité). */
  readonly sqlstate: string;
  /** Champ ou grandeur en cause (`items[3].quantity`, `total_ttc_cents`…). */
  readonly field: string | null;

  constructor(code: EstimateV3ErrorCode, message: string, field: string | null = null) {
    super(message);
    this.name = "EstimateV3Error";
    this.code = code;
    this.sqlstate = SQLSTATE_BY_CODE[code];
    this.field = field;
  }
}

export function invalidInput(field: string, reason: string): EstimateV3Error {
  return new EstimateV3Error(
    ESTIMATE_V3_INPUT_INVALID,
    `Entrée de calcul v3 invalide (${field}) : ${reason}.`,
    field
  );
}

export function amountOverflow(field: string): EstimateV3Error {
  return new EstimateV3Error(
    ESTIMATE_AMOUNT_OVERFLOW,
    `Montant hors limite (${field}) : plus de 2 147 483 647 centimes, aucun écrêtage.`,
    field
  );
}

export function storedIncoherent(field: string, reason: string): EstimateV3Error {
  return new EstimateV3Error(
    ESTIMATE_V3_STORED_INCOHERENT,
    `Version v3 figée incohérente (${field}) : ${reason}.`,
    field
  );
}
