export const DEFAULT_TAX_RATE_BP = 2000; // 20%
export const LOW_MARGIN_THRESHOLD_BP = 1000; // 10%

/**
 * Conflit de concurrence optimiste : `estimate_versions.updated_at` a bouge
 * depuis que la page a charge sa copie. L'auteur du changement peut etre un
 * autre utilisateur, mais aussi le meme utilisateur dans un autre onglet ou une
 * reprise de verrou — le libelle ne doit donc designer personne.
 */
export const ESTIMATE_VERSION_CONFLICT_MESSAGE =
  "Version modifiée ailleurs (autre onglet, autre session ou autre utilisateur)";
