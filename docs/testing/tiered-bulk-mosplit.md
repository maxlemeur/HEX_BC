# Sauvegarde groupée de la main-d'œuvre atelier/chantier

> Contrat et reçu de campagne historique conservés car un script les référence. Les résultats ci-dessous ne qualifient pas la version actuelle ; pour exécuter les tests, voir [le guide courant](../../e2e/README.md).


## Portée et preuve attendue

Ce plan est écrit avant la régression SQL et avant la correction. La préparation
est locale : aucune migration, écriture, modification de compte ou activation de
fonctionnalité sur Supabase partagé n'est autorisée par ce travail.

La chaîne canonique est `bulk_update_estimate_items` →
`bulk_update_estimate_items_without_product_id` →
`bulk_update_estimate_items_without_line_nature` →
`snapshot_estimate_item_bulk_updates`. Le cœur et le helper, redéfinis dans les
migrations catalogue/AID de février 2026, omettent les six colonnes ajoutées par
EST-031 : `h_mo_atelier`, `k_mo_atelier`, `labor_role_atelier_id`,
`h_mo_chantier`, `k_mo_chantier`, `labor_role_chantier_id`.

Le correctif doit conserver les signatures, propriétaires, droits, modes de
sécurité, chemins de recherche et wrappers existants. Il doit écrire ces six
champs dans la même mise à jour que les autres données de la ligne, après les
verrous et le contrôle de version existants, avec les contraintes et triggers
actuels. Les champs absents conservent leur valeur ; un `null` explicite efface
une valeur nullable. Il ne faut ni inventer une nouvelle formule ni modifier
`h_mo` pour le contraindre à la somme des heures réparties.

## Échecs observables à couvrir avant le correctif

| Défaillance | Observation attendue |
| --- | --- |
| Perte silencieuse d'un des six champs | Relire les six valeurs après l'appel public et comparer au payload ; aucune valeur ancienne ne doit subsister. |
| Montants sauvegardés avec des entrées de calcul anciennes | Un oracle arithmétique indépendant, fondé sur les heures, coefficients et taux relus, doit retrouver les montants de ligne et de pied. |
| Effacement involontaire dans un patch partiel | Une clé absente conserve sa valeur ; `null` explicite efface chaque champ nullable ; zéro reste zéro. |
| Précision ou cast perdu | Vérifier des décimales compatibles avec `numeric(12,3)`, une chaîne numérique invalide, un débordement et un UUID invalide. |
| Valeurs négatives acceptées | Heures/coefficient négatifs refusés par les CHECK actuels ; aucun changement du lot ou du pied. |
| Référence de rôle invalide | Un rôle inconnu, d'un autre tenant ou d'un autre propriétaire de projet est refusé par la FK/le trigger V2 réel. |
| Valeurs interdites sur une section | Les heures/rôles et coefficients non neutres sont refusés par la contrainte EST-032 actuelle ; ne pas inventer un rejet de `null` si le CHECK existant l'autorise. |
| Contournement de la sécurité | Exécuter avec une identité simulée et RLS : tiers, viewer et tenant inactif ne doivent pas pouvoir modifier le devis. La fonction reste SECURITY INVOKER. |
| Écriture d'un devis non modifiable | Le trigger gouverné V2 refuse un devis envoyé/figé, sans changement des lignes ni du pied. |
| Conflit de version ignoré | Un token périmé ou manquant est refusé ; le token récent réussit. |
| Lot partiel ou ID hors devis | ID inexistant, d'un autre devis, d'un autre tenant ou dupliqué : aucune mise à jour partielle. |
| Échec tardif d'un wrapper | `line_nature`/`product_id` invalide annule aussi les six valeurs, les autres lignes et les totaux. |
| Régression des données déjà supportées | AID, prix fournisseur choisi, produit, nature de ligne, titres, parents, positions et totaux restent sauvegardés. |
| Collision lors d'une permutation | Le déplacement en deux phases conserve l'unicité des positions et le bon ordre. |
| Payload/pied invalide | Tableau obligatoire ; patch du pied limité aux clés existantes ; casts de totaux invalides annulant l'ensemble. |
| Mauvaise répétabilité de la migration | Première application et seconde application identiques ; absence d'implémentation ou définition inattendue : refus explicite et aucune autre fonction modifiée. |
| Régression de privilèges/dépendances | OID, ACL, propriétaire, signature et sécurité conservés ; wrappers et helper inchangés. |

Les baux d'édition sont vérifiés par le serveur applicatif, pas dans le corps
canonique de cette RPC. La régression SQL ne prétend pas prouver ce contrôle HTTP
ni une course entre plusieurs sessions PostgreSQL.

## Oracle métier indépendant

Fixture locale synthétique : un devis V2 en marge par tranches, TVA 20 %, sans
arrondi commercial. Tranches `0 → 1,5` et `30 000 centimes → 1,2`.

