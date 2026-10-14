# CORE-08 — création d’une ligne et totaux immédiatement cohérents

## Contrat observable défini avant correction

Une réponse `201` à `POST /api/estimates/{versionId}/items` doit rendre la ligne et les totaux de sa version immédiatement cohérents. La recette lit la version dès la réponse, depuis une page neutre, sans ouvrir l’éditeur, enregistrer, attendre un autosave ou envoyer les totaux attendus. Elle conserve la réponse et cette première lecture avant toute assertion financière. Une lecture ultérieure ne remplace jamais cette observation immédiate.

Le défaut connu est distinct de CORE-07 : le parcours CCTP qualifié a prouvé une sauvegarde manuelle réparant un en-tête resté à `40000/8000/48000` malgré quatre lignes calculées à `71000/14200/85200`. Cette réparation ne prouve pas l’atomicité du `POST` individuel.

| Cas | Échec observable | Preuve exigée |
| --- | --- | --- |
| CA01 nominal V2 | `201` mais en-tête périmé, mauvaise TVA, ligne perdue ou jeton antérieur | Réponse et GET immédiat après chacun des quatre POST ; identités et valeurs exactes |
| CA01 persistance | L’éditeur ou l’export doit réparer le devis pour montrer le bon total | Ouverture puis vrai reload sans sauvegarde ; zéro POST bulk observé ; deux XLSX réellement téléchargés et parsés |
| CA02 compatibilité | Le correctif refuse un brouillon incomplet, invente un rôle, transforme un chapitre en ligne ou convertit un devis historique en V2 | Chapitre et ligne minimale créés via les routes réelles sur V2 puis V1 ; champs/defaults, moteur et identités relus |
| CA02 heures sans rôle | Une condition de publication devient une interdiction de sauvegarde en brouillon | Création `h_mo: 1`, rôle absent, `201`, heure conservée et coût MO nul sur ce témoin |
| CA03 précision PostgreSQL | Le calcul précède la normalisation décimale et ne correspond plus aux valeurs stockées | Trois POST réels aux demi-unités de précision : quantité, kFO et majoration horaire ; valeurs stockées et totaux immédiats exacts |
| Qualification | Un setup, un résultat filtré ou un export vide passe pour le parcours entier | Authentification + trois parcours sélectionnés, quatre résultats exécutés, aucun skip ; sources/build/fixtures/artefacts hachés |

Les refus transactionnels, rollback et courses simultanées sont des preuves natives distinctes. Deux lectures HTTP séquentielles ne prouvent pas une isolation concurrente.

## Oracle nominal V2

Paramètres : EUR, marge fixe 1, coefficient global 1, aucune remise ni arrondi commercial, TVA 2000 bp, rôle propriétaire unique à 4000 ct/h. Les deux chapitres sont eux aussi créés par API. Aucune ligne finale, application d’ouvrage ou snapshot n’est préinséré.

| Ligne créée | Quantité / unité | Achat unitaire | kFO | hMO | HT ligne | Totaux immédiatement après `201` (HT / TVA / TTC, ct) | Heures cumulées |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L1 réseau CH-A | 10 m | 4000 ct | 0,5 | 5 | 40000 | 40000 / 8000 / 48000 | 5 |
| L2 protection droite | 4 m | 1000 ct | 1 | 1 | 8000 | 48000 / 9600 / 57600 | 6 |
| L3 protection raccords | 2 u | 1500 ct | 1 | 0,5 | 5000 | 53000 / 10600 / 63600 | 6,5 |
| L4 canalisation ECS-B | 6 m | 2000 ct | 1 | 1,5 | 18000 | 71000 / 14200 / 85200 | 8 |

`kMO` et majoration horaire valent 1. Chaque réponse fournit un nouvel item dont les montants doivent correspondre à la relecture ; `version.id` et `version.updated_at` doivent correspondre à la version relue. Les champs de calcul/quantité/rôle et la hiérarchie des lignes déjà créées restent identiques. Après la dernière lecture immédiate, le test libère seulement son propre verrou par `DELETE /lock`, sans force. Il ouvre ensuite l’éditeur et attend son verrou réellement acquis (champ quantité activé) et le statut « Sauvegardé » ou « À jour », puis recharge réellement et télécharge Excel et DPGF. Aucun CtrlS, clic d’enregistrement ou PATCH des totaux n’est permis.

