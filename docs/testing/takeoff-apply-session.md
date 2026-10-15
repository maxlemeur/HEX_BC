# Identité de page lors de l'application d'un métré

## Défaillance observée avant correction

La campagne candidate 4 conserve les refus TKF01 et TKF02 (niveau A et lignes
exclues) : HTTP409 « autre page d'édition » malgré le compte propriétaire.
Les traces originales restent sous
`.codex-tmp/army-migration-20261015/candidate-4/.e2e/army/critical/`.

Dans les deux interfaces, `TakeoffReviewPage` et `TakeoffJobMonitor`, la
confirmation appelle déjà `ensureTakeoffApplyDraftLock(versionId)` : renouveler
le bail de cette page, acquérir normalement si absent, refuser un autre détenteur,
puis libérer uniquement le bail acquis pour cette application. Cependant,
`takeoff/client.applyTakeoffJob` n'envoie pas l'identifiant de session utilisé
par les appels de verrou. Le garde refuse donc l'application.

Le serveur n'a pas perdu un argument : `bulkUpdateEstimateItems` lit déjà
l'en-tête de la requête Next via `assertDraftLockOwnedByCurrentUser` et
`resolveRequestDraftLockSessionId`. La route apply conserve ce contexte. Ajouter
un second contrôle ou supprimer celui existant ne résoudrait pas l'omission du
client. La correction transmet la même identité depuis le gestionnaire de session
existant, sans nouveau bail, forçage, changement de RLS ou migration.

## Scénarios et limites de preuve

- La page propriétaire applique les mesures admises et conserve les quantités
  exactes ; les lignes exclues restent exclues.
- Une autre session du même compte, un en-tête absent ou invalide sont refusés,
  et ni les lignes ni le statut du job ne doivent changer.
- Depuis le wizard réel, l'acquisition, l'application puis la libération utilisent
  la même identité. Le moniteur et la revue partagent ce contrat.
- Le garde de confiance, les autorisations tenant, le statut brouillon et les
  contrôles atomiques continuent de s'appliquer après le contrôle de session.

TKF06 est défini avant le correctif client : créer un devis et une section dédiés,
préparer deux mesures niveau A (12,5 et 3) et une mesure exclue (7), ouvrir le
moniteur, sélectionner la section, ajouter sans effacer, contrôler l'aperçu puis
cliquer la confirmation finale réelle. Attendre HTTP200, deux créations, le job
`applied`, puis relire après reload les quantités, les exclusions et les lignes
préexistantes. Aucun fetch de test ne remplace la confirmation du wizard.

Les TKF E2E réels constituent la régression serveur. Ils doivent être rejoués avec
le header de la page propriétaire et avec une autre session. Le parcours de
confirmation UI doit aussi être rejoué pour qualifier le transport client.
Aucun nouveau test isolé n'est ajouté : le test existant du moniteur est adapté
avant le code pour exiger la version cible au passage du client. Les suites
existantes client, verrou et UI restent des vérifications complémentaires ;
elles ne remplacent pas ce rejeu navigateur.
