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
- La personne qui a lancé le job, et sa connexion ChatGPT sur ce Mac (connectée, avec
  un modèle choisi), lue une fois par requête : une relance du même job utilise son
  forfait.

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
| Forfait ChatGPT déconnecté ou expiré | le reconnecter dans Mon profil | `plan_disconnected` |
| Aucun modèle ChatGPT choisi | en choisir un dans Mon profil | `plan_model_missing` |
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

Partout où une analyse arrêtée est montrée (ligne et bandeau de l'activité, fiche de
l'affaire, notifications), l'échec dit seulement ce qui s'est passé ; la décision seule
dit quoi faire, là où elle est connue. La carte de reprise de la fiche suit la décision
de la dernière analyse et nomme son lien d'après elle ; la vue d'ensemble de l'affaire,
qui ne la connaît pas, ne donne pas de consigne et renvoie au suivi du métré. Les états
du lot de l'ancien fournisseur ne s'affichent plus à côté d'une analyse arrêtée. Le bandeau suit la décision de la dernière
analyse : il ne propose un nouveau métré que si elle le propose, et rien à un membre
qui ne peut pas agir. Un démarrage différé (« Reprise automatique ») n'est annoncé
que pour une analyse en file, en cours ou dont la reprise est programmée. La liste
n'est plus relue à intervalle : la page suit une projection légère des demandes et
des analyses en cours (section « Suivi d'une demande dans le centre d'activité » de
[`preparation-metre.md`](preparation-metre.md)), relue toutes les 30 secondes tant
qu'une reprise programmée est attendue, et la liste est relue dès que celle-ci
signale la transition ; la fin d'un délai est relue une fois à son échéance. Une
réponse sans décision (serveur d'une version antérieure) n'offre aucune action et
demande de recharger la page.

Les motifs d'échec ne proposent jamais un autre niveau d'analyse : la nouvelle
analyse reste détaillée, avec moins de sources ou un fichier corrigé. Les lignes
d'une page sont comptées par une seule requête groupée.

## Commande

Au clic, le serveur relit le rôle, le droit d'écrire l'affaire, l'état, la fin
enregistrée, la reprise programmée, le délai et le Mac, puis applique la même
règle. Un refus porte la décision dans `error.details.resume` : 403 pour un
membre qui ne peut pas agir ou qui n'a pas lancé l'analyse, 422 pour un ancien
fournisseur, un serveur sans métré local, un autre Mac ou un forfait ChatGPT à
reconnecter ou sans modèle, 409 sinon. Tout refus porte la décision en vigueur, que
la ligne adopte avant que la liste soit relue ; elle est calculée sur une lecture
faite après la cause du refus (le job, les droits du membre et sa connexion). Le forfait ChatGPT, le modèle et le Mac
de la personne qui a lancé l'analyse sont vérifiés ensuite au lancement. Le droit
d'écrire l'affaire est relu juste avant l'écriture, que la base protège par la même
règle de rôle et de propriété ; l'annulation applique la même relecture. L'écriture est
conditionnelle (même statut, même nombre de relances, même personne qui l'a lancée,
pas de fin ni de reprise programmée) : une relance concurrente ou une fin écrite
entre la lecture et le clic laisse le job intact et répond avec la décision en
vigueur. La règle « seule la personne qui a lancé l'analyse la relance » est
appliquée ici par l'application ; la base l'appliquera aussi avec la correction des
avis de fin d'analyse.

Les tests unitaires de la table sont dans
[`operator-state.test.ts`](../../src/lib/takeoff/operator-state.test.ts) ; la
cohérence des trois surfaces dans
[`server.jobs.test.ts`](../../src/lib/takeoff/server.jobs.test.ts) et
[`activity-center.test.ts`](../../src/lib/takeoff/activity-center.test.ts) et
[`request-activity.test.ts`](../../src/lib/takeoff/request-activity.test.ts) (les plans d'une demande) ; le
parcours TKW13 de
[`worker-lifecycle.e2e.ts`](../../e2e/army/takeoff/worker-lifecycle.e2e.ts) les
rejoue dans le navigateur.