## Compatibilité V1/V2

Sur deux versions distinctes, initialement sans item :

1. POST `{item_type: "section"}` : titre de chapitre par défaut actuel, valeurs financières nulles, total nul.
2. POST `{item_type: "line", parent_id: chapitre}` : `title="Nouvelle ligne"`, `quantity=1`, `unit_price_ht_cents=0`, `h_mo=0`, rôle nul, montants nuls ; les champs omis restent omis dans la requête archivée.
3. POST d’une ligne nommée, quantité 2, achat 1000 ct, `h_mo=1`, sans rôle : `201`, une heure conservée, coût FO 2000 ct et MO 0 ; totaux `2000/400/2400` sous les paramètres ci-dessus.
4. Nouveau chapitre après la ligne positive : préserve toutes les identités, entrées et montants précédents, ainsi que `calc_engine_version`.

Ces valeurs sont ancrées dans `computeEstimateLineValues` : le taux absent vaut zéro, les coefficients absents valent un. `calculateEstimateBreakdownForItems` transmet le moteur de la version ; la validation des rôles complets de publication n’est activée que par `requireCompleteLaborRoleAssignments: true` dans le chemin de snapshot. Le témoin V1 est donc vérifié séparément, et non présenté comme une couverture de toutes les différences V1/V2. L’acceptation réelle avant correctif des heures sans rôle doit être conservée dans la baseline ; un refus observé serait un arbitrage à remonter, jamais une attente affaiblie silencieusement.

CA02 ajoute deux témoins V1 séparés pour le flag `EST_031_LABOR_SPLIT`, changé par la route normale `PATCH /api/feature-flags` sur le seul tenant neuf. Payload commun : quantité 2, achat 1000 ct, hMO legacy 1 avec RMO4000, hMO atelier 3 avec le même rôle. OFF doit donner `6000/1200/7200` pour la nouvelle ligne ; ON doit donner `14000/2800/16800`. Les lignes anciennes de chaque version restent identiques. Les témoins sont distincts afin de ne pas confondre cet oracle avec une revalorisation d’une ancienne ligne à payload split après changement du flag. Les courses de changement de rôle/palier/flag, la distinction flag absent/false/erreur et paliers vides/fallback relèvent des preuves natives/contextuelles séparées.

## CA03 — précision des champs stockés

Troisième V2 et son chapitre parent créés par API : quantité `1.0005` à 100000 ct devient `1.001`, ligne HT100100 ; kFO `1.0005` avec quantité1 et prix100000 devient `1.001`, ligne HT100100 ; majoration `1.00005` devient `1.0001`, hMO100 avec RMO4000 donne HT400040. Totaux cumulés attendus `100100/20020/120120`, `200200/40040/240240`, puis `600240/120048/720288` ; les trois requêtes brutes sont conservées avec les valeurs effectivement relues. Ce témoin HTTP prouve le câblage des précisions PostgreSQL, sans prétendre couvrir toutes les représentations numériques, exposants ou dépassements de capacité.

## Profil et préconditions proposés

Réutiliser le mode `coverage` de `scripts/run-tester-army.mjs`, son profil explicite, ses gardes de réseau/chemin/secrets et ses archives ; ajouter seulement `scenarioSet: "create-atomic"` pour sélectionner l’authentification et `estimate-create-atomic.e2e.ts`. Ce lot utilise `--max-failures 3` pour conserver les trois diagnostics baseline ; le CCTP conserve `--max-failures 1`. Le qualificateur CCTP conserve son exigence de douze résultats ; il ne qualifie pas ce nouveau lot.

