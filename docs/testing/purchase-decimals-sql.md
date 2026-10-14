# SITE-01B — Quantités et unités d'achat, qualification SQL

## Défaillances définies avant implémentation

Les quantités du devis sont décimales, tandis que la commande et son registre
de transfert sont entiers. L'édition supprime/recrée les lignes et cherche
leur provenance par égalité de valeur : corriger une quantité ou omettre une
référence peut donc perdre le lien d'origine. Le POST manuel écrit plusieurs
étapes avec compensation. Une ancienne lecture n'est pas distinguée d'une
édition actuelle ; deux sauvegardes peuvent écraser leurs corrections.

TesterArmy qualifie saisie, création, édition et sorties. La couverture SQL
ci-dessous vise les frontières non suffisamment exposées par ces parcours :
écritures directes, typemod, limites de stockage, droits, atomicité d'une panne,
identité de ligne, immutabilité du reçu et course ordonnée à deux connexions.
Elle est écrite avant la migration. Les claims SQL simulés ne constituent pas
une authentification HTTP.

## Contrat retenu

- Quantité positive, au plus trois décimales significatives, borne maximale
  historique 2 147 483 647 ; coût et taxe en entiers, totaux au centime.
- HT = `round(quantité × coût)` ; TVA = `round(HT × taux / 10000)` ; total par
  somme des lignes. Aucun arrondi automatique de quantité.
- Une unité historique n'est complétée que depuis un snapshot de préparation
  fiable. Sinon elle reste `NULL`, affichée comme unité à confirmer.
- Une ligne existante garde son UUID, sa référence, son produit et ses sources.
  La quantité courante et le prix peuvent être corrigés avec historique ; la
  quantité transférée initialement et le reçu initial ne changent pas.
- Les écritures de commande sont atomiques et contrôlent une révision relue.
  Une commande hors brouillon, une ligne étrangère ou un acteur sans droit
  ne doit pas être modifié.

