# Éditeur et réglages v3 (sous-lot 2.6) — défaillances observables et rouge

Statut : **phase rouge seulement** (17/10/2026). Aucun code de production. Ce document fixe les défaillances
observables de l'éditeur v3, leur preuve (parcours E2E `engine-v3-editor`, écrit par l'agent du parcours,
ou isolation Vitest `V3S-01` à `V3S-04`), et le contrat de composants et de hooks que le rouge suppose.
Source : [conception du lot 2](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md), §0, D4 à
D9, D11, §4, §5 (S2, S4, S5, EUHIST, CAP, T-STAT), §8.1 et §8.2 (lignes 2.6), §9, §14 « 2.6 ». Là où ce
document résume la conception, la conception fait foi ; là où il **choisit** (signalé « Choix »), il fixe
le contrat que le rouge exige.

Branche `lot2/2.6-editeur-v3`, base `f1d94213` (pointe de `lot2/2.5-persistance-v3` : M4, politique
d'entreprise, création `canonical_v3`, écrivains v3, gel v3, serveur TS et API). L'implémentation commence
quand 2.5 est fusionné. Dépendances : 2.5, 2.3.

## 1. Contrat supposé

### 1.1 Modules nouveaux (§8.1, chacun ≤ 1 200 lignes non vides)

| Fichier | Rôle |
|---|---|
| `src/lib/estimates/v3-settings-payload.ts` | **Choix** : cœur pur de `useEstimateV3Settings` (lecture de la version, saisie champ par champ, charge de sauvegarde). Module sans React, testable dans le projet Vitest `node` ; le §8.1 ne nomme que le hook, qui le réexporte. Contrat au §1.2, asserté par `v3-settings-payload.test.ts` |
| `src/hooks/useEstimateV3Settings.ts` | État d'éditeur v3 : brouillon de réglages, erreurs par champ, dialogue de propagation de TVA, charge de sauvegarde ; reçoit les branches v3 déléguées par les fichiers saturés (§1.4) |
| `src/components/estimates/v3/EstimateV3SettingsSection.tsx` | Réglages v3 rendus par `EstimateSettingsPanel.tsx` à la place des blocs marge, remise, TVA et arrondi : coefficients de vente FO et MO, repère du barème de l'entreprise (non appliqué), remise en € **ou** en %, « demandé / appliqué », « TVA par défaut des nouvelles lignes », arrondi « Aucun » ou « palier inférieur » |
| `src/components/estimates/v3/V3LineCells.tsx` | Cellules v3 de la grille, déléguées par `EstimateEditorTable.tsx` : « U » (référentiel), « Statut », « h MO / u », « TVA % », « h MO total » en lecture seule |
| `src/components/estimates/v3/TaxRatePropagationDialog.tsx` | Dialogue au changement de taux par défaut : « Oui » applique le taux à toutes les lignes dans la **même** sauvegarde (`apply_tax_rate_to_lines`, D8) ; « Non » ne change que le taux des nouvelles lignes |

### 1.2 API pure (`src/lib/estimates/v3-settings-payload.ts`)

```ts
export type EstimateV3DiscountIntent =
  | { kind: "none" }
  | { kind: "amount"; amount_cents: number } // entier, 0 à 2 147 483 647
  | { kind: "rate"; rate_bp: number };       // entier, 0 à 10 000

export type EstimateV3SettingsDraft = {
  title: string; date_devis: string; exclusions: string; validite_jours: number;
  currency: SupportedEstimateCurrency; contractor_role: "principal" | "subcontractor";
  sale_coefficient_fo: number; sale_coefficient_mo: number;
  discount: EstimateV3DiscountIntent;
  tax_rate_bp: number; rounding_mode: "none" | "down"; rounding_step_cents: number;
};

export type EstimateV3SettingsField = "sale_coefficient_fo" | "sale_coefficient_mo" | "discount_amount" | "discount_rate";
export type EstimateV3SettingsInputErrorCode =
  | "ESTIMATE_V3_SALE_COEFFICIENT_REQUIRED" | "ESTIMATE_V3_SALE_COEFFICIENT_INVALID" | "ESTIMATE_V3_DISCOUNT_INVALID";
export type EstimateV3SettingsInputError = { field: EstimateV3SettingsField; code: EstimateV3SettingsInputErrorCode; message: string };

export type EstimateV3SettingsPayload = {
  title: string | null; exclusions: string | null; date_devis: string; validite_jours: number;
  currency: SupportedEstimateCurrency; contractor_role: "principal" | "subcontractor";
  sale_coefficient_fo: number; sale_coefficient_mo: number;
  discount_amount_cents: number | null; discount_bp: number;
  tax_rate_bp: number; rounding_mode: "none" | "down"; rounding_step_cents: number;
  apply_tax_rate_to_lines?: true;
};

export class EstimateV3SettingsError extends Error { readonly code: EstimateV3SettingsInputErrorCode; }

export function readEstimateV3SettingsDraft(version: VersionSettingsColumns): EstimateV3SettingsDraft;
export function applyEstimateV3SettingsInput(draft: EstimateV3SettingsDraft, field: EstimateV3SettingsField, raw: string):
  { draft: EstimateV3SettingsDraft; error: EstimateV3SettingsInputError | null };
export function buildEstimateV3SettingsPayload(draft: EstimateV3SettingsDraft, options: { applyTaxRateToLines: boolean }):
  EstimateV3SettingsPayload;
```

Règles (assertées par `V3S-01` à `V3S-04`) :

- **Lecture** : `discount_amount_cents` non nul → intention en montant ; sinon `discount_bp > 0` → taux ;
  sinon aucune. Coefficients repris tels que stockés.
- **Coefficients** (`sale_coefficient_fo`, `sale_coefficient_mo`) : texte lu par `parseCoefficient` (grammaire
  D11 : virgule décimale, « 1.250 » refusé comme ambigu), dans ]0 ; 10], 4 décimales au plus, jamais arrondi.
  Vide ou blanc → `ESTIMATE_V3_SALE_COEFFICIENT_REQUIRED` ; illisible, ≤ 0, > 10 ou 5 décimales →
  `ESTIMATE_V3_SALE_COEFFICIENT_INVALID`. Un refus rend le brouillon **inchangé** (ancienne valeur conservée)
  **et** une erreur dont le message, en français, nomme le champ (« FO » ou « MO ») : le hook l'affiche sous le
  champ et bloque la sauvegarde tant qu'elle est là. Jamais 0, jamais de reprise silencieuse.