Fixture minimale approuvée : `schemaVersion: "estimate-create-atomic-fixture-1"`, `status: "ready"`, origine locale exacte, préfixe `ARMY-CREATE-ATOMIC-`, propriétaire/tenant/RMO4000 neufs, deux affaires/versions **V1 vides** dédiées (`legacyV1`, `legacySplitV1`). Les trois affaires V2 sont créées par le `POST /api/estimates` ordinaire dans les parcours ; les versions historiques sont les seuls prérequis de devis insérés au seed, car le schéma public de création n’expose pas `calc_engine_version`. Le manifeste conserve leurs identités, paramètres et preuves initiales sans item. Aucun état financier final n’est semé.

Le profil pointe vers le reçu de la pile native dédiée et la sentinelle existante réelle ; il n’utilise pas un ancien inventaire « vide ». L’origine active autorisée à cette date est `http://127.0.0.1:45585`, portée par le profil ignoré, jamais figée dans le code durable. L’ancienne pile/DB `32959` est exclue. Environnement privé chargé explicitement, connexion navigateur ordinaire, traces désactivées, modèles non utilisés, aucun envoi ni changement de rôle historique.

**Préparation préalable :** plan et scénario écrits avant correction. Le coordinateur a ensuite approuvé cette forme de fixture et les exécutions locales ci-dessous. Les anciens onze parcours CCTP et leur qualificateur n’ont pas été modifiés pour cette baseline.

## Adaptation ultérieure des onze parcours CCTP

Ne pas modifier leur attente historique tant que le correctif CORE-08 n’est pas actif et prouvé. Une fois l’atomicité qualifiée, remplacer uniquement le bloc de synchronisation S0 de `source-coverage-support.ts` par : archiver/assertion `71000/14200/85200` dès la troisième création ; après reload attendre l’éditeur prêt et « Sauvegardé »/« À jour » ; conserver la fenêtre observée de trois secondes sans POST bulk et les mêmes totaux ; supprimer le CtrlS de réparation devenu sans objet. Garder toutes les assertions S0/S1, huit heures, application/snapshot, exports et invalidations. La preuve CORE-07 historique reste archivée ; une nouvelle qualification complète CCTP devra être explicite et distincte.

## Baselines exécutées le 12 octobre 2026

Les trois archives utilisent le build Windows `cQIFaqMjaqekBmvB5tm44`, Node 24.19.0 et Chromium desktop Windows, sur l’origine API dédiée `45585`. Chaque campagne utilise un nouveau compte/tenant, deux V1 vides et des V2 créées par API. Les manifestes déclarent quatre résultats sélectionnés et exécutés, aucune exclusion, zéro skip, zéro appel modèle, zéro téléchargement, sources inchangées. Les échecs restent des échecs ; aucune de ces archives ne qualifie le correctif, l’éditeur ou les exports.

| Archive sous `.e2e/army/coverage/runs/` | Résultat observé | Interprétation |
| --- | --- | --- |
| `2026-10-12T02-12-40-251Z` | Auth PASS, trois échecs avant création d’item | Attente du harnais `POST /lock=200` erronée ; la route retourne correctement `201` et tous les booléens de possession étaient vrais. Corrigée sans changement produit. |
| `2026-10-12T02-13-55-630Z` | Auth PASS, CA01 RED métier ; CA02/CA03 interrompus sur HTTP400 | CA01 archive déjà les quatre bonnes lignes avec en-tête nul. Les dernières branches CA02 et CA03 omettaient le chapitre parent obligatoire : « Une ligne doit être ajoutée sous une section. » Les préconditions ont été corrigées, sans abaisser les montants attendus. |
| `2026-10-12T02-15-56-429Z` | Auth PASS, trois RED métier, tous les POST d’items prévus ont reçu `201` | Baseline stable complète avant correction : incohérence des totaux, flag V1 ignoré et calcul avant arrondi des champs stockés. |

