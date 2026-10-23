# Persistance AID dans la sauvegarde groupée V2

> Contrat et reçu de campagne historique conservés car un script les référence. Les résultats ci-dessous ne qualifient pas la version actuelle ; pour exécuter les tests, voir [le guide courant](../../e2e/README.md).


## Échec observé et périmètre

Ce plan précède le runner de régression et la nouvelle migration AID. Le correctif
est préparé uniquement en local ; les quatre fichiers MO validés restent figés.
Aucun changement distant, compte, flag, environnement applicatif, manifeste ni
server.ts n'est modifié par ce sous-lot.

Après le passage de PATCH single-item V2 tiered à la RPC groupée, un PATCH HTTP
valide répond avec succès mais GET retrouve `aid: null` au lieu de
`ARMY.AID.1410`. La preuve E2E rouge est conservée dans
`.e2e/demo-eight-connected/2026-10-07-aid-valid-http-diagnostic-01a07773/results.json`.
La fixture de diagnostic a un coût nul pour distinguer cette perte d'un défaut
de calcul monétaire.

Le snapshot read-only post-MO est
`.e2e/army/tiered-bulk-aid/deployed.json`, projet
`ijropnynpwjbllievrip`, relevé du 7 octobre 2026. Le cœur
`bulk_update_estimate_items_without_line_nature` écrit les six champs MO via la
jointure existante du payload, mais omet AID. Son helper ne retourne pas AID.
La colonne nullable `text` et le CHECK de longueur 64 existent pourtant.

La version canonique du repo gère déjà AID via `aid = snapshot.aid`, avec
normalisation dans le helper. La nouvelle migration doit être une opération
neutre sur cette chaîne déjà compatible. Elle doit ajouter seulement le SET AID
manquant au cœur déployé, sans remplacer le helper ni changer son type de retour,
la jointure, les verrous, le CAS, les compteurs, le pied ou les wrappers.

## Défaillances et assertions définies avant le code

| Défaillance | Preuve attendue |
| --- | --- |
| AID neuf ignoré | NULL devient l'AID fourni, relu après l'appel de la façade publique. |
| Modification ignorée | Un AID existant est remplacé par le nouvel AID normalisé. |
| Effacement ignoré | `aid: null` efface ; chaîne vide/espaces devient NULL conformément au helper canonique. |
| Clé absente effaçant une ligne | Un patch sans clé AID préserve la valeur, y compris une ligne ajoutée au bulk uniquement pour ses montants. |
| Normalisation différente | Espaces ordinaires périphériques supprimés, majuscules appliquées ; exemple `" army.aid.1410 " → "ARMY.AID.1410"`. |
| AID de section perdu | Une section peut porter AID ; sa sauvegarde ne lui ajoute aucun payload monétaire interdit. |
| Limite de longueur contournée | 64 caractères normalisés acceptés ; 65 refusés par le CHECK existant, sans écriture du lot ni du pied. |
| Perte d'une des six valeurs MO | AID + heures/coefs/rôles atelier/chantier sauvegardés ensemble et comparés séparément après relecture. |
| Montants modifiés involontairement | Mutation AID seule conserve les six valeurs, quantité, prix, montants et pied ; cas combiné cohérent selon l'oracle financier indépendant MO. |
| Régression d'une référence ou d'un wrapper | Produit, nature, fournisseur, titres et positions restent sauvegardés via les fonctions actuelles. |
| Écriture partielle après rôle invalide | Rôle inconnu, tenant/propriétaire étranger : refus par le vrai guard V2, rollback de l'AID et de tout le lot. |
| Échec tardif de nature/produit | L'erreur du wrapper annule AID, MO, positions, lignes et pied. |
| Conflit de version | Ancien token ou token absent refusé sans mutation ; nouveau token accepté. |
| IDs dupliqués, absents ou hors devis | Refus du lot, aucune écriture AID partielle. |
| Contournement de droits | Tiers, viewer propriétaire et tenant inactif avec une vraie ligne de son devis ne peuvent pas modifier AID ; SELECT viewer reste autorisé. |
| Version publiée | Le trigger V2 refuse la mutation, même pour le propriétaire PostgreSQL du harness. |
| Régression des invariants PostgreSQL | OID, propriétaire, ACL, invoker, signature et search_path conservés ; les trois autres fonctions et leurs corps restent identiques. |
| Mauvaise applicabilité de migration | Cœur absent/inattendu ou prérequis MO manquants : refus explicite ; seconde application identique ; chaîne canonique AID déjà complète inchangée. |

