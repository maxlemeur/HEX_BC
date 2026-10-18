# Lectures complètes PostgREST — contrat avant correction

Base : main 59b3b6bf. Périmètre : tous les P1/P2 de l’audit du 18/10/2026,
à l’exclusion de la copie de sections v1/v2 et des P3 indépendants.

Défaillances observables à prévenir avant implémentation :

- Un DPGF de 2 501 postes est créé avec 1 000 postes, ou ses doublons tardifs
  sont absents. Parcours Army : import JSON réel, mapping puis création depuis
  la source liée, contrôle des 2 501 titres/quantités et du total exact.
- Un modèle/ouvrage de plus de 1 000 items est entièrement écrit en SQL mais
  renvoyé partiellement. Parcours : insertion normale, contrôle des IDs renvoyés
  contre les IDs persistés, des montants et du rechargement.
- Une relation 1:N dépasse le plafond même avec 100 parents : preuves, risques,
  registre, métriques, pièces et statistiques deviennent incomplets. Vérifier
  l’exhaustivité des ensembles et des exports, pas uniquement leur HTTP 200.
- Un snapshot incomplet est utilisé pour restaurer des métrés après panne ;
  aucune suppression ne doit commencer après une lecture échouée/incomplète.
- Un changement de compte, une page manquante, des IDs dupliqués ou une erreur
  de page suivante ne doivent jamais retourner un préfixe comme résultat complet.
- Les filtres tenant, limites métier explicites (5 000/10 000/50 000), tris et
  contrôles de révision doivent rester effectifs. Les RPC d’écriture ne sont
  jamais réexécutées pour en paginer le résultat.

Exception d’isolation définie avant le code : les erreurs réseau entre pages,
les comptes incohérents et les doublons de transport serveur ne sont pas
injectables de façon fiable par une route navigateur (PostgREST est appelé
côté serveur). La régression du lecteur partagé utilise le vrai SDK Supabase
avec un transport HTTP contrôlé. Elle vérifie les plages, le contrat count,
les résultats, les erreurs et les filtres ; elle ne remplace pas Army sur la
base native pour les parcours métier. Aucun secret distant n’est nécessaire.

## Correction et couverture

Les 54 constats P1/P2 de l’[audit historique](../audits/postgrest-1000-rows-2026-10-18.md)
sont traités : 14 groupes P1 (32 sites) et 40 groupes P2 (91 sites), soit
121 SELECT et deux RPC d’insertion. Les numéros et lignes de l’audit restent
ceux de main 59b3b6bf, avant correction.

- `src/lib/supabase/read-all.ts` lit des plages de 500 lignes avec compte exact,
  ordre stable incluant la PK et validation du compte/des identités. Erreur de
  page, page courte, doublon ou compte changeant : aucun préfixe réussi retourné.
- Les filtres `IN` sont découpés en 150 valeurs au plus avec un budget encodé
  de 6 000 caractères ; chaque lot est lui-même paginé (relations 1:N comprises).
  Les tris existants sont conservés et recomposés lorsque nécessaire entre lots.
- Les limites métier existantes restent explicites : catalogue 5 000,
  recherche de doublons 10 000, audit d’anomalies 50 000.
- Les writers de modèles/ouvrages sont appelés une seule fois. Les nouvelles
  RPC `*_with_receipt` agrègent le résultat SQL en JSONB avant PostgREST,
  avec compte, lignes et ordre de restitution. Les consommateurs refusent
  un reçu incohérent. Les fonctions existantes gardent les autorisations,
  le moteur et la transaction ; les wrappers sont `security invoker`, sans
  droit pour `anon`. Migration nouvelle, jamais appliquée au distant.
- Les trois recharges rendues non bornées par la correction amont sont aussi
  traitées : prix fournisseur des preuves, auteurs des preuves et indices
  matériaux des suggestions catalogue. La revue indépendante a identifié les
  dépendances fonctionnelles prix/indices ; suivi ciblé sans
  défaut restant sur ces corrections.
- La copie de sections v1/v2 et les P3 indépendants restent hors périmètre.