- Ligne A : quantité 2, fourniture unitaire 1 000 centimes, coefficients FO et
  majoration MO 1. Avant modification : atelier 1 h × 1 × 4 000 et chantier
  1 h × 1 × 6 000 ; coût de ligne 12 000 centimes.
- Ligne B : quantité 1, fourniture 5 000 centimes, aucune heure MO. Coût total
  initial 17 000 ; pied HT/TVA/TTC = `25 500 / 5 100 / 30 600`.
- Payload des six champs de A : atelier 2 h × 1,5 × 3 000 et chantier
  3 h × 2 × 5 000. Coût A = `2 × 1 000 + 9 000 + 30 000 = 41 000` ; coût du
  devis = 46 000, donc coefficient 1,2.
- Résultat : A HT/TVA/TTC = `49 200 / 9 840 / 59 040`, PU = 24 600 ; B =
  `6 000 / 1 200 / 7 200` ; pied = `55 200 / 11 040 / 66 240`.

Les heures MO sont celles de la ligne et ne sont pas multipliées par la quantité.
L'oracle n'importe aucun calculateur de production. Le cas avant correction doit
montrer les six anciennes entrées encore présentes alors que les montants et le
pied issus du payload sont écrits. C'est une incohérence de données reproductible
sur la RPC réelle ; cela ne prétend pas reproduire le serveur HTTP complet.

## Pourquoi une régression SQL isolée est nécessaire

La recette E2E finale doit saisir les valeurs dans l'éditeur V2, franchir une
tranche, sauvegarder, recharger, puis comparer les six champs et tous les montants
par l'UI et l'API. Elle doit aussi vérifier le conflit de version et les baux.
Les preuves ARMY existantes couvrent l'autosave standard et la duplication, mais
ne prouvent pas la persistance de ces six champs. Cette recette ne peut valider
une migration encore non autorisée sur la base partagée.

La préparation locale appelle les fonctions PostgreSQL complètes avec leurs vrais
wrappers et le trigger de contrôle des rôles V2. Elle expose le défaut avant
correction puis vérifie les chemins de rollback et les attributs PostgreSQL
qu'une recette navigateur seule ne distingue pas. PGlite remplace ici la pile
Supabase locale indisponible ; l'identité est simulée et la fixture est ciblée.
Le test ne vaut ni validation de toute la pile RLS distante, ni preuve de baux
HTTP, ni preuve de concurrence multisession. Un snapshot déployé doit avoir une
provenance read-only et le projet `ijropnynpwjbllievrip` avant d'être accepté.

## Exécution et résultats

Depuis la racine du repo, dans PowerShell, utiliser le runtime PGlite déjà installé
pour la recette locale. Aucun accès réseau ni secret Supabase n'est requis.

```powershell
$env:PGLITE_MODULE = '.codex-tmp/demo-eight-20261002-01a07773/sql-runtime/node_modules/@electric-sql/pglite/dist/index.js'
$env:BULK_FUNCTIONS_JSON = '.e2e/army/tiered-bulk-mosplit/deployed.json'

# Reproduire le défaut uniquement, sans charger la migration.
node scripts/test-tiered-bulk-mosplit-sql.mjs --baseline-only

# Charger les corps déployés, reproduire le défaut, appliquer en mémoire,
# puis vérifier la matrice complète.
node scripts/test-tiered-bulk-mosplit-sql.mjs

# Reconstituer la chaîne depuis les migrations canoniques du repo.
Remove-Item Env:BULK_FUNCTIONS_JSON -ErrorAction SilentlyContinue
node scripts/test-tiered-bulk-mosplit-sql.mjs
```

Le mode déployé requiert aussi `deployed-dependencies.json` et
`deployed-additional.json` à côté du premier snapshot. Ces trois relevés sont
en lecture seule, datés du 6 octobre 2026, et identifient le même projet. Le runner
charge les corps complets capturés des RPC, helpers tenant et triggers nécessaires,
leurs ACL de fonction, ainsi que les policies SELECT/UPDATE/ALL capturées des cinq
tables concernées. Les trois policies restrictives `Operators can update estimate
rows` sont incluses. Le mode canonique charge leurs templates réels depuis la
migration de restauration des privilèges du 11 août.

Chaque exécution conserve son propre `runs/<horodatage>-deployed|canonical/evidence.json`
avec commande, variables de runtime, révision, état Git, SHA256 des entrées, état
PostgreSQL des quatre fonctions avant/après, résultats attendus et observés, erreurs
et limites. `sourceChangedDuringRun` porte sur les entrées SQL/harness chargées ;
ce n'est pas une qualification de l'ensemble du code applicatif.

