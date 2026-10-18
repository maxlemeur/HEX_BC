# Chemins d'entrée v3 (sous-lot 2.8)

Statut : **phase verte**, branche `lot2/2.8-chemins-entree-v3` (base `main` `78ca0855`, 2.9 compris, puis 2.6
fusionné) ; création atomique accélérée par M6b après le dépassement de délai d'IO01 en CI ; collage v3 livré après
la fusion du 2.6 (IO04 vert). Ces deux suites ont chacune leur section en fin de fiche.
Source : [conception du lot 2](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md), §14 « 2.8 »,
D16, D11, §5.4, §6.1 M6, §7 ; décisions P-12 et P-14 (validées le 16/10/2026). Dépendances livrées : 2.3
(profil OPTIMA, parseurs), 2.5 (persistance v3, M4). Le collage dans la grille v3 dépendait du 2.6, fusionné
depuis (section « Collage v3 »).

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
   Unitaire » → contrôle, « Taux horaire » → choix du rôle MO) ; l'aperçu montre les valeurs interprétées ;
   unité par le référentiel ou statut, jamais en texte libre ; heures de ligne refusées ; écriture par
   l'écrivain de lot v3 (section « Collage v3 »).
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
  sur une v1/v2, h/u × Q en heures de ligne (P-16). Sur une v3 : section « Collage v3 » (après la fusion du 2.6).
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
   cause du « 1 ligne vérifiée » relevé en phase rouge. Désormais seul un « Sous-total » suivi d'un intitulé
   sans quantité (le sous-lot suivant) ou d'un autre tel « Sous-total » (celui du lot), puis plus loin d'une
   ligne à quantité positive, est ignoré seul : dans les deux classeurs OPTIMA, le pied commence au dernier
   bloc de sous-totaux et aucune ligne à quantité n'est perdue. « Total… », les mentions légales, un dernier
   « Sous-total » et un « Sous-total » suivi d'options chiffrées ouvrent toujours le pied (revues : pied chiffré
   « Sous-total HT / TVA / Total TTC », options après « Total HT » ou juste après « Sous-total HT », tests
   dédiés). Correctif de perte de lignes, qui change le résultat d'un import v1/v2 des seuls classeurs à
   sous-totaux intermédiaires (plus de lignes importées) ; `dpgf-import` et `import-optima-v2` rejoués verts.
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
6. **IO04** (collage dans la grille v3) attendait le 2.6 : levé, le 2.6 est fusionné et le collage v3 livré
   (section « Collage v3 ») ; IO04 sélectionne désormais la section cible avant de coller (une ligne v3 appartient
   à une section) et vérifie le rôle MO choisi.
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