- **Remise** : un champ par intention. Montant lu par `parseAmountCents` (≥ 0, 2 décimales), taux par
  `parseRateBp` (0 à 100 %, 2 décimales, « % » admis) ; refus → `ESTIMATE_V3_DISCOUNT_INVALID`, brouillon
  inchangé. Une saisie valide **remplace** l'intention de l'autre champ. Vider le champ de l'intention active
  la supprime (`none`) ; vider l'autre champ ne change rien (le champ montant d'une intention en pourcentage
  est vide : le quitter ne doit pas effacer le taux). Changer un coefficient ne touche jamais l'intention.
- **Charge** : exactement les 13 clés du type (plus `apply_tax_rate_to_lines: true` seulement après « Oui »).
  Montant → `discount_amount_cents = M`, `discount_bp = 0` ; taux → `discount_amount_cents = null`,
  `discount_bp = bp` exact ; aucune → `null`, `0`. Le montant **demandé** part tel quel (le plafond CAP est
  calculé par le moteur, jamais écrit comme intention). Aucune clé v2 (`margin_multiplier`, `margin_mode`,
  `margin_bp`, `global_coefficient`, `discount_mode`, `discount_steps`) ni total client (`total_*_cents`) :
  le serveur recalcule (2.5). `title` et `exclusions` vides ou blancs → `null`, sinon rognés (convention v2).
  Un coefficient hors ]0 ; 10] ou à plus de 4 décimales (y compris 0 et `NaN`) → `EstimateV3SettingsError`
  `ESTIMATE_V3_SALE_COEFFICIENT_INVALID`, aucune charge.

Messages proposés (le hook et le parcours peuvent s'y aligner ; le test n'exige que le code et le nom du champ) :
« Coefficient de vente FO obligatoire : saisissez un nombre supérieur à 0 et au plus 10. »,
« Coefficient de vente FO invalide : nombre supérieur à 0 et au plus 10, 4 décimales au plus. » (idem MO),
« Remise invalide : montant positif en euros, 2 décimales au plus. », « Remise invalide : pourcentage entre 0 et
100, 2 décimales au plus. »

### 1.3 Hook `useEstimateV3Settings` (contrat supposé, raffinable sans toucher au §1.2)

- Actif si et seulement si `requireEstimateEngineVersion(version) === 3` ; inerte sur une v1/v2 (P-04 : la
  sauvegarde v2 et sa réécriture du taux restent inchangées).
