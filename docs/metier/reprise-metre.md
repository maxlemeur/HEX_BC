# Reprise d'une analyse de métré arrêtée

Une seule règle décide de ce qu'un membre peut faire d'une analyse arrêtée
(échouée ou annulée) : la soumettre à nouveau, attendre la reprise déjà
programmée ou la fin du délai, préparer une nouvelle analyse, ou rien. La liste
des analyses de l'affaire, le détail d'une analyse et la commande « Soumettre à
nouveau » l'appliquent tous les trois et donnent la même décision avec le même
motif. La règle est dans
[`operator-state.ts`](../../src/lib/takeoff/operator-state.ts) ; les droits du
membre sur l'affaire et le Mac de la requête sont lus une fois par requête dans
[`resume-viewer-server.ts`](../../src/lib/takeoff/resume-viewer-server.ts).

## Entrées

- Le rôle du membre (ingénieur ou administrateur pour agir) et son droit
  d'écrire l'affaire (son propriétaire, ou un administrateur ; une affaire
  archivée n'est écrite par personne).
- Le statut du job, sa fin enregistrée (`analysis_outcome`), sa reprise
  programmée (`next_retry_at`) et la date de son échec.
- Le fournisseur et le Mac du job, comparés au Mac de la requête.
- Le nombre de relances (trois au plus) et le code de diagnostic, pour le
  budget de l'analyse détaillée épuisé et le résultat inconnu.
- La personne qui a lancé le job.

## Décision

La première ligne qui s'applique décide. Les faits du job passent avant les
droits du membre : un lecteur apprend pourquoi personne ne peut reprendre le
job, et tout le monde attend une reprise programmée. « Nouvelle analyse » vaut
pour un ingénieur ou un administrateur qui peut écrire l'affaire ; un autre
membre lit le même motif sans action.

| Situation | Décision | Motif |
| --- | --- | --- |
| En file, en cours, terminée ou appliquée | rien à reprendre | `not_stopped` |
| Ancien fournisseur ou ancien lot (batch) | nouvelle analyse | `legacy_provider` |
| Trois relances utilisées | nouvelle analyse | `retry_limit` |
| Fin enregistrée (échec, annulation) | nouvelle analyse | `analysis_closed` |
| Fin enregistrée sur un résultat inconnu | nouvelle analyse | `outcome_unknown` |
| Reprise automatique programmée, même en retard | attendre son échéance | `retry_scheduled` |
| Budget de l'analyse détaillée épuisé | nouvelle analyse en restreignant les sources | `budget_exhausted` |
| Lecteur, directeur, ou sans droit d'écrire l'affaire | rien | `read_only` |
| Lancée par un autre membre (ou par un compte disparu) | nouvelle analyse sur son propre forfait | `launched_by_other` |
| Serveur sans métré local (version hébergée, autre adresse) | rien ici | `execution_unavailable` |
| Lancée depuis un autre Mac | rien ici | `other_mac` |
| Échec de moins de 5, 15 puis 45 s | attendre la fin du délai | `retry_delay` |
| Résultat de la tentative interrompue inconnu, sans fin enregistrée | soumettre à nouveau | `outcome_unknown` |
| Sinon | soumettre à nouveau | `retry_available` |

Une fin enregistrée est définitive pour son job : une relance après elle est une
nouvelle analyse, avec son propre demandeur. Un job terminé avant l'activation
des avis de fin n'a pas de fin enregistrée et garde la relance qu'il avait, sous
les mêmes conditions. Les vieilles lignes (sans diagnostic, sans date de fin,
avec un code inconnu) suivent la même table.

## Écrans et réponses

La liste renvoie pour chaque ligne la décision (`resume`), le code de
diagnostic (`errorCode`) et l'échéance de la reprise programmée ; le détail
renvoie la même décision sur le job (`resume`, `can_resubmit`). L'écran traduit
le motif et le diagnostic en français et n'affiche jamais un code : une analyse
sans diagnostic dit « Échec sans code disponible », un code inconnu donne un
motif général. La liste décide de ce qu'elle a lu, sans lire le détail d'aucune
analyse ; à la fin d'une attente qu'elle a annoncée, elle se relit une fois.

Les motifs d'échec ne proposent jamais un autre niveau d'analyse : la nouvelle
analyse reste détaillée, avec moins de sources ou un fichier corrigé.

## Commande

Au clic, le serveur relit le rôle, le droit d'écrire l'affaire, l'état, la fin
enregistrée, la reprise programmée, le délai et le Mac, puis applique la même
règle. Un refus porte la décision dans `error.details.resume` : 403 pour un
membre qui ne peut pas agir ou qui n'a pas lancé l'analyse, 422 pour un ancien
fournisseur, un serveur sans métré local ou un autre Mac, 409 sinon. Le forfait ChatGPT, le modèle et le Mac
de la personne qui a lancé l'analyse sont vérifiés ensuite ; la liste ne les lit
pas et l'écran dit qu'ils sont vérifiés au lancement. L'écriture est
conditionnelle (même statut, même nombre de relances, pas de fin ni de reprise
programmée) : une relance concurrente ou une fin écrite entre la lecture et le
clic laisse le job intact et demande de recharger le suivi.

Les tests unitaires de la table sont dans
[`operator-state.test.ts`](../../src/lib/takeoff/operator-state.test.ts) ; la
cohérence des trois surfaces dans
[`server.jobs.test.ts`](../../src/lib/takeoff/server.jobs.test.ts) et
[`activity-center.test.ts`](../../src/lib/takeoff/activity-center.test.ts) ; le
parcours TKW13 de
[`worker-lifecycle.e2e.ts`](../../e2e/army/takeoff/worker-lifecycle.e2e.ts) les
rejoue dans le navigateur.
