# Chemins d'entrée v3 (sous-lot 2.8)

Statut : **phase verte** (IO04 attend le 2.6), branche `lot2/2.8-chemins-entree-v3` (base `main` `78ca0855`,
2.9 compris).
Source : [conception du lot 2](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md), §14 « 2.8 »,
D16, D11, §5.4, §6.1 M6, §7 ; décisions P-12 et P-14 (validées le 16/10/2026). Dépendances livrées : 2.3
(profil OPTIMA, parseurs), 2.5 (persistance v3, M4). Le collage dans la grille v3 dépend du 2.6, en cours ;
ses scénarios ne dépendent pas des libellés de la grille v3.

Règle d'entrée, tous moteurs : aucune ligne d'un devis existant n'est modifiée ; un chemin vers une v1/v2 se
comporte comme avant (corpus figé, empreintes documentaires et montée de version identiques).

## Règles retenues

Une v3 porte les heures **par unité** (`h_mo_per_unit`, `h_mo_atelier_per_unit`, `h_mo_chantier_per_unit`,
4 décimales) et son unité en `unit_code` (référentiel `measurement_units`) ou un statut `pricing_status` ;
`h_mo*` = arrondi(Q × h/u, 3) est dérivé par le déclencheur de M4. Chaque chemin d'entrée **convertit
explicitement ou refuse** (D16) ; aucun ne multiplie des heures par unité par Q.

1. **Import OPTIMA vers une v3** (création d'un chiffrage depuis l'import, sous politique 3 ; le refus
   actuel de `canonical-v2-creation.ts:820` est levé pour cette source) :
   - « Tps pose unitaire » → `h_mo_per_unit` direct ; une colonne d'heures de ligne doit être choisie
     explicitement en h/u sur une v3 ;
   - unité par le référentiel : code → `unit_code` ; mention de statut (HL, inc, NC, PM, CP, SO) →
     `pricing_status`, ligne à 0 € ; aucune ligne dont l'« unité » est un prix ;
   - ligne de paramètres L2:O2 : coefficients FO et MO proposés comme coefficients de vente de la v3,
     modifiables avant confirmation ; taux horaire comparé au rôle choisi, écart signalé ;
   - **import auto-vérifiant** : le PU v3 recalculé est comparé ligne à ligne à « Prix Unitaire » ; tout
     écart supérieur à 0,5 c est listé avant confirmation ;
   - provenance de l'import conservée sur chaque ligne (import, correspondance, ligne mappée, structure de
     feuille), comme pour `dpgf-import` ; `sourceDocumentId` et `_timax_provenance` restent ceux d'un import
     PDF (I9), chemin inchangé.
2. **Collage vers une v3** : les en-têtes OPTIMA sont reconnus (« Tps pose unitaire » → h/u, « Prix
   Unitaire » → contrôle) ; l'aperçu montre les valeurs interprétées.
3. **Ouvrage de bibliothèque vers une v3** : h/u = `h_mo / default_quantity`, exact à 4 décimales, sinon
   refus nommé ; quantité par défaut à 0 avec des heures → refus nommé ; unité normalisée.
4. **Ouvrage généré vers une v3** : la ligne porte le rendement par unité, jamais un total d'heures.
5. **Modèles** (P-12) :
   - colonnes v3 sur `estimate_template_items` (`unit_code`, `pricing_status`, h/u ×3), nulles et `priced`
     pour les modèles existants ;
   - modèle créé ou dupliqué depuis une v3 : colonnes v3 copiées ;
   - modèle v1/v2 inséré dans une v3 : h/u = h / Q, arrondi demi-supérieur à 4 décimales ; les lignes où
     arrondi(Q × h/u, 3) ≠ h sont listées à l'utilisateur ; Q nulle et h > 0 → insertion refusée, ligne
     nommée ;
   - modèle v3 inséré dans une v1/v2 : heures totales du modèle, colonnes v3 ignorées.
6. **Section importée d'une autre version** : mêmes règles que les modèles.
7. **Métré appliqué à une v3** : refus nommé `TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED`, aucune écriture (en place
   depuis 2.5, parcours V3P-17 rejoué).
8. **Structure IA, version zéro, mise à jour groupée directe** : refusées en v3 avec un message nommé (P-14).
9. Toute écriture v3 passe par le contrat d'écrivain (`miaouffrage.estimate_v3_writer`) ; montants des
   lignes et totaux de la version recalculés par le moteur v3 dans la même transaction.

