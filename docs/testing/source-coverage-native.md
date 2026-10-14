# Qualification SQL locale des exigences CCTP

Le 12 octobre 2026, la migration candidate
`supabase/migrations/20261011233527_estimate_source_coverage.sql` passe les
34 scénarios de `src/test/fixtures/source-coverage-regression.sql` sur la
pile Supabase native locale, dans une transaction intégralement annulée.
Cette qualification n'applique pas durablement la migration.

## Identité et résultat

| Élément | Preuve |
| --- | --- |
| Révision de départ | `ce5874f54f8202297b74e4ed238e5c48e49d2f1b`, avec modifications locales inventoriées dans le manifeste |
| Candidat SHA256 | `bd658f9bf95daa75b9d12e8a25671123ec7b2c621713ee6074b736538f7301a1` |
| Fixture SHA256 | `3482c751e51b6066f25d1259647c8558de90ea99be5fd617094a5c2cf7430a92` |
| Runner SHA256 | `627e35d6bde3800c7825e9ea3b4cab5589ae98afeed479dd593b2997b00bfeba` |
| Archive exacte | `.e2e/source-coverage/coverage-native/runs/2026-10-12T00-06-20-019070Z` |
| Manifeste SHA256 | `7f9d135b3918946355175294cda83f8723c309eb76f1a8b540c0f9012c6bdad8` |
| Résultat | 34 exécutés, 34 réussis, aucun scénario sauté |
| Conservation | `before.json` et `after-independent.json` ont des octets identiques : catalogue, données des 114 tables inventoriées, rôles et privilèges |

Le runner accepte uniquement `127.0.0.1:32959/postgres` et vérifie son
identité avec le reçu de la pile native. Il n'imprime pas ses identifiants.
Une seule instruction DO contient le candidat et les scénarios ; l'exception
finale P9001 annule l'ensemble. Des bornes de durée sont installées avant
cette instruction. Une connexion indépendante relit ensuite l'état de la
base, y compris l'absence des tables candidates et du préfixe de fixture.
Les sources exactes et dépendances du runner sont copiées dans l'archive.

Commande exécutée depuis la racine Windows :

```powershell
wsl -d Ubuntu-24.04 -- python3 /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/source-coverage/coverage-native/native.py --execute --approval-reference goal-local-rollback-validation-reviewed-20261012 --migration-sha bd658f9bf95daa75b9d12e8a25671123ec7b2c621713ee6074b736538f7301a1 --fixture-sha 3482c751e51b6066f25d1259647c8558de90ea99be5fd617094a5c2cf7430a92
```

Cette commande documente l'essai précis ; elle ne constitue pas une
autorisation d'application persistante ou distante. Les secrets du runtime
ne sont ni dans la commande ni dans la fixture suivie. La reconstruction
complète de la pile et les aides natives restent locales ; le seed et le
runner navigateur versionnés sont décrits dans
[la recette E2E](source-coverage-e2e.md).

## Ce que les scénarios établissent

Les cas vérifient les ACL des tables et RPC, les lectures selon les rôles,
l'inclusion d'un composant effectivement appliqué, le refus d'une couverture
partielle ou d'une citation non vérifiée, les cibles incompatibles, les
révisions attendues et les reçus idempotents. Ils éprouvent l'invalidation
après changement technique, y compris changement puis retour à l'ancienne
valeur, le registre et ses portées, le remplacement de référence, l'historique
immuable, l'atomicité en cas d'échec d'événement et les suppressions en cascade.
Les dimensions d'affaire survivent à la suppression d'une seule version.
Le rejeu historique reste contrôlé après changement de rôle ou de statut.

Les régressions sont écrites avant l'implémentation. Deux extensions ciblées
précèdent les correctifs découverts en revue : transfert de parents avant la
première référence et changement de portée d'une exception du registre.
Les reçus antérieurs sont conservés sous `coverage-native/`.

Deux premiers essais ont échoué dans les préconditions : montants obligatoires
de ligne manquants, puis ligne d'une autre version sans section. Le troisième
atteint 32/34 et reproduit le défaut de réécriture d'une exigence pendant la
suppression de son parent ; le candidat corrige cette invalidation. Son autre
échec concerne la préparation d'un devis envoyé : la fixture utilise désormais
le RPC existant de gel avec un snapshot complet. Les assertions métier ne
sont pas abaissées. La conservation de la base passe à chaque tentative.

## Limites

Une nouvelle pile native complète a ensuite été initialisée pour la recette
applicative : projet `miaouffrage-coverage-729799711d9c404b`, API locale `45585`,
PostgreSQL local `33485`, identité native `7695571534776503175`. Elle est
distincte de la pile historique `32959`. Toutes les migrations du checkout
ont été appliquées par la CLI ; cela n'applique rien sur la pile historique.

La suite pgTAP complète passe **13 fichiers / 1 232 assertions** après correction
du fixture existant `transactional-workflows.test.sql`. Celui-ci construisait
un achat sourcé sans unité ni chaîne d'offre complète et appelait encore le
RPC à trois arguments révoqué. Il utilise désormais l'identité stable de ligne
et la révision d'édition ; son refus tardif porte sur un changement d'unité
sourcée, après écriture du header, pour conserver la preuve d'annulation.
Aucune règle produit n'a été assouplie. L'essai initial en échec reste archivé.

Reçu : `.e2e/source-coverage/disposable-native/runs/729799711d9c404b/requalification/receipt.json`.
Le rejeu n'a effectué ni reset, ni migration, ni redémarrage. Les lectures
indépendantes avant/après retrouvent la même identité, le même historique et
l'inventaire vide explicite. Cette preuve ne remplace pas les courses ou l'UI.

Les objets Storage des 34 cas de couverture sont des métadonnées synthétiques. Cet essai ne
prouve ni les octets des PDF, ni une session HTTP, ni les parcours navigateur,
ni des courses entre connexions concurrentes. Les montants S0 sont préparés
dans la fixture : leur conservation ne qualifie pas le calculateur ou les
exports. La préparation du statut envoyé ne qualifie pas le parcours d'envoi.

La revue indépendante du candidat et des corrections est close sans défaut
bloquant identifié. La limite de catalogue de 100 composants cumulés sur une
page reste explicite ; une recherche trop large est refusée.

Les huit courses réelles sont désormais qualifiées dans
`.e2e/source-coverage/coverage-concurrency/qualifications/qualification-20261012T004519Z.json`
(SHA-256 `daa8a508103ccaa68bad055d01449a4adb7e00213afe623be0a4402baf9dc208`).
Les 350 lignes préexistantes inventoriées dans 113 tables à ID sont conservées,
dont les onze affaires navigateur. Cette qualification reste SQL et n'inclut
pas les variantes concurrentes de composition ou de suppression en cascade.
Les onze parcours métier et la matrice complète des droits HTTP restent à
qualifier avant de présenter DOS-CAL-01 comme entièrement livré.