La RPC ne valide pas tous les types/regex métier que l'API valide. Le correctif
conserve la normalisation SQL canonique ; il n'ajoute ni regex tenant ni règle
d'unicité. L'API vérifie la longueur de la chaîne avant trim, alors que le CHECK
SQL porte sur la valeur stockée. Ces différences ne doivent pas devenir de
nouvelles règles implicites. Les baux d'édition restent contrôlés par le serveur,
pas par le corps de cette RPC.

## Régression isolée et recette E2E

Le rouge HTTP existe avant le correctif. Après application distante autorisée,
la recette devra refaire création/modification/effacement d'AID via l'API et
l'éditeur, recharger, puis vérifier ses montants et paramètres. Le sous-lot local
ne peut pas qualifier cette migration encore non appliquée.

La régression SQL appelle les corps complets post-MO capturés, les deux wrappers,
les vrais guards/révisions et les policies SELECT/UPDATE/ALL déjà capturées dans
`.e2e/army/tiered-bulk-mosplit/deployed-dependencies.json` et
`deployed-additional.json`. Chaque snapshot doit déclarer read-only et le même
projet. Le mode canonique reconstruit les fonctions réelles et applique d'abord
la migration MO figée dans la base éphémère.

Le schéma ciblé MO figé peut être réutilisé en lecture puis étendu par une fixture
AID propre. L'identité reste simulée par `auth.uid()`, global admin est false et
les grants de tables sont locaux. Cette preuve PGlite ne représente pas Auth,
PostgREST, les baux HTTP, toute la pile RLS, les triggers d'audit/publication ou
une course entre plusieurs sessions.

Le cas financier combiné réutilise l'oracle indépendant décrit dans
`tiered-bulk-mosplit.md` : heures et taux relus donnant coût 46 000, coefficient
1,2, A HT/TVA/TTC `49 200/9 840/59 040`, B `6 000/1 200/7 200`, pied
`55 200/11 040/66 240`. La régression AID n'importe aucun calculateur produit.
Un second patch AID + prix FO de A à 1 200 centimes donne coût A 41 400, coût
du devis 46 400, A `49 680/9 936/59 616`, B inchangée et pied
`55 680/11 136/66 816`. Les six valeurs MO doivent rester exactement identiques.

## Commandes et preuves

Depuis la racine du repo, sous PowerShell :

```powershell
$env:PGLITE_MODULE = '.codex-tmp/demo-eight-20261002-01a07773/sql-runtime/node_modules/@electric-sql/pglite/dist/index.js'
$env:BULK_AID_FUNCTIONS_JSON = '.e2e/army/tiered-bulk-aid/deployed.json'

# Corps post-MO capturés ; reproduire uniquement, sans appliquer AID.
node scripts/test-tiered-bulk-aid-sql.mjs --baseline-only

# Reproduire, appliquer AID en mémoire, puis vérifier tous les cas.
node scripts/test-tiered-bulk-aid-sql.mjs

# Reconstruction canonique puis migration MO en mémoire, AID déjà complet.
Remove-Item Env:BULK_AID_FUNCTIONS_JSON -ErrorAction SilentlyContinue
node scripts/test-tiered-bulk-aid-sql.mjs
```

Le runtime PGlite est celui déjà installé pour la recette, Node 24 LTS. Si ce
cache local n'existe pas dans un autre checkout, fournir son propre module PGlite
via `PGLITE_MODULE`. Aucun secret, .env.local ou connexion Supabase n'est lu.

Chaque appel sauvegarde un nouvel artefact
`.e2e/army/tiered-bulk-aid/runs/<horodatage>-deployed|canonical/evidence.json`.
Il contient commande/variables, révision et état Git, empreintes des sources et
snapshots, identité synthétique, attentes/observations, erreurs, attributs des
fonctions et limites. `sourceChangedDuringRun` concerne ces entrées chargées,
pas la totalité de l'application ni une validation du serveur compilé.

