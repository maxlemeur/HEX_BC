import type { Json } from "@/types/database";
import type { ZodIssue } from "zod";
import type { PurchaseOrderLineInput } from "@/lib/purchase-orders/schemas";

export function purchaseOrderInputError(issues: readonly ZodIssue[]): string {
  const issue = issues[0];
  if (!issue) return "Vérifiez les données de la commande.";
  const fields: Record<string, string> = {
    quantity: "Quantité positive attendue, au plus trois décimales et 2 147 483 647.",
    unitPriceCents: "Prix HT attendu en centimes entiers, entre 0 et 2 147 483 647.",
    taxRateBp: "Taux de TVA invalide (entre 0 et 100 %).",
    unit: "L'unité est requise pour cette ligne.",
    designation: "La désignation est requise.",
    id: "Identifiant de ligne invalide.", productId: "Identifiant de produit invalide.",
    reference: "Référence invalide.", supplierId: "Sélectionnez un fournisseur valide.",
    deliverySiteId: "Sélectionnez un chantier valide.",
    expectedDeliveryDate: "Date de livraison invalide (YYYY-MM-DD ou TBD attendu).",
    expectedRevision: "Révision de commande absente ou invalide. Rechargez la commande.",
    notes: "Les instructions doivent être du texte.", items: "La commande doit contenir de 1 à 1 000 lignes valides.",
  };
  const field = String(issue.path.at(-1) ?? "");
  const message = issue.code === "unrecognized_keys" ? "Champ inconnu ou non modifiable." :
    fields[field] ?? "Vérifiez les données de la commande.";
  return issue.path[0] === "items" && typeof issue.path[1] === "number"
    ? `Ligne ${issue.path[1] + 1} : ${message}` : message;
}

export function toPurchaseOrderLinePayload(item: PurchaseOrderLineInput): Json {
  return {
    ...(item.id !== undefined ? { id: item.id } : {}),
    ...(item.productId !== undefined ? { product_id: item.productId } : {}),
    ...(item.reference !== undefined ? { reference: item.reference } : {}),
    ...(item.unit !== undefined ? { unit: item.unit } : {}),
    designation: item.designation,
    quantity: item.quantity,
    unit_price_ht_cents: item.unitPriceCents,
    tax_rate_bp: item.taxRateBp,
  };
}

const errors: Record<string, { status: 400 | 403 | 404 | 409 | 500; message: string }> = {
  PURCHASE_ORDER_DRAFT_NOT_EDITABLE: { status: 403, message: "Seuls les bons de commande en brouillon peuvent être modifiés." },
  PURCHASE_ORDER_AUTH_REQUIRED: { status: 403, message: "Authentification requise." },
  PURCHASE_ORDER_ACCESS_DENIED: { status: 403, message: "Vous n'avez pas accès à cette commande." },
  PURCHASE_ORDER_NOT_FOUND: { status: 404, message: "Bon de commande introuvable." },
  PURCHASE_ORDER_REVISION_CONFLICT: { status: 409, message: "Cette commande a été modifiée. Rechargez-la avant de réappliquer vos changements." },
  PURCHASE_ORDER_REVISION_REQUIRED: { status: 409, message: "Rechargez la commande avant de la modifier." },
  PURCHASE_ORDER_QUANTITY_INVALID: { status: 400, message: "La quantité doit être positive et comporter au plus trois décimales." },
  PURCHASE_ORDER_AMOUNT_OUT_OF_RANGE: { status: 400, message: "Le montant dépasse la capacité d'une commande." },
  PURCHASE_ORDER_UNIT_REQUIRED: { status: 400, message: "Confirmez l'unité de chaque ligne créée ou corrigée." },
  PURCHASE_ORDER_SOURCE_SUPPLIER_IMMUTABLE: { status: 400, message: "Le fournisseur provient du devis validé. Préparez un nouvel arbitrage fournisseur avant de changer cette commande." },
  PURCHASE_ORDER_SOURCE_UNIT_IMMUTABLE: { status: 400, message: "L'unité d'une ligne issue du devis ne peut pas être modifiée." },
  PURCHASE_ORDER_ITEMS_INVALID: { status: 400, message: "Les lignes de la commande sont invalides. Rechargez la commande et vérifiez les saisies." },
  PURCHASE_ORDER_HEADER_INVALID: { status: 400, message: "Vérifiez le fournisseur, le chantier et la date de livraison." },
  PURCHASE_ORDER_INPUT_INVALID: { status: 400, message: "Vérifiez les données de la commande." },
  PURCHASE_ORDER_EXPORT_TOO_LARGE: { status: 400, message: "L'export dépasse 10 000 lignes. Réduisez la sélection de commandes." },
};

export function purchaseOrderWriteError(error: { message: string }) {
  // Only named domain errors may cross this boundary. SQL diagnostics can
  // contain records or infrastructure information belonging to other users.
  const code = Object.keys(errors).find((candidate) => error.message === candidate);
  return code ? { ...errors[code], code } : {
    status: 500 as const, message: "Impossible d'enregistrer la commande.", code: "PURCHASE_ORDER_WRITE_FAILED",
  };
}