- Expose : le brouillon, les erreurs par champ, `applyInput(field, raw)`, la demande de changement de taux
  par défaut (ouvre `TaxRatePropagationDialog` si une ligne a un autre taux), `confirmTaxPropagation(apply)`,
  `buildSavePayload()` (refuse tant qu'une erreur de champ est présente) et l'aperçu v3 calculé par le moteur
  pur de 2.4 (`computeEstimateV3Breakdown`) avec les **mêmes** entrées que le serveur (taux horaires du
  propriétaire, ventilation) ; l'aperçu ne part jamais comme total.
- Sauvegarde : `saveEstimateVersion(versionId, buildSavePayload(), updated_at, content_revision)` ; la
  réponse (version et lignes relues) remplace l'aperçu.

### 1.4 Branchements dans les fichiers existants (délégation seulement)

Mesure du 17/10/2026 à `f1d94213` (`npm run check:architecture` vert ; lignes non vides) :

| Fichier | Lignes / budget | Branchement v3 | Marge |
|---|---|---|---|
| `src/components/estimates/EstimateEditorTable.tsx` | 2 564 / 2 600 | cellules v3 déléguées à `V3LineCells` (`:1380`, `:1570-1577`, `:1789`) | +36 au plus |
| `src/hooks/useEstimateEditorState.impl.tsx` | 2 894 / 3 100 | `:541-542`, `:721-751`, `:930`, `:1252-1254`, `:1343-1351`, `:1452-1493` (charge v3 = `buildEstimateV3SettingsPayload`), `:1825-1858`, `:2808-2821` (coefficient réalisé, jamais `effective_margin_multiplier`) | +206 au plus |
| `src/hooks/useEstimateEditorSyncController.ts` | 1 199 / 1 200 | `:733` : `forceV2Totals` lève aujourd'hui sur une v3 (`resolveCalcEngineVersion`) ; la branche v3 (aucun total client, aucun `h_mo`) est déléguée par **remplacement** de l'expression | +1 au plus |
| `src/hooks/useEstimateEditorCalculation.ts:264-265` | 305 / 1 200 | aperçu v3 par le moteur pur | — |
| `src/hooks/useEstimateEditorSupplierController.ts` | — | présélection sur une v3 : §2, F26-17 | — |
| `EstimateSettingsPanel.tsx`, `ColumnHeaderHelp.tsx`, `EstimateColumnsHelpPanel.tsx`, `[versionId]/page.tsx:179`, `print/page.tsx:175` | — | section v3, aides par moteur, fiche et impression d'un brouillon v3 | — |

Assertions existantes **devenues fausses par construction** en 2.6 (réécriture délibérée, comme 2.5 §1.7) :
`V3P-06` d'`e2e/army/local/engine-v3-persistence.e2e.ts:386-388` et le volet éditeur/fiche d'
`e2e/army/local/engine-v3-fail-closed.e2e.ts:96-119` attendent la bannière « moteur de calcul 3 indisponible »
sur l'éditeur et la fiche d'une v3. La publication et l'envoi (`:139-144`) restent refusés jusqu'en 2.7.

## 2. Défaillances observables et preuves

Parcours : `e2e/army/local/engine-v3-editor.e2e.ts` (agent du parcours ; numéros de scénario du §14 « 2.6 »,
identifiants proposés `V3E-01` à `V3E-11`, le fichier du parcours fait foi). Chaque relecture attend l'état
sauvegardé (`waitForAutoSave`), compare l'écran à l'API relue après rechargement et aux valeurs du §3.

| Id | Défaillance observable | E2E | Vitest |
|---|---|---|---|
| F26-01 | F12 : une remise en montant part avec un `discount_bp` dérivé (`round(R / assiette × 10 000)`, `useEstimateEditorState.impl.tsx:1452-1460`). Masqué sur S2 (101 c / 6 905 456 c → 0) ; à partir de 3,46 € sur S1, refus serveur générique `ESTIMATE_V3_VERSION_SETTINGS_INVALID` | V3E-03 (relu : 101 c, 0 pb) | V3S-01 |
| F26-02 | Montant et taux envoyés ensemble, ou une saisie ne remplace pas l'autre intention | V3E-03 | V3S-02 |
| F26-03 | EUHIST : changer un coefficient réécrit le taux en montant ou le redérive ; un taux est arrondi à la saisie ; quitter le champ montant (qui, en v2, affiche le montant appliqué d'un taux et le renvoie au blur) convertit le taux en montant | V3E-03 (c_FO doublé, curseur passé par le champ montant : 1 000 pb relus) | V3S-03 |
| F26-04 | CAP : le montant demandé est remplacé par le montant appliqué, ou « demandé / appliqué » n'est pas affiché | V3E-04 | V3S-01 (500 € demandés partent tels quels) |
| F26-05 | Coefficient vidé : 0 envoyé (`emptyValue={0}` du champ marge v2), ou ancienne valeur reprise sans message (`NumberInput` sans `emptyValue`) | V3E-02 | V3S-04 |
| F26-06 | Coefficient ambigu, hors bornes ou trop précis accepté ou arrondi (« 1.250 », « 0 », « 10,0001 », « 1,23456 ») | — | V3S-04 |
| F26-07 | Changement de taux par défaut non propagé après « Oui », propagé après « Non », ou réglages et lignes en deux sauvegardes | V3E-05 | — |
| F26-08 | Pied par taux faux : TVA ligne à ligne (S5 : 1 325 527 c au lieu de 1 325 525 c), un seul taux au récapitulatif | V3E-05 | — |
| F26-09 | Ligne non chiffrée (« Hors lot ») comptée au HT ou à la TVA, ou ses saisies perdues au retour à « Chiffrée » (T-STAT) | V3E-06 | — |
| F26-10 | Unité : « ML » lue comme millilitre ou laissée en texte libre, unité inconnue acceptée en silence, unité remplacée par une suggestion catalogue (F18) | V3E-07 | — |
| F26-11 | Confusion h/u et `h_mo` : la grille écrit `h_mo` (refus `ESTIMATE_V3_LABOR_HOURS_PER_UNIT_REQUIRED`) ou « h MO total » est éditable ; la MO ne suit pas Q ; aide « par unité » en v1/v2 ou « total » en v3 | V3E-01, V3E-08 | — |
| F26-12 | « Barème par défaut » affiché ou appliqué en v3 ; repère du barème de l'entreprise appliqué ; marge affichée depuis `margin_multiplier` ou `effective_margin_multiplier` (×1 → « 0 % ») | V3E-09 | — |
| F26-13 | Arrondi `up` ou `nearest` proposé en v3 (y compris « Réglage conservé »), ou arrondi traité hors remise HT | V3E-10 | — |
| F26-14 | Aperçu ≠ valeur persistée : entrées d'aperçu différentes du serveur (taux horaire, barème) ou total client envoyé | V3E-01 à V3E-11 (écran = relu = §3) | — |
| F26-15 | L'éditeur, la fiche ou l'impression d'un brouillon v3 montrent encore la bannière 2.1, ou l'éditeur v2 s'ouvre et réécrit la v3 | V3E-01, V3E-10 | — |
| F26-16 | Sauvegarde automatique d'une v3 : `forceV2Totals` lève (`:733`), totaux client v2 (`buildVersionTotalsPatch`) ou `h_mo` envoyés | V3E-01, V3E-08 | — |
| F26-17 | Présélection fournisseurs sur une v3 : lignes normalisées en v2 (`normalizeLine`, `h_mo`, PU et totaux v2 envoyés par `bulkUpdateEstimateItems`), refus générique « moteur 3 indisponible » après avoir proposé le dialogue (`server.ts:6678`), ou unité de comparaison lue dans `description` au lieu de `unit_code` | V3E-11 | — |
| F26-18 | Budget dépassé (`EstimateEditorTable.tsx` > 2 600, `useEstimateEditorState.impl.tsx` > 3 100, `useEstimateEditorSyncController.ts` > 1 200) | `npm run check:architecture` (dans `verify:pr`) | — |
| F26-19 | Régression v1/v2 : charge, aperçu ou montants v2 changés | parcours critiques existants (`estimate-integrity`), corpus figé et empreintes ; `git diff --stat` vide sur `estimate-calculations.ts` et `estimate-v2-snapshot.ts` | — |

**F26-17, contrat retenu (Choix)** : sur une v3, appliquer la présélection passe par l'écrivain v3 de 2.5 (les
mêmes opérations de lot qu'une saisie de PR FO dans la grille) : seuls `unit_price_ht_cents` et
`selected_supplier_price_id` partent, le serveur recalcule PU, net, TVA et totaux, `h_mo` reste
arrondi(Q × h/u, 3). Repli admis seulement par décision explicite, avec le scénario mis à jour dans le même
commit : refus nommé `ESTIMATE_V3_SUPPLIER_PRESELECTION_UNSUPPORTED` avant toute écriture (`content_revision`
inchangée), action désactivée avec ce message. Interdits : montants v2, écriture partielle, message générique.
La présélection est masquée en mode simplifié : le scénario passe en mode Expert.

## 3. Valeurs attendues (moteur pur 2.4, rejouées le 17/10/2026)

Recalculées par `computeEstimateV3Breakdown` sur `oracleInput` (`src/lib/estimates/engine-v3/oracle.fixtures.ts`),
40 €/h, coefficients 1,30 / 1,20 sauf mention ; elles égalent le §5 de la conception là où il les donne.

| Scénario | Entrée | HT | TVA | TTC | Détail |
|---|---|---|---|---|---|
| V3E-01 | 7 lignes O1–O7 (S1) | 69 054,56 € | 13 810,91 € | 82 865,47 € | PU O1 166,63 € ; à 1,3 / 1,3 : 174,59 € (HT 71 336,74 €) |
| V3E-03 | S2, montant 1,01 € | 69 053,55 € | 13 810,71 € | 82 864,26 € | `discount_amount_cents` 101, `discount_bp` 0 |
| V3E-03 | S3, 10 % | 62 149,10 € | 12 429,82 € | 74 578,92 € | `discount_bp` 1 000, montant nul |
| V3E-03 | S3 puis c_FO 1,30 → 2,60 | 99 634,26 € | 19 926,85 € | 119 561,11 € | brut 110 704,73 €, remise 11 070,47 €, toujours 1 000 pb |
| V3E-04 | CAP : 500 € demandés, assiette 400 € | — | — | — | « demandé 500,00 € / appliqué 400,00 € », `discount_amount_cents` 50 000 |
| V3E-05 | S5 : O1–O3 à 10 %, O4–O7 à 20 %, remise 1,01 € | 69 053,55 € | 13 255,25 € | 82 308,80 € | bases 5 554,53 € (10 %) et 63 499,02 € (20 %) ; TVA 555,45 € + 12 699,80 € |
| V3E-06 | S1, O5 (314,00 €) « Hors lot » | 68 740,56 € | 13 748,11 € | 82 488,67 € | O5 : PU vide, 0 € ; retour à « Chiffrée » → S1 |
| V3E-08 | S1, Q de O5 1 → 2 | 69 368,56 € | 13 873,71 € | 83 242,27 € | O5 : 628,00 €, MO et PT doublés |
| V3E-10 | S4 : S2 + arrondi au pas de 100 € inférieur | 69 000,00 € | 13 800,00 € | 82 800,00 € | arrondi commercial 53,55 €, ajustement 0 |
| V3E-11 | S1, présélection O7 : PR FO 8,83 € → 9,00 € | 69 056,32 € | 13 811,26 € | 82 867,58 € | PU O7 74,10 €, total 592,80 € |

## 4. Justification de l'isolation (Vitest)

`AGENTS.md` place l'E2E en premier : toutes les défaillances du §2 ont un scénario, sauf F26-06 (cas limites de
saisie) et F26-18 (contrôle statique). L'isolation `src/lib/estimates/v3-settings-payload.test.ts` couvre ce que
le parcours ne peut pas distinguer, au titre des exceptions admises (intégrité de données, cas limites de
parseur) :

- **F26-01 est invisible sur les valeurs de la conception** : la sauvegarde v2 enverrait
  `round(101 / 6 905 456 × 10 000) = 0`, la valeur attendue. Une dérivation non nulle n'apparaît qu'au-delà de
  3,46 € sur S1, et le serveur la refuse alors par un code de forme générique, sans dire d'où vient le taux.
- **F26-02 et F26-03** exigent des suites de transitions (8 saisies) et des taux qui ne survivent pas à un aller
  et retour par un montant (12,34 %) : chaque étape coûterait une sauvegarde et une relecture dans le parcours,
  qui n'en garde qu'une (1,01 €, 10 %, c_FO doublé).
- **F26-05 et F26-06** sont des cas limites de parseur : 10 saisies par coefficient, plus 5 valeurs refusées
  au moment de construire la charge ; le parcours en garde une (champ vidé).

Non isolé : tout le reste (rendu, dialogue, grille, pied, relecture), prouvé par le parcours.

## 5. Rouge observé (17/10/2026)

Windows 11, Node 24.19.0, Vitest 4.1.11, worktree `miaouffrage-l2-26` à `f1d94213`, seule modification locale :
le fichier de test, non suivi au moment de l'exécution.

```text
$ npx vitest run --project=node src/lib/estimates/v3-settings-payload.test.ts   # sortie 1
 ❯ |node| src/lib/estimates/v3-settings-payload.test.ts (4 tests | 4 failed)
     × V3S-01 … × V3S-02 … × V3S-03 … × V3S-04 …
Error: MODULE_ABSENT: src/lib/estimates/v3-settings-payload.ts (sous-lot 2.6, contrat du §1.2 de
docs/testing/estimate-engine-v3-2.6.md) n'existe pas encore.
 Test Files  1 failed (1)
      Tests  4 failed (4)
```

Motif voulu : le module du §1.2 n'existe pas ; chaque cas échoue sur ce seul motif. Le test se compile sans
lui (contrat de types recopié, chargement par un spécificateur en variable, comme
`src/lib/estimates/offer-contract.test.ts:186`) : contrôle de types isolé du fichier (`tsc`, sortie 0) et
`npx eslint --max-warnings=0` (sortie 0). Journal non versionné, SHA-256
`600f57cdce30f5ad09eb81f04a00754107aa198205d9b238e5fc6d17f8b3e65c`.

Contrôle de discrimination, hors dépôt et non versionné (copie du test et implémentation jetable dans le
répertoire temporaire de la session, chargée par le même chemin absolu, ce qui prouve aussi l'import dynamique
sous Windows) : implémentation conforme au §1.2 → 4/4 verts ; défauts injectés → dérivation du taux
(`V3S-01`, `V3S-02` rouges : « expected { discount_amount_cents: 101, … } to be null »), deux intentions
(`V3S-02`, `V3S-03`), taux converti en montant au changement de coefficient (`V3S-03`), coefficient vidé à 0 ou
repris sans message (`V3S-04`), clé v2 dans la charge (les quatre).

## 6. Commandes

```bash
# Windows ou WSL
npx vitest run --project=node src/lib/estimates/v3-settings-payload.test.ts
npm run check:architecture
# WSL, clone Linux ~/miaouffrage-lot2-26 (au plus deux exécutions natives possédées en parallèle)
E2E_ARMY_WORKERS=2 NODE_OPTIONS=--max-old-space-size=4096 npm run e2e:army:local -- --grep "V3E"
```

Au vert (implémentation) : le même test, types recopiés remplacés par `import type` depuis le module et
chargement dynamique par un import statique, sans modifier une assertion ; parcours `engine-v3-editor` vert et
inscrit à `scripts/tester-army/army-impact-map.json` ; `V3P-06` et le volet éditeur/fiche de `V3FC` réécrits
(§1.4) ; `npm run verify:pr` ; corpus figé et empreintes identiques.

## 7. Limites et points ouverts

- Les sélecteurs et libellés du parcours font foi ; les messages du §1.2 sont une proposition.
- CAP (V3E-04) suppose une assiette de 400 € dans le brouillon unique du parcours (un brouillon par parcours,
  verrou d'édition) : à construire par statuts ou quantités, au choix de l'agent du parcours.
- La règle « vider le champ de l'intention active la supprime » est un **choix** : la conception ne dit pas ce
  que vaut une remise vidée en v3 ; la v2 la met à 0 €.

## 8. Implémentation : grille, état d'éditeur, synchronisation et pages (vert)

Piste « grille » du vert (la piste « réglages », §1.2 et §1.3, est le commit `e0022a1f`). Décisions prises par
délégation du porteur, le 17/10/2026 :

| Décision | Contrat retenu |
|---|---|
| F26-17, présélection fournisseurs sur une v3 | **Recalcul persisté** par l'écrivain de lot de 2.5 (`POST …/batch`, `op: "update"`) : seuls `unit_price_ht_cents` et `selected_supplier_price_id` partent ; le serveur recalcule PU, nets, TVA et totaux et les vérifie (D12) dans la même transaction. Le refus nommé du §2 n'est pas retenu. La comparaison lit l'unité d'une ligne v3 dans `unit_code`, jamais dans `description` |
| Remise vidée | Vider le champ de l'intention active la met à `none` (choix du §7, tenu par le module pur) |
| Émission | Fermée jusqu'en 2.7 : « Envoyer » masqué sur une v3, exports désactivés ; PDF et envoi restent refusés par le serveur (`ESTIMATE_ENGINE_UNAVAILABLE`, V3FC02) |
| Modèles, ouvrages, métré | Refusés sur une v3 jusqu'en 2.8, par les refus nommés existants du serveur (aucune conversion côté éditeur) |

### 8.1 Aiguillage et délégation

| Fichier | Changement | Lignes non vides / budget |
|---|---|---|
| `src/lib/estimates/editor-engine.ts` (nouveau) | aiguillage exhaustif du moteur de l'éditeur : `resolveEditorEngineContext`, `reconcilesEditorTotals` (remplace l'expression de `forceV2Totals` qui levait sur une v3), `toEngineItemWrite`, `normalizeEditorDraftItems`, `resolveEditorInitialDiscountCents` ; une v1/v2 garde les mêmes appels historiques, une v3 n'est jamais normalisée ni calculée par le moteur 1/2 | 109 / 1 200 |
| `src/lib/estimates/v3-editor.ts` (nouveau, pur) | lignes affichées depuis l'aperçu du moteur pur (PU, nets, TVA, parts FO/MO, heures dérivées), charge de ligne v3 (saisies seulement : `unit_code`, `pricing_status`, `h_mo*_per_unit`, jamais `h_mo` ni projection), référence de synchronisation, unité du référentiel (`ml — mètre linéaire`, alias validé, inconnue refusée par son nom), taux de TVA proposés, pied v3, pied stocké d'un brouillon | 238 / 1 200 |
| `src/components/estimates/v3/V3LineCells.tsx` (nouveau) | contexte de grille v3, cellule « Unité pour {t} », « Heures de main-d’œuvre par unité » (`h_mo_per_unit`, 4 décimales) et `output` en lecture seule « Heures de main-d’œuvre totales », sélecteurs « Statut de chiffrage » et « Taux de TVA » | 242 / 1 200 |
| `src/components/estimates/v3/EstimateV3DraftSummary.tsx` (nouveau) | lecture d'un brouillon v3 sur la fiche et l'impression : montants stockés, TVA par taux, lignes | 97 / 1 200 |
| `useEstimateEditorState.impl.tsx` | moteur résolu une fois ; `useEstimateV3Settings` branché (aperçu, charge de sauvegarde, tiroir) ; chargement, relectures et normalisation par `editor-engine` ; charge v3 de `saveEstimateVersion` = `buildSavePayload()` (jamais de `discount_bp` dérivé ni de total client) ; lignes relues après « Oui » = nouvelle référence ; v3 : pas de multiplicateur de marge (`effective_margin_multiplier` jamais lu), envoi masqué, exports désactivés | 2 894 → 2 908 / 3 100 |
| `useEstimateEditorSyncController.ts` | `:729` remplacé par `reconcilesEditorTotals` ; la charge de lot passe par `toEngineItemWrite` ; la référence de synchronisation porte les saisies v3 | 1 199 → 1 199 / 1 200 |
| `useEstimateEditorCalculation.ts` | v3 : aucun calcul historique, lignes affichées depuis l'aperçu | — |
| `EstimateEditorTable.tsx` | inchangé : la grille reçoit le contexte v3 d'`EstimateEditorPage` | 2 564 / 2 600 |
| `LineRow.tsx`, `StandardMoCells.tsx`, `LaborSplitCells.tsx`, `EstimateEditorRow.tsx` | délégation aux cellules v3 ; PT = brut ⌈Q × PU⌋ ; PU vide pour une ligne non chiffrée ; atelier/chantier par unité en v3 | `LineRow` 1 198 → 1 196 / 1 200 |
| `useEstimateEditorItemsController.ts`, `useEstimateEditorSupplierController.ts`, `useCatalogueSuggestions.ts` | charge de ligne v3 injectée ; présélection v3 par l'écrivain de lot ; une suggestion du catalogue ne remplace jamais l'unité d'une ligne v3 | — |
| `batch-client.ts` | une ligne v3 non chiffrée relue sans PU (`pu_ht_cents` nul, décision 3 de 2.5) n'est plus une issue inconnue | — |
| `EstimateEditorPage.tsx`, `EstimateEditorDrawer.tsx` | contexte de grille v3 autour de la grille ; tiroir : réglages v3 passés à `EstimateSettingsPanel`, gestionnaire v1/v2 des tranches de marge non rendu sur une v3 (`showMarginTiers`) | — |
| `EstimateSettingsSummaryBar.tsx` | pied v3 : « Total HT », une entrée « TVA {r} % » par taux présent, « TVA », « TTC à payer », remise et arrondi commercial dès qu'ils s'appliquent, aucune marge v2 | — |
| `ColumnHeaderHelp.tsx`, `EstimateColumnsHelpPanel.tsx`, `EstimateEditorTableChrome.tsx` | aide et en-têtes selon le moteur : v3 « h MO / u » et la formule complète du PU ; v1/v2 inchangées (« heures totales de la ligne ») | — |
| `edit/page.tsx`, `[versionId]/page.tsx`, `print/page.tsx` | l'éditeur s'ouvre sur une v3 ; fiche et impression d'un brouillon v3 en lecture, sans bandeau ni émission ; seul un moteur inconnu garde le bandeau | — |

`estimate-calculations.ts` et `estimate-v2-snapshot.ts` : aucun diff.

### 8.2 Choix d'écran

- « Statut » et « TVA % » sont deux sélecteurs compacts accolés au titre, dans la cellule Désignation, toujours
  visibles : des colonnes dédiées toucheraient le modèle de colonnes partagé par la v1/v2 (identifiants, ordre
  par groupes, largeurs, en-tête, pied). « h MO total » est un `output` sous « h MO / u », dans la même cellule.
- Les sections et le pied de la grille somment les **nets** (sens historique de `line_total_ht_cents`, D7) ; le
  PT d'une ligne affiche son **brut**. Le document client v3 (sections brutes) est de 2.7.
- La fiche et l'impression lisent les montants **stockés** (vérifiés à chaque sauvegarde, D12), jamais un
  recalcul ; l'éditeur lit l'aperçu du moteur pur.

### 8.3 Réécritures délibérées (§1.4)

- `V3P-06` (`engine-v3-persistence.e2e.ts`) : l'éditeur v3 s'ouvre sur la v3 persistée (grille, état
  « Sauvegardé » ou « À jour », pas de bandeau) et l'ouvrir ne la réécrit pas (`stamp` inchangé).
- `V3FC01` (`engine-v3-fail-closed.e2e.ts`) : éditeur et fiche d'un brouillon v3 sans bandeau ; l'éditeur
  montre l'aperçu du moteur 3 de la fixture (pastille « Total HT : 58,50 € » et, le propriétaire de la fixture
  étant en mode Simplifié, « TTC à payer » 70,20 € lu dans le détail du pied ouvert au clavier) et jamais la
  lecture v1 du HT et du TTC (45,00 € / 54,00 €) ; le PR FO saisi (22,50) y reste affiché, d'où une expression
  sans « 22,50 » pour l'éditeur ; la fiche garde l'expression complète ; l'état de la fixture est inchangé.
  `V3FC02` (publication et envoi refusés) est inchangé.

