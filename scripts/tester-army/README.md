# Outillage TesterArmy

Les commandes publiques sont dans [le guide des tests](../../e2e/README.md).
Les sources suivantes définissent le comportement ; éviter de recopier leurs
inventaires et nombres attendus dans un rapport de campagne.

| Source | Rôle |
| --- | --- |
| `../run-tester-army.mjs` | Wrapper de sélection, manifeste, rapport frais, expurgation et archivage |
| `../run-tester-army-ci.ts` | Pile autonome locale, contrôles DB, compte/tenant, build, parcours et destruction |
| `journey-preflight.mjs` | Collecte réelle, filtres, inventaire des parcours locaux hors sélections |
| `select-journeys.ts`, `army-impact-map.json`, `army-shards.json` | Sélection CI et répartition des fichiers |
| `aggregate-shards.ts` | Vérification des preuves de chaque shard et de leur union |
| `dev-loop.ts`, `dev-loop-state.ts` | Itérations réutilisables et reprise des ressources possédées |
| `calc-v3-campaign.ts`, `calc-v3-phases.ts`, `calc-v3-fixtures.ts` | Campagne de calcul/émission, sélections et préconditions |
| `build-local.mjs` | Build isolé et identité de ses entrées |

Les scripts `local-recipe*`, `local-native*`, `seed-*` et `qualify-*` servent
également des campagnes à profil explicite. Leurs anciens profils peuvent
contenir des chemins de machine, identités de pile et empreintes figées :
consulter leur `--help` et leur chargeur avant emploi, ne pas réutiliser un
ancien reçu comme preuve d'une pile neuve. `npm run check:army-recipes` vérifie
leurs refus et contrats hors réseau ; ce n'est pas une campagne navigateur.

Les documents encore référencés par `journey-preflight.mjs` conservent la trace
historique des parcours exécutés hors sélections permanentes. Les scripts
SQL `test-tiered-bulk-{aid,mosplit}-sql.mjs` et `check-offer-contract-sql.py`
empreintent aussi leurs documents : les supprimer sans adapter ces consommateurs
casserait leurs contrôles d'entrée.