## Interfaces (M6, `…_estimate_engine_v3_entry_paths.sql`, horodatée après M7 `20261017172127`)

| Objet | Changement |
|---|---|
| `estimate_template_items` | `unit_code` (FK), `pricing_status` (défaut `priced`), `h_mo_per_unit`, `h_mo_atelier_per_unit`, `h_mo_chantier_per_unit` ; déclarés neutres au contrôle de montée de version |
| `create_estimate_template_from_version`, `duplicate_estimate_template` | copient les colonnes v3 |
| `insert_estimate_template_into_version` | branche v3 : contrat d'écrivain, h/u direct ou converti, refus `22023 ESTIMATE_V3_TEMPLATE_HOURS_WITHOUT_QUANTITY` (détail : titre de la ligne), montants v3 recalculés |
| `materialize_estimate_assembly_tree` | branche v3 : h/u = h / quantité par défaut, refus `22023 ESTIMATE_V3_ASSEMBLY_HOURS_WITHOUT_QUANTITY` et `22023 ESTIMATE_V3_ASSEMBLY_HOURS_PER_UNIT_INEXACT` (détail : titre du composant) |
| `private.generated_ouvrage_insert_line`, `commit_generated_ouvrages` | branche v3 : h/u et `unit_code` acceptés, contrat d'écrivain, montants du moteur v3 par le pont (pas de projection client) ; `finalize_estimate_assembly_calculation` inchangée (écart 3) |
| `public.estimate_v3_complete_entry_for_writer` (nouvelle) | pont des écrivains d'entrée : brouillon v3 sous contrat, unités des nouvelles lignes, montants v3 stockés puis contrôlés |

Chaque fonction est copiée de sa dernière définition ; seules les lignes visées changent. Les littéraux de
moteur ajoutés rejoignent la liste blanche F-SQL-14 de `estimate-calc-engine-v3-guards.test.sql`, et les
sondes F-SQL-10 de ces chemins sont réécrites (refus attendu → comportement v3).

## Défaillances observables (état de `fc2ba2dc`)

| # | Défaillance | Où |
|---|---|---|
| E1 | Créer un chiffrage depuis un import sous politique 3 est refusé (`EstimateEngineUnavailableError`) | `canonical-v2-creation.ts:820` |
| E2 | « Tps pose unitaire » est converti en heures de ligne (h/u × Q) ; sur une v3 le déclencheur refuserait la ligne | `import-flow.ts:530-546`, `:265` |
| E3 | L'unité importée va dans `description` ; ni `unit_code` ni `pricing_status` ; une mention de statut reste une unité | `import-flow.ts:592` |
| E4 | La ligne de paramètres n'est qu'affichée : ni coefficients v3 proposés, ni taux comparé au rôle | `import-flow.ts:284-298` |
| E5 | Le contrôle « Prix Unitaire » est calculé par le moteur v1/v2 | `import-flow.ts:608-616` |
| E6 | Collage : aucune cible h/u, « Tps pose unitaire » inconnu ; un collage avec heures est refusé sur une v3 | `clipboard.ts:18-28`, `:172` ; `batch-preparation.ts:94-98` |
| E7 | Ouvrage de bibliothèque dans une v3 : refus `ESTIMATE_V3_WRITER_NOT_SUPPORTED` ; le calcul TS refuse la v3 | `materialize_estimate_assembly_tree` ; `assembly-calculation.ts:53` |
| E8 | Ouvrage généré dans une v3 : refusé ; la ligne porterait un total d'heures | `commit_generated_ouvrages`, `generated-ouvrage-labor-hours.ts:11-40` |
| E9 | Modèle dans une v3 : refusé ; un modèle n'a pas de colonnes v3 et un modèle issu d'une v3 perd ses h/u | `insert_estimate_template_into_version`, `create_estimate_template_from_version` |
| E10 | Section importée dans une v3 : refus SQL générique | `buildImportedEstimateItemInsert` (`server.ts:2242-2289`) |

## Preuves prévues

### E2E (suite locale, pile possédée)

`e2e/army/local/engine-v3-import-optima.e2e.ts`, propriétaire dédié sous politique 3 (aide du 2.5), classeurs
OPTIMA déjà versionnés dans `docs/prd_file/` copiés dans le répertoire d'artefacts du run (rien d'ajouté au
dépôt) :

- **IO01** lot hydraulique, coefficients proposés 1,3 / 1,3 : PU = « Prix Unitaire » sur 785/785, aucun
  écart listé, Σ 1 644 207,61 € HT ; statuts 61 HL, 9 inc, 7 NC, 1 PM, 1 CP, à 0 € ; provenance présente ;