### 8.4 Défauts révélés par le vert

Deux défauts, rouges par le parcours lui-même :

- **Retour à « Chiffrée » refusé par l'écrivain de lot** (`V3E02`, T-STAT, passage 2) : une ligne « Hors lot »
  n'a pas de PU (décision 3 de 2.5) ; `commit_estimate_batch` met la ligne à jour avant de la projeter, et le
  CHECK `estimate_items_item_type_payload_check` (PU obligatoire d'une ligne chiffrée) annulait le lot (« Le lot
  a été annulé. »). Migration `20261017205000_estimate_engine_v3_line_repricing.sql` : un déclencheur `BEFORE
  UPDATE OF pricing_status` donne un PU provisoire nul à une ligne qui redevient chiffrée ; la projection du
  même lot écrit le PU du moteur et `estimate_v3_assert_draft` vérifie chaque PU (D12), un PU provisoire ne peut
  donc jamais être validé. Seule une ligne v3 peut quitter `priced` (CHECK de M4) : aucune v1/v2 n'est touchée,
  aucune comparaison de moteur à un littéral (liste blanche F-SQL-14 inchangée). M4 n'est pas réécrite (encore
  en revue dans 2.5). À appliquer au Supabase partagé avant tout déploiement (AGENTS.md).
- **Barème v1/v2 dans le tiroir d'une v3** (`V3E01`, V3E-09, F26-12, passage 7) : le tiroir rendait, sous les
  réglages v3, le gestionnaire « Tranches de marge » de la v1/v2, avec « Aucune tranche définie : le barème par
  défaut est appliqué. » et l'exemple « × 1.60 » ; le moteur 3 n'applique aucun barème (repère seulement). Le
  tiroir ne le rend plus sur une v3 (`showMarginTiers`, `ed93d1fd`) ; v1/v2 inchangées.