Le type `numeric(p,3)` arrondit une valeur à quatre décimales avant sa
validation par contrainte. Une colonne `numeric` avec bornes et vérification
`quantity = trunc(quantity,3)` permet de refuser une perte de précision, y
compris par écriture directe. Cette différence doit être tranchée et testée,
sans réduire la plage des commandes entières historiques.
Source : [types numériques PostgreSQL](https://www.postgresql.org/docs/current/datatype-numeric.html).

## Assertions requises avant code

1. 12,5 × 123 : 1538 / 308 / 1846 ; 0,125 × 777 : 97 / 19 / 116 ;
   0,001 × 500 : 1 / 0 / 1. Total 1636 / 327 / 1963 centimes.
2. Refus atomique de zéro, négatif, valeur non finie, quatrième décimale,
   dépassement quantité/montant, nombre JSON mal typé ou ligne partiellement
   invalide. L'entier historique maximal avec coût zéro reste représentable.
3. Création manuelle et depuis devis : quantités et unités persistées,
   source intacte, historique fidèle, minimum fournisseur exact à 12,499/12,500.
4. Édition de note seule puis des valeurs : identité, référence, produit,
   unité et provenance conservés ; reçu initial et registre inchangés ;
   correction historisée avec acteur et valeurs avant/après.
5. Révision périmée, UUID de ligne étranger, doublon, suppression/ajout,
   accès inter-tenant et rôle interdit : aucune perte partielle de ligne.
6. Échec forcé d'une insertion tardive : aucune commande partielle, montant
   ou historique résiduel. Les reprises et protections SITE-01A restent actives.
7. Deux éditeurs réels : attendre un verrou observé puis démontrer que le
   second ne remplace pas la correction du premier avec une ancienne révision.

Le cadrage et les assertions ci-dessus ont été écrits avant implémentation.
Les résultats exécutés sont consignés ci-dessous ; ils ne remplacent pas cet
historique de préparation. La migration de SITE-01A installée reste immuable.

## Résultats SQL exécutés le 11 octobre 2026

Périmètre : pile native locale isolée `http://127.0.0.1:59827`, sur `main`,
révision `ce5874f54f8202297b74e4ed238e5c48e49d2f1b` avec les changements locaux
consignés dans chaque manifeste de preuve. Aucune migration distante n'a été
appliquée. Les heures des fichiers ci-dessous sont en UTC.

Nouvelle migration installée :
`supabase/migrations/20261011091744_purchase_decimal_quantities_and_stable_edits.sql`.
SHA-256 : `ef743a2dba4937ddb5afd3b4886dfd5920251cfb245280d220cfa3ab4eb1171d`.
Cette migration est désormais immuable elle aussi.

Le harness `.e2e/purchase-decimals/native.py` vérifie l'identité exacte de la
pile et archive la commande, le SQL, son propre code, la révision Git, les
changements locaux et les hashes. Les tests utilisent un unique bloc DO dont
l'exception terminale P9001 annule toutes les fixtures ; en mode candidate,
elle annule également les DDL testés. Les claims SQL simulés ne démontrent pas
un login HTTP ni une course à plusieurs connexions.

### Reproductions avant correction

Les chemins de cette section sont relatifs à `.e2e/purchase-decimals/`.

| Preuve | Résultat observé avant correction |
| --- | --- |
| `2026-10-11T09-26-46-446619Z-regression-red.json` | Contrats RPC absents et quantités décimales refusées par le schéma antérieur. |
| `2026-10-11T09-32-41-644604Z-regression-green.json` | Trois sondes de trigger autorisent INSERT, UPDATE et DELETE sur une commande envoyée. Sondes privilégiées de la frontière du trigger, sans prétendre reproduire une course RLS. |
| `2026-10-11T09-34-17-342444Z-regression-green.json` | RPC d'export absente pour les trois sondes : 1 200 lignes, identifiant inaccessible et plafond de 10 000 lignes. |
| `2026-10-11T09-39-57-964653Z-regression-green.json` | Fournisseur sourcé modifiable, y compris après suppression des lignes/FK ; produit source perdu ; unité tarifaire avec espaces refusée à tort. |
| `2026-10-11T09-40-55-843420Z-regression-green.json` | Changer l'UUID d'une commande après suppression de ses lignes détache son historique. |
| `2026-10-11T09-43-15-172661Z-regression-green.json` | Un acteur admin de deux tenants peut déplacer une commande manuelle et détacher son historique du tenant initial. |
| `2026-10-11T09-44-35-507648Z-regression-green.json` | La garde de statut bloque à tort le vrai FK SET NULL du produit d'une commande envoyée. |

Les fichiers contenant `regression-green` désignent le mode du harness de
candidate ; leur champ `allPassed` et leurs résultats par cas font autorité.
Le nom du fichier n'est pas une assertion de succès.

### Candidate finale et schéma installé

| Exécution | Résultat | Fichier de preuve | SHA-256 du résultat |
| --- | --- | --- | --- |
| Candidate finale SITE-01B, transaction annulée | **52/52**, `allPassed: true` | `2026-10-11T09-45-36-810472Z-regression-green.json` | `bb09227b2153fc5f1943a0de3d535c09133176adefc41c18790d5965bdd49152` |
| SITE-01A sur cette candidate, transaction annulée | **39/39**, `allPassed: true` | `2026-10-11T09-45-56-460489Z-regression-green.json` | `1528a87d8d30353960206a94d4ce597e67c6f1cb169faf4996023643cb435fed` |
| SITE-01B sur le schéma installé | **52/52**, `allPassed: true` | `2026-10-11T09-48-47-635877Z-regression-green.json` | `90ad62ef97e0fe39c26471e9cc9dfa217f4a8c52b5bde12fc30adbc3416a296f` |
| SITE-01A sur le schéma installé | **39/39**, `allPassed: true` | `2026-10-11T09-49-10-856542Z-regression-green.json` | `c54a8958a186944c6d95b6d5700b5bf29051947ef57f739758769b3e223912de` |

Les 52 cas couvrent notamment les décimales et arrondis, les limites et types
JSON, la création manuelle atomique, les identités stables, les omissions de
champs, la réorganisation/suppression/ajout, les révisions périmées, les droits,
les unités historiques à confirmer, la provenance après suppression des FK,
les fournisseurs sourcés, le refus des mutations hors brouillon et les exports
groupés sans troncature. Les 39 cas conservent les garanties SITE-01A de revue,
reprise idempotente, atomicité, autorisation et réservation durable.

### Application locale et conservation des données

L'application a suivi la revue du SHA de migration et de l'inspection
`native-before-2026-10-11T09-45-37.json`. Le helper `apply-native.py` refuse un
changement de base depuis cette inspection, un SHA différent ou une autre
migration en attente. Il a appliqué exclusivement cette migration via
`supabase migration up --local`, puis relu et comparé l'état résultant.

Le reçu [`native-application.json`](../../.e2e/purchase-decimals/native-application.json)
porte `status: verified`, terminé à **09:47:59 UTC**. Son SHA-256 est
`49c8b3a9d6af5751f64fb4bc7f13f244b0f6d41c56880ab83eb4f0eaf66ded0a`.
Il établit les points suivants :

- Données et timestamps des 15 tables métier contrôlées conservés, ainsi que
  propriétaires, ACL, politiques RLS et triggers préexistants.
- **20 unités historiques complétées** exclusivement depuis les snapshots
  privés fiables de préparation ; **46 unités laissées inconnues**.
  Aucune unité n'est inventée depuis un catalogue ou un devis actuel.
- Reçus initiaux et registre des transferts inchangés. Aucun événement
  d'historique fabriqué pendant le backfill. Toutes les révisions historiques
  sont initialisées à **1**, avec borne sûre JavaScript et incrément contrôlé.
- Corps installés et privilèges des **cinq RPC** et **sept helpers** vérifiés.
  RPC accessibles à `authenticated`, pas à `anon` ni `service_role` ; helpers
  privés et tables d'historique sans droits API. Ancienne surcharge d'édition
  sans révision révoquée. L'export reste `SECURITY INVOKER` et `STABLE`.
- Quantités stockées en `numeric` sans typmod, avec contraintes de précision
  et de plage. Le backfill ne modifie pas les dates historiques.

Les hashes des états relus sont conservés dans le reçu :
avant `7c4aa7efc7a436f9db84fc8c06e911ad1d192a8ac97be72ae0160e903a81fcd6`,
après `880ce301af36efe8a3c87076f89ad0ba274961576ca81cd1f22fa1595a8749ea`,
registre/unités `4ce56b5f6a78be823e9cfd03606d3e3019f078ffbee8a8592d43135d65dae73f`.

Le manifeste a été complété pour cette seule nouvelle migration avec
`npm run supabase:manifest:add`, puis `npm run supabase:validate` a réussi.
Le résultat est consigné dans `manifest-validation.json` ; aucune empreinte
d'une migration antérieure n'a été réécrite.

### Contrôle indépendant après les tests installés

La lecture indépendante à **09:50:24 UTC** est archivée dans
[`2026-10-11T09-50-24-664407Z-verify.json`](../../.e2e/purchase-decimals/2026-10-11T09-50-24-664407Z-verify.json),
SHA-256 `be870e8728bd3ebd684567b66b640d11f63fe4d87ad7c56ef7823b78c2fe966f`.
Elle confirme migration enregistrée, RPC présente, acteur toujours admin dans
un tenant actif, et **zéro fixture SQL résiduelle** des deux suites pour tous
les compteurs contrôlés : tenants, projets, versions, produits, fournisseurs,
commandes et lignes.

### Limites de cette preuve

La création manuelle est atomique mais n'est pas idempotente. Seule la
préparation SITE-01A possède la reprise par intention idempotente. Les achats
partiels, reliquats, conversions et réceptions quantitatives ne sont pas
réalisés par cette migration.

Les courses à plusieurs connexions et les parcours TesterArmy sont qualifiés
par leurs campagnes distinctes. Cette preuve SQL séquentielle ne revendique
pas leur succès, ni une authentification HTTP, un rendu de document ou une
qualification distante. Les scénarios d'import figurant au cadrage initial
restent eux aussi à distinguer des assertions SQL exécutées ici.