| Artefact conservé | Résultat |
| --- | --- |
| `2026-10-07T06-20-25.013Z-deployed/evidence.json` | Baseline avant création de migration : `defect-reproduced`, 18 vérifications ; création/remplacement/null ignorés. SHA256 `37ac48baaa250368f6acdfaabd5a9f130d20f3d8606e941ffef718bec9615ce1`. |
| `2026-10-07T06-27-06.249Z-deployed/evidence.json` | 126 vérifications passent, mode post-MO capturé, source stable pendant le run. |
| `2026-10-07T06-27-06.251Z-canonical/evidence.json` | 117 vérifications passent, migration AID entièrement neutre sur les quatre fonctions canoniques. |

Ces chemins sont relatifs au dossier `runs` indiqué ci-dessus. Les premiers verts
`06-23-32.545Z` (123/114 checks) restent conservés. La revue a ensuite rendu
explicites les préconditions : création depuis NULL ; chaque effacement null,
vide ou espaces part d'un AID existant non-NULL relu. Les nouveaux verts prouvent
ces transitions plutôt qu'un résultat déjà présent. La baseline autonome conserve
son ancienne empreinte de runner ; chaque run complet déployé reproduit à nouveau
la perte avant d'appliquer la correction éphémère.

### Migration prête pour revue

`supabase/migrations/20261007062228_restore_bulk_estimate_aid.sql` a été créée
par `supabase migration new restore_bulk_estimate_aid` après la baseline. Le CLI
a créé le fichier puis signalé un timeout de fermeture de télémétrie ; le fichier
vide a été vérifié avant son remplissage. SHA256 :
`c76ca56503a60c0fa2393b84eceba7c262c0de1e568d0eee4b4de3e31ae2b6e4`.

Elle modifie uniquement le SET après `title = snapshot.title` dans le cœur
déployé, avec présence de clé, `upper(btrim())`, blanc/null à NULL, sinon valeur
existante exacte. La jointure post-MO, les six affectations MO, les montants, les
verrous, le CAS et les wrappers sont conservés. La branche canonique reconnaît
l'affectation `aid = snapshot.aid` et la normalisation du helper et retourne
sans DDL. Le helper et son type de retour restent inchangés dans les deux modes.

La matrice vérifie notamment AID + six MO, AID + nouveau prix FO et tous les
montants recalculés indépendamment, 64/65 caractères, valeurs absentes conservées,
section, permutation, token périmé, ID étranger/dupliqué, RLS viewer/inactif, rôle
étranger et rollback après erreur tardive. OID, ACL, propriétaire, invoker,
signature et search_path restent identiques ; les trois autres corps restent
identiques. Seconde application identique et refus explicite de cœur absent ou
inattendu sont aussi observés.

### Limites de preuve

Les corps post-MO sont ceux du nouveau snapshot ; guards/helpers/policies viennent
des relevés read-only MO précédents. Les 13 policies SELECT/UPDATE/ALL concernées
sont chargées, y compris les trois restrictives. Les fixtures et les grants de
tables sont simulés ; les profils/global admin, Auth/PostgREST, propagation
tenant, audit, publication complète et concurrence multisession ne sont pas
reconstitués. Aucune recette UI après correction distante n'a eu lieu ici.

La regex métier tenant, la validation HTTP de types et la longueur brute avant
normalisation restent contrôlées par le serveur. SQL direct convertit certains
JSON en texte et ne valide pas cette regex ; `trim()` JavaScript couvre plus
d'espaces que `btrim()`, et longueur/majuscules Unicode peuvent différer. Le
correctif reprend le contrat SQL canonique, sans nouvelle règle ni élargissement.

Les quatre fichiers MO figés sont lus et restent inchangés. Aucun changement
distant n'a été appliqué par ce sous-lot. L'autorisation MO ne couvre pas la
nouvelle migration AID : l'orchestrateur garde la demande humaine ciblée et la
recette HTTP/UI finale avant l'allocation du rejeu duplication ARMY.