Cinq préalables du parcours testaient autre chose que l'éditeur v3, corrigés sans toucher une assertion :

| Passage | Constat | Correction |
|---|---|---|
| 1 (`d97107a7`) | éditeur ouvert mais en lecture seule, « Verrouillé par vous dans un autre onglet ou appareil » : `prepareV3Draft` et `seedLines` gardaient le verrou de la session d'API de leur document, et l'éditeur ouvert ensuite par une navigation est une autre session de page (`useDraftLock`) | les préalables rendent leur verrou une fois écrits (`3e145f55`) |
| 2 | `addGridLine` touchait le « + » de la section sans le survol d'un utilisateur : ce menu est `pointer-events: none` tant que la désignation n'est ni survolée ni focalisée (`estimate-frozen.css`), et une section créée par l'API n'a pas de focus | survol du titre de la section avant le « + » (`99e63ef0`) |
| 2 | `V3E03` ouvrait la présélection sur une ligne qui retient déjà l'offre A avec une offre B moins chère : pour tout moteur la revue en fait une exception « divergence », jamais une proposition (`findEstimateSupplierPreselectionProposalAlternative` exige aucune offre retenue et une seule offre), donc aucune des deux issues attendues ne pouvait paraître | `releaseOfferForPreselection` libère l'offre A de la ligne par l'écrivain de lot v3 et la retire du catalogue avant l'ajout de B (preuve `v3e-preselection-precondition`) (`99e63ef0`) |
| 4 | le menu de section reste ouvert après « + Ligne » jusqu'à un clic extérieur ou Échap (`usePopover`) : le second `addGridLine` le refermait | le menu n'est ouvert que s'il ne l'est pas déjà (`86ef5886`) |
| combiné (`73e2cbc9`) | après `openSettings`, tiroir et grille en lecture seule, « Verrouillé par vous dans un autre onglet ou appareil » : une navigation ouvre une autre session de page et le document quitté rend son bail par une libération `keepalive` envoyée au `beforeunload` (`useDraftLock`) ; elle n'est pas parvenue (hypothèse : le garde du navigateur critique route chaque requête, celle-ci partie avec la page), et la page ne reprend le bail qu'à son expiration (120 s, `DRAFT_LOCK_TTL_SECONDS`) par sa reprise automatique toutes les 5 s. Comportement inchangé de `useDraftLock`, tous moteurs | `waitForDraftLease` attend dans `openSettings` et `openGrid` que l'état de synchronisation ne soit plus « Verrouillé » ni « Connexion… » (jusqu'à 150 s), sans rejouer d'étape (`0deea428`) |