- **IO02** même chiffrage à 1,30 / 1,20 : Σ 1 572 320,99 € HT ; coefficient réalisé (HT / déboursé
  1 264 749,07 €) 1,243188 ;
- **IO03** lot plomberie : 656/656, Σ 1 027 655,61 €, puis 981 887,92 € à 1,30 / 1,20 ;
- **IO04** collage de l'en-tête OPTIMA et de la ligne O1 : aperçu « h/u 1,991 » et « Prix Unitaire
  174,59 : contrôle », PU 166,63 € à 1,30 / 1,20 ;
- **IO05** ouvrage de bibliothèque inséré à Q = 10 puis à Q = 20 : MO doublée ;
- **IO06** modèle v2 inséré dans une v3 : MO identique à la tolérance documentée, lignes converties listées ;
- **IO07** section importée d'une autre version vers une v3 : refus nommé, rien d'écrit (ajouté en phase verte,
  rouge d'abord : 400 générique) ;
- **IO08** structure IA et version zéro sur une v3 : refus nommé, rien d'écrit (P-14 ; ajouté en phase verte,
  rouge d'abord : génération de structure acceptée en 201, autres chemins 404/409 sans rapport).

Le refus nommé du métré reste prouvé par V3P-17 (`engine-v3-persistence.e2e.ts`), rejoué.

### Isolation (justifiée)

- **pgTAP** `estimate-engine-v3-entry-paths.test.sql` : colonnes v3 des modèles ; modèle v2 → v3 (h/u
  converti, rapport, refus Q = 0) ; modèle issu d'une v3 ; ouvrage → v3 (h/u, refus quantité nulle et
  quotient inexact) ; ligne d'ouvrage généré v3 (rendement par unité). L'intégrité SQL des conversions et
  des refus nommés n'est pas entièrement observable depuis un parcours, et la validation complète d'un
  ouvrage généré se paie un parcours entier par cas.
- **Vitest** : réconciliation OPTIMA v3 (écart supérieur à 0,5 c listé), ligne de paramètres proposée en
  coefficients, correspondance v3 de l'import (h/u direct, `unit_code`, `pricing_status`), interprétation
  du collage OPTIMA ; cas limites de parseurs et de demi-centimes, chers en E2E.

Rejouer aussi : corpus figé, empreintes documentaires, montée de version (M6 neutre), I9 (`dpgf-import`).

## Exécution rouge (18/10/2026, macOS, Node 24.19.0, base `78ca0855`, tests `7b7fb9cb`)

Journaux : `.e2e/lot2-2.8/red/` (copie de travail, non versionnée).