Dernier manifeste SHA-256 : `ae3e2d1ef5792abc5f76e508a99aba80fa126108c15243d3f96999453eb167b8`. Fixture : `.e2e/army/coverage/fixtures/create-atomic-baseline-03/fixture.json`, SHA-256 `e13726cc1cb253767de54c5082c172541ebbe30d8d7ea5bdddb60ec67e84886b`. Profil exact : `.e2e/source-coverage/disposable-native/runs/729799711d9c404b/coverage-preparation/run-profile-create-atomic-baseline-03.json`. Les reçus de provisioning conservent les lectures ordinaires initiales des deux V1 vides et la sentinelle existante inchangée ; ils ne prétendent pas avoir relu toutes les données historiques.

Constats de la dernière archive, avant toute ouverture d’éditeur :

- **CA01 :** lignes HT `40000`, `8000`, `5000`, `18000`, mais en-tête `0/0/0` immédiatement après chaque création, au lieu des quatre paliers attendus. Chaque état est conservé dans `ca01-line-N-immediate.json` et récapitulé dans `ca01-immediate-summary.json`.
- **CA02 :** les chapitres, champs omis et heures positives sans rôle sont acceptés en V1 et V2. Les defaults sont conservés et la ligne sans rôle vaut bien `2000/400/2400` ; son en-tête reste nul. Après le PATCH ordinaire confirmant flag OFF, la ligne à payload atelier vaut pourtant HT`14000`, au lieu de `6000`. Le témoin séparé flag ON vaut bien HT`14000`. Le défaut OFF est visible dans `ca02-v1-split-off-immediate.json`, même si la première assertion financière qui termine CA02 concerne l’en-tête nul.
- **CA03 :** quantité et kFO sont bien stockés à `1.001`, mais chaque ligne garde HT`100050` au lieu de `100100`. La majoration est stockée à `1.0001`, mais la ligne MO garde HT`400020` au lieu de `400040`. Les trois requêtes, les réponses et les lectures sont dans `ca03-*-immediate.json` et `ca03-precision-observations.json`. L’en-tête reste également nul.

Les noms ci-dessus sont préfixés par l’identifiant ARMY propre au test dans `artifacts/business/`. Toutes les libérations de verrous de la baseline complète sont des DELETE normaux de la session propriétaire, sans force. Les identifiants de session ne sortent pas de la mémoire du navigateur. Les sources/harness ont été libérés après le terminal ; la suite attend le correctif et un nouveau build explicite avant une campagne GREEN sur nouvelles fixtures.

## Lecture du futur résultat GREEN

`scripts/tester-army/qualify-estimate-create-atomic.mjs <archive-exacte>` est préparé et contrôlé par syntaxe/lint ; il n’est pas encore exécuté. Il reprend les vérifications du lecteur CCTP (archive complète, SHA, sources/build, origine locale, profil/fixture, réseau, zéro modèle/trace et scan des secrets configurés) avec ses propres quatre titres et preuves CA01/02/03. Il exige les paliers financiers exacts, les GET immédiats, les deux moteurs/defaults et états réels du flag, les trois valeurs décimales stockées, l’absence de bulk pendant ouverture/reload/exports et deux téléchargements XLSX réels. Il utilise une sélection exacte des fichiers métier, jamais un suffixe ambigu.

Exécuter seulement sur un run terminal GREEN explicitement désigné, avec le même environnement privé backend puis fixture et l’index Git alternatif. Il produit un dossier inédit sous `.e2e/army/coverage/atomic-qualifications/`, `qualification.json` et son SHA, sans relancer le navigateur ou contacter la base. Le lecteur CCTP à douze résultats reste intact. Les preuves natives de rollback/concurrence et l’application locale de migration doivent être reliées séparément par le coordinateur ; ce lecteur ne les invente pas.

Le build corrigé préparé pour cette étape est `VvHbNXoMA0g2N-2OfwSpb`, manifeste `.e2e/product-foundation/builds/2026-10-12T02-25-17-349Z/manifest.json`, SHA-256 `77f929384ae9f801160ad631bfed53b5970c1336fc23a96dde689fb71875ffdd` : étapes de build/OpenAPI réussies, cinq budgets validés, sources stables. Cette preuve de compilation n’est pas un résultat E2E. Au moment de sa préparation, une course native concernant la cible effective d’un déplacement de rôle impose d’attendre une correction SQL additionnelle et son nouveau reçu de transport. Aucune fixture GREEN n’a été créée sur la base de ce seul build.