| Preuve conservée | Résultat |
| --- | --- |
| `.e2e/army/tiered-bulk-mosplit/runs/2026-10-06T21-00-49.903Z/evidence.json` | Baseline écrite/exécutée avant la migration : `defect-reproduced`, 12 vérifications. Les six anciennes valeurs persistent ; pied écrit 55 200 HT contre 25 500 recalculés depuis ces valeurs. SHA256 `359dc310af9baf13f1b9f5a7a04ee304c040559471d6d88830bbeeadc0e26c57`. |
| `.e2e/army/tiered-bulk-mosplit/runs/2026-10-06T21-09-26.352Z-deployed/evidence.json` | 145 vérifications passent, avec les policies restrictives capturées et une vraie ligne du tenant inactif. SHA256 `1e1a5b40de1fbd56d9289265019200dcd7879069b16e30815a453244b491cb6c`. |
| `.e2e/army/tiered-bulk-mosplit/runs/2026-10-06T21-09-40.463Z-canonical/evidence.json` | 138 vérifications passent sur la chaîne canonique. SHA256 `5d32ab6baffd6acc52db65897f5b9feff26bfce2cdd7418ad390ef4f92b8a786`. |
| `.e2e/army/tiered-bulk-mosplit/runs/2026-10-06T21-05-22.370Z/evidence.json` | Probe local AID séparé, 44 vérifications : mêmes payloads avant/après, sans effacement introduit. |

Les erreurs de préparation sont conservées séparément : le premier résultat après
migration attendait une écriture AID absente du contrat déployé ; un essai canonique
s'est arrêté avant le premier check sur un paramètre `format()` non typé. Ces
essais ne constituent pas de la couverture positive. La baseline autonome garde
son ancienne empreinte du runner ; chaque run complet reproduit de nouveau le
défaut avant son application locale et enregistre sa propre source exacte.

### Correction préparée

`supabase/migrations/20261006210154_restore_bulk_estimate_labor_split.sql` a été
créée par `supabase migration new restore_bulk_estimate_labor_split`, après le
plan et la baseline. Le CLI a créé le fichier puis renvoyé une erreur de fermeture
de sa télémétrie ; le fichier vide a été vérifié avant son remplissage. Son SHA256
est `db4d586abf4ffb37ade5abcb7ea2a5721ac638a20734fd57741fee62efdc7220`.

Elle remplace seulement la définition du cœur existant en ajoutant les six SET
conditionnels et une jointure du payload par ID dans l'UPDATE déjà verrouillé.
Elle conserve la table temporaire, la permutation en deux phases, les compteurs,
le CAS et le pied atomique. Les wrappers et le helper restent identiques. Le
runner vérifie OID/signature/propriétaire/ACL/sécurité/search_path, idempotence et
refus d'un cœur absent ou inattendu. Aucun nouveau calcul, grant, RLS, flag, compte
ou rôle distant n'est introduit.

### AID et limites restantes

Les corps déployés du helper et du cœur ne lisent ni n'écrivent `aid`, alors que
la version canonique AID du repo le fait. Le premier harness attendait à tort
`ARMY-001` après un payload sur une ligne initialement NULL. La vérification de
compatibilité sème désormais un AID existant pour vérifier sa conservation.

Le probe `.e2e/army/tiered-bulk-mosplit/probe-aid.mjs` réutilise le setup du
runner et teste avant/après migration : AID initial NULL ou `ARMY-PRESENT`, avec
payload de remplacement `aid: " army-001 "`, clé absente ou `aid: null`.
Les douze appels gardent exactement l'AID initial ; les six champs split sont
perdus avant et persistés après. Cette correction ne crée donc aucun effacement
AID et ne répare pas l'écriture AID déjà absente du contrat déployé. Ce dernier
écart doit être traité séparément, sans élargir implicitement cette migration.

Pour reproduire ce probe conservé, définir les deux variables du mode déployé
ci-dessus puis exécuter `node .e2e/army/tiered-bulk-mosplit/probe-aid.mjs`.
Il produit son propre artefact, avec son empreinte et les payloads observés.

L'identité et les grants de tables sont ceux de la fixture isolée ; global admin
est simulé false, donc ce chemin n'est pas testé. Les triggers de propagation
tenant, d'audit, de publication complète et de profondeur hiérarchique ne sont
pas reconstitués. Les garde-fous de rôles atelier/chantier tenant/propriétaire du
trigger gouverné ne s'appliquent qu'à V2 ; ce correctif ne renforce pas les FK V1.
Les tests financiers se limitent au cas décrit, avec split actif dans l'oracle.
Ils ne prouvent pas l'activation du flag ni la recette UI sur Supabase.

L'API exige des nombres finis et non négatifs. Le cast SQL historique peut
accepter `NaN` ou arrondir `-0.0004` à zéro avant le CHECK ; les régressions le
consignent explicitement et ne prétendent pas ajouter une validation de finitude.
Une section avec coefficient NULL peut passer un CHECK indéterminé ; la migration
conserve aussi cette sémantique.

Aucune application distante n'a eu lieu. Une nouvelle autorisation humaine
ciblée est nécessaire pour appliquer cette correction à la base partagée ;
l'approbation précédente de la duplication ne couvre pas cette migration.
Après application autorisée, la recette UI/API avec nouvelles données ARMY, un
flag split actif approprié et des sources stables reste nécessaire.