Les 32 suites métier existantes adaptées fournissent des résultats Supabase
complets à la frontière du lecteur via `src/test/complete-reads-fixture.ts` ;
leurs assertions métier sont conservées. Ces doubles ne prouvent pas la
pagination : cette preuve est portée par les tests de transport avec le vrai
SDK et les parcours sur PostgREST natif.

| Constat d’audit | Table(s) | Sites | Protection appliquée |
| --- | --- | ---: | --- |
| P1 · 01 | dpgf_rows_mapped | 1 | Pagination SELECT / lots IN selon filtres |
| P1 · 02 | estimate_template_items | 2 | Pagination SELECT / lots IN selon filtres |
| P1 · 03 | RPC insert_estimate_template_into_version → SETOF estimate_items ; estimate_items | 2 | Reçu SQL JSONB + SELECT paginés associés |
| P1 · 04 | RPC insert_estimate_assembly_into_version → SETOF estimate_items | 1 | Reçu SQL JSONB + SELECT paginés associés |
| P1 · 05 | estimate_assembly_items | 1 | Pagination SELECT / lots IN selon filtres |
| P1 · 06 | takeoff_results ; takeoff_items ; takeoff_run_metrics | 3 | Pagination SELECT / lots IN selon filtres |
| P1 · 07 | estimate_items | 1 | Pagination SELECT / lots IN selon filtres |
| P1 · 08 | estimate_items | 2 | Pagination SELECT / lots IN selon filtres |
| P1 · 09 | estimate_items ; estimate_item_outlier_dismissals ; supplier_pricebook ; estimate_rules | 4 | Pagination SELECT / lots IN selon filtres |
| P1 · 10 | estimate_risk_alerts | 2 | Pagination SELECT / lots IN selon filtres |
| P1 · 11 | supplier_pricebook | 1 | Pagination SELECT / lots IN selon filtres |
| P1 · 12 | affaire_register_entries | 1 | Pagination SELECT / lots IN selon filtres |
| P1 · 13 | takeoff_jobs ; takeoff_version_links ; takeoff_items ; takeoff_dpgf_links | 4 | Pagination SELECT / lots IN selon filtres |
| P1 · 14 | estimate_rules ; estimate_approvals | 7 | Pagination SELECT / lots IN selon filtres |
| P2 · 15 | takeoff_items | 1 | Pagination SELECT / lots IN selon filtres |
| P2 · 16 | dpgf_rows_mapped ; products | 3 | Pagination SELECT / lots IN selon filtres |
| P2 · 17 | products ; suppliers | 3 | Pagination SELECT / lots IN selon filtres |
| P2 · 18 | estimate_items | 3 | Pagination SELECT / lots IN selon filtres |
| P2 · 19 | estimate_items ; takeoff_dpgf_links ; takeoff_dpgf_review_decisions ; dpgf_rows_mapped | 4 | Pagination SELECT / lots IN selon filtres |
| P2 · 20 | estimate_line_evidences | 2 | Pagination SELECT / lots IN selon filtres |
| P2 · 21 | estimate_line_evidences | 1 | Pagination SELECT / lots IN selon filtres |
| P2 · 22 | estimate_items | 1 | Pagination SELECT / lots IN selon filtres |
| P2 · 23 | affaire_register_entries | 1 | Pagination SELECT / lots IN selon filtres |
| P2 · 24 | affaire_register_entries | 3 | Pagination SELECT / lots IN selon filtres |
| P2 · 25 | affaire_intake_documents | 3 | Pagination SELECT / lots IN selon filtres |
| P2 · 26 | plan_sets ; plan_files | 2 | Pagination SELECT / lots IN selon filtres |
| P2 · 27 | plan_files | 3 | Pagination SELECT / lots IN selon filtres |
| P2 · 28 | estimate_items (sections historiques) ; estimate_template_items (sections) ; affaire_intake_documents (CCTP) | 3 | Pagination SELECT / lots IN selon filtres |
| P2 · 29 | estimate_structure_draft_nodes | 1 | Pagination SELECT / lots IN selon filtres |
| P2 · 30 | estimate_structure_draft_applications ; estimate_structure_drafts | 2 | Pagination SELECT / lots IN selon filtres |
| P2 · 31 | estimate_generated_ouvrage_drafts ; estimate_generated_ouvrage_source_fragments | 2 | Pagination SELECT / lots IN selon filtres |
| P2 · 32 | estimate_version_zero_drafts | 2 | Pagination SELECT / lots IN selon filtres |
| P2 · 33 | estimate_versions | 1 | Pagination SELECT / lots IN selon filtres |
| P2 · 34 | estimate_versions | 1 | Pagination SELECT / lots IN selon filtres |
| P2 · 35 | estimate_versions | 1 | Pagination SELECT / lots IN selon filtres |
| P2 · 36 | estimate_versions | 1 | Pagination SELECT / lots IN selon filtres |
| P2 · 37 | estimate_items ; supplier_pricebook ; estimate_item_outlier_dismissals | 3 | Pagination SELECT / lots IN selon filtres |
| P2 · 38 | audit_logs | 1 | Pagination SELECT / lots IN selon filtres |
| P2 · 39 | takeoff_jobs ; takeoff_run_metrics ; takeoff_results ; takeoff_items ; audit_logs | 5 | Pagination SELECT / lots IN selon filtres |
| P2 · 40 | takeoff_jobs ; estimate_risk_alerts ; affaire_register_entries ; takeoff_dpgf_links ; takeoff_dpgf_review_decisions ; estimate_items | 6 | Pagination SELECT / lots IN selon filtres |
| P2 · 41 | takeoff_dpgf_review_decisions ; takeoff_items ; takeoff_dpgf_links ; takeoff_version_links ; estimate_items | 6 | Pagination SELECT / lots IN selon filtres |
| P2 · 42 | estimate_review_cycles ; estimate_review_comments ; estimate_review_correction_items ; estimate_review_correction_events ; audit_logs | 5 | Pagination SELECT / lots IN selon filtres |
| P2 · 43 | estimate_risk_alerts ; affaire_register_entries | 2 | Pagination SELECT / lots IN selon filtres |
| P2 · 44 | estimate_items ; estimate_template_items | 2 | Pagination SELECT / lots IN selon filtres |
| P2 · 45 | estimate_assembly_items ; estimate_assembly_members | 2 | Pagination SELECT / lots IN selon filtres |
| P2 · 46 | purchase_order_devis | 1 | Pagination SELECT / lots IN selon filtres |
| P2 · 47 | purchase_order_devis | 1 | Pagination SELECT / lots IN selon filtres |
| P2 · 48 | purchase_order_devis | 1 | Pagination SELECT / lots IN selon filtres |
| P2 · 49 | labor_roles ; margin_tiers | 4 | Pagination SELECT / lots IN selon filtres |
| P2 · 50 | labor_roles ; margin_tiers | 2 | Pagination SELECT / lots IN selon filtres |
| P2 · 51 | estimate_items ; margin_tiers ; labor_roles | 3 | Pagination SELECT / lots IN selon filtres |
| P2 · 52 | estimate_item_outlier_dismissals | 1 | Pagination SELECT / lots IN selon filtres |
| P2 · 53 | dpgf_catalogue_links | 1 | Pagination SELECT / lots IN selon filtres |
| P2 · 54 | dpgf_rows_raw | 1 | Pagination SELECT / lots IN selon filtres |

