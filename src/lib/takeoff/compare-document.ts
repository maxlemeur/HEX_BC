// M1b : deux jobs de métré portent sur le même document quand ils partagent sa référence
// durable. Un jeu de plans se reconnaît à son identifiant, jamais au nom de son premier fichier ;
// un fichier téléversé, à son libellé d'origine (NFC, sans casse). Un nom nettoyé pour Storage
// (« Plan R+1.pdf » et « Plan R-1.pdf » y deviennent tous deux « Plan-R-1.pdf ») ne rapproche
// jamais deux jobs. Partagé par la comparaison serveur et la liste des jobs comparables de la revue.
export function takeoffCompareDocumentKey(job: {
  plan_set_id?: string | null;
  source_file_name: string | null;
}): string | null {
  if (job.plan_set_id) return `plan_set:${job.plan_set_id}`;
  const label = job.source_file_name?.normalize("NFC").trim().toLowerCase();
  return label ? `upload:${label}` : null;
}