Revue de suivi (sur `c28866e4`) : les corrections tiennent, aucun défaut bloquant ni important ; quatre
mineurs. Sous-total suivi directement d'options chiffrées (encore importées) : corrigé, test rouge d'abord ;
le test « sous-total intermédiaire » écrit dans ce sous-lot plaçait une ligne juste après le sous-total, cas
absent des classeurs OPTIMA : aligné sur leur structure (intitulé du sous-lot suivant). La première règle
durcie perdait encore des lignes OPTIMA, un sous-total de sous-lot pouvant être suivi de celui du lot
(lignes 209 et 211 du lot hydraulique) : IO01 et IO03 rouges (123/785, 257/656) ; chaînes de sous-totaux
prises en compte, simulation sur les deux classeurs (aucune ligne à quantité perdue), cas ajouté au test,
puis IO01 et IO03 verts. Commentaire déplacé :
corrigé. Restent documentés : le contrôle des rôles MO des modèles est côté TypeScript seulement (un appel
direct de la RPC l'évite, sans enjeu de sécurité, comme pour les ouvrages) et refuse aussi une ligne non
chiffrée ; le cas pgTAP H n'exerce la branche v3 de `commit_generated_ouvrages` qu'avec 0 h (la division
h / Q non nulle n'est exécutée que par son miroir TypeScript).

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

## Création atomique (M6b, `20261018013249_estimate_creation_set_based_item_effects.sql`)

M6b (2.8, création ensembliste) : à ne pas confondre avec M8, la bascule du 2.10 dans la conception (§6.1).

**Constat (CI de la PR, `army-critical`, 18/10/2026)** : IO01 échoue sur `57014 canceling statement due to
statement timeout` dans `persist_estimate_creation_atomic`. Les rôles de l'API ont un `statement_timeout` de
8 s (CI comme production) ; créer la v3 du lot hydraulique (1 021 éléments) déclenchait, par ligne, une mise à
jour de la révision de contenu de la version (et sa ligne d'audit), la ligne d'audit de l'élément, une recherche
de couverture des sources et une remontée de hiérarchie. Localement 660 ms ; en CI (deux travailleurs, coureur
partagé) au-delà de 8 s. IO03 (plomberie) passait.

**Décision du porteur (relayée le 18/10/2026)** : ni relèvement du délai des rôles de l'API, ni découpage de la
création en plusieurs RPC (atomicité) ; rejeu ensembliste des effets par ligne en fin de RPC, sans changer
aucun résultat, avec mesure avant/après et preuve pgTAP, rouge d'abord.

**Contrat** :

1. `persist_estimate_creation_atomic` pose `miaouffrage.estimate_creation_atomic` = id de la version créée
   autour de l'insertion de ses éléments (`set_config` local, valeur précédente restaurée), puis appelle
   `public.estimate_creation_replay_item_effects_for_writer` avec les ids dans l'ordre du payload.
2. Sous ce contrat, et seulement pour l'insertion d'un élément de cette version, les quatre déclencheurs par
   ligne rendent la main aussitôt. Une autre version, une mise à jour, une suppression, un autre écrivain les
   gardent.
3. Le pont (security definer, `service_role` seul, refusé hors contrat
   `42501 ESTIMATE_CREATION_REPLAY_OUTSIDE_CONTRACT`) rejoue dans l'ordre des déclencheurs : profondeur de
   chaque élément (mêmes contrôles, mêmes messages, premier élément fautif dans l'ordre du payload) ; une étape
   de révision par élément (même contrôle de brouillon, une mise à jour de + N, admise par
   `guard_estimate_version_workflow_columns` seulement à la hausse, sur un brouillon, avec
   `miaouffrage.estimate_creation_replay` et le contrat de création liés tous deux à cette version) ; une ligne
   d'audit par étape et par insertion, aux valeurs qu'écrivait `log_estimate_audit` ; l'invalidation de
   couverture, rejouée élément par élément quand une exigence est bornée à (`dpgfLotId`) ou liée à l'un d'eux.
   Le pont referme ensuite le contrat : un seul rejeu par création.
4. Sur une v3, le rejeu précède le contrôle de projection D12, comme les déclencheurs le précédaient.

**Défaillances visées** : C1 délai dépassé sur un lot complet ; C2 une révision, une ligne d'audit, une
révision de couverture ou un refus de profondeur différents du chemin par ligne ; C3 le contrat profite à une
autre version, à une autre opération ou à un appel direct du pont ; C4 une v3 créée ne passe plus D12.

**Preuves** :

- **pgTAP** `estimate-creation-atomic-item-effects.test.sql` (isolation justifiée : l'égalité des lignes
  d'audit et des révisions et les gardes du contrat ne sont pas observables depuis un parcours). Référence R :
  version créée vide puis les mêmes éléments écrits ligne par ligne ; candidate C : création atomique. Égaux :
  révision de contenu, ligne de version, lignes d'audit des éléments et des étapes de révision (identifiant
  d'enregistrement, version, avant/après compris), révisions techniques de deux exigences de couverture
  (3 chacune : racine, lot A, ligne liée), refus de profondeur ; mises à jour de la version 6 (R) contre 1 (C) ;
  contrat refermé ; sous un contrat posé, autre version et mise à jour gardent audit et révision ; pont refusé
  hors contrat, pour une autre version, au second appel et à `authenticated` (permission refusée) ; écriture
  directe de la révision refusée (`ESTIMATE_CONTENT_REVISION_IS_MANAGED`) sans contrat, avec le seul réglage de
  rejeu, liée à une autre version ou à la baisse ; v3 créée, D12 passé, une étape et deux lignes d'audit par
  élément.
- **Rouge** (sans M6b) : 2 assertions sur 13, sur leur propre motif (`6|6` au lieu de `6|1` ; pont absent,
  `42883`) ; les 11 assertions d'équivalence déjà vertes sur le chemin par ligne. **Vert** avec M6b : 13 sur 13.
  Après la revue : 2 sur 14 rouges contre la première M6b (second rejeu accepté ; révision écrite avec le seul
  réglage de rejeu), puis 14 sur 14.
- **Mesure** (sonde non versionnée, création v3 de 1 021 éléments au profil du lot hydraulique, 7 passages
  annulés, pile locale) : médiane **660,5 ms avant, 245,0 ms après** (× 2,7). Reste : insertion et
  déclencheurs BEFORE par ligne (dérivation v3, gardes) ~ 65 ms, contrôle D12 ~ 50 ms, audit ensembliste
  ~ 75 ms (les mêmes 2 042 lignes). Si la CI reste à ≥ 12 fois le local (IO01 ≥ 8 s pour 660 ms), IO01 y
  descend vers 3 s : la preuve est IO01 en CI.
- **Rejoués** (sur `e7ea42d4` + M6b, journaux `.e2e/lot2-2.8/green/m6b/`) : `db:ci:local` (22 fichiers,
  1 886 assertions, matrice RLS), `db:upgrade-check` (0 différence, contrôle négatif), corpus figé et
  empreintes documentaires identiques ; TesterArmy `dpgf-import`, `import-optima-v2`, `numeric-entry-v3`,
  `engine-v3-import-optima` : 15 parcours sur 16, IO04 rouge attendu, avant et après la revue. IO01 vert
  (785/785) ; sa durée (196 s puis 135 s) vient de lectures bloquées ~60 s (constat ci-dessus), pas de la
  création.

**Garde locale** : gros devis v3 (création et enregistrement des paramètres sur 1 021 éléments) : invariance
d'échelle à chaque `db:ci:local`, médiane de création ≤ 330 ms sur demande (`DB_CI_STATEMENT_BUDGET=enforce`) ;
l'enregistrement des paramètres dépasse déjà ce budget (≈ 546 ms). Voir
[large-estimate-statement-budget.md](large-estimate-statement-budget.md).

**Écart assumé** : quand un payload porte deux refus différents (un refus de profondeur et le refus d'une
ligne plus loin par un autre déclencheur ou une contrainte), le refus remonté peut différer. Une création
acceptée écrit les mêmes lignes, révisions, lignes d'audit et révisions de couverture.

**Revue indépendante (lecture seule, M6b avant commit)** : aucun écart de résultat (copies conformes à leurs
sources, déclencheurs de `estimate_versions` sans dépendance à la profondeur ni au rôle pour cette mise à jour,
ordre et valeurs des lignes d'audit, ids du payload égaux aux ids insérés, réglages locaux annulés avec la
transaction). Corrigés : exemption de la garde liée aussi au contrat de création, au brouillon et à une hausse
(elle ne tenait qu'au réglage de rejeu, qui aurait permis à un appel SQL direct de reculer le jeton de
fraîcheur) ; audit des étapes lié aux deux réglages ; pont à usage unique ; assertions d'audit complétées et
refus de la garde testés ; commentaire de la RPC sur l'ordre du payload rectifié (la clé étrangère `parent_id`
est différée).

## Collage v3 (règle 2, après la fusion du 2.6)

Le 2.6 (PR #44, `da462ac4`) a livré la grille v3 et refusé par son nom tout collage dans une v3 (F26-31,
« contrat de collage v3 à définir »), en laissant au 2.8 ce contrat. Fusions de `main` dans la branche :
`5b987685` (2.6 et boucle locale ; seul le manifeste des migrations en conflit ; la migration du 2.6,
`20261017205000`, ne redéfinit aucune fonction recopiée par M6 ou M6b) et `8dda3c9b` (documentation, PR #46).

**Contrat** (`src/lib/estimates/v3-paste.ts`, `clipboard.ts`, `useEstimateClipboard.ts`,
`useEstimateEditorPasteController.ts`) :

- chaque ligne collée écrit ses saisies v3 : unité par le référentiel (`unit_code`), ou statut de ligne pour une
  mention (« HL », « PM », « Hors lot »…, ligne à 0 €) ; unité vide : à choisir dans la grille ; unité inconnue :
  ligne refusée, jamais écrite en texte libre (`description` reste vide) ;
- heures : « Tps pose unitaire » (ou toute colonne associée à « Heures MO par unité ») → `h_mo_per_unit` ; une
  colonne d'heures de ligne non nulle est refusée (même règle que l'import, `line_hours_require_hours_per_unit`) ;
- feuille OPTIMA : « Prix Unitaire » est un contrôle affiché, jamais collé ; la ligne de paramètres (ligne 2, sans
  désignation) est montrée et jamais collée ; son « Taux horaire » choisit le rôle MO et sa majoration MO (N2)
  s'applique, comme à l'import, aux lignes qui n'en portent pas ; ses coefficients FO/MO sont ignorés (le collage
  ne change jamais les coefficients de vente de la version) ;
- rôle MO des lignes à heures : règle de l'import OPTIMA (E17), au taux de la ligne de paramètres ou des lignes :
  le rôle choisi dans l'aperçu, sinon l'unique rôle actif à ce taux, sinon un choix explicite (confirmation
  inactive) ; sans taux, MO à 0 €/h signalé, modifiable ; un taux illisible (« quarante ») ne choisit rien et ne
  refuse jamais la ligne (« 40 », « 40,00 € », « 40,1234 » se lisent) ;
- l'aperçu (« Aperçu du collage ») ajoute la colonne « Valeurs écrites (moteur 3) » (« Unité ml », « h/u 1,991 »,
  « Prix Unitaire 174,59 : contrôle », la ligne de paramètres) et le choix « Rôle MO des lignes collées » ; une
  ligne refusée est exclue d'office, et sur une v3 une ligne que l'association des colonnes rend écrivable (ou non)
  est incluse (ou exclue) d'office, un choix manuel sur une ligne inchangée étant gardé ;
- écriture par l'écrivain de lot v3 : création par lots de 100, repositionnement après la ligne active, annulation
  par lots de 100 suppressions (au-delà, la grille relit l'état enregistré si un lot échoue), jamais par les routes
  directes ; montants recalculés et contrôlés (D12) ; le rétablissement reprend la recréation v3 du 2.6 (F26-21)
  puis repositionne par le lot ;
- copie de la grille d'une v3 : heures par unité (« h/u », relues à l'identique) au lieu des heures de ligne, et
  pour une ligne non chiffrée la mention de son statut dans la colonne « Unité » ; une copie v3 se recolle donc
  dans une v3 (le rôle MO n'est pas copié : il est résolu de nouveau, avec son message) ;
- tous moteurs : une copie d'Excel dont l'en-tête contient un saut de ligne (« Prix⏎Unitaire », « Prix⏎Total »
  des classeurs OPTIMA, mis entre guillemets par Excel) est lue en une ligne d'en-tête ; une guillemet ouverte et
  jamais fermée garde la lecture ligne à ligne d'avant.

Une v1/v2 colle comme avant (h/u × Q en heures de ligne, routes et annulation inchangées) ; ses seules différences
observables : « Taux horaire » d'une feuille OPTIMA apparaît associé dans l'aperçu (jamais écrit ni bloquant) et un
en-tête Excel à saut de ligne est désormais lu.

**Défaillances visées** : P1 l'unité collée part dans `description` et `unit_code` reste vide ; P2 des heures
totales sont écrites ou refusées par un message générique ; P3 le PU ignore le taux horaire de la feuille
(MO à 0 €/h sans le dire), y compris quand il n'est que sur la ligne de paramètres ; P4 l'annulation ou le
repositionnement passent par une route directe, dépassent la limite d'un lot ou désynchronisent le jeton de
version ; P5 un collage v1/v2 change ; P6 l'en-tête réel d'un classeur OPTIMA n'est pas reconnu ; P7 une copie v3
ne se recolle pas dans une v3.

**Preuves** :

- **IO04** (rouge sur `5b987685` : aperçu sans « h/u 1,991 ») : l'en-tête réel copié par Excel (cellules
  « Prix⏎Unitaire » et « Prix⏎Total » entre guillemets), la ligne de paramètres (« Taux horaire » 40) et la ligne O1
  sans paramètres, collés dans la section choisie (bail rendu par l'API, page éditable) ; l'aperçu montre
  « h/u 1,991 », « Prix Unitaire 174,59 : contrôle » et « Paramètres du classeur : taux horaire 40,00 €/h, non
  collés » ; rôle choisi au taux de la feuille ; O1 : `unit_code` ml, h/u 1,991, h 39,82, rôle Tuyauteur,
  section choisie, PU 166,63 € à 1,30 / 1,20.
- **V3E13**, parcours du 2.6 réécrit au nouveau contrat (il prouvait le refus que le 2.8 lève ; rouge sur
  `5b987685`) : deux lignes (13,00 € et 6,50 €), collage générique 2 ml × 10,00 € ancré sur la première ; ligne
  collée en deuxième position (repositionnement par le lot), `unit_code` ml, `description` vide, 0 h de ligne,
  PU 13,00 €, totaux 45,50 / 9,10 / 54,60 €, révision de contenu incrémentée ; annulation : ligne supprimée par le
  lot, ordre et totaux 19,50 / 3,90 / 23,40 € revenus.
- **Vitest** (isolation justifiée : cas d'unité, de statut, d'heures, de taux et d'analyse du presse-papiers, et
  annulation de 101 lignes, chers en parcours), écrits rouges avant leur code : `v3-paste.test.ts` (« Taux
  horaire » OPTIMA seulement, O1, statut HL, unité vide ou inconnue, heures de ligne refusées, quatre décimales
  de h/u, ligne de paramètres et son taux, taux illisible non bloquant et « 40,00 € », copie Excel de l'en-tête
  réel, guillemet jamais fermée, majoration N2, statut d'une copie v3, copie v3 recollée, rôle au taux d'une
  ligne ou de la ligne de paramètres, taux divergents ou sans rôle, choix et refus explicites) ;
  `useEstimateEditorPasteController.test.ts` (charge v3 sans clé dérivée et repositionnement par l'écrivain v3 ;
  annulation de 101 lignes en lots de 100 puis 1).

- **Sélection TesterArmy** (pile possédée, `8dda3c9b` et ces changements, sources inchangées pendant le build,
  journaux `.e2e/lot2-2.8/green/paste-v3/`) : `numeric-entry`, `numeric-entry-v3`, `dpgf-import`,
  `import-optima-v2`, `engine-v3-editor`, `engine-v3-editor-actions` (V3E05 à V3E13), `engine-v3-import-optima`
  (IO01 à IO09) : 31 parcours sur 31.

**Revues indépendantes** (lecture seule) : la première n'a relevé aucun écart sur les chemins v1/v2 ni sur la
charge v3 ; corrigés : annulation au-delà de 100 lignes, taux lu sur la ligne de paramètres (seule place du taux
dans les deux classeurs réels, vérifié), copie v3 recollable, taux jamais bloquant, repositionnement prouvé par
V3E13, cas Vitest impossible remplacé, inclusion recalculée sur une v3. La revue de suivi a confirmé ces
corrections ; corrigés ensuite : en-tête Excel à saut de ligne (défaut antérieur du découpage, qui empêchait de
reconnaître une feuille OPTIMA réelle), majoration de la ligne de paramètres, statut d'une copie v3, taux en
« € », relecture après un échec d'annulation partielle, notes limitées aux lignes valides et à la ligne de
paramètres.

**Limites** : le rétablissement d'un collage v3 n'est pas rejoué en parcours ; un rôle choisi s'applique à toutes
les lignes à heures du collage (un rôle par collage, comme l'import) ; le contrôle « Prix Unitaire » est montré,
pas comparé au PU du moteur (les coefficients de la version, pas ceux du classeur, s'appliquent) ; la suppression
et le repositionnement d'une annulation v3 sont deux lots, non atomiques ; `estimate-batch-client` (BC04, collage
v1/v2 par paquets de 100) ne tourne que sous le profil de couverture `batch-atomic`, non rejoué : le chemin v1/v2
du contrôleur n'appelle que les mêmes routes et ses tests Vitest restent verts.