## Résultat GREEN qualifié — 12 octobre 2026, 02:37 UTC

Archive exacte : `.e2e/army/coverage/runs/2026-10-12T02-37-27-533Z`, manifeste SHA-256 `f6be88c154b994958a3d3a3b65d480a50ba0e7ec9128010609b45404150dec06`. **Quatre résultats sélectionnés/exécutés/passés**, zéro skip/flaky/modèle, deux téléchargements réels, sources et build inchangés. Exécution Windows du build Windows `VvHbNXoMA0g2N-2OfwSpb` ; fixture `create-atomic-green-01`, SHA-256 `4042a61ce8f33ec4125f93843d9ce4eb2fd522d01607ed934929e2bb2f5950c6`.

La qualification `.e2e/army/coverage/atomic-qualifications/2026-10-12T02-37-27-533Z-0b43a4e9/qualification.json` est **PASS : 2592 contrôles, aucun échec** ; SHA-256 `3b15b4ed0b63adfbe720b68863a26d4e673595ab2dfde47d9fdd2fdc986f4115`. Le scan porte sur 175 fichiers texte sans conserver les valeurs sensibles. CA01 prouve les quatre paliers immédiats, la relecture de l’éditeur et les deux exports sans bulk de réparation ; CA02 conserve les defaults, heures sans rôle et moteurs V1/V2, avec `6000` en split OFF et `14000` en split ON ; CA03 prouve les champs arrondis et montants correspondants.

La première lecture de qualification est conservée comme **échec du lecteur**, SHA-256 `20868e831419c5adec637275c1ba3da8f4526b7ceeda1fb193b9efc9358baf3f` : elle imposait une extension `.xlsx`, alors que le SDK avait conservé les deux fichiers Excel valides sans extension. Aucun rerun navigateur n’a été effectué pour cela. Une copie revue a remplacé ce critère par le chemin exact remappé dans l’archive, le SHA et une seconde lecture indépendante ExcelJS comparant toutes les cellules. Copie utilisée SHA-256 `355a9338438654d14bdedcf8b5a16c84534d7e28add9b6b58f0811b7c83d0e58`, conservée avec `preparation.json` à côté du verdict ; reçu de conservation SHA-256 `f8a828a9d897cc1d5bf5338f8e2344f23e9a127dff7fc28901d146a735c97159`. La promotion canonique par le coordinateur est postérieure à la qualification (`.e2e/atomic-reader-reviewed/promotion.json`, SHA-256 `23258b7d4ceb194cd9af1abda8401e8f2700c1de898e9c9b723b612bd2020ef5`) ; elle ne réécrit pas les entrées historiques.

Le profil conserve la chaîne native explicite : application de `20261012020700_atomic_create_estimate_item.sql` (SHA `12af939473dab9be200e37e191e91b19a0a220610ba8c743da2f9e0271071b31`), correction additionnelle `20261012023009_guard_normalized_estimate_calculation_tenant.sql` (SHA `20c7fd7c31788eab0ab607774f3449618f1ff72afe3ad534d9d47039f7bc73a9`), reçu pgTAP puis transport `core08-qualified/stack.json` SHA `096f2f8a7e04bdf2753f238416f83054dfd3ef7bd76e2588bb2b3d47dfab077d`. Le lecteur vérifie la concordance des reçus et des sources ; la qualification détaillée des neuf courses et 1232 assertions natives reste séparée de cette preuve HTTP/UI.

Limites : périmètre nominal V2 sans remise pour les exports ; compatibilité V1 de brouillons, pas aptitude à publication ni généralisation à toutes les remises ; aucune qualification production, pixel, impression PDF, performance ou matrice complète de rôles. CORE-06 sortie rapide après reload demeure distinct. L’adaptation CCTP retire désormais seulement la sauvegarde de réparation après les trois POST, exige leurs totaux immédiats et conserve la fenêtre de trois secondes sans bulk ; elle nécessitera son propre nouveau résultat à douze cas.