- **pgTAP** `estimate-engine-v3-entry-paths.test.sql` : rouge sur ses assertions, sans interruption du
  fichier. Issues relevées : T1, T2 (modèle dans la v3), A1, A2, A3 (ouvrage dans la v3) →
  `0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED` ; G (ligne d'ouvrage généré) → `22023
  GENERATED_OUVRAGE_INVALID_INPUT` (h/u et `unit_code` hors liste blanche) ; T3 : modèle créé depuis la v3
  sans colonnes v3 ; colonnes v3 des modèles absentes. Garde verte : un modèle entre dans une v2 comme avant.
- **Vitest** : 5 rouges sur 97. Import vers une v3 : PU d'O1 134,30 € au lieu de 174,59 € (moteur ignoré,
  pas de coefficients de vente), ni `unitCode` ni statut, écart de contrôle sur la mauvaise base ; collage :
  ni cible h/u, ni colonne de contrôle.
- **TesterArmy** `e2e:army:local -- --grep '^IO0[1-6]\s'` (fichier pgTAP rouge tenu hors du worktree) :
  - IO01, IO03 : l'aperçu reste celui d'une v1/v2 (« Heures MO : h/u × Q = heures totales de la ligne »,
    contrôle au moteur v1/v2) ; aucun coefficient du classeur proposé (E2, E4, E5) ;
  - IO04 : l'éditeur affiche « Ce devis utilise le moteur de calcul 3, pas encore disponible pour cette
    action. » (collage v3, dépend aussi du 2.6) ;
  - IO05, IO06 : insertion refusée, 400 `0A000` (E7, E9). Un premier passage échouait par un 409 de verrou :
    les routes d'insertion ne portent pas la version dans leur chemin et l'aide de la campagne n'y joignait pas
    la session de bail ; le parcours la transmet désormais lui-même.

Point d'attention pour l'implémentation : sur le classeur hydraulique complet, l'aperçu actuel annonce
« 1 ligne vérifiée » au contrôle « Prix unitaire de vente » (110 sur le plomberie) : la lecture de
« Prix Unitaire » sur les classeurs réels est à vérifier avant le vert.

## Phase verte (18/10/2026, macOS, Node 24.19.0, base `78ca0855`)

### Ce qui est livré

- **M6** `20261017225906_estimate_engine_v3_entry_paths.sql` (manifeste à jour, garde Git et cohérence des
  migrations vertes) : colonnes v3 de `estimate_template_items` et coefficients de vente de
  `estimate_templates` (D5, §6.2 ; neutres à la montée de version) ; copie par
  `create_estimate_template_from_version` et `duplicate_estimate_template` ; un modèle issu d'une v3 se
  reconnaît à l'une de ses trois colonnes h/u, copiées telles quelles ; pont
  `public.estimate_v3_complete_entry_for_writer` (brouillon v3 d'un tenant de l'appelant seulement, sous
  contrat d'écrivain : unité des
  nouvelles lignes par le référentiel, montants du moteur v3 sur toutes les lignes et la version, contrôle
  `estimate_v3_assert_draft`) ; branches v3 de `insert_estimate_template_into_version`,
  `materialize_estimate_assembly_tree`, `insert_estimate_assembly_into_version`,
  `private.generated_ouvrage_insert_line` et `commit_generated_ouvrages`. Liste blanche F-SQL-14 complétée,
  sondes F-SQL-10 réécrites (modèle et ouvrage : entrée sous contrat, contrat refermé après l'appel ;
  ouvrage généré : projection client refusée, puis section de repli écrite sous contrat).
- **Import OPTIMA** (`import-flow.ts`, action d'import, `canonical-v2-creation.ts`) : sous politique 3,
  l'import crée une v3 ; h/u direct ; unité par le référentiel, mention de statut → ligne non chiffrée à
  0 € ; PU et contrôle « Prix Unitaire » au moteur v3 (cellule lue à 15 chiffres significatifs puis au
  centime, `src/lib/imports/optima-control.ts`, déplacé depuis `scripts/engine-v3`) ; coefficients du
  classeur proposés dans l'aperçu, modifiables avant confirmation, sinon ceux de l'entreprise ; une colonne
  d'heures de ligne est refusée sur une v3 (`line_hours_require_hours_per_unit`). Le refus nommé reste en
  place pour toute autre source (modèle, création rapide, assistant, DPGF liée).
- **Collage** (`clipboard.ts`) : « Tps pose unitaire » → h/u ; sur une feuille reconnue par le profil OPTIMA,
  « Prix Unitaire » → contrôle (jamais collé ; ailleurs il reste non mappé, règle 2.3) et « Majoration MO » →
  majoration additive (0 = ×1) ;
  sur une v1/v2, h/u × Q en heures de ligne (P-16). La grille v3 qui applique le collage relève du 2.6.
- **Ouvrage de bibliothèque et modèle** (`assemblies-server.ts`) : la v3 reçoit ses montants dans la
  transaction d'insertion (pas de finalisation v1/v2) ; l'insertion d'un modèle liste les lignes converties
  (`converted_lines`, `template-v3-hours.ts`, miroir exact de M6) ; les refus de M6 arrivent nommés à
  l'utilisateur (400, code `ESTIMATE_V3_…`, ligne ou composant nommé) ; un modèle dont une ligne porte le rôle
  MO d'un autre utilisateur est refusé dans une v3 (`ESTIMATE_TEMPLATE_LABOR_ROLE_REQUIRED`), au lieu d'une
  MO comptée à 0 €/h sans avertissement.
- **Ouvrage généré** (`generated-ouvrages.ts`) : ligne v3 au rendement par unité (h / Q, demi-supérieur,
  4 décimales), sans projection client ; la base calcule et vérifie les montants.
- **Refus nommés** (`ESTIMATE_ENGINE_UNAVAILABLE`, 409, avant toute écriture) : section importée d'une autre
  version vers ou depuis une v3 et section dupliquée vers ou depuis une v3 (règle 6), structure IA (génération
  et application) et version zéro (génération et matérialisation) (P-14). Avant : refus SQL générique, ou brouillon de structure IA généré pour une v3. La mise à jour groupée
  directe refusait déjà par son nom (2.5).
- **Aperçu de l'import** : un rôle choisi dont le taux diffère du taux horaire du classeur est signalé
  (« Taux horaire du classeur 40,00 €/h, rôle choisi 45,00 €/h : la MO différera du classeur. »).

### Écarts au contrat, assumés

1. **Pied de document de l'import (tous moteurs)** : `analyzeImportStructure` ouvrait le pied au premier
   « Sous-total » et ignorait tout ce qui suivait. Un lot OPTIMA porte un sous-total par sous-lot : le lot
   hydraulique n'importait qu'une ligne sur 785 (110 sur la plomberie), en v1/v2 comme en v3 — c'était la
   cause du « 1 ligne vérifiée » relevé en phase rouge. Désormais seul un « Sous-total » suivi d'une ligne à
   quantité positive est ignoré seul ; « Total… », les mentions légales et un dernier « Sous-total » ouvrent
   toujours le pied (revue : un pied chiffré « Sous-total HT / TVA / Total TTC » et des options après
   « Total HT » gardent le comportement d'avant, tests dédiés). Correctif de perte de lignes, qui change le
   résultat d'un import v1/v2 des seuls classeurs à sous-totaux intermédiaires (plus de lignes importées) ;
   `dpgf-import` et `import-optima-v2` rejoués verts.
2. **Ouvrage généré** : h/u = h / Q arrondi (comme un modèle), pas « exact ou refus » (comme un ouvrage de
   bibliothèque). Un sous-détail généré donne des heures totales estimées ; un refus sur quotient inexact
   bloquerait la plupart des insertions. Q nulle avec des heures : refus nommé
   `ESTIMATE_V3_GENERATED_HOURS_WITHOUT_QUANTITY`.
3. **`finalize_estimate_assembly_calculation`** reste v1/v2 : une v3 reçoit ses montants à l'insertion
   (pont M6), le finaliseur n'est plus appelé pour elle et son contrat d'écrivain le refuse toujours.
4. **Règle 6 (section importée d'une autre version)** : refus nommé, prouvé par IO07 ; la conversion des
   heures par les règles des modèles est une suite du 2.8 (aucun test rouge ne la couvrait en phase rouge).
5. **Routes d'insertion** : elles répondent 200 depuis toujours ; les parcours rouges IO05/IO06 attendaient
   201 par erreur, corrigé.
6. **IO04** (collage dans la grille v3) attend le 2.6 : la PR 2.8 se fusionne après le 2.6 et reste rouge sur
   IO04 jusque-là ; l'interprétation du collage est prouvée en Vitest.
7. **Limites connues, non traitées** : `converted_lines` ne compare que les heures MO totales (atelier et
   chantier non listés) ; une ligne non chiffrée (HL, PM…) d'un modèle issu d'une v3, insérée dans une v1/v2,
   y devient chiffrée (colonnes v3 ignorées) ; une unité non résolue par le référentiel n'est pas signalée à
   l'import (le gel la refusera, `ESTIMATE_V3_UNIT_REQUIRED`) ; les coefficients de vente d'un modèle sont
   stockés mais aucun chemin ne crée encore une v3 depuis un modèle (refus nommé sous politique 3).

### Revue indépendante (lecture seule, sur `efbf243b` réconcilié avec `main` `91068850`)

13 constats, aucun bloquant sur les montants, M6 ou l'isolation entre tenants. Suites données :

| # | Constat | Suite |
|---|---|---|
| 1 | IO04 rouge dans la sélection de la CI | fusion après le 2.6 (écart 6) |
| 2 | Pied de document trop permissif sur un DPGF générique | corrigé, tests rouges d'abord (pied chiffré, options après « Total HT ») |
| 3 | Refus de M6 perdus côté API (400 générique) | corrigé, parcours IO09 (non exécuté rouge : l'issue rouge était le 400 générique observé en phase rouge) |
| 4 | Rôle MO d'un autre utilisateur dans un modèle → MO à 0 €/h | corrigé pour une v3, test Vitest rouge d'abord (isolation : un parcours demanderait un second utilisateur du tenant) |
| 5 | Assertions faibles (IO05, IO06, provenance) ; succès v3 de `commit_generated_ouvrages` jamais exécuté | montants absolus IO05 (24,00 € puis 48,00 €) et IO06 (37,00 €), provenance sur chaque ligne (IO01, IO03), cas pgTAP H de bout en bout (vert : aucun défaut, seule l'attente d'unité était fausse, « m » → `ml`) |
| 6 | Modèle v3 reconnu par `h_mo_per_unit` seul | corrigé (T4 rouge d'abord), miroir TypeScript aligné |
| 8 | Duplication de section et import depuis une v3 : message générique | corrigé, sondes IO07 |
| 10 | Coefficients de vente des modèles (D5) absents | ajoutés à M6, assertion pgTAP rouge d'abord |
| 11 | Pont sans contrôle de tenant | corrigé (cas B rouge d'abord) |
| 13 | Fins de ligne réécrites dans `generated-ouvrages.test.ts` | corrigé (18 lignes réelles) |
| 7, 9, 12 | Limites | écart 7 |

La suite complète (`e2e:army:ci -- full`, avant ces suites) a aussi trouvé une régression : le collage
proposait « Prix Unitaire » comme contrôle sur toute feuille, alors que `numeric-entry-v3` (2.3) exige qu'il
reste non mappé hors OPTIMA ; restreint au profil OPTIMA, test 2.3 rétabli.

### Exécution verte

Journaux : `.e2e/lot2-2.8/green/` (copie de travail, non versionnée).

- **pgTAP** (`npm run db:ci:local`) : 21 fichiers, 1 871 assertions, matrice RLS comportementale verte ;
  `estimate-engine-v3-entry-paths.test.sql` vert (T1, T1-v2, T4, A1, G, H, T3, coefficients du modèle ; T2,
  A2, A3 refusés par leur nom ; B refusé hors tenant) ;
  `estimate-calc-engine-v3-guards.test.sql` vert avec la liste blanche et les sondes réécrites.
- **Montée de version** (`db:upgrade-check`, avec contrôle négatif) : 0 différence ; colonnes v3 des modèles
  neutres. **Corpus figé** identique à l'octet (600 cas) ; **empreintes documentaires** identiques.
- **Vitest** : rouges de la phase rouge au vert (import v3 d'O1 : h/u 1,991, PU 174,59 € puis 166,63 € à
  1,30 / 1,20, statuts, écart d'O1b listé ; collage OPTIMA) ; nouveaux : conversion h / Q des modèles et des
  ouvrages générés, création v3 depuis l'import (action), ouvrage généré vers une v3, pied de document
  (sous-total intermédiaire ignoré seul ; pied classique inchangé), aperçu v3 (coefficients, contrôle, écart de
  taux).
- **TesterArmy** (`e2e:army:local`, pile possédée) :
  - IO01 hydraulique : 785/785 PU = « Prix Unitaire », statuts 61 HL, 10 inclus (9 inc + 1 CP), 7 NC,
    1 PM, à 0 €, Σ 1 644 207,61 € HT aux coefficients du classeur 1,3 / 1,3 ; IO02 : 1 572 320,99 € à
    1,30 / 1,20, coût 1 264 749,07 €, coefficient réalisé 1,243188 ;
  - IO03 plomberie : 656/656, Σ 1 027 655,61 €, 981 887,92 € à 1,30 / 1,20, coût 790 490,05 €,
    1,242126 ;
  - IO05 (ouvrage : PU 24,00 €, 240,00 € à Q = 10 puis 480,00 € à Q = 20), IO06 (modèle v2 : h/u 0,5 et
    0,0003, collier listé 1 h → 0,9 h, tube 37,00 € × 10), IO07, IO08, IO09 verts ;
  - non-régression : `numeric-entry-v3`, `dpgf-import` (DPGF01 ×2, DPGF03) et `import-optima-v2` (2.3,
    3 parcours) verts ; 15 parcours sur 16, IO04 rouge, attendu (grille v3 du 2.6) ;
  - suite complète (`e2e:army:ci -- full`, avant les suites de la revue) : 146 sur 148, IO04 et la régression
    `numeric-entry-v3` corrigée depuis.

### Constat hors périmètre : lecture d'un gros devis

Sur le devis hydraulique (~1 000 éléments), `GET /api/estimates/{id}` répond en ~0,7 s, mais deux lectures
sur quatre ont pris 61 s (blocage d'environ 60 s, puis réponse correcte) ; la plomberie (~800 éléments) reste
à ~0,3 s. Le chemin est antérieur au 2.8 et indépendant du moteur ; cause probable à confirmer : les
enrichissements de provenance interrogent `.in("estimate_item_id", …)` avec tous les identifiants (URL
d'environ 37 Ko). Les parcours IO lancent donc la lecture dans la page et l'attendent par sondage, durée
consignée dans les preuves, au lieu d'échouer sur le délai fixe d'un `browser.evaluate` ; l'enquête est une
suite proposée.