Les deux réécritures du §8.3 testaient d'abord autre chose que leur intention, corrigées au premier passage
`V3P01|V3FC0` (`73e2cbc9`) : `V3FC01` attendait la pastille TTC du mode Expert alors que le propriétaire de la
fixture est en mode Simplifié (le pied n'y montre que le HT, le reste dans son détail) ; `V3P-06` ouvrait
l'éditeur sous le bail de l'API du document (« Verrouillé par vous dans un autre onglet ou appareil »), rendu
désormais avant l'ouverture comme dans les parcours de l'éditeur.

### 8.5 Limites

- La donnée de `V3E03` porte la même unité dans `description` et `unit_code` : la lecture de `unit_code` par la
  comparaison fournisseurs n'y est pas discriminée.
- Taux proposés par la cellule « TVA % » : la liste par défaut de la politique (20 / 10 / 5,5 / 2,1 %) et le taux
  de la ligne ; une liste propre à l'entreprise n'est pas encore lue par l'éditeur (contrôlée au gel).
- Changer le taux horaire d'un rôle n'écrit rien sur une v3 : l'aperçu le suit, la prochaine écriture recalcule.
- L'éditeur mobile d'une ligne et la restauration d'un brouillon en conflit restent v2 : sur une v3, une heure
  totale saisie est refusée par le serveur (`ESTIMATE_V3_LABOR_HOURS_PER_UNIT_REQUIRED`), jamais écrite.
- Actions en lot (catégorie, rôle, majoration) : leur charge est réduite aux saisies par `toEngineItemWrite`.
- Tiroir d'une v3 : le gestionnaire des tranches de marge n'y est plus rendu ; le barème de l'entreprise se
  gère depuis le tiroir d'une v1/v2 (ou `/api/margin-tiers`) jusqu'à un gestionnaire rédigé pour le moteur 3.
- **Instabilité observée, non reproduite** : à `86ef5886`, deux passages de `V3E01` sur trois
  (`2026-10-17T21-01-04-472Z`, `2026-10-17T21-09-01-580Z`) ont perdu le rôle « Tuyauteur » saisi dans la liste
  « Rôle de main-d'œuvre pour {t} » (ligne O2 puis O1) : après le remplissage, le champ est focalisé, la liste
  ouverte et le texte vide, donc le Tab ne valide rien et la sauvegarde attendue n'arrive pas. Une sonde des
  événements (focus, saisie, touches, piles d'appel) n'a ensuite montré que la séquence nominale, et les six
  passages suivants (sondés ou non, dont le vert du §8.6) n'ont plus perdu de saisie dans la grille ; `ed93d1fd` ne touche
  pas ce chemin (tiroir fermé pendant la saisie). Cause non établie ; aucune reprise ni attente ajoutée pour
  faire passer le parcours (AGENTS.md).

### 8.6 Preuves (17 et 18/10/2026)

- Parcours : `V3E01`, `V3E02`, `V3E03`, `V3P01`, `V3FC01`, `V3FC02` verts ensemble à `0deea428`, une tentative
  chacun, issue de la présélection « recalcul persisté » (commande, archive et empreintes au §10 du doc
  `estimate-engine-v3-2.6-e2e.md`).
- `npm run verify:pr` dans le clone WSL à `0deea428`, sortie 0 : audit des dépendances et des signatures (762
  paquets vérifiés), budgets d'architecture (1 131 modules, 0 cycle), OpenAPI, `typecheck`, `lint`
  (`--max-warnings=0`), Vitest node 296 fichiers / 2 782 tests passés (1 fichier, 2 tests ignorés), jsdom 162 / 821
  passés (dont `v3-settings-payload.test.ts`, `useEstimateEditorSyncController.test.ts`,
  `EstimateEditorTable.integration.test.tsx`, `EstimateEditorDrawer.test.tsx`,
  `EstimateSettingsSummaryBar.test.tsx`), couverture critique 3 / 12.
- Windows, à `0deea428` : `npm run typecheck` et `npm run check:architecture` sortie 0 ; `npx eslint
  --max-warnings=0` sur chaque fichier touché par un commit de correction, sortie 0.
- `git diff --stat f1d94213 HEAD -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts` : vide.
