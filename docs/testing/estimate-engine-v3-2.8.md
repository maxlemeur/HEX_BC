# Chemins d'entrée v3 (sous-lot 2.8)

Statut : **phase rouge**, branche `lot2/2.8-chemins-entree-v3` (base `main` `78ca0855`, 2.9 compris).
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
   - `sourceDocumentId` et `_timax_provenance` présents (I9).
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
| `private.generated_ouvrage_insert_line`, `commit_generated_ouvrages`, `finalize_estimate_assembly_calculation` | branche v3 : h/u et `unit_code` acceptés, contrat d'écrivain, clés de totaux v3 |

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
- **IO06** modèle v2 inséré dans une v3 : MO identique à la tolérance documentée, lignes converties listées.

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