## Validation et intégration de main

À la demande du propriétaire pendant la correction, `origin/main` a été
récupéré puis intégré par avance rapide de `59b3b6bf` à `51bce775` (PR #45
émission v3 et PR #63 message de marge v3). Les changements locaux ont été
sauvegardés, réappliqués et revus dans les six fichiers partagés. Le seul
conflit, dans le manifeste, conserve les deux migrations et leurs empreintes.
À ce stade de validation : aucun commit de correction, push, PR ou changement de Supabase distant.

Environnement observé : Linux cloud, Node 24, Supabase CLI 2.120.0 natif,
PostgreSQL/PostgREST locaux jetables, aucune credential distante configurée.

| Contrôle | Résultat observé |
| --- | --- |
| `npm run verify:pr` sur la copie de validation de `51bce775` avec le correctif | Réussi : audit des dépendances/signatures, budgets, OpenAPI, types, lint, 3 289 tests Node, 831 jsdom et 12 de frontière critique. Deux tests Node préexistants sautés ; ne constituent aucune preuve métier. |
| `npm test -- --project=node src/lib/supabase/read-all.test.ts` | 8 régressions de transport réel SDK réussies ; module absent puis cas URL longue observés rouges avant leurs implémentations respectives. |
| `npm test -- --project=node src/test/army-impact-map.test.ts` après renommage du scénario | 21 tests réussis. |
| `npm run supabase:validate` | Inventaire et empreintes cohérents après intégration. |
| `npm run db:ci:local -- --files supabase/tests/database/complete-estimate-receipts.test.sql --skip-rls` | Réussi : 10 assertions, 18 s de pgTAP. Une section + 1 001 lignes modèle et arbre de 1 050 composants ; compte/IDs exacts, une seule insertion, accès anon refusé. Les statistiques des fixtures sont analysées explicitement pour garder le parcours isolé indépendant des autres fichiers. |
| SQL/RLS dans le runner ciblé Army | Suite pgTAP complète et matrice RLS réussies sur main intégré. |
| `git -c core.whitespace=cr-at-eol diff --check` | Réussi ; fins de ligne CRLF préexistantes conservées. |
| Revue indépendante | Deux dépendances prix/indices corrigées, suivi ciblé sans défaut restant ; revue d’intégration des six fichiers partagés sans perte d’apport de main. |

La copie `/tmp/hex-postgrest-validation` porte le même code et le même HEAD.
Elle évite un défaut préexistant de l’environnement : les très grands numéros
d’inode du checkout sont arrondis par `fs.lstatSync` sans `bigint`, et le test
existant du parseur `--files` considère à tort deux fichiers distincts comme
identiques. Aucun garde-fou du runner n’a été changé pour contourner cet échec.
Après le renommage du scénario, sa sélection a été revérifiée séparément.

Les préparations interrompues restent des échecs de préparation : accès direct
aux artefacts natifs/polices refusé, première fixture sans section parente,
renommage pour éviter le faux positif du contrôle de confidentialité sur la
chaîne d’un nom de fichier, puis synchronisation demandée de main. Leurs
artefacts ne qualifient pas le parcours et ceux rejetés par le contrôle de
confidentialité ne doivent pas être publiés. Les protections sont conservées.
La campagne globale commencée avant l’intégration a été arrêtée : le nouvel
AGENTS.md réserve ces campagnes à la CI et demande des parcours locaux ciblés.

Dans ce cloud, les launchers nettoient les variables de transport. La recette
ciblée utilise un adaptateur hors dépôt qui transmet uniquement le proxy et
les certificats aux processus Node/Supabase ; aucune variable de routage vers
une base distante n’est ajoutée. Les archives natives officielles sont mises
en cache après vérification des SHA d’archive et manifeste du CLI installé.
Commande de qualification :

```sh
node --require /tmp/hex-cloud-transport.cjs --import tsx \
  scripts/run-tester-army-ci.ts critical --grep PG1000
```

Le scénario `e2e/army/local/large-row-completeness.e2e.ts` vérifie les vrais
endpoints authentifiés : import JSON de 2 501 postes, doublon au-delà de la
première page, mapping, création DPGF liée, montants exacts 250 100 / 50 020 /
300 120 centimes, lecture du modèle entier, puis instanciation complète du modèle.
L’égalité des IDs de reçus/persistance est vérifiée par le spécialiste SQL.


Deux échecs déterministes de la nouvelle fixture navigateur ont été corrigés,
sans changer le produit :

- `.e2e/army/ci/2026-10-18T16-47-16-912Z-critical` : `APP_NOT_OPEN` avant
  la première requête. Ajout de `app.open("/dashboard")` avant le compte dédié.
- `.e2e/army/ci/2026-10-18T16-50-15-633Z-critical` : le DPGF, doublon tardif,
  montants et lecture du modèle passent ; insertion refusée en 409 car la
  route des modèles ne déduit pas la session de verrou d’une URL de version.
  La fixture envoie maintenant le même en-tête de session explicitement aux
  routes d’acquisition et d’insertion. Aucun contrôle de verrou n’est modifié.


Limite observée, conservée comme telle :
`.e2e/army/ci/2026-10-18T16-52-47-800Z-critical` atteint la route d’insertion
avec une session de verrou correcte, puis reçoit HTTP 400 / SQLSTATE 57014
sur le modèle de 2 501 lignes (délai de rôle de 8 s). La transaction est
annulée ; ce n’est pas un résultat partiel présenté comme réussi. La
qualification API de cette insertion volumineuse reste manquante dans ce
cloud. La régression SQL des reçus, sous rôle authenticated avec délai de
spécialiste de 60 s, passe avec ses 1 001 lignes modèle et 1 050 composants.
Le scénario API conservé qualifie import, lecture et instanciation canonique ;
il ne qualifie pas la performance de la route d’insertion de 2 501 lignes.
Aucun délai SQL produit ni contrôle d’accès n’a été augmenté pour le faire passer.

`.e2e/army/ci/2026-10-18T16-56-25-513Z-critical` atteint également
l’instanciation (HTTP 201). La fixture utilisait une réponse imbriquée
`project/version` ; le contrat réel renvoie `projectId/versionId`. Le type de
la fixture et la relecture ont été alignés sur ce contrat, avant le démarrage
du parcours navigateur suivant.

## Qualification finale du parcours canonique

Commande ci-dessus, HEAD `51bce775` + correctif local, run
[2026-10-18T16-58-45-596Z-critical](../../.e2e/army/ci/2026-10-18T16-58-45-596Z-critical/manifest.json) :
statut **passed**, contrôle de confidentialité **passed**, Chromium desktop,
2 tests sélectionnés/exécutés/réussis (connexion et PG1000), aucun échec,
saut, retry réussi ou interruption parmi les tests sélectionnés. La source
et le build sont restés inchangés pendant le parcours navigateur.

Résultat conservé dans `critical/artifacts/business/*-pg1000-complete.json` :
2 501 IDs de lignes, 2 502 items dans le modèle avec sa section, doublon aux
positions source 0 et 2 500, puis 2 501 lignes après instanciation et totaux
HT/TVA/TTC de **250 100 / 50 020 / 300 120 centimes**. Les 25 fichiers pgTAP
passent leurs 1 951 assertions et la matrice RLS passe sur la même pile locale.
La limite de la route d’insertion de 2 501 lignes reste celle indiquée plus haut.

Les journaux qualité, régressions SDK, SQL isolé et empreintes des changements
sont conservés dans
[large-row-quality-2026-10-18](../../.e2e/army/ci/large-row-quality-2026-10-18/source.json).
Sur un poste avec accès réseau direct, reproduire le parcours avec
`npm run e2e:army:local -- --grep PG1000` ; l’adaptateur de transport mentionné
plus haut concerne uniquement ce cloud.

## Préparation de la publication autorisée

Après autorisation de commit et push sur `main`, récupération et intégration de
`31a009eb` : seul `AGENTS.md` change depuis la qualification ci-dessus, avec
l’exception de performance propriétaire pour la copie de sections v3, hors périmètre.
La migration locale est renommée en
`20261018170351_complete_estimate_insertion_receipts.sql` par l’outil de restamp :
SQL et SHA-256 inchangés, aucune autre référence réécrite. Le garde Git contre
`31a009eb` et la validation du manifeste passent. Les preuves métier précédentes
portent sur ce même SQL et ce même code applicatif ; aucune nouvelle exécution
métier n’est revendiquée pour ce renommage. Aucune migration distante appliquée.

Un push concurrent ajoute ensuite `85f630db` (attente du verrou dans le scénario
d’arrondi commercial et sa documentation). Le commit local encore non publié
est rebasé dessus sans conflit. Aucun code applicatif, SQL ou scénario PG1000
ne change ; le garde de migration et la fusion propre sont revérifiés contre
cette nouvelle base avant l’envoi.
