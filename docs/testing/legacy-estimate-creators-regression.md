# Retrait des anciennes RPC de création — 2026-10-10

## Contrat et échecs observables définis avant correction

Les quatre anciennes RPC de création restent dans l'historique SQL mais ne doivent
être exécutables ni par PUBLIC ni par `anon`, `authenticated` ou `service_role`.
La création canonique v2, la duplication authentifiée, les AID et la provenance
d'import doivent conserver leur comportement.

La lecture de production a confirmé un EXECUTE direct pour `service_role` sur les
quatre signatures, sans autre grant Data API. Aucun appel applicatif à ces RPC ne
subsiste ; les références dans `src/types/database.ts` sont des déclarations.
Un parcours UI seul ne peut donc exercer cette capacité abandonnée. L'exception
d'isolation utilise les assertions existantes de
`supabase/tests/database/estimate-calc-engine-governance.test.sql`, avec les
contrôles de création v2 et de duplication du même fichier, puis la matrice RLS
PostgREST réelle exécutée par `npm run db:ci:local`.

Une base neuve peut déjà refuser ces droits grâce aux nouveaux privilèges par
défaut. La preuve de mise à niveau doit aussi réintroduire les anciens grants
dans une transaction locale, appliquer la nouvelle migration, vérifier le refus
effectif et les appels `42501`, puis vérifier son idempotence et la conservation
des droits canoniques. Aucun fixture métier distant ne sera créé pour ce test.

## Faux succès du runner

La CLI 2.109.1 peut sortir avec le code zéro et le rapport suivant quand le moteur
Docker ne voit pas le répertoire des tests :

```text
Files=0, Tests=0,  0 wallclock secs
Result: NOTESTS
```

Le runner acceptait ce résultat. La régression de parser est une seconde exception
d'isolation : elle couvre ce rapport réel, une exécution partielle, un échec et un
rapport absent. L'E2E normale ne peut injecter ces rapports sans altérer son moteur
Docker. La garde doit exiger un résultat PASS, tous les fichiers SQL attendus et
un nombre d'assertions strictement positif avant de lancer la matrice RLS.

Sur ce Mac, la VM Colima dédiée ne monte que le répertoire jetable de QA et
`TMPDIR` pointe vers ce répertoire pour le runner. Aucun changement du
`supabase/config.toml` du dépôt n'est nécessaire.

## Contrôle de production

Le projet `ijropnynpwjbllievrip` a été lu dans le Chrome personnel : plan Free,
aucune sauvegarde plateforme et PITR réservé à un ajout au plan Pro. Aucun achat
ou changement de plan n'est autorisé. Le rollback de cette seule révocation est
le rétablissement des quatre grants EXECUTE observés avant application ; aucune
ligne métier ni définition de fonction n'est modifiée.

L'historique distant contient notamment les versions `20261002182830` et
`20261007184209`, différentes des horodatages locaux des mêmes corrections. Un
`db push` global ne convient pas à cette intervention ; utiliser uniquement la
nouvelle migration via MCP et conserver son identifiant distant réel.

## Adaptation des régressions et privilèges du catalogue

La preuve réelle avant correction a exécuté 13 fichiers : échecs de gouvernance
8–10 et 28, échecs d'invariants 513–520, puis arrêt de la fixture transactionnelle
sur la colonne `products.tax_rate_bp` supprimée. Les assertions de duplication
doivent inspecter `duplicate_estimate_version_without_product_id`, tout en gardant
la sécurité et les ACL de la façade externe et le refus d'accès direct au helper.
Les cas de duplication autorisée et refusée restent exécutés. La TVA des lignes
et des commandes reste dans la fixture ; seule la colonne produit obsolète est
retirée.

Les deux tables créées après le grant historique de service-role,
`supplier_pricebook_history` et `product_reference_price_validations`, n'ont pas
de droits service-role explicites dans leur migration d'origine. La production
possède déjà SELECT/INSERT/UPDATE/DELETE pour ce rôle, avec RLS active et SELECT
seul pour `authenticated`. Une nouvelle migration locale rétablit précisément
ces huit droits pour aligner les resets frais, sans modifier les rôles utilisateur
ou les policies. Les huit assertions d'invariants sont conservées. L'opération
distante autorisée reste uniquement la révocation des quatre RPC.

## Résultats

Exécution locale réelle du 2026-10-10 sur `b69a1d6c` avec les changements de ce
lot et le WIP préservé : Node 24.21.0, Supabase CLI 2.109.1, PostgreSQL 17.6,
Docker dans la VM Colima dédiée. Le résultat NOTESTS initial n'est pas une preuve
pgTAP, même si la matrice RLS de cette invocation est passée.

- Reset canonique et inventaire : 223 migrations uniques, manifeste et garde Git
  valides ; aucune migration existante réécrite.
- pgTAP : 13 fichiers, 1 214 assertions, `Result: PASS` ; gouvernance 205/205.
- Mise à niveau transactionnelle depuis les anciens grants : 22/22, dont les
  quatre refus effectifs `42501`, la conservation des fonctions et droits
  canoniques, puis une seconde application idempotente.
- Matrice RLS via PostgREST : 2/2 avec trois comptes locaux jetables ; arrêt et
  suppression de la stack réussis.
- Régressions du runner et de la garde Git : 12/12 ; lint des fichiers touchés,
  typecheck, build Webpack et budgets de performance verts. Vitest global :
  431 fichiers et 2 694 tests actifs verts ; les deux tests RLS ignorés dans cette
  commande ont été exécutés par le runner local.

Production `bon_de_commande` : le MCP a appliqué le contenu exact de
`20261010010645_revoke_service_role_on_legacy_estimate_creators.sql` (SHA-256
`6bfe927d7de7b32aecd02cb72b7c1c16c0bf6ebbb98002f58d63f3c39c56498e`),
enregistré à distance sous la version `20261010011819`. La lecture après confirme
les seize droits API à `false`, ainsi que les ACL et les empreintes des
définitions de `duplicate_estimate_version(uuid,boolean)` et
`persist_estimate_creation_atomic(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)` inchangées.
Les advisors restent à 61 signalements : 4 INFO et 57 WARN déjà présents.
La migration des droits du catalogue n'a pas été appliquée à distance.

Le correctif ferme uniquement les quatre RPC retirées. Il ne retire pas les droits
SQL directs du rôle serveur de confiance et ne prouve pas un parcours UI distant.
Le plan Free ne fournit pas de sauvegarde plateforme ni de PITR ; aucun test de
restauration n'a donc pu être effectué. Les anciens grants observés constituent
le rollback SQL de cette révocation.

Les preuves et la commande exacte sont conservées dans la collection gérée Codex
Security `artifacts/legacy-creators/` : `local-proof.json`, sorties pgTAP avant et
après, TAP gouvernance et mise à niveau, script SQL, wrapper de preuve et lectures
de production. Pour la voie standard, relancer `npm run db:ci:local` sous Node 24
avec un moteur Docker voyant le répertoire temporaire du runner. Le workflow
`E2E RLS Matrix` accepte désormais une exécution manuelle sur `main` ; son résultat
et son SHA sont conservés avec les preuves CI de ce lot.

Limite indépendante : `npm run audit:dependencies` échoue sur l'état actuel du
lockfile avec 28 signalements high. Les lots audit, gardes, dépendances et
refactorisation annoncés dans le handoff ne sont pas présents dans ce checkout.
Ils n'ont pas été reconstitués ni déclarés publiés ; le WIP d'association d'article
reste hors des commits de ce lot. Aucune exception d'audit n'a été ajoutée.
