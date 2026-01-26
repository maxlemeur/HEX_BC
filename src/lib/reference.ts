/**
 * Génère une référence de bon de commande au format C-AAMM-XXX
 * - C = Commande
 * - AAMM = Année (2 chiffres) + Mois (2 chiffres)
 * - XXX = Numéro séquentiel (3 chiffres minimum)
 *
 * Exemple: C-2601-042 (42ème commande de janvier 2026)
 */
export function buildPurchaseOrderReference(
  orderNumber: number,
  date: Date = new Date()
): string {
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const seq = orderNumber.toString().padStart(3, "0");

  return `C-${year}${month}-${seq}`;
}
