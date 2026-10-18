# Éditeur et réglages v3 (sous-lot 2.6) — défaillances, parcours E2E, implémentation et preuves

Statut : **vert, intégré, revu** (18/10/2026 ; revue, corrections et preuves au §11, qualifiées à `258daf9e`). Le rouge a été écrit le 17/10/2026 sans code de production (isolation
Vitest au §5, parcours E2E au §9.8). L'implémentation, en deux pistes (réglages `e0022a1f`, grille `d97107a7` à
`6521ab4a`), est au §8 ; l'intégration des deux pistes, la fusion d'`origin/main` et les preuves mesurées sont au
§10. Ce document fixe les défaillances observables de l'éditeur v3 (§2), leur preuve (parcours E2E
`engine-v3-editor`, §9, ou isolation Vitest `V3S-01` à `V3S-04`, §4), le contrat de composants et de hooks (§1) et
le contrat d'écran et d'API du parcours (§9.4, §9.5). Il absorbe l'ancien `estimate-engine-v3-2.6-e2e.md`
(fusionné le 18/10/2026 : ses §1 à §8 sont ici les §9.1 à §9.8, son §10 est au §8.6). Source :
[conception du lot 2](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md), §0, D4 à D9, D11, §4,
§5 (S2, S4, S5, EUHIST, CAP, T-STAT), §8.1 et §8.2 (lignes 2.6), §9, §14 « 2.6 ». Là où ce document résume la
conception, la conception fait foi ; là où il **choisit** (signalé « Choix »), il fixe le contrat que le rouge
exige. Les choix laissés ouverts au rouge ont été tranchés par délégation du porteur (tableau du §8).

Branche `lot2/2.6-editeur-v3`. Rouge écrit sur `f1d94213` (pointe de `lot2/2.5-persistance-v3` à ce moment : M4,
politique d'entreprise, création `canonical_v3`, écrivains v3, gel v3, serveur TS et API). 2.5 est fusionné dans
`main` (PR #33, `94694ab3`) ; la branche a fusionné `origin/main` à `fc2ba2dc` (commit `28d04309`), puis à `78ca0855`
(2.9, commit `1ec72124`) et à `91068850` (documentation seule, commit `71802307`), sans rebase (§10.1).
Dépendances : 2.5, 2.3.

## 1. Contrat

### 1.1 Modules nouveaux (§8.1, chacun ≤ 1 200 lignes non vides)

| Fichier | Rôle |
|---|---|
| `src/lib/estimates/v3-settings-payload.ts` | **Choix** : cœur pur de `useEstimateV3Settings` (lecture de la version, saisie champ par champ, charge de sauvegarde, aperçu par le moteur pur). Module sans React, testable dans le projet Vitest `node` ; le §8.1 ne nomme que le hook, qui le réexporte. Contrat au §1.2, asserté par `v3-settings-payload.test.ts` |
| `src/hooks/useEstimateV3Settings.ts` | État d'éditeur v3 : brouillon de réglages, erreurs par champ, dialogue de propagation de TVA, charge de sauvegarde, aperçu ; reçoit les branches v3 déléguées par les fichiers saturés (§1.4) |
| `src/components/estimates/v3/EstimateV3SettingsSection.tsx` | Réglages v3 rendus par `EstimateSettingsPanel.tsx` à la place des blocs marge, remise, TVA et arrondi : coefficients de vente FO et MO, repère du barème de l'entreprise (non appliqué), remise en € **ou** en %, « demandé / appliqué », « TVA par défaut des nouvelles lignes », arrondi « Aucun » ou « palier inférieur » |
| `src/components/estimates/v3/V3LineCells.tsx` | Cellules v3 de la grille, déléguées par `LineRow`, `StandardMoCells` et `EstimateEditorRow` (contexte fourni par `EstimateEditorPage`) : « U » (référentiel), « Statut », « h MO / u », « TVA % », « h MO total » en lecture seule |
| `src/components/estimates/v3/TaxRatePropagationDialog.tsx` | Dialogue au changement de taux par défaut : « Oui » applique le taux à toutes les lignes dans la **même** sauvegarde (`apply_tax_rate_to_lines`, D8) ; « Non » ne change que le taux des nouvelles lignes |

Modules ajoutés au vert par la piste grille (§8.1) : `src/lib/estimates/editor-engine.ts`,
`src/lib/estimates/v3-editor.ts`, `src/components/estimates/v3/EstimateV3DraftSummary.tsx` ; à la revue (§11) :
`src/lib/estimates/v3-editor-writer.ts` (écritures de la grille v3 par l'écrivain de lot).

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
  champ et bloque la sauvegarde tant qu'elle est là. Jamais 0, jamais de reprise silencieuse. Au vert, la borne
  est contrôlée par la règle Zod de 2.5 (`isValidEstimateV3SaleCoefficient`) : navigateur et API refusent les
  mêmes valeurs.
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

Messages (proposés au rouge, retenus tels quels au vert, suivis à l'écran de « Valeur conservée : {valeur}. ») :
« Coefficient de vente FO obligatoire : saisissez un nombre supérieur à 0 et au plus 10. »,
« Coefficient de vente FO invalide : nombre supérieur à 0 et au plus 10, 4 décimales au plus. » (idem MO),
« Remise invalide : montant positif en euros, 2 décimales au plus. », « Remise invalide : pourcentage entre 0 et
100, 2 décimales au plus. » Le test n'exige que le code et le nom du champ.

Fonctions pures ajoutées au vert, hors contrat du §1.2 (même module) : `applyEstimateV3TaxRateInput` (taux par
défaut, 0 à 100 %, 2 décimales), `formatEstimateV3Coefficient`, `formatEstimateV3RatePercent`,
`formatEstimateV3AmountInput`, `formatEstimateV3DiscountTexts` (textes des deux champs de remise),
`countEstimateV3LinesWithOtherTaxRate` (ouverture du dialogue), `resolveEstimateV3MarginTierHint` (repère
`resolveMarginMultiplier`, seulement avec un barème d'entreprise), `buildEstimateV3PreviewInput` et
`computeEstimateV3SettingsPreview` (aperçu, §1.3), `isValidEstimateV3SaleCoefficient`.

### 1.3 Hook `useEstimateV3Settings` (contrat tenu au vert)

```ts
useEstimateV3Settings(input: {
  version: (VersionSettingsColumns & { id: string }) | null | undefined; // calc_engine_version : propriété propre
  items: readonly EstimateV3PreviewLine[];            // lignes de l'éditeur ; sections ignorées
  laborRoles: readonly { id: string; hourly_rate_cents: number }[];
  laborSplitEnabled: boolean;
  marginTiers?: readonly MarginTier[] | null;         // barème de l'entreprise seulement, jamais getMarginTiers()
}): EstimateV3SettingsController | null;
```

- Actif si et seulement si `requireEstimateEngineVersion(version) === 3` (et `usesSaleCoefficients`) ; `null` sur
  une v1/v2 (P-04 : la sauvegarde v2 et sa réécriture du taux restent inchangées). Une relecture de la version
  resynchronise le brouillon pendant le rendu, pas dans un effet.
- Expose : `draft`, `saved`, `unavailableMessage` ; `texts` et `errors` par champ texte
  (`sale_coefficient_fo`, `sale_coefficient_mo`, `discount_amount`, `discount_rate`, `tax_rate`), `hasErrors`,
  `isDirty` ; `setText`, `commitText`, `applyInput(field, raw)`, `updateDraft(patch)` (champs communs : titre,
  date, exclusions, validité, devise, rôle, arrondi) ; `reset()`.
- « Enregistrer le paramétrage » appelle `requestSave(save)` : valide les textes encore en saisie, refuse tant
  qu'une erreur de champ est présente, ouvre `TaxRatePropagationDialog` quand le taux par défaut a changé
  **et** qu'au moins une ligne porte un autre taux (`taxPropagation: { rateBp, lineCount }`), sinon appelle
  `save`. Rien n'est envoyé avant la réponse : `confirmTaxPropagation(applyToLines, save)` appelle la sauvegarde
  courante de l'éditeur (pas celle capturée à l'ouverture), `cancelTaxPropagation()` (Échap) n'envoie rien.
- `buildSavePayload()` → `{ ok: true, payload }` ou `{ ok: false, reason: "unavailable" | "field_errors" |
  "tax_propagation_required", message }`.
- `preview` : aperçu v3 calculé par le moteur pur de 2.4 (`computeEstimateV3Breakdown`) par
  `computeEstimateV3SettingsPreview`, avec les **mêmes** entrées que le serveur (`buildEstimateV3Input`, champ
  par champ ; taux horaire du rôle du propriétaire pour la MO, l'atelier et le chantier ; ventilation ; réglages
  du brouillon comme version prospective) ; une ligne à identifiant provisoire (pas encore créée) en est
  exclue, le serveur ne la connaissant pas encore. C'est l'**unique** aperçu de l'éditeur : la grille, le pied et
  le tiroir le lisent (§10.2). Il ne part jamais comme total. `marginTierHint` : `{ multiplier,
  costSubtotalCents }` ou `null`.
- Sauvegarde (`performSaveSettings` de `useEstimateEditorState.impl.tsx`) : sur une v3,
  `saveEstimateVersion(versionId, buildSavePayload().payload, updated_at, content_revision)`, sans totaux v2 ni
  `buildVersionTotalsPatch` ni `discount_bp` dérivé ; la réponse (version et lignes relues) remplace l'état, les
  lignes relues après « Oui » deviennent la nouvelle référence de synchronisation, et le hook se resynchronise
  sur la version relue. `hasUnsavedSettings` tient compte de `isDirty`, « Abandonner » appelle `reset()`.

### 1.4 Branchements dans les fichiers existants (délégation seulement)

Mesure du 17/10/2026 à `f1d94213` (`npm run check:architecture` vert ; lignes non vides) ; mesures au vert au §8.1
et au §10.1 :

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
Réécritures au §8.3.

## 2. Défaillances observables et preuves

Parcours : `e2e/army/local/engine-v3-editor.e2e.ts` (§9 ; numéros de scénario du §14 « 2.6 », `V3E-01` à
`V3E-11`, le fichier du parcours fait foi). Chaque relecture attend l'état sauvegardé (`waitForAutoSave`), compare
l'écran à l'API relue après rechargement et aux valeurs du §3.

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
| F26-10 | Unité : « ML » lue comme millilitre ou laissée en texte libre, unité inconnue acceptée en silence (ou refusée sans que la cellule se quitte), unité remplacée par une suggestion catalogue (F18) | V3E-07 ; inconnue et statut : V3E05 (revue, §11) | — |
| F26-11 | Confusion h/u et `h_mo` : la grille écrit `h_mo` (refus `ESTIMATE_V3_LABOR_HOURS_PER_UNIT_REQUIRED`) ou « h MO total » est éditable ; la MO ne suit pas Q ; aide « par unité » en v1/v2 ou « total » en v3 | V3E-01, V3E-08 | — |
| F26-12 | « Barème par défaut » affiché ou appliqué en v3 ; repère du barème de l'entreprise appliqué ; marge affichée depuis `margin_multiplier` ou `effective_margin_multiplier` (×1 → « 0 % ») | V3E-09 | — |
| F26-13 | Arrondi `up` ou `nearest` proposé en v3 (y compris « Réglage conservé »), ou arrondi traité hors remise HT | V3E-10 | — |
| F26-14 | Aperçu ≠ valeur persistée : entrées d'aperçu différentes du serveur (taux horaire, barème) ou total client envoyé | V3E-01 à V3E-11 (écran = relu = §3) | — |
| F26-15 | L'éditeur, la fiche ou l'impression d'un brouillon v3 montrent encore la bannière 2.1, ou l'éditeur v2 s'ouvre et réécrit la v3 | V3E-01, V3E-10 | — |
| F26-16 | Sauvegarde automatique d'une v3 : `forceV2Totals` lève (`:733`), totaux client v2 (`buildVersionTotalsPatch`) ou `h_mo` envoyés | V3E-01, V3E-08 | — |
| F26-17 | Présélection fournisseurs sur une v3 : lignes normalisées en v2 (`normalizeLine`, `h_mo`, PU et totaux v2 envoyés par `bulkUpdateEstimateItems`), refus générique « moteur 3 indisponible » après avoir proposé le dialogue (`server.ts:6678`), ou unité de comparaison lue dans `description` au lieu de `unit_code` | V3E-11 | — |
| F26-18 | Budget dépassé (`EstimateEditorTable.tsx` > 2 600, `useEstimateEditorState.impl.tsx` > 3 100, `useEstimateEditorSyncController.ts` > 1 200) | `npm run check:architecture` (dans `verify:pr`) | — |
| F26-19 | Régression v1/v2 : charge, aperçu ou montants v2 changés | parcours critiques existants (`estimate-integrity`), corpus figé et empreintes ; `git diff --stat` vide sur `estimate-calculations.ts` et `estimate-v2-snapshot.ts` | — |
| F26-20 | Ajouté à l'intégration (§10.4) : la comparaison fournisseurs d'une ligne v3 (« Comparer les fournisseurs », « Choisir une offre ») lit l'unité dans `description`, vide sur une ligne v3 : toute unité d'offre passe pour compatible (une ligne en ml peut prendre un prix à la barre) et retenir une offre écrit son unité dans `description` | V3E-12 | — |
| F26-21 | Revue (§11) : supprimer une ligne ou une section d'une v3, annuler un ajout, rétablir une suppression ou nettoyer une ligne retirée pendant sa création passe par la suppression directe (refus générique, ligne revenue, ou ligne orpheline cachée) ; annuler une suppression recrée la ligne sans ses saisies v3 (`h_mo` refusé, `unit_code` perdu) | V3E05 | — |
| F26-22 | Revue : majoration, catégorie, rôle, déplacement ou suppression en lot d'une v3 (et leur annulation) par `POST /items/bulk` ou la suppression directe : refus générique après une mise à jour optimiste | V3E06 | — |
| F26-23 | Revue : le taux horaire d'un rôle changé dans l'éditeur ne recalcule rien de stocké : l'aperçu suit, la fiche, l'impression, la liste des affaires et les approbations gardent l'ancien HT sous « Sauvegardé » | V3E07 | — |
| F26-24 | Revue : « Deboursé sec », « Marge € », « Marque % » d'une ligne v3 recalculés par la formule v1/v2 (vente = net, taux atelier/chantier) au lieu du moteur (brut − déboursé) | V3E08 | — |
| F26-25 | Revue : « Temps MO manquant » et la nature de ligne lus sur le `h_mo` stocké, périmé dès qu'une saisie change Q ou h/u | V3E08 | — |
| F26-26 | Revue : « Associer ou remplacer l'article » lit l'unité d'une ligne v3 dans `description`, prix d'une autre unité accepté, unité de l'offre écrite dans `description` (même famille que F26-20) | V3E09 | — |
| F26-27 | Revue : Ctrl+S, l'enregistrement à la fermeture du tiroir et la navigation n'ouvrent pas la question de propagation de la TVA (sauvegarde bloquée par une erreur derrière le tiroir) | V3E10 | — |
| F26-28 | Revue : « 0 » dans « Remise (%) » laisse les réglages « Non sauvegardé » après leur sauvegarde | V3E11 | — |
| F26-29 | Revue : un palier inférieur stocké hors de la liste s'affiche « Aucun » alors qu'il s'applique | V3E11 | — |
| F26-30 | Revue : la fiche d'un brouillon v3 propose « Préparer le PDF » et « Sauvegarder comme modèle » (émission fermée jusqu'en 2.7, modèles jusqu'en 2.8), refusés ensuite par le message générique | V3E11 | — |
| F26-31 | Revue : coller des lignes dans une v3 écrit l'unité dans `description` (`unit_code` perdu) et des heures totales (refusées) | V3E13 | — |
| F26-32 | Revue : appliquer ou annuler les suggestions en lot sur une v3 par `POST /items/bulk` : refus générique | V3E12 | — |

**F26-17, contrat retenu** (Choix au rouge, **décision** du porteur au vert, §8) : sur une v3, appliquer la
présélection passe par l'écrivain v3 de 2.5 (les mêmes opérations de lot qu'une saisie de PR FO dans la grille) :
seuls `unit_price_ht_cents` et `selected_supplier_price_id` partent, le serveur recalcule PU, net, TVA et totaux,
`h_mo` reste arrondi(Q × h/u, 3). Repli admis seulement par décision explicite, avec le scénario mis à jour dans
le même commit : refus nommé `ESTIMATE_V3_SUPPLIER_PRESELECTION_UNSUPPORTED` avant toute écriture
(`content_revision` inchangée), action désactivée avec ce message (non retenu). Interdits : montants v2, écriture
partielle, message générique. La présélection est masquée en mode simplifié : le scénario passe en mode Expert.

## 3. Valeurs attendues (moteur pur 2.4, rejouées le 17/10/2026)

Recalculées par `computeEstimateV3Breakdown` sur `oracleInput` (`src/lib/estimates/engine-v3/oracle.fixtures.ts`),
40 €/h, coefficients 1,30 / 1,20 sauf mention ; elles égalent le §5 de la conception là où il les donne. Détail
par étape au §9.3.

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

Les parcours tiennent T-STAT et CAP sur un brouillon dédié (V3E02, §9.3.2) et la présélection sur une ligne
dédiée (V3E03, §9.3.3) plutôt que sur l'oracle : les lignes V3E-06 et V3E-11 ci-dessus restent les valeurs du
moteur sur S1, non rejouées par le parcours.

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

## 5. Rouge observé, isolation (17/10/2026)

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

Au vert (`e0022a1f`), seul l'en-tête du test a changé, comme prévu au §6 : types importés par `import type`
depuis le module et import statique au lieu du chargement dynamique ; aucune assertion modifiée ; 4/4 verts. Le
rouge du parcours E2E est au §9.8.

## 6. Commandes

```bash
# Windows ou WSL
npx vitest run --project=node src/lib/estimates/v3-settings-payload.test.ts
npx vitest run --project=node src/test/army-impact-map.test.ts src/test/ci-guardrails.test.ts
npm run check:architecture
# WSL, clone Linux ~/miaouffrage-lot2-26 (au plus deux exécutions natives possédées en parallèle)
E2E_ARMY_WORKERS=2 NODE_OPTIONS=--max-old-space-size=4096 npm run e2e:army:local -- --grep "V3E|V3P01|V3FC"
NODE_OPTIONS=--max-old-space-size=4096 npm run e2e:army:calc-v3            # parcours de référence 2.0, hors CI
npm run engine:document-fingerprints -- check                            # empreintes identiques
npm run db:ci:local                                                      # si le SQL change
npm run verify:pr
```

Critère du vert (tenu, §10.3) : le même test, types recopiés remplacés par `import type` depuis le module et
chargement dynamique par un import statique, sans modifier une assertion ; parcours `engine-v3-editor` vert et
inscrit à `scripts/tester-army/army-impact-map.json` ; `V3P-06` et le volet éditeur/fiche de `V3FC` réécrits
(§1.4, §8.3) ; `npm run verify:pr` ; corpus figé et empreintes identiques.

## 7. Limites et points ouverts du rouge

- Les sélecteurs et libellés du parcours font foi (§9.4) ; les messages du §1.2 étaient une proposition, retenue
  au vert.
- CAP (V3E-04) supposait une assiette de 400 € dans le brouillon unique du parcours : le parcours la construit
  sur son propre brouillon (V3E02, §9.3.2).
- La règle « vider le champ de l'intention active la supprime » était un **choix** (la conception ne dit pas ce
  que vaut une remise vidée en v3 ; la v2 la met à 0 €) : **décision** du porteur au vert (§8).

## 8. Implémentation : réglages, grille, état d'éditeur, synchronisation et pages (vert)

Deux pistes : « réglages » (§1.2, §1.3 ; commit `e0022a1f`) et « grille » (`d97107a7` à `6521ab4a`). Décisions
prises par délégation du porteur, le 17/10/2026 :

| Décision | Contrat retenu |
|---|---|
| F26-17, présélection fournisseurs sur une v3 | **Recalcul persisté** par l'écrivain de lot de 2.5 (`POST …/batch`, `op: "update"`) : seuls `unit_price_ht_cents` et `selected_supplier_price_id` partent ; le serveur recalcule PU, nets, TVA et totaux et les vérifie (D12) dans la même transaction. Le refus nommé du §2 n'est pas retenu. La comparaison lit l'unité d'une ligne v3 dans `unit_code`, jamais dans `description` |
| Remise vidée | Vider le champ de l'intention active la met à `none` (choix du §7, tenu par le module pur) |
| Émission | Fermée jusqu'en 2.7 : « Envoyer » masqué sur une v3, exports désactivés ; PDF et envoi restent refusés par le serveur (`ESTIMATE_ENGINE_UNAVAILABLE`, V3FC02) |
| Modèles, ouvrages, métré | Refusés sur une v3 jusqu'en 2.8, par les refus nommés existants du serveur (aucune conversion côté éditeur) |
| Messages de refus des réglages | Ceux proposés au §1.2, suivis de « Valeur conservée : {valeur}. » |
| TVA par défaut d'une v3 | Tout taux de 0 à 100 %, 2 décimales au plus ; la liste des taux de l'entreprise n'est pas imposée à la saisie, le gel la contrôle (D8) |
| **Écart à la conception (relevé par la revue, à confirmer par le porteur dans la PR)** : migration en 2.6 | La conception donne à 2.6 « Migration : aucune » (§14 « 2.6 »). 2.6 ajoute `20261017205000_estimate_engine_v3_line_repricing.sql` pour corriger un défaut de l'écrivain de 2.5 révélé par `V3E02` (§8.4 : une ligne non chiffrée ne pouvait plus redevenir « Chiffrée » par `commit_estimate_batch`). Elle doit être appliquée au Supabase partagé avant tout déploiement, sur autorisation explicite (`AGENTS.md`, `supabase/README.md` §3). Appliquée au partagé le 18/10/2026 après la fusion de la PR #44 : [rapport](./shared-supabase-2-6-2026-10-18.md). Son commentaire disait « CHECK de M4 » : corrigé (« garde de colonnes de M4 »), empreinte du manifeste mise à jour (`d0d82b4e`) |
| Choix de la revue (§11.2), dans le cadre des décisions ci-dessus | collage refusé par son nom sur une v3 ; suggestions en lot, actions en lot, suppressions et recréations par l'écrivain de lot ; l'article associé ne fixe jamais l'unité d'une ligne v3 ; fiche d'un brouillon v3 : PDF et modèle désactivés avec leur raison |

### 8.1 Aiguillage et délégation

| Fichier | Changement | Lignes non vides / budget |
|---|---|---|
| `src/lib/estimates/v3-settings-payload.ts` (nouveau, pur) | contrat du §1.2 et fonctions ajoutées (§1.2), aperçu par le moteur pur (§1.3) | 460 / 1 200 |
| `src/hooks/useEstimateV3Settings.ts` (nouveau) | hook du §1.3 ; réexporte le module pur | 392 / 1 200 |
| `src/components/estimates/v3/EstimateV3SettingsSection.tsx` (nouveau) | réglages v3 du tiroir (§9.4.4) : coefficients (refus `aria-invalid`, message et valeur conservée, sauvegarde désactivée), repère du barème (`estimate-v3-margin-tier-hint`), deux champs de remise et `estimate-v3-discount-applied`, TVA par défaut, `Arrondi` (`none`, `100`, `1000`, `5000`, `10000`), récapitulatif de l'aperçu avec la TVA par taux | 359 / 1 200 |
| `src/components/estimates/v3/TaxRatePropagationDialog.tsx` (nouveau) | `alertdialog` « Appliquer ce taux à toutes les lignes ? », « Non » / « Oui », Échap n'envoie rien | 56 / 1 200 |
| `EstimateSettingsPanel.tsx` | prop facultative `v3` : champs communs (titre, date, validité, devise, exclusions, régime de TVA) lus et écrits dans le brouillon v3, section v3 à la place de la grille marge / remise / TVA / arrondi ; sans `v3`, rendu inchangé (bloc du régime de TVA mis en constante partagée, grille v2 sous une condition sans réindentation) | 692 |
| `src/lib/estimates/editor-engine.ts` (nouveau) | aiguillage exhaustif du moteur de l'éditeur : `resolveEditorEngineContext`, `reconcilesEditorTotals` (remplace l'expression de `forceV2Totals` qui levait sur une v3), `toEngineItemWrite`, `normalizeEditorDraftItems`, `resolveEditorInitialDiscountCents` ; une v1/v2 garde les mêmes appels historiques, une v3 n'est jamais normalisée ni calculée par le moteur 1/2 | 109 / 1 200 |
| `src/lib/estimates/v3-editor.ts` (nouveau, pur) | lignes affichées depuis l'aperçu du moteur pur (PU, nets, TVA, parts FO/MO, heures dérivées), charge de ligne v3 (saisies seulement : `unit_code`, `pricing_status`, `h_mo*_per_unit`, jamais `h_mo` ni projection), référence de synchronisation, unité du référentiel (`ml — mètre linéaire`, alias validé, inconnue refusée par son nom), taux de TVA proposés, pied v3, pied stocké d'un brouillon | 238 / 1 200 |
| `src/components/estimates/v3/V3LineCells.tsx` (nouveau) | contexte de grille v3, cellule « Unité pour {t} », « Heures de main-d’œuvre par unité » (`h_mo_per_unit`, 4 décimales) et `output` en lecture seule « Heures de main-d’œuvre totales », sélecteurs « Statut de chiffrage » et « Taux de TVA » | 242 / 1 200 |
| `src/components/estimates/v3/EstimateV3DraftSummary.tsx` (nouveau) | lecture d'un brouillon v3 sur la fiche et l'impression : montants stockés, TVA par taux, lignes | 97 / 1 200 |
| `useEstimateEditorState.impl.tsx` | moteur résolu une fois ; `useEstimateV3Settings` branché (aperçu, charge de sauvegarde, tiroir) ; chargement, relectures et normalisation par `editor-engine` ; charge v3 de `saveEstimateVersion` = `buildSavePayload()` (jamais de `discount_bp` dérivé ni de total client) ; lignes relues après « Oui » = nouvelle référence ; v3 : pas de multiplicateur de marge (`effective_margin_multiplier` jamais lu), envoi masqué, exports désactivés | 2 894 → 2 908 (pistes) → 2 926 après la fusion d'`origin/main` (§10.1) / 3 100 |
| `useEstimateEditorSyncController.ts` | `:729` remplacé par `reconcilesEditorTotals` ; la charge de lot passe par `toEngineItemWrite` ; la référence de synchronisation porte les saisies v3 | 1 199 → 1 199 / 1 200 |
| `useEstimateEditorCalculation.ts` | v3 : aucun calcul historique, lignes affichées depuis l'aperçu ; après la fusion, `computePersistedTotals` (PR #36) rend `null` sur une v3 | — |
| `EstimateEditorTable.tsx` | pistes : inchangé, la grille reçoit le contexte v3 d'`EstimateEditorPage` ; intégration : l'unité de la comparaison fournisseurs vient du hook (`activeSupplierComparisonUnit`, F26-20) | 2 564 → 2 577 (2.9) → 2 578 / 2 600 |
| `hooks/useEstimateSupplierComparison.ts` | intégration (F26-20) : sur une v3, unité de la ligne = `unit_code` pour l'éligibilité, le prix converti et l'affichage ; retenir une offre n'écrit pas `description` ; v1/v2 inchangées | — |
| `LineRow.tsx`, `StandardMoCells.tsx`, `LaborSplitCells.tsx`, `EstimateEditorRow.tsx` | délégation aux cellules v3 ; PT = brut ⌈Q × PU⌋ ; PU vide pour une ligne non chiffrée ; atelier/chantier par unité en v3 ; après la fusion de 2.9, l'unité passée à la liste des suggestions est `unit_code` sur une v3 | `LineRow` 1 198 → 1 196 → 1 197 (2.9) / 1 200 |
| `useEstimateEditorItemsController.ts`, `useEstimateEditorSupplierController.ts`, `useCatalogueSuggestions.ts` | charge de ligne v3 injectée ; présélection v3 par l'écrivain de lot (sans patch de totaux client après la fusion, §10.1) ; une suggestion du catalogue ne remplace jamais l'unité d'une ligne v3 et, après la fusion de 2.9, son prix converti se lit dans `unit_code` | — |
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

Raison commune : la bannière « moteur de calcul 3 indisponible » de 2.1 protégeait l'éditeur v2 d'une v3 ; 2.6
ouvre l'éditeur v3, la bannière y devient la défaillance F26-15. Ce que ces assertions protégeaient (ouvrir ne
réécrit pas la v3, jamais de lecture v1 des montants) est conservé dans leur réécriture.

### 8.4 Défauts révélés par le vert

Deux défauts, rouges par le parcours lui-même :

- **Retour à « Chiffrée » refusé par l'écrivain de lot** (`V3E02`, T-STAT, passage 2) : une ligne « Hors lot »
  n'a pas de PU (décision 3 de 2.5) ; `commit_estimate_batch` met la ligne à jour avant de la projeter, et le
  CHECK `estimate_items_item_type_payload_check` (PU obligatoire d'une ligne chiffrée) annulait le lot (« Le lot
  a été annulé. »). Migration `20261017205000_estimate_engine_v3_line_repricing.sql` : un déclencheur `BEFORE
  UPDATE OF pricing_status` donne un PU provisoire nul à une ligne qui redevient chiffrée ; la projection du
  même lot écrit le PU du moteur et `estimate_v3_assert_draft` vérifie chaque PU (D12), un PU provisoire ne peut
  donc jamais être validé. Seule une ligne v3 peut quitter `priced` (garde de colonnes de M4, `guard_estimate_item_engine_columns` ; libellé corrigé à la revue, §11) : aucune v1/v2 n'est touchée,
  aucune comparaison de moteur à un littéral (liste blanche F-SQL-14 inchangée). M4 n'est pas réécrite. À
  appliquer au Supabase partagé avant tout déploiement (AGENTS.md).
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

État revu le 18/10/2026 (§11) : les points barrés par la revue sont corrigés et ne restent ici que pour la trace ;
les limites qui demeurent sont au §11.6.

- La donnée de `V3E03` porte la même unité dans `description` et `unit_code` : la lecture de `unit_code` par la
  comparaison fournisseurs n'y est pas discriminée.
- Taux proposés par la cellule « TVA % » : la liste par défaut de la politique (20 / 10 / 5,5 / 2,1 %) et le taux
  de la ligne ; une liste propre à l'entreprise n'est pas encore lue par l'éditeur (contrôlée au gel).
- ~~Changer le taux horaire d'un rôle n'écrit rien sur une v3~~ : corrigé (F26-23, §11).
- L'éditeur mobile d'une ligne et la restauration d'un brouillon en conflit restent v2. **Correction de la revue** :
  sur une v3, une heure totale saisie dans l'éditeur mobile n'est pas refusée par le serveur, elle est **ignorée sans
  message** côté client (la charge v3 retire `h_mo`, la file trouve alors une charge égale à la référence et
  n'envoie rien, le champ revient à la valeur de l'aperçu) ; l'unité saisie dans l'éditeur mobile s'écrit dans
  `description`, sans effet sur `unit_code`. Limite maintenue (§11.6).
- ~~Actions en lot (catégorie, rôle, majoration) : leur charge est réduite aux saisies par `toEngineItemWrite`~~ :
  inexact (relevé par la revue) — `toEngineItemWrite` ne servait qu'à la sauvegarde de la grille, et les actions
  en lot partaient par `POST /items/bulk`, refusé sur une v3. Corrigé (F26-22, §11).
- ~~« Associer ou remplacer l'article » lit l'unité dans `description`~~ : corrigé (F26-26, §11) ; l'article ne fixe
  jamais l'unité d'une ligne v3.
- Tiroir d'une v3 : le gestionnaire des tranches de marge n'y est plus rendu ; le barème de l'entreprise se
  gère depuis le tiroir d'une v1/v2 (ou `/api/margin-tiers`) jusqu'à un gestionnaire rédigé pour le moteur 3.
- F26-07, « rien n'est envoyé avant la réponse » : tenu par `requestSave` (§1.3) et vérifié seulement par un
  contrôle jsdom jetable de la piste réglages, hors dépôt ; le parcours asserte l'issue de « Non » et de « Oui »
  (version et sept lignes relues), pas l'absence de requête pendant que le dialogue est ouvert.
- ~~Un arrondi v3 stocké hors de la liste s'affiche avec une note, sans option correspondante~~ : corrigé (F26-29,
  §11) — le pas stocké est une option « (réglage actuel) ».
- ~~Supprimer une ligne ou une section d'une v3 depuis la grille passe encore par la suppression directe~~ (corrigé,
  F26-21, §11) : passait par la suppression directe
  (`deleteEstimateItem`, `useEstimateEditorItemsController.ts`), que 2.5 refuse sur une v3 avec le message
  générique du moteur 3 (`ESTIMATE_ENGINE_UNAVAILABLE`, V3P-15 et V3P-18) : rien n'est écrit, l'erreur s'affiche
  et la ligne revenait à la relecture. Elle passe désormais par le lot (`op: "delete"`, qui recalcule), prouvée par
  `V3E05` (§11).
- **Instabilité observée, non reproduite** : à `86ef5886`, deux passages de `V3E01` sur trois
  (`2026-10-17T21-01-04-472Z`, `2026-10-17T21-09-01-580Z`) ont perdu le rôle « Tuyauteur » saisi dans la liste
  « Rôle de main-d'œuvre pour {t} » (ligne O2 puis O1) : après le remplissage, le champ est focalisé, la liste
  ouverte et le texte vide, donc le Tab ne valide rien et la sauvegarde attendue n'arrive pas. Une sonde des
  événements (focus, saisie, touches, piles d'appel) n'a ensuite montré que la séquence nominale, et les six
  passages suivants (sondés ou non, dont le vert du §8.6) n'ont plus perdu de saisie dans la grille ; `ed93d1fd` ne touche
  pas ce chemin (tiroir fermé pendant la saisie). Cause non établie ; aucune reprise ni attente ajoutée pour
  faire passer le parcours (AGENTS.md).

### 8.6 Preuves des pistes (17 et 18/10/2026)

Même environnement que le §9.8 (WSL Ubuntu 24.04, Node 24.14.0, `e2e` 0.21.0, clone `~/miaouffrage-lot2-26` remis à
la branche par `git reset --hard`, diff local vide : `diffSha256` `e3b0c442…b855`, verrou natif attendu avant chaque
lancement). Aucune assertion des trois parcours n'est modifiée ; les préalables corrigés et leurs raisons sont au
§8.4.

```bash
E2E_ARMY_WORKERS=2 NODE_OPTIONS=--max-old-space-size=4096 npm run e2e:army:local -- --grep "V3E0|V3P01|V3FC0"
```

Sortie 0 à `0deea428`. En amont : 249 migrations (dont `20261017205000_estimate_engine_v3_line_repricing.sql`),
« Local migration inventory matches the repository. », pgTAP `Files=19, Tests=1833, Result: PASS`, « Behavioral RLS
matrix passed. », build passé. Rapport : `discovered 85, selected 7, executed 7, passed 7, failed 0, flaky 0`,
chaque parcours en une tentative :

```text
✓ V3E01 66.5s   ✓ V3E02 135.7s   ✓ V3E03 13.2s   ✓ V3P01 10.7s   ✓ V3FC01 1.7s   ✓ V3FC02 0.9s
```

Archive : `.e2e/army/ci/2026-10-17T22-02-38-629Z-critical/` du clone WSL (manifeste : `passed`, `filtered-critical`,
`grep: V3E0|V3P01|V3FC0`, 2 workers, révision `0deea428`, confidentialité `passed` ; SHA-256 du manifeste
`13d575d1dd4d6e0fac0ebacd3678b6c468e2372f9883ef3237d807b9f989ea5b`). Preuves sous
`critical/runs/2026-10-17T22-03-45-000Z/artifacts/business/` :

| Preuve | SHA-256 |
|---|---|
| `v3e-v3e01-editor-open` | `bd706ee8d7359bafbb69fa857932b0e2b8e306a2a975a13f8d1b2b7262bcb98e` |
| `v3e-v3e02-editor-open` | `6fb59e5a002a44b70e010aa43487a6fea73aeed9620267d75ceb19be53fe77ef` |
| `v3e-v3e03-editor-open` | `97a3dd91a1f27741d4916974d358b8c040ccef9299f5ca31491e84a6667f45a8` |
| `v3e-preselection-precondition` | `e006a1bd6c1e8feb6ae6e052a759a6c53ede4749c38a89911fa2e23722496804` |
| `v3e-preselection` | `d0d18d6d1f9cb2b0b7ea4e85627d08c4098c09aa75946900e99767b0c9a950c6` |
| `v3e-preselection-recomputed` | `ce1650b39bcd8e01565689b8cb055302841e3bf703221947a05f2314f1039c2c` |
| `v3p-editor-open` | `2f3e6f7cf38638c0a52b9a87522818e9ae2fe9378a4a49d36086a2768990959a` |
| `engine-v3-read` (V3FC01) | `5ad119eda9d2519d4a69ebf6f381b047cd042c47248357356dde4988162fb8d5` |

**Issue de la présélection (V3E-11)** : `{"refused": false, "recomputed": true, "genericBanner": false}` — recalcul
persisté (F26-17) : l'offre B (PR 12,40 €) retenue, PU 16,12 €, net 32,24 €, totaux relus 3 224 / 645 / 3 869 c
(§9.3.3), aucune écriture partielle.

Passages intermédiaires, chacun à diff local vide sauf mention : `V3E0` vert à `ed93d1fd`
(`2026-10-17T21-39-22-907Z`, manifeste `a45071334fb39e496c209f1e52d039a6563ce75be4f1df3577e85a9583096125`, 4/4) ;
`V3P01|V3FC0` vert à `73e2cbc9` (`2026-10-17T21-50-26-939Z`, manifeste
`ca5bbb54dc1a61b6962d4ea9a7a4a9025881e79a9bb94b4196e34c5f493777bb`, 4/4).

Autres preuves des pistes :

- Piste réglages, Windows, à `e0022a1f` : `v3-settings-payload.test.ts` 4/4 (avant et après le passage à
  l'import statique) ; `EstimateSettingsPanel.test.tsx` et `EstimateEditorDrawer.test.tsx` 12/12 (v1/v2
  inchangées) ; `npx eslint --max-warnings=0` sur ses six fichiers, `npm run typecheck`, `npm run
  check:architecture` sortie 0.
- `npm run verify:pr` dans le clone WSL à `0deea428`, sortie 0 : audit des dépendances et des signatures (762
  paquets vérifiés), budgets d'architecture (1 131 modules, 0 cycle), OpenAPI, `typecheck`, `lint`
  (`--max-warnings=0`), Vitest node 296 fichiers / 2 782 tests passés (1 fichier, 2 tests ignorés), jsdom 162 / 821
  passés (dont `v3-settings-payload.test.ts`, `useEstimateEditorSyncController.test.ts`,
  `EstimateEditorTable.integration.test.tsx`, `EstimateEditorDrawer.test.tsx`,
  `EstimateSettingsSummaryBar.test.tsx`), couverture critique 3 / 12.
- Windows, à `0deea428` : `npm run typecheck` et `npm run check:architecture` sortie 0 ; `npx eslint
  --max-warnings=0` sur chaque fichier touché par un commit de correction, sortie 0.
- `git diff --stat f1d94213 HEAD -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts` : vide.

## 9. Parcours E2E `engine-v3-editor` (ex-`estimate-engine-v3-2.6-e2e.md`)

Écrit rouge le 17/10/2026, sans code de production. Ce chapitre fixe les scénarios, les défaillances observables
qu'ils exposent et le **contrat d'écran et d'API** que l'implémentation de 2.6 tient pour que le parcours passe au
vert sans modifier une assertion. Préalables repris de `V3P01` (`engine-v3-persistence.e2e.ts`, doc 2.5 §9) :
propriétaire dédié par parcours, politique 3 (1,30 / 1,20) posée par le transport SQL possédé le temps de la
création puis remise à 2, rôle « Tuyauteur » 40 €/h par l'API.

### 9.1 Fichiers et commande

| Fichier | Rôle |
|---|---|
| `e2e/army/local/engine-v3-editor.e2e.ts` | Parcours `V3E01`, `V3E02`, `V3E03`, `V3E04` (ajouté à l'intégration, §10.4) (sélection critique locale : motif `engine-v3-*.e2e.ts` d'`e2e.config.ts`) |
| `e2e/army/local/engine-v3-editor-support.ts` | Préalables (propriétaire, v3, section, lignes par lot), mode Expert, préréglage « Standard », lectures d'écran et d'API, relevé `checkpoint` |
| `e2e/army/local/engine-v3-editor-actions.e2e.ts` | Ajouté à la revue (§11) : `V3E05` à `V3E13`, actions de la grille et du tiroir hors saisie d'une cellule (suppressions, lots, taux horaire, sous-détail, article, question de TVA, remise nulle, arrondi stocké, fiche, suggestions en lot, collage) |
| `scripts/tester-army/army-impact-map.json` | Parcours ajouté à `suite.journeys`, aux groupes `editor`, `affaires-list`, `print` et à la règle `estimate-detail` |

```bash
# WSL, clone Linux ~/miaouffrage-lot2-26 (au plus deux exécutions natives possédées en parallèle)
E2E_ARMY_WORKERS=2 NODE_OPTIONS=--max-old-space-size=4096 npm run e2e:army:local -- --grep "V3E0"
# Windows ou WSL
npx vitest run --project=node src/test/army-impact-map.test.ts
```

### 9.2 Scénarios et défaillances observables

`V3E-nn` = scénario n du §14 « 2.6 » de la conception (11 : présélection, demandée en plus). Les `F26-xx` sont
ceux du §2.

| Id | Scénario (§14) | Défaillance observable | F26 | Parcours |
|---|---|---|---|---|
| V3E-01 | 7 lignes **par la grille** (désignation, U, Q, PR FO, h/u) ; PU O1 166,63 € ; 1,3 / 1,3 → 174,59 € | l'éditeur ne s'ouvre pas sur une v3 (bandeau 2.1) ; PU, PT, heures totales ou totaux ≠ §5.1 / S1 ; « h MO total » saisissable ; aide « heures totales de la ligne » en v3 ; marge v2 « 0% » au pied | 11, 14, 15, 16 | V3E01 |
| V3E-02 | coefficient FO vidé | 0 envoyé, ou ancienne valeur reprise sans message | 05 | V3E01 |
| V3E-03 | remise 1,01 € → 1,01 €, `discount_bp` 0 ; 10 % → 1 000 pb ; c_FO doublé → toujours 10 % | taux dérivé d'un montant, deux intentions, taux converti en montant en passant par le champ montant, remise appliquée qui ne suit pas le brut | 01, 02, 03 | V3E01 |
| V3E-04 | 500 € demandés sur une assiette de 400 € | montant demandé remplacé par l'appliqué ; « demandé / appliqué » absent | 04 | V3E02 |
| V3E-05 | TVA 20 → 10 % : dialogue ; « Non » garde 20 % ; « Oui » → 7 lignes à 10 % ; S5 : deux taux au pied | pas de dialogue ; « Non » touche les lignes ; « Oui » en oublie ; réglages et lignes en deux sauvegardes ; TVA ligne à ligne (1 325 527 c) ; un seul taux au pied | 07, 08 | V3E01 |
| V3E-06 | ligne de 500 € « Hors lot » → HT −500,00 € ; retour à « Chiffrée » → restaurée | ligne non chiffrée comptée ; saisies perdues au retour | 09 | V3E02 |
| V3E-07 | « ML » → « ml — mètre linéaire » ; une suggestion catalogue ne change pas l'unité | « ML » texte libre ou millilitre ; unité remplacée par la désignation ou par l'unité de l'article | 10 | V3E01, V3E03 |
| V3E-08 | Q d'une ligne avec heures doublée → MO et PT doublés | `h_mo` non dérivé, PT non proportionnel | 11 | V3E01 |
| V3E-09 | pas de « Barème par défaut » en v3 ; repère du barème d'entreprise non appliqué | barème codé en dur (×1,60) ou « barème par défaut est appliqué » affiché ; barème appliqué aux montants | 12 | V3E01 |
| V3E-10 | arrondi au pas de 100 € inférieur → S4 | arrondi traité hors remise HT, ajustement ≠ 0, modes `up`/`nearest` proposés | 13 | V3E01 |
| V3E-11 | présélection fournisseurs appliquée sur une v3 | lignes écrites sans recalcul (totaux périmés, « Totaux à synchroniser » : défaut v2 connu de 2.2), écriture partielle, bandeau générique du moteur 3 | 17 | V3E03 |
| V3E-12 | hors §14, ajouté à l'intégration : comparaison fournisseurs d'une ligne v3 en ml (`description` vide), offres en ml et à la barre | offre à la barre acceptée ; unité de l'offre écrite dans `description` ; PR ou totaux faux | 20 | V3E04 |

En plus (périmètre du §14 « 2.6 ») : fiche et impression du brouillon v3 sans bandeau (F26-15), dans V3E01.

### 9.3 Déroulé et valeurs attendues

Chaque relevé (`checkpoint`) se fait **après l'état sauvegardé** (Ctrl+S par `saveLineEditsWithShortcut` puis
`waitForAutoSave` pour la grille ; « Enregistrer le paramétrage » puis relecture API pour les réglages) et lit
trois fois : la valeur persistée (API), la valeur affichée par l'éditeur qui l'a sauvegardée, puis la valeur
affichée **et** relue par l'API après rechargement. Tolérance : 0 c. Preuves `recordEvidence` `v3e-*`.

#### 9.3.1 `V3E01` (un brouillon v3, l'ancre v2 n'est jamais éditée)

1. Mode Expert ; éditeur ouvert sur la v3 (**premier rouge** avant 2.6) ; préréglage de colonnes « Standard ».
2. Les 7 lignes par la grille, une sauvegarde par ligne (O4 saisi « ML ») :

   | Ligne | U saisie → affichée | Q | PR FO | h/u | h MO total | PU | PT |
   |---|---|---|---|---|---|---|---|
   | O1 | ml → ml — mètre linéaire | 20 | 54,66 | 1,991 | 39,82 | 166,63 | 3 332,60 € |
   | O2 | u → u — unité | 3 | 95,63 | 1,75 | 5,25 | 208,32 | 624,96 € |
   | O3 | m2 → m2 — mètre carré | 21 | 58,50 | 0 | 0 | 76,05 | 1 597,05 € |
   | O4 | ML → ml — mètre linéaire | 1139 | 3,02 | 0,2 | 227,8 | 13,53 | 15 410,67 € |
   | O5 | u → u — unité | 1 | 20,00 | 6 | 6 | 314,00 | 314,00 € |
   | O6 | ml → ml — mètre linéaire | 282 | 91,86 | 0,998 | 281,436 | 167,32 | 47 184,24 € |
   | O7 | ml → ml — mètre linéaire | 8 | 8,83 | 1,30 | 10,4 | 73,88 | 591,04 € |

   S1 : HT 69 054,56 €, TVA 13 810,91 €, TTC 82 865,47 € ; API : `unit_code`, `pricing_status` `priced`,
   `h_mo_per_unit`, `h_mo` = Q × h/u, `pu_ht_cents`, net = PT, `tax_rate_bp` 2 000, rôle « Tuyauteur ».
3. Aide des colonnes : contient « h MO / u », pas « heures totales de la ligne ».
4. O5 à Q 2 : h MO total 12, PT 628,00 €, HT 69 368,56 € / TVA 13 873,71 € / TTC 83 242,27 € ; retour à Q 1 → S1.
5. Réglages sans barème d'entreprise : FO « 1,30 », MO « 1,20 », remises vides, TVA par défaut « 20 » ; aucun
   « barème par défaut » ni « ×1,60 ». FO vidé → refus explicite, 1,30 relu (API et champ).
6. MO 1,30 → PU O1 174,59 €, PT O1 3 491,80 €, HT 71 336,74 € / TVA 14 267,35 € / TTC 85 604,09 € ; MO 1,20 → S1.
7. Barème d'entreprise créé par l'API (0 € → ×1,15 ; 50 000 € → ×1,10) : repère « ×1,10 … non appliqué » pour un
   déboursé de 54 871,77 € ; montants S1 inchangés.
8. S2 (remise 1,01 €) : HT 69 053,55 €, TVA 13 810,71 €, TTC 82 864,26 €, remise −1,01 € ; API montant 101,
   `discount_bp` 0, appliqué 101, nets [333 255, 62 495, 159 703, 1 541 044, 31 400, 4 718 355, 59 103] ;
   « demandé 1,01 € / appliqué 1,01 € ».
9. S4 (arrondi 100 € inférieur) : options d'arrondi exactement `none`, `100`, `1000`, `5000`, `10000` ; HT
   69 000,00 €, TVA 13 800,00 €, TTC 82 800,00 €, arrondi commercial −53,55 €, `rounding_adjustment_cents` 0 ;
   retour à « Aucun » → S2.
10. S3 (10 %) : HT 62 149,10 €, TVA 12 429,82 €, TTC 74 578,92 €, remise −6 905,46 € ; API `discount_bp` 1 000,
    montant nul ; champ montant vide, champ taux « 10 ». c_FO 2,60, curseur passé par le champ montant : brut
    110 704,73 €, remise −11 070,47 €, HT 99 634,26 €, TVA 19 926,85 €, TTC 119 561,11 €, PU O1 237,68 €,
    toujours 1 000 pb. Retour à c_FO 1,30 et 1,01 € → S2.
11. TVA par défaut 20 → 10, « Non » : version 1 000 pb, 7 lignes à 2 000 pb, pied « TVA 20 % » seul (S2) ;
    10 → 20 : aucun dialogue (toutes les lignes ont déjà 20 %) ; 20 → 10, « Oui » : 7 lignes à 1 000 pb, TVA
    6 905,36 €, TTC 75 958,91 €.
12. S5 : O4–O7 remis à 20 % par la cellule « TVA % » : TVA 10 % 555,45 €, TVA 20 % 12 699,80 €, TVA 13 255,25 €,
    TTC 82 308,80 €, HT 69 053,55 € ; API bases 555 453 c (10 %) et 6 349 902 c (20 %).
13. Fiche `/dashboard/estimates/{id}` : sans bandeau, Total HT 69 053,55 €, Total TTC 82 308,80 € ; impression :
    sans bandeau, titre « Devis » (le pied v3 imprimé relève de 2.7).

#### 9.3.2 `V3E02` (un brouillon v3, lignes posées par un lot)

Ligne A : 4 u, PR 76,92 €, h/u 0 → PU 100,00 €, PT 400,00 € ; ligne B : 1 u, PR 200,00 €, 5 h/u → PU 500,00 €.
Initial : HT 900,00 € / TVA 180,00 € / TTC 1 080,00 €. B « Hors lot » : HT 400,00 € (−500,00 €), TVA 80,00 €,
TTC 480,00 €, B net 0 et TVA 0, Q, PR et h/u conservés. B « Chiffrée » : 900,00 €, PT de B 500,00 €. B « Hors
lot » puis remise 500 € : brut 400,00 €, appliqué 400,00 €, HT, TVA et TTC à 0,00 €, montant demandé 50 000 c,
`discount_bp` 0, « demandé 500,00 € / appliqué 400,00 € ».

#### 9.3.3 `V3E03` (un brouillon v3, une ligne posée par un lot)

Ligne L : 2 ml, PR 15,00 € → PU 19,50 €, PT 39,00 €. Article « … cuivre 22 » en « ML », offre A 15,00 € (API du
catalogue). Désignation saisie dans la ligne, suggestion appliquée par Entrée : article et offre A liés, unité `ml`
inchangée (« ml — mètre linéaire »), 39,00 € / 7,80 € / 46,80 €. Offre B 12,40 € ajoutée, présélection ouverte
(mode Expert), puis **exactement une** des deux issues (§9.4.6) :

| Issue | API | Écran après rechargement |
|---|---|---|
| recalcul persisté | PR 1 240, offre B, PU 1 612, net 3 224 ; 3 224 / 645 / 3 869 | PU 16,12, PT 32,24 €, HT 32,24 €, TTC 38,69 € |
| refus nommé | inchangée (`content_revision`, offre A, 3 900 / 780 / 4 680) | message du §9.4.6 dans le dialogue, « Appliquer la sélection » désactivé ; puis 39,00 € |

Dans les deux cas, jamais « Totaux à synchroniser ». La conception impliquait le **refus** (D16, P-14 : « mise à
jour groupée directe » refusée en v3 pendant le lot 2 avec un message nommé ; la présélection passe aujourd'hui par
`POST /api/estimates/{id}/items/bulk`). Ce document retient le **recalcul** (F26-17, décision du §8), le refus nommé
en repli : le parcours admet l'un ou l'autre et consigne lequel (`v3e-preselection`).

#### 9.3.4 `V3E04` (un brouillon v3, une ligne posée par un lot ; ajouté à l'intégration, §10.4)

Ligne « … cuivre 18 » comme la grille la fait : `unit_code` ml, `description` vide, 2 ml, PR 15,00 € → PU 19,50 €,
net 39,00 €. Article en « ML », offre en « ml » à 12,40 € et offre « barre » à 50,00 € (deux fournisseurs, aucune
conversion), par les API du catalogue. Mode Expert ; « Plus d'actions pour {titre} » → « Comparer les
fournisseurs » → dialogue « Comparer fournisseurs ». Attendu : la carte « barre » porte « Unité différente du
devis » et son bouton est désactivé, la carte « ml » non ; « Retenir cette offre » sur la carte « ml » puis Ctrl+S :
API `unit_code` ml, `description` nulle, PR 1 240, offre « ml », PU 1 612, net 3 224, totaux 3 224 / 645 / 3 869 c ;
écran « Total HT : 32,24 € », « TVA 20 % : 6,45 € », « TTC à payer : 38,69 € », PU 16,12, PT 32,24 €, avant et
après rechargement (`checkpoint`). Preuve `v3e04-supplier-comparison`.

### 9.4 Contrat d'écran

Libellés exacts après normalisation des espaces (espaces insécables et fines → espace) ; signe moins `−` ou `-`
indifférent ; apostrophe `’` ou `'` indifférente pour le message du §9.4.6 seulement. Montants au format
`formatCurrency` fr-FR (« 69 054,56 € »).

#### 9.4.1 Éditeur ouvert sur une v3

Route `/dashboard/estimates/{id}/edit` : pas de `data-testid="estimate-engine-unavailable"` ni du texte
`ESTIMATE_ENGINE_UNAVAILABLE_MESSAGE` ; titre « Éditer le chiffrage » (`h1`/`h2`) ; `role="grid"`
`aria-label="Lignes de devis"` ; `role="region"` `aria-label="Résumé du paramétrage"`. Restent tels quels (mode
Expert) : onglet « Affichage & contrôle » (`/^Affichage & contrôle(?: \d+)?$/`), `estimate-editor-display-button`,
bouton « Standard », `estimate-columns-help-button`, `estimate-columns-help-panel`, « Fermer l’aide des colonnes »,
`estimate-page-toolbar-autosave-status` (« En attente », « Synchronisation… », « Sauvegardé », « À jour »), Ctrl+S.

#### 9.4.2 Grille v3 (préréglage « Standard », mode Expert)

Ajout de ligne : bouton « Ajouter dans {titre de section} » puis `estimate-section-add-line-button`
(`POST /api/estimates/{id}/items` → 201 `{item}`). Ligne : `data-estimate-item-id="{id}"`, champ titre
`data-testid="estimate-line-title-input"` (combobox des suggestions du catalogue). Contrôles par leur
`aria-label`, `{t}` = titre de la ligne :

| Contrôle | `aria-label` | Saisie | Affichage |
|---|---|---|---|
| Unité (référentiel) | `Unité pour {t}` | texte ; un alias unique validé par Tab (« ML », « m2 ») | après validation, valeur du champ `{code} — {libellé en minuscule}` : « ml — mètre linéaire », « u — unité », « m2 — mètre carré » ; `unit_code` = code |
| Quantité | `Quantité pour {t}` | inchangé | inchangé |
| PR FO | `Prix d’achat unitaire HT pour {t}` | inchangé (Ctrl+S depuis ce champ) | inchangé |
| h MO / u | `Heures de main-d’œuvre par unité pour {t}` | 4 décimales au plus, virgule | — ; écrit `h_mo_per_unit`, jamais `h_mo` |
| h MO total | `Heures de main-d’œuvre totales pour {t}` | **lecture seule** (pas d'`input` modifiable) | Q × h/u, fr-FR, 0 à 3 décimales (« 39,82 », « 281,436 », « 0 ») |
| Rôle MO | `Rôle de main-d'œuvre pour {t}` | combobox existante (nom unique + Tab) | inchangé |
| Statut | `Statut de chiffrage pour {t}` | `<select>`, valeurs = `estimate_line_pricing_status` | libellés : `priced` « Chiffrée », `out_of_scope` « Hors lot » (exigés) ; proposés : `included` « Inclus », `for_memory` « Pour mémoire », `not_priced` « Non chiffrée », `not_applicable` « Sans objet » |
| TVA % | `Taux de TVA pour {t}` | `<select>`, valeurs en pb (`2000`, `1000`, `550`, `210` : taux de la politique) | `select.value` = pb de la ligne |
| PU | `Prix de vente unitaire HT pour {t}` | lecture seule | PU v3 publié, 2 décimales (« 166,63 ») |
| PT | cellule `[data-estimate-column="total_price"]` de la ligne | — | brut ⌈Q × PU⌋ (« 3 332,60 € ») pour une ligne chiffrée ; libre pour une ligne non chiffrée |

L'éditeur v2 garde ses contrôles (`Heures de main-d’œuvre pour {t}` saisissable) ; ils n'apparaissent pas en v3.

#### 9.4.3 Pied « Résumé du paramétrage » (mode Expert)

Boutons de la région, lus par `aria-label` (sinon texte). Chaque relevé exige la présence exacte de :

- `Total HT : {HT net}` ; `TVA : {TVA totale}` ; une entrée `TVA {taux} % : {T_r}` par taux présent (« TVA 20 % »,
  « TVA 10 % », taux fr-FR « 5,5 ») ; `TTC à payer : {HT + TVA}` ;
- `Remise commerciale : −{appliquée}` dès qu'une remise est appliquée ;
- `Arrondi commercial : −{A}` dès qu'un arrondi commercial est appliqué.

Interdits : `Marge : 0%` (marge v2 d'un multiplicateur ×1) ; toute entrée `TVA {r} %` d'un taux absent des lignes
chiffrées (après « Non » : pas de « TVA 10 % » ; après « Oui » : pas de « TVA 20 % »). L'ordre est libre ; une
autre entrée (coefficient réalisé, brut) est admise.

#### 9.4.4 Réglages v3 (tiroir `role="dialog"` « Paramétrage du devis »)

Ouverture : `/dashboard/estimates/{id}/edit?openSettings=general` ; enregistrement : bouton « Enregistrer le
paramétrage » (inchangé). Champs par libellé exact (`getByLabel`) :

| Libellé | Contrat |
|---|---|
| `Coefficient de vente FO`, `Coefficient de vente MO` | valeur fr-FR, 2 décimales au moins (« 1,30 ») ; vidé puis Tab → `aria-invalid="true"` et un texte visible commençant par « Coefficient de vente FO obligatoire » (message du §1.2) ; aucune écriture (bouton désactivé, ou sauvegarde refusée) ; rechargement → « 1,30 » |
| `Remise (EUR HT)` | intention en montant ; vide si l'intention est un taux ; le quitter sans saisie ne change rien |
| `Remise (%)` | intention en taux (« 10 ») ; vide si l'intention est un montant |
| `TVA par défaut des nouvelles lignes` | taux de version fr-FR (« 20 ») |
| `Arrondi` | `<select>`, options exactement `none`, `100`, `1000`, `5000`, `10000` (aucun « Réglage conservé », ni `up`/`nearest`) |

Les deux champs de remise sont visibles ensemble, sans sélecteur de mode (§1.2) : une saisie valide dans l'un
remplace l'intention de l'autre.

- `data-testid="estimate-v3-discount-applied"` : texte contenant `demandé {M} / appliqué {R}` pour un montant
  (« demandé 1,01 € / appliqué 1,01 € », « demandé 500,00 € / appliqué 400,00 € ») et `appliqué {R}` pour un taux.
- `data-testid="estimate-v3-margin-tier-hint"` : avec un barème d'entreprise, texte contenant `×{k}` (fr-FR, deux
  décimales : « ×1,10 ») du palier atteint par le déboursé, et « non appliqué ». Sans barème d'entreprise, ni
  « barème par défaut » (casse indifférente) ni « ×1,60 » dans tout le tiroir.
- Dialogue de propagation : `role="alertdialog"`, nom `Appliquer ce taux à toutes les lignes ?`, boutons « Oui » et
  « Non ». **Choix** : il s'ouvre au clic sur « Enregistrer le paramétrage » quand le taux par défaut a changé
  **et** qu'au moins une ligne porte un autre taux (§1.3) ; rien n'est envoyé avant la réponse ; « Oui » envoie
  `apply_tax_rate_to_lines: true` dans la même sauvegarde, « Non » n'envoie que le taux de version.

#### 9.4.5 Fiche et impression d'un brouillon v3

`/dashboard/estimates/{id}` : sans bandeau, `dt` « Total HT » et « Total TTC » suivis des montants stockés.
`/dashboard/estimates/{id}/print?price_mode=unit_and_total&detail_level=lines` : sans bandeau, titre « Devis ».

#### 9.4.6 Présélection fournisseurs sur une v3

Entrée inchangée : onglet « Affichage & contrôle », `estimate-editor-display-button`,
`estimate-editor-supplier-preselection-button` (activé), dialogue `role="dialog"` « Présélection fournisseurs »,
case `Sélectionner {titre de ligne}`, bouton « Appliquer la sélection ».

- **Recalcul persisté** (F26-17, décision du §8) : seuls `unit_price_ht_cents` et `selected_supplier_price_id`
  partent par l'écrivain v3 ; totaux et lignes relus égalent le §9.3.3.
- **Refus nommé** (repli, non retenu) : avant toute écriture, le dialogue affiche exactement
  « La présélection fournisseurs n’est pas disponible pour un devis au moteur de calcul 3. » (**Choix** du texte ;
  code `ESTIMATE_V3_SUPPLIER_PRESELECTION_UNSUPPORTED` si une route répond) et « Appliquer la sélection » est
  désactivé ; `content_revision` inchangée.
- Échecs : lignes écrites avec totaux périmés, écriture partielle, bandeau générique
  `ESTIMATE_ENGINE_UNAVAILABLE_MESSAGE`, ni l'un ni l'autre en 60 s.

### 9.5 Contrat d'API

| Route | Usage par le parcours | Attendu |
|---|---|---|
| `POST /api/estimates` | ancre v2 puis v3 avec `version.expected_calc_engine_version: 3` (politique 3) | 201 ; v3 à 1,30 / 1,20 (contrat 2.5) |
| `POST /api/estimates/{id}/lock`, `POST …/items` (section), `POST …/batch` (lignes de V3E02, V3E03) | préalables | contrat 2.5 (§9.3.2 du doc 2.5) |
| `POST /api/estimates/{ancre}/labor-roles` | « Tuyauteur » 4 000 c/h | 201 |
| `POST /api/margin-tiers` | `{threshold_cents, multiplier, position}` (deux paliers) | 201 |
| `POST /api/products`, `POST /api/suppliers`, `POST /api/prices` | `action: "create"` : article `unit: "ML"`, fournisseurs A et B, offres A (15,00 €, « ML ») et B (12,40 €, « ml ») avec SKU, quantité minimale 1, EUR, validité du jour (chemin de `bulk-edit-sync-sources`) ; lectures catalogue de l'affaire autorisées (`ownedPriceLookupProjects`) | 201 `{item}` ; offre : `{id, product_id, supplier_id, unit_price_cents}` |
| `GET /api/estimates/{id}` | toutes les relectures (409 `VERSION_CONFLICT` d'une lecture pendant une sauvegarde relu, comme `waitForAutoSave`) | `version` : `total_*`, `gross_ht_cents`, `discount_applied_cents`, `commercial_rounding_cents`, `rounding_adjustment_cents`, `sale_coefficient_fo/mo`, `discount_bp`, `discount_amount_cents`, `tax_rate_bp`, `rounding_mode`, `rounding_step_cents`, `content_revision` ; `items[]` : `unit_code`, `pricing_status`, `quantity`, `unit_price_ht_cents`, `h_mo_per_unit`, `h_mo`, `pu_ht_cents`, `line_total_ht_cents`, `line_tax_cents`, `tax_rate_bp`, `labor_role_id`, `product_id`, `selected_supplier_price_id`, `title` |

Écrits **par l'éditeur** (aucun appel direct du parcours) : lignes par la sauvegarde de la grille (lot v3 de 2.5),
réglages par `PATCH /api/estimates/{id}` (charge du §1.2). Les colonnes numériques sont comparées après
`Number()`.

### 9.6 Origine des attendus

PU, bruts, déboursé et totaux S1 à S5 : conception §5.1 et §5.2 (CAP, T-STAT, EUHIST : §5.3, transposés). États
intermédiaires (1,3 / 1,3, O5 à Q 2, c_FO 2,60 à 10 %, S2 à 10 %, V3E02, V3E03), nets par ligne et bases par taux :
moteur pur 2.4 (`computeEstimateV3Breakdown`, 40 €/h), dont les totaux égalent la conception là où elle les donne.
La grille tire des `id` au hasard, or D13 départage les ex aequo par `id` croissant : un script hors dépôt a rejoué
chaque état sur les **5 040** ordres d'`id` des 7 lignes. Totaux, bases par taux et nets par ligne n'en dépendent
jamais ; la TVA par ligne en dépend en S2 (O3, O7) et en S4 (O1, O2, O7) : le parcours ne l'asserte donc que par
taux (`taxByRate`), jamais ligne à ligne.

### 9.7 Hypothèses, choix, limites

- **Un brouillon par parcours** (verrou d'édition) : trois parcours, chacun avec son propriétaire, son ancre v2 non
  éditée et sa v3. CAP et T-STAT ont leur propre brouillon (V3E02) plutôt qu'une assiette construite dans l'oracle.
- **Mode Expert** et préréglage **Standard** (rôle MO visible) : le contrat du §9.4.2 et du §9.4.3 vaut dans ce
  mode ; le mode simplifié n'est pas qualifié ici (la présélection y est masquée).
- **MO doublée (V3E-08)** : la grille v3 n'affiche pas de MO en € par ligne ; le parcours asserte les heures totales
  et le PT (exacts, Q entier), la répartition FO/MO étant prouvée par le gel de 2.5 et le moteur 2.4.
- **Impression** : seulement l'absence de bandeau ; le pied v3 imprimé, la remise et la TVA par taux sont de 2.7.
- Les messages exacts imposés sont ceux du §9.4 ; « Coefficient de vente FO obligatoire… » reprend le message du
  §1.2 ; le texte du refus de présélection est un choix de ce document.
- `V3P-06` (`engine-v3-persistence.e2e.ts`) et le volet éditeur et fiche de `V3FC` (`engine-v3-fail-closed.e2e.ts`)
  attendaient encore le bandeau sur l'éditeur et la fiche d'une v3 : faux par construction en 2.6 (§1.4), réécrits
  avec l'implémentation (§8.3), pas dans le rouge.
- Durée : V3E01 a un délai de 15 min (7 sauvegardes de ligne, 11 relevés avec rechargement, une quinzaine
  d'ouvertures du tiroir), V3E02 et V3E03 7 min ; mesurée au vert (§8.6, §10.3) dans la campagne critique
  (`maxDuration` 30 min, deux workers).

### 9.8 Preuve rouge (17/10/2026)

WSL Ubuntu 24.04, Node 24.14.0, TesterArmy `e2e` 0.21.0, clone `~/miaouffrage-lot2-26` remis à `2338757a`
(`git reset --hard` sur la branche, diff local vide : `diffSha256` `e3b0c442…b855`), au plus deux exécutions natives
possédées en parallèle (attente du verrou avant chaque lancement).

```bash
E2E_ARMY_WORKERS=2 NODE_OPTIONS=--max-old-space-size=4096 npm run e2e:army:local -- --grep "V3E0"
```

Sortie 1. En amont : 248 migrations, pgTAP `Files=19, Tests=1833, Result: PASS`, « Behavioral RLS matrix passed. »,
build passé. Parcours : configuration 1/1 ; **3/3 rouges pour la raison visée**, après des préalables réussis
(propriétaire dédié, ancre v2, « Tuyauteur », fenêtre de politique 3, v3 créée, section, lot de lignes pour V3E02 et
V3E03, article, fournisseur et offre A pour V3E03) :

```text
× V3E01 … 63.14s   × V3E02 … 64.62s   × V3E03 … 64.92s
ASSERTION_FAILED: the v3 editor opens instead of the 2.1 engine-unavailable banner:
expected {"banner":true,"heading":false,"grid":false,"summary":false}
to equal {"banner":false,"heading":true,"grid":true,"summary":true}
 ❯ e2e/army/local/engine-v3-editor-support.ts:212:86
 ❯ at http://localhost:3107/dashboard/estimates/<v3>/edit
```

Archive : `.e2e/army/ci/2026-10-17T19-08-52-516Z-critical/` du clone WSL (manifeste : `failed`,
`filtered-critical`, `grep: V3E0`, 2 workers, révision `2338757a`, confidentialité `passed` ; SHA-256 du manifeste
`418a172dc56f78efd8c7ad0a02763a2360b86ca48a07c47f620b879e649908c6`). Preuves `v3e-*-editor-open`, sous
`critical/runs/2026-10-17T19-10-00-180Z/artifacts/business/` :

| Parcours | v3 | SHA-256 |
|---|---|---|
| V3E01 | `b1c6d8b8-cf69-40b4-8834-4342dcf66e2c` | `af4ce68571fbc62084a5fd0859b710f5415926987726a29cbb166f6ddb764b6c` |
| V3E02 | `13c8ff5c-82ca-40f3-aace-707126eb2cda` | `206e53c953eceec96bb4a1492107eedcd803a72b3768ab0528fab1241e4b0b4c` |
| V3E03 | `2849d99e-dedd-435e-af4e-426942fc7469` | `dcebc40b7652438eef52bae04e84ed88bad4f8d597bf2c49e97f2faa9d35dafb` |

Deux essais précédents échouaient au **préalable**, pas sur l'éditeur, et ne comptent pas comme rouge :
`2026-10-17T18-58-33-251Z-critical` (`a09e2f25`) : motif de politique non ASCII refusé par
`setTenantCalcPolicy` (« Invalid tenant calc policy fixture input. »), corrigé par `b8db6f52` ;
`2026-10-17T19-03-15-370Z-critical` (`b8db6f52`) : V3E01 et V3E02 déjà rouges pour la raison visée, V3E03 arrêté par
`POST /api/prices` 400 (offre créée avec un nouvel article et un nouveau fournisseur), corrigé par `2338757a` (chemin
de `bulk-edit-sync-sources`).

Carte d'impact (Windows) : `npx vitest run --project=node src/test/army-impact-map.test.ts
src/test/ci-guardrails.test.ts` → 23/23. `npm run typecheck`, `npx eslint --max-warnings=0` sur les deux fichiers du
parcours et `npm run check:architecture` : sortie 0.

## 10. Intégration des deux pistes (18/10/2026)

### 10.1 Fusion d'`origin/main`

2.5 a été fusionné dans `main` (PR #33) avec ses correctifs de revue : M4 refuse la suppression directe d'une ligne
v3 hors contrat d'écrivain (`ESTIMATE_V3_WRITER_NOT_SUPPORTED`, pgTAP F25-25 ; V3P-18 : le lot et la suppression
contrôlée d'une affaire brouillon restent possibles), contrôle préalable des sections avant M4,
création `canonical_v2` qui garde la `max_section_depth` héritée ; `main` porte aussi la PR #36 (totaux de version
écrits avec la présélection fournisseurs d'une v1/v2, `V1PT01`, `OZ04`) et la PR #37 (relevé de M4 sur le Supabase
partagé). `git merge --no-ff origin/main` (`fc2ba2dc`) au commit `28d04309`, sans rebase. Trois conflits, résolus en
gardant les deux intentions :

| Fichier | `main` | 2.6 | Résolution |
|---|---|---|---|
| `useEstimateEditorCalculation.ts` | `computePersistedTotals(items)` (rappel), `persistedTotals` qui l'appelle | `persistedTotals` nul sur une v3 | rappel de `main`, nul sur une v3 (`isV3` dans ses dépendances) |
| `useEstimateEditorSupplierController.ts` | `computeVersionTotalsPatch` des lignes présélectionnées, refus « Impossible de calculer les totaux du devis. » s'il est nul, patch envoyé par `bulkUpdateEstimateItems`, `applyVersionToken(updatedAt, totals)` | v3 par l'écrivain de lot, `applyVersionToken(updatedAt, contentRevision)` | v1/v2 : chemin de `main` à l'identique ; v3 : aucun patch calculé ni envoyé (le serveur recalcule et vérifie, D12), écrivain de lot de 2.6 ; `applyVersionToken(updatedAt, totals?, contentRevision?)`, la révision de contenu n'étant passée que par l'écrivain v3 |
| `supabase/migrations.manifest.json` | empreinte révisée de M4 | migration `20261017205000` | empreinte de M4 de `main` + `20261017205000` (son contenu est inchangé) |

Défaut évité par la résolution (établi à la lecture du code, non rejoué) : prendre le côté `main` du contrôleur de
présélection aurait refusé **toute** présélection v3 avant écriture, car l'aperçu historique est nul par
construction sur une v3 (`buildVersionTotalsPatch(null)` rend `undefined`, d'où « Impossible de
calculer les totaux du devis. » : ni recalcul ni refus nommé, l'échec « ni l'un ni l'autre » du §9.4.6). La
défaillance est celle que `V3E03` (V3E-11) asserte déjà : aucun nouveau test ; la preuve est `V3E03` vert à la
révision fusionnée, et pour la v1/v2 `OZ04` (v1, phase `offers` de calc-v3) et « bulk edit sync supplier preselection
saves a return… » (v2, P1 de `bulk-edit-sync-sources`) (§10.3).

M4 révisée et la migration `20261017205000` : la migration de 2.6 ne touche ni le déclencheur de suppression de M4
ni son contrôle préalable ; rejouée avec M4 révisée par la pile native (§10.3).

`useEstimateEditorState.impl.tsx` passe de 2 908 à 2 926 lignes non vides (+18 de la PR #36) : budget 3 100 tenu.

**Seconde fusion.** `origin/main` a avancé pendant les preuves (PR #34, sous-lot 2.9, unité d'achat des offres,
migration M7 `20261017172127_supplier_offer_purchase_unit.sql`) : `git merge --no-ff origin/main` (`78ca0855`) au
commit `1ec72124`, sans rebase. Trois conflits, plus un branchement :

| Fichier | `main` (2.9) | 2.6 | Résolution |
|---|---|---|---|
| `useCatalogueSuggestions.ts` | prix de l'offre converti pour l'unité de la ligne (`alternativePriceForLineUnit`), unité lue dans `description` | unité d'une ligne v3 dans `unit_code`, jamais écrite dans `description` | prix converti de 2.9 calculé pour `unit_code` sur une v3 ; contrôle d'unité et charge de 2.6 |
| `server.ts` (comparaisons fournisseurs) | `estimateLineUnit` partagé (`coalesce(unit_code, description)`, jumeau SQL de M7) | aiguillage par moteur (`unit_code` en v3) | `estimateLineUnit` de 2.9 : même unité sur tous les moteurs, `unit_code` étant toujours nul en v1/v2 (M4) ; le fichier est celui de `main` |
| `supabase/migrations.manifest.json` | M7 | `20261017205000` | les deux, dans l'ordre des noms (M4 → M7 → 2.6) |
| `LineRow.tsx` (sans conflit) | nouvelle prop `lineUnit={item.description}` de la liste des suggestions | — | `lineUnit={v3Grid ? item.unit_code : item.description}` : la liste affiche le prix que la suggestion appliquera |

Les budgets restent tenus après 2.9 : `EstimateEditorTable.tsx` 2 577 / 2 600 (+13 de 2.9), `LineRow.tsx` 1 197 / 1 200.

### 10.2 Réconciliation des pistes

- **Un seul aperçu** : la piste grille lit l'aperçu du hook (`v3Settings.preview`, `useEstimateEditorCalculation`
  et `applyEstimateV3PreviewToItems`) ; `computeEstimateV3SettingsPreview` / `buildEstimateV3PreviewInput` est le
  seul calcul d'entrée du moteur côté client (aucun `computeEstimateV3EditorPreview` n'a été gardé). La grille, le
  pied et le tiroir ne peuvent donc pas diverger.
- **API du hook** : celle du §1.3 ; l'état d'éditeur appelle `buildSavePayload()` dans `performSaveSettings`,
  tient compte de `isDirty` et appelle `reset()` à l'abandon ; le tiroir reçoit le contrôleur (`v3`) et ne rend
  pas le gestionnaire v1/v2 des tranches de marge (`showMarginTiers: !isV3`).
- **Libellés** : ceux du §9.4, inchangés par l'intégration ; un seul bouton « Enregistrer le paramétrage » par
  moteur (celui de la section v3 sur une v3, celui du panneau sur une v1/v2).
- **Charges** : réglages = les 13 clés du §1.2 (plus `apply_tax_rate_to_lines` après « Oui ») ; ligne v3 = saisies
  seulement (`toEngineItemWrite`, `buildEstimateV3ItemUpdatePayload`) ; présélection v3 = `unit_price_ht_cents` et
  `selected_supplier_price_id` par l'écrivain de lot ; aucun total client sur une v3.
- Références documentaires des sources mises à jour vers ce document (commentaires seulement).

### 10.3 Preuves mesurées (18/10/2026)

WSL Ubuntu 24.04, Node 24.14.0, TesterArmy `e2e` 0.21.0, clone `~/miaouffrage-lot2-26` remis à la branche
(`git -c safe.directory='*' fetch` du worktree Windows puis `git reset --hard FETCH_HEAD`), diff local vide
(`diffSha256` `e3b0c442…b855`), `NODE_OPTIONS=--max-old-space-size=4096`, verrou natif attendu avant chaque
lancement (au plus deux exécutions possédées). Windows 11 : worktree `miaouffrage-l2-26`, Node 24.19.0, Vitest
4.1.11.

**Révisions.** Le code final est celui de `a7417e3d` ; `71802307` n'ajoute que la documentation de `main` (PR #38) et
le commit suivant ne change que ce document. `c8c750f3` → `a7417e3d` ne change qu'une sonde de `V3FC01` (§10.4) : les
preuves qui ne lancent pas `V3FC01` (empreintes, calc-v3, SQL) sont prises à `c8c750f3`, les autres à `71802307`.

#### 10.3.1 Qualification finale

| Preuve | Commande | Révision | Résultat | Archive (clone WSL) |
|---|---|---|---|---|
| Parcours 2.6 et présélection v2 | `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --grep "V3E0\|V3P01\|V3FC\|supplier preselection saves a return"` | `71802307` | sortie 0 ; en amont 250 migrations, « Local migration inventory matches the repository. », pgTAP `Files=20, Tests=1854, Result: PASS`, « Behavioral RLS matrix passed. », build ; `discovered 86, selected 9, executed 9, passed 9, failed 0, flaky 0`, une tentative chacun : V3E01 67,6 s, V3E02 137,2 s, V3E03 13,8 s, V3E04 7,7 s, V3P01 11,7 s, V3FC01 1,6 s, V3FC02 0,9 s, « bulk edit sync supplier preselection saves a return… » 11,6 s ; 5 min 2 s | `.e2e/army/ci/2026-10-17T23-39-50-876Z-critical`, manifeste `c526604e750d524cae002dae0cf879925c06a3c56a224f2b386b840453a6c76c`, confidentialité `passed` |
| Qualité de PR | `npm run verify:pr` | `71802307` | sortie 0 ; audit des dépendances (0 avis bloquant), 762 signatures vérifiées, budgets d'architecture (1 133 modules, 0 cycle), OpenAPI valide et synchronisée, `typecheck`, `lint` (`--max-warnings=0`), Vitest node 297 fichiers / 2 812 tests passés (1 fichier, 2 tests ignorés), jsdom 164 / 823, couverture critique 3 / 12 | journal non versionné du clone |
| Empreintes de documents | `npm run engine:document-fingerprints -- check` | `c8c750f3` | sortie 0 ; 14 familles v1/v2 ; « Document fingerprints identical » | `.e2e/engine-v3/document-fingerprints/2026-10-17T23-21-30-687Z-check`, manifeste `146396e53e5607ff6502a1a4f9deaf29b448ffa94770b239f5083996ae7789bd` |
| Parcours de référence 2.0 (hors CI) | `npm run e2e:army:calc-v3` | `c8c750f3` | sortie 1 ; sources inchangées pendant la campagne ; `journeys` 11/11, `components` 5/5, `numeric` 4/4, `resume` 5/5, `access` 2/2, `offers` 10/10 (OZ01 à OZ04, PU01 à PU05 de 2.9, setup), `emission` 5/6 : **OF00 rouge**, dialogue PDF bloqué par « Ce devis est déjà ouvert dans une autre page. » (`PATCH /lock` 409), artefact de `next dev` documenté par 2.9 (`estimate-engine-v3-2.9.md`, « OF00 en mode développement ») | `.e2e/army/ci/2026-10-17T22-41-50-449Z-calc-v3` à `fb52abcb` (avant 2.9 : 38/38) ; `.e2e/army/ci/2026-10-17T23-22-13-861Z-calc-v3` à `c8c750f3`, manifeste `4da4b5323bdd2200f0614866b617b75a2963f3cb557faf77cb28a310b916139f` |
| OF00 sur `main` (référence) | `npm run e2e:army:calc-v3 -- --phase emission --grep "^OF00\s"`, clone détaché sur `origin/main` puis remis à la branche | `91068850` | sortie 1 ; même échec, même alerte : rouge hérité de `main` (2.9), pas de 2.6 | `.e2e/army/ci/2026-10-17T23-46-10-545Z-calc-v3`, manifeste `f711397f9ce47aaac94d50e5720af42708de819c0a111b06534c86a010d7f665` |
| SQL et RLS natifs (M4, M7, `20261017205000`) | `npm run db:ci:local` | `c8c750f3` | sortie 0 ; inventaire conforme, pgTAP `Files=20, Tests=1854, Result: PASS`, « Behavioral RLS matrix passed. » | journal non versionné du clone |

Preuves métier de la qualification, sous `critical/runs/2026-10-17T23-41-00-767Z/artifacts/business/` :

| Preuve | SHA-256 |
|---|---|
| `v3e-v3e01-editor-open` | `2e6e6a5a101e065c272dbd63ee85a13974afc0754431671891db865b56ed2189` |
| `v3e-v3e02-editor-open` | `7f97cb1bb3a2f6ee29c40aad6dc077179a0c95f3f41a528e67b7f238f568da78` |
| `v3e-v3e03-editor-open` | `cc4aeeb5333e6d48d843008abae90da89447b25d9429cfdd8ba03b87e3b0d124` |
| `v3e-v3e04-editor-open` | `47d338cfcf35c35e9479b972a3ebd2c37b06c1d320f7be51d00e8e2c8919bbd9` |
| `v3e-preselection-precondition` | `6255db0ff6f57e07e2e9b2257dd684a70e0f8835cb9d1c2fc28ed8854b7adc16` |
| `v3e-preselection` | `47be308c8d16ab5fab7249faaba62235af76b3cee38299d20284125c462b4197` |
| `v3e-preselection-recomputed` | `be21d0093f50f0fa7579db6512330646093f443e71ddbe3353ff9b8287233852` |
| `v3e04-supplier-comparison` | `4f0c81351e4fd15fd2bbb205ef564912150ed6bb2a6e38afb648981e0c61f509` |
| `v3e-v3e04-retained` | `1100b32c6374aad093247bdcbe8fba4fed2a5e825bed53417e0149d6b84560a1` |
| `v3p-editor-open` | `c5872030f31e06d7f514b09fbae2ea3b64c7e7fdbf387f6e93bde8ea5747ebb4` |
| `engine-v3-read` (V3FC01) | `570b0e354f56bd6a550ba745fd7f8fd33fa270454429c68c0012300d741fa666` |
| `bulk-sync-p1-preselection-stored-totals` (v2) | `0b65118ddcaa564c6c91b335a0e9b8bafd87ce3e0df379e099421e176c0b4937` |

**Issues assertées.** Présélection v3 (V3E-11) : `{"refused": false, "recomputed": true, "genericBanner": false}`,
offre B retenue, PR 1 240, PU 1 612, net 3 224, totaux 3 224 / 645 / 3 869 c (§9.3.3). Comparaison d'une ligne v3
(V3E-12) : `{"offers":{"ml":{"unitRefused":false,"retainEnabled":true},"bar":{"unitRefused":true,
"retainEnabled":false}},"persisted":{"unitCode":"ml","description":null,"prFo":1240,…}}`, puis 3 224 / 645 / 3 869 c
et « Total HT : 32,24 € », « TVA 20 % : 6,45 € », « TTC à payer : 38,69 € » avant et après rechargement (§9.3.4).
Présélection v2 (P1 de `bulk-edit-sync-sources`) : totaux stockés égaux à ceux des lignes (PR #36 inchangée).
Valeurs S1 à S5, CAP, T-STAT et réglages : celles du §3 et du §9.3, assertées par le parcours à 0 c.

Windows :

| Commande | Révision | Résultat |
|---|---|---|
| `npx vitest run --project=node src/lib/estimates/v3-settings-payload.test.ts` | `c8c750f3` | 4/4 (`V3S-01` à `V3S-04`, assertions inchangées) |
| `npx vitest run --project=node src/test/army-impact-map.test.ts src/test/ci-guardrails.test.ts` | `c8c750f3`, `71802307` | 23/23 |
| `npx vitest run --project=node src/lib/estimates/engine-frozen-corpus.test.ts` | `c8c750f3` | 2/2 (corpus figé) |
| `npx vitest run --project=jsdom src/hooks/useEstimateEditor src/components/estimates` | `c8c750f3` | 58 fichiers, 393/393 |
| `npx vitest run --project=node src/hooks src/lib/estimates` | `c8c750f3` | 85 fichiers passés (1 ignoré), 1 078 tests passés (2 ignorés) |
| `npm run typecheck` | `c8c750f3`, `71802307` | sortie 0 |
| `npm run validate-openapi` ; `npm run check:architecture` | `c8c750f3` | « OpenAPI spec valide et synchronisee. » (aucune route ni schéma changé par 2.6, rien à régénérer) ; 1 133 modules, 0 cycle |
| `npx eslint --max-warnings=0` sur les 37 fichiers `.ts`/`.tsx` ajoutés ou modifiés par la branche (`git diff --name-only --diff-filter=AM origin/main...HEAD`), puis sur la sonde de `a7417e3d` | `c8c750f3`, `a7417e3d` | sortie 0 |
| `git diff --stat origin/main...HEAD -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts` (et depuis `f1d94213`) | `71802307` | vide |
| `git -c core.whitespace=cr-at-eol diff --check origin/main...HEAD` | `71802307` | propre |

Budgets (lignes non vides) : `EstimateEditorTable.tsx` 2 578 / 2 600, `useEstimateEditorState.impl.tsx` 2 926 / 3 100,
`useEstimateEditorSyncController.ts` 1 199 / 1 200, `LineRow.tsx` 1 197 / 1 200.

#### 10.3.2 Passages précédents (avant la seconde fusion ; historique)

| Commande | Révision | Résultat | Archive |
|---|---|---|---|
| `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --grep "V3E0\|V3P01\|V3FC"` | `28d04309` | sortie 0 ; 249 migrations, pgTAP `Files=19, Tests=1837` ; 7/7 | `2026-10-17T22-20-39-207Z-critical`, manifeste `2a9d86460420107c7438ff089c820ecfba253fac959561bcdb7fd8d4018e73db` |
| même sélection et « supplier preselection saves a return » | `fb52abcb` | sortie 0 ; 8/8 ; issue de la présélection « recalcul persisté » | `2026-10-17T22-34-41-676Z-critical`, manifeste `e523888599b988dacf6064c9d4e0a08796f5daabbb14e15c4cc430dba9a4e1f7` |
| `npm run engine:document-fingerprints -- check` | `fb52abcb` | identiques, 14 familles | `2026-10-17T22-41-06-810Z-check`, manifeste `f0ce2a794b560f86d0f4c22fc357b7cf231dbd22158dd5f7a2a88379fef7b727` |
| `npm run e2e:army:calc-v3` | `fb52abcb` | sortie 0 ; 11 / 5 / 4 / 5 / 2 / 5 / 6, 4 PDF | `2026-10-17T22-41-50-449Z-calc-v3`, manifeste `a5b545289cc549d26c7e4ebbd6b8fe586ea7f96757f6c85a2416184c6e065036` |
| `npm run db:ci:local` ; `npm run verify:pr` | `fb52abcb` | sortie 0 ; node 296 / 2 787, jsdom 162 / 821, couverture 3 / 12 | journaux du clone |
| même sélection et « supplier preselection saves a return » | `c8c750f3` | sortie 1 : 8/9, `V3FC01` rouge sur sa sonde (§10.4), les autres verts dont `V3E04` | `2026-10-17T23-16-25-111Z-critical`, manifeste `2256db5cb5e512ad1b083b53f2121af45db940b83a6bd2d0e68848c39510edc5` |

### 10.4 Défaut révélé par l'intégration (F26-20, V3E04)

En résolvant la seconde fusion (2.9 fait lire l'unité de la ligne aux chemins d'achat), la comparaison fournisseurs
d'une ligne (`useEstimateSupplierComparison.ts`, prop `itemUnit` du panneau dans `EstimateEditorTable.tsx`) lisait
encore l'unité dans `description`. Une ligne v3 faite par la grille n'a rien dans `description` (son unité est
`unit_code`, D9) ; `areSupplierUnitsCompatible` tient une unité de ligne vide pour compatible avec toute offre : le
panneau proposait donc une offre dans une autre unité (prix à la barre sur une ligne en ml), et retenir une offre
écrivait son unité dans `description`. Hors des scénarios du §14 « 2.6 » (`V3E03` porte la même unité dans
`description` et `unit_code`, §8.5), donc non couvert jusque-là.

- **Rouge d'abord** (`3e095711`, parcours `V3E04`, §9.3.4) : WSL, clone à `3e095711`, diff local vide,
  `npm run e2e:army:local -- --grep "V3E04"`, sortie 1 ; en amont 250 migrations, pgTAP `Files=20, Tests=1854, Result:
  PASS`, matrice RLS, build ; setup vert, `V3E04` rouge pour la raison visée :
  `{"offers":{"ml":{"unitRefused":false,"retainEnabled":true},"bar":{"unitRefused":false,"retainEnabled":true}},
  "persisted":{"unitCode":"ml","description":"ml","prFo":1240,…}}` au lieu de l'offre « barre » refusée et d'une
  `description` nulle. Archive `.e2e/army/ci/2026-10-17T23-11-13-132Z-critical` (manifeste
  `0b1866792a92d12fbebf1eb1e3396fccd740fda1abd8bfc2695b94dabce2f780`), preuve `v3e04-supplier-comparison`
  `c9f57300d2ec9648ede0a325c950d34463287f82b95c2a3163c3d261f2d5c996`.
- **Correction** (`c8c750f3`) : sur une v3 (contexte `useEstimateV3Grid`), l'unité de la ligne est `unit_code` pour
  l'éligibilité, le prix converti (2.9) et l'affichage du panneau (`activeSupplierComparisonUnit`), et retenir une
  offre n'écrit que le PR FO et l'offre ; v1/v2 inchangées (`description`, mêmes valeurs écrites). Vert au §10.3.
- Même famille, corrigée à la revue : l'association d'article depuis la fiche (F26-26, §11).

**Sonde de `V3FC01` corrigée** (`a7417e3d`, sans toucher une assertion) : à `c8c750f3`, `V3FC01` a attendu 30 s « TTC à
payer 70,20 € » ; l'écran à l'échec montre le déclencheur « Voir les détails de TVA, remise et TTC » sans le focus et la
première cellule de la grille focalisée. `useSpreadsheetNavigation` redonne le focus à sa cellule active quand son
modèle de navigation change, ce qui peut arriver après l'aperçu : le `focus()` puis `keyboard.press("Enter")` de la
sonde envoyait Entrée à la cellule, et le détail ne s'ouvrait pas. La sonde attend désormais que la grille tienne le
focus, puis appuie sur Entrée sur le déclencheur lui-même (`locator.press`) ; l'assertion (TTC de l'aperçu v3, jamais la
lecture v1) est inchangée et verte à `71802307`. Ce vol du focus de la barre d'outils par la grille est un comportement
existant de l'éditeur, tous moteurs, hors du périmètre de 2.6. **Revue** (`cc78c87d`) : cette sonde faisait du vol du
focus une condition préalable (si la grille ne le prenait plus, `V3FC01` échouait pour une raison étrangère à la lecture
v3) ; elle attend désormais un éditeur posé, bail pris (`waitForDraftLease` : le passage en édition est l'un des
changements de modèle qui déplacent le focus), puis appuie sur Entrée sur le déclencheur, sans rien supposer du focus.

### 10.5 Limites et suites

- ~~Aucune revue indépendante en lecture seule n'a été conduite~~ : deux revues indépendantes en lecture seule ont été
  conduites sur le diff stable le 18/10/2026 ; constats, revérification, rouges, corrections et preuves au §11.
- Migration `20261017205000_estimate_engine_v3_line_repricing.sql` : à appliquer au Supabase partagé avant tout
  déploiement, sur autorisation explicite (`AGENTS.md`, `supabase/README.md` §3) ; rien n'a été appliqué à distance.
- Limites de l'implémentation : état revu au §11.6 (le §8.5 garde la trace des points corrigés par la revue).
- `V1PT01` (`supplier-preselection-v1-totals.e2e.ts`) n'est sélectionné que par la suite `full` ; la v1 est couverte
  ici par `OZ04` (phase `offers`, même scénario) et la v2 par P1 de `bulk-edit-sync-sources`.
- `OF00` (phase `emission` de calc-v3, `next dev`) est rouge depuis 2.9, sur `main` comme sur la branche (§10.3.1) :
  décision de 2.9 partagée avec 2.7 (la phase d'émission passera en build de production en 2.7) ; 2.6 ne l'aggrave
  pas.
- `origin/main` peut encore avancer : avant un push autorisé, refusionner et rejouer ce que la fusion invalide
  (`AGENTS.md`).

## 11. Revue indépendante et corrections (18/10/2026)

Deux revues indépendantes en lecture seule ont été conduites sur le diff stable (`ae9b375d`). Chaque constat a été
revérifié (lecture du code, puis parcours rouge quand le constat est un comportement) avant toute correction ; les
assertions des tests du rouge de 2.6 (`V3E01` à `V3E04`, `V3S-01` à `V3S-04`) ne sont pas modifiées.

### 11.1 Constats et revérification

| # | Constat (revue) | Revérification | Suite |
|---|---|---|---|
| R1-1, R2-2 | « Deboursé sec », « Marge € », « Marque % » d'une v3 calculés par la formule v1/v2 (`computeEstimateLineMargin`) | confirmé, rouge `V3E08` : marge 11,50 € au lieu de 25,00 €, ligne « Hors lot » à 30,00 € de déboursé et −30,00 € de marge | corrigé, F26-24 |
| R1-2 | Taux horaire d'un rôle : rien de stocké recalculé, aucun écart signalé | confirmé, rouge `V3E07` : totaux stockés 500,00 € / 100,00 € / 600,00 € pour 560,00 € HT à l'écran | corrigé, F26-23 |
| R1-3 | Collage : unité dans `description`, heures totales, totaux v2 | confirmé, rouge `V3E13` : ligne créée, `unit_code` perdu, révision changée | refus nommé, F26-31 |
| R1-4, R2-3 | « Associer ou remplacer l'article » : unité lue dans `description`, offre d'une autre unité acceptée, unité écrite dans `description` | confirmé, rouge `V3E09` : offre « barre » proposée sur une ligne en ml, `description` « ML » après l'association | corrigé, F26-26 |
| R1-5 | Suppression d'une ligne, annulation d'un ajout, nettoyage en vol par la suppression directe (refusée en v3) | confirmé, rouge `V3E05` (second passage) : refus générique affiché, ligne revenue | corrigé, F26-21 |
| R1-6, R2-5 | Question de propagation de la TVA ouverte par le seul bouton « Enregistrer le paramétrage » | confirmé, rouge `V3E10` : aucune question au Ctrl+S | corrigé, F26-27 |
| R1-7 | « 0 » dans « Remise (%) » → « Non sauvegardé » sans fin | confirmé, rouge `V3E11` : statut « Non sauvegardé » après la sauvegarde | corrigé, F26-28 |
| R1-8 | Palier d'arrondi stocké hors liste affiché « Aucun » | confirmé, rouge `V3E11` : `select.value` « none », « Aucun » ; le volet « “Aucun” ne déclenche pas d'événement » n'est pas discriminé par le parcours (`selectOption` déclenche l'événement) : tenu par construction (le pas stocké est une option distincte) | corrigé, F26-29 |
| R1-9 | Fiche d'un brouillon v3 : PDF et modèle proposés | confirmé, rouge `V3E11` : les deux actions actives, aucune raison | corrigé, F26-30 |
| R2-1 | Actions en lot (catégorie, rôle, majoration, déplacement, suppression, suggestions et leurs annulations) hors écrivain v3 ; §8.5 inexact | confirmé, rouges `V3E06` (majoration en lot : refus générique) et `V3E12` (suggestions en lot : refus générique) ; §8.5 inexact à la lecture | corrigé, F26-22 et F26-32 ; §8.5 corrigé |
| R2-4 | Contrôles qualité sur le `h_mo` stocké | confirmé, rouge `V3E08` : « Temps MO manquant » encore signalé après la sauvegarde des heures par unité | corrigé, F26-25 |
| R2-6 | Sonde `V3FC01` conditionnée au vol du focus | confirmé à la lecture (`a7417e3d`) | sonde corrigée (`cc78c87d`), §10.4 |
| R2-7 | §8.5 inexact pour l'éditeur mobile (heure totale « refusée par le serveur ») | confirmé à la lecture : ignorée sans message côté client | §8.5 corrigé ; limite maintenue (§11.6) |
| R2-8 | F26-10 sans parcours pour une unité inconnue ou un statut | confirmé ; le parcours ajouté (`V3E05`) a révélé un défaut : après le refus, `reportValidity()` ramenait le focus dans la cellule et Tab ne la quittait plus | refus gardé, piège du focus corrigé (`a15cc432`) |
| R2-9 | Migration ajoutée en 2.6 non consignée, commentaire « CHECK de M4 » faux | confirmé à la lecture | écart consigné au §8 ; commentaire corrigé (`d0d82b4e`) |

Revérifié en plus, hors des constats (lecture du code, non corrigé, §11.6) : « Convertir en section », « Convertir en
ligne » (`PATCH /items`) et « Dupliquer la section » (insertion directe) refusent aussi une v3 côté serveur, sans rien
écrire.

### 11.2 Choix de la revue (dans le cadre des décisions du §8)

- **Écrivain unique** (`src/lib/estimates/v3-editor-writer.ts`, nouveau) : sur une v3, les contrôleurs saturés
  délèguent suppressions, mises à jour en lot et recréations à l'écrivain de lot de 2.5 (recalcul et vérification
  D12 dans la même transaction) ; une v1/v2 garde ses appels historiques, à l'identique (l'écrivain n'est injecté que
  sur une v3). Suppression en lot : un seul lot atomique (aucune suppression partielle). Recréation : saisies v3
  (`unit_code`, statut, heures par unité), jamais `h_mo` ni une projection.
- **Taux horaire (F26-23)** : une fois le rôle enregistré, un lot `update` sans changement sur une ligne qui porte le
  rôle suffit, le lot v3 projetant toutes les lignes ; un échec est signalé (« Le taux horaire est enregistré, mais
  les montants du devis n'ont pas été recalculés : … »).
- **Collage (F26-31)** : refus nommé dans l'aperçu, avant toute écriture — « Le collage de lignes n’est pas encore
  disponible pour un devis au moteur de calcul 3 : saisissez les lignes dans la grille (unité du référentiel, heures
  par unité). » Son contrat v3 (unité du référentiel, heures par unité ou totales, statut) n'est pas fixé ; la copie
  d'une ligne v3 exporte `unit_code`.
- **Association d'article (F26-26)** : même règle que la suggestion de la désignation (2.6) : l'offre est jugée et
  prix dans `unit_code`, une autre unité est refusée (« Unité différente du devis : offre en …, ligne en … »,
  suggestion désactivée dans la fiche), l'article ne fixe jamais l'unité d'une ligne v3 et `description` n'est jamais
  écrite. v1/v2 : chemin historique (l'article reste la source de l'unité).
- **Question de TVA (F26-27)** : `askTaxPropagation` du hook ; la sauvegarde qui l'appelle (Ctrl+S, fermeture du tiroir,
  navigation) attend la réponse, le tiroir est rendu visible si besoin ; « Oui » / « Non » reprennent la même
  sauvegarde (jamais une seconde), Échap n'enregistre rien.
- **Fiche (F26-30)** : « Préparer le PDF » et « Sauvegarder comme modèle » désactivés, raison affichée : « Moteur de
  calcul 3 : le PDF et l’enregistrement comme modèle ne sont pas encore disponibles pour ce brouillon. » ;
  « Dupliquer » reste (2.5 duplique une v3).
- **Unité inconnue (F26-10)** : refus gardé (cellule signalée, `aria-invalid`, message dans l'infobulle et pour les
  lecteurs d'écran), sans `reportValidity()`.

### 11.3 Rouges observés (18/10/2026)

WSL Ubuntu 24.04, Node 24.14.0, `e2e` 0.21.0, clone `~/miaouffrage-lot2-26` remis à la branche (`git -c
safe.directory='*' fetch` du worktree Windows puis `git reset --hard FETCH_HEAD`), diff local vide (`diffSha256`
`e3b0c442…b855`), verrou natif attendu avant chaque lancement.

| Passage | Commande | Révision | Résultat | Archive (clone WSL) |
|---|---|---|---|---|
| 1 | `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --grep "V3E05\|V3E06\|V3E07\|V3E08\|V3E09\|V3E10\|V3E11\|V3E12\|V3E13"` | `8e9d90f5` | sortie 1 ; en amont « Local migration inventory matches the repository. », pgTAP `Files=20, Tests=1854, Result: PASS`, « Behavioral RLS matrix passed. », build ; setup vert, **9/9 rouges** | `.e2e/army/ci/2026-10-18T01-09-47-012Z-critical`, manifeste `7af1a469d34b36d0172f3129dd717611705e7f25324971f38aa7f3216581ffa7`, confidentialité `passed` |
| 2 | même commande, `--grep "V3E05\|V3E12"` | `1e235ce4` | sortie 1 ; mêmes contrôles en amont ; **2/2 rouges** | `.e2e/army/ci/2026-10-18T01-19-21-640Z-critical`, manifeste `109bceca7baa3e29d78cabc7b5ab234cf23d4302f5b718b776aa8ca52e5efeb9`, confidentialité `passed` |

Première assertion en échec de chaque parcours (les assertions `expect.soft` d'un même parcours sont listées) :

| Parcours | Passage | Attendu | Observé |
|---|---|---|---|
| `V3E05` | 1 | « xyz » et « HL » refusés par leur nom, la cellule se quitte | refus nommés et `aria-invalid`, mais `focusLeft: false` (défaut révélé, F26-10) |
| `V3E05` | 2 (après `a15cc432`) | ligne C supprimée, HT 447,00 € | refus générique, ligne présente, HT 460,00 € (F26-21) |
| `V3E06` | 1 | majoration 1,5 sur A et B, HT 482,00 € | majorations 1 / 1, HT 434,00 €, refus générique (F26-22) |
| `V3E07` | 1 | taux 5 000 c/h, totaux stockés 56 000 / 11 200 / 67 200 c | taux enregistré, totaux stockés 50 000 / 10 000 / 60 000 c (F26-23) |
| `V3E08` | 1 | (soft) P : 110,00 € / 25,00 € / 18,5 % ; « Hors lot » : 0,00 € / 0,00 € / - ; « Temps MO manquant » après la sauvegarde : non | (soft) P : 110,00 € / 11,50 € / 9,5 % ; « Hors lot » : 30,00 € / -30,00 € (en rouge) / - ; « Temps MO manquant » encore levé (F26-24, F26-25) |
| `V3E09` | 1 | (soft) offre « barre » désactivée et refusée par son nom ; `description` nulle après l'association | (soft) offre « barre » active, sans refus ; `description` « ML » (F26-26) |
| `V3E10` | 1 | question de propagation ouverte par Ctrl+S | aucune question (F26-27) |
| `V3E11` | 1 | (soft) plus rien en attente après 0 % ; (soft) arrondi stocké 2,50 € sélectionné ; PDF et modèle désactivés avec leur raison | (soft) « Non sauvegardé » ; (soft) `value` « none », « Aucun », 5 options ; PDF et modèle actifs, aucune raison (F26-28 à F26-30) |
| `V3E12` | 1 | « Examiner 1 suggestion » | « Examiner 3 suggestions » : **préalable faux**, la règle floue de `suggestion-scoring` appariait les trois lignes d'un même préfixe ; corrigé sans toucher une assertion (`1e235ce4` : mot-clé « robinetterie » porté par la seule ligne B) |
| `V3E12` | 2 | K FO 1,3 sur B, HT 453,50 € | K FO 1, HT 434,00 €, refus générique (F26-32) |
| `V3E13` | 1 | collage refusé par son nom, rien d'écrit | ligne collée créée, révision changée, HT 39,00 € (F26-31) |

Les étapes suivantes de chaque parcours (annulations, déplacement et suppression en lot, section, fermeture du tiroir,
annulation des suggestions) n'ont pas été atteintes au rouge : leurs défauts sont établis à la lecture (routes
directes refusées par 2.5 sur une v3 : `deleteEstimateItem` et `bulkUpdateEstimateItems` de `server.ts`) et leur
correction est prouvée par le vert (§11.5).

### 11.4 Corrections

| Commit | Défaillances | Fichiers |
|---|---|---|
| `cc78c87d` | sonde `V3FC01` (R2-6) | `engine-v3-fail-closed.e2e.ts` |
| `8e9d90f5` | rouges `V3E05` à `V3E13` | `engine-v3-editor-actions.e2e.ts` (nouveau), `engine-v3-editor-support.ts` (bail et section des préalables), carte d'impact |
| `a15cc432` | F26-10 (piège du focus) | `V3LineCells.tsx` |
| `1e235ce4` | préalable de `V3E12` | `engine-v3-editor-actions.e2e.ts` |
| `b86a76fa` | F26-27, F26-28, F26-29 | `useEstimateV3Settings.ts`, `v3-settings-payload.ts`, `EstimateV3SettingsSection.tsx` |
| `ae53f150` | F26-21, F26-22, F26-23, F26-25, F26-31, F26-32 | `v3-editor-writer.ts` (nouveau), `v3-editor.ts`, `editor-engine.ts`, `client.ts` (corps de création : saisies v3 quand la charge les porte), contrôleurs des éléments, des lots, des suggestions, du collage et de la présélection, `useEstimateEditorState.impl.tsx` |
| `9f47fc93` | F26-24, F26-26 | `LineRow.tsx`, `V3LineCells.tsx`, `EstimateArticleSheet.tsx`, `EstimateEditorTable.tsx` |
| `6c646080` | F26-30 | `EstimateDetailActionsMenu.tsx`, `[versionId]/page.tsx` |
| `d0d82b4e` | R2-9 (commentaire) | migration `20261017205000`, `migrations.manifest.json` |
| `13e7bc25` | ce chapitre (revue, rouges, corrections) | ce document |
| `1c16ad40` | F26-26, relecture avant le vert : un prix de référence d'article (sans offre) dans une autre unité est aussi refusé | `v3-editor.ts` |
| `258daf9e` | fusion d'`origin/main` (`89627add` : import CSV des offres fournisseurs), sans conflit ni recouvrement | — |

Budgets (lignes non vides) : `EstimateEditorTable.tsx` 2 591 / 2 600, `useEstimateEditorState.impl.tsx` 2 946 / 3 100,
`useEstimateEditorSyncController.ts` 1 199 / 1 200 (inchangé), `LineRow.tsx` 1 197 / 1 200,
`useEstimateEditorSuggestionsController.ts` 1 224 / 1 400. `estimate-calculations.ts` et `estimate-v2-snapshot.ts` :
aucun diff.

### 11.5 Preuves au vert (18/10/2026)

Révision qualifiée : `258daf9e` (fusion d'`origin/main` `89627add`, sans rebase ; `main` n'apporte que l'import CSV des
offres fournisseurs et sa documentation, sans recouvrement avec 2.6). Même environnement qu'au §11.3 (diff local vide,
`diffSha256` `e3b0c442…b855`, verrou natif : au plus deux exécutions natives possédées en parallèle, comptées par
exécution).

| Preuve | Commande | Résultat | Archive (clone WSL) |
|---|---|---|---|
| Parcours 2.6 et parcours v2 touchés par la revue | `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --grep "V3E\|V3P01\|V3FC\|bulk edit sync\|bulk move\|numeric entry"` | sortie 1 ; en amont inventaire conforme, pgTAP `Files=20, Tests=1854, Result: PASS`, « Behavioral RLS matrix passed. », build ; **26/27** : `V3E01` à `V3E13`, `V3P01`, `V3FC01`, `V3FC02`, `bulk-edit-sync` (3), `bulk-move` (1), `bulk-edit-sync-sources` (3, dont la présélection v2 P1), `numeric-entry` (2) verts en une tentative ; **`numeric entry v3` rouge** : « element is outside of the viewport: getByTestId("estimate-editor-settings-button") » (voir ci-dessous) | `.e2e/army/ci/2026-10-18T01-49-07-316Z-critical`, manifeste `4bbea21276d14de597991aa2a50b7e1ad0c1fc35b6bcc6535cd80d41292dcc2d`, confidentialité `passed` |
| `numeric entry v3` seul | `E2E_ARMY_WORKERS=1 npm run e2e:army:local -- --grep "numeric entry v3"` | sortie 0 ; 1/1 vert (15,3 s), même révision | `.e2e/army/ci/2026-10-18T01-57-51-938Z-critical`, manifeste `23ba5a0337d33ff01439fd86b2ec4de02eac4cac64ad5a0b1187b1d1a9d93f97` |
| Empreintes de documents | `npm run engine:document-fingerprints -- check` | sortie 0 ; 14 familles v1/v2, « Document fingerprints identical » | `.e2e/engine-v3/document-fingerprints/2026-10-18T02-01-23-234Z-check`, manifeste `7a2325bfcbccdc06726bf38326d899a64e2b193662599502108e838b528ae770` |
| Parcours de référence 2.0 (hors CI) | `npm run e2e:army:calc-v3` | sortie 0 ; sources inchangées pendant la campagne ; `journeys` 11/11, `components` 5/5, `numeric` 4/4, `resume` 5/5, `access` 2/2, `offers` 10/10 (dont `OZ04`, présélection v1), `emission` 6/6 : **38/38** ; `OF00`, rouge intermittent en `next dev` depuis 2.9 (§10.3.1), vert à ce passage | `.e2e/army/ci/2026-10-18T02-02-13-007Z-calc-v3`, manifeste `2a61715935bed2515dd5fa9740c51e739c449f2d021f5638d29ba4261832d1d3`, confidentialité `passed` |
| Qualité de PR | `npm run verify:pr` (WSL) | sortie 0 ; audit des dépendances (0 avis bloquant), 762 signatures vérifiées, budgets d'architecture (1 134 modules, 0 cycle), OpenAPI valide et synchronisée, `typecheck`, `lint` (`--max-warnings=0`), Vitest node 297 fichiers / 2 812 tests (1 fichier, 2 tests ignorés), jsdom 164 / 823, couverture critique 3 / 12 | journal non versionné du clone |

**`numeric entry v3` dans la campagne combinée** : parcours v2 du sous-lot 2.3, jamais sélectionné jusque-là avec
`bulk-edit-sync-sources`. Celui-ci bascule l'utilisateur ARMY partagé en mode Expert le temps de ses scénarios
(`withSharedState`, préférence enregistrée au profil, donc hors de la session restaurée) ; à deux workers,
`numeric entry v3`, qui suppose le mode Simplifié, a ouvert l'éditeur pendant cette fenêtre : l'écran à l'échec montre
les pastilles du mode Expert (« Marge : 0% », « TVA : 20% », « Remise »…) et le bouton des réglages du menu
d'affichage hors de la fenêtre. Seul, à la même révision, il passe. Course entre deux parcours v2 existants, sans lien
avec le code de 2.6 (barre d'outils, menu d'affichage et mode d'interface inchangés) ; rien n'a été modifié pour la
faire passer.

Valeurs assertées au vert (0 c de tolérance) : `V3E05` — unités « xyz » et « HL » refusées par leur nom, cellule
quittée, `unit_code` « u » ; suppression de C → 44 700 / 8 940 / 53 640 c ; annulation → C recréée (nouvel `id`, `u`,
`priced`, h/u 0, PU 1 300 c) et 46 000 / 9 200 / 55 200 c ; annulation d'un ajout → ligne supprimée ; section T et sa
ligne supprimées → 43 400 / 8 680 / 52 080 c. `V3E06` — majoration 150 % en lot → 48 200 / 9 640 / 57 840 c (PU de A
20 200 c, h MO 2) ; déplacement vers T ; suppression en lot → 1 300 / 260 / 1 560 c ; annulation → A et B recréées dans
T avec leurs saisies et la majoration 1,5. `V3E07` — taux 50 €/h → totaux stockés 56 000 / 11 200 / 67 200 c, fiche
« Total HT » 560,00 €. `V3E08` — P : 110,00 € / 25,00 € / 18,5 % ; « Hors lot » : 0,00 € / 0,00 € / - ; « Temps MO
manquant » levé avant, plus après la sauvegarde ni après rechargement. `V3E09` — offre « barre » désactivée,
« Unité différente du devis : … » ; article en ml associé : `unit_code` ml, `description` nulle, PR 1 240 c, totaux
3 224 / 645 / 3 869 c. `V3E10` — question ouverte par Ctrl+S (« Non » : version 1 000 pb, ligne 2 000 pb) et par
« Enregistrer » à la fermeture (« Oui » : version et ligne 550 pb, 13 000 / 715 / 13 715 c, tiroir fermé). `V3E11` —
0 % enregistré puis « À jour » ; arrondi stocké 2,50 € affiché « 2,50 € — palier inférieur (réglage actuel) » (options
`none`, `100`, `250`, `1000`, `5000`, `10000`), « Aucun » enregistré ; fiche : PDF et modèle désactivés, raison
affichée, « Dupliquer » actif. `V3E12` — K FO 1,3 sur B → 45 350 / 9 070 / 54 420 c, annulé → 43 400 / 8 680 /
52 080 c. `V3E13` — collage refusé par son nom, aucune ligne, révision inchangée. `V3E01` à `V3E04`, `V3P01`,
`V3FC01`, `V3FC02` : assertions inchangées, vertes (présélection v3 : recalcul persisté, 3 224 / 645 / 3 869 c).

Windows (Node 24.19.0), à `258daf9e`, diff local vide : `npm run typecheck` sortie 0 ; `npx eslint --max-warnings=0` sur
les 45 fichiers `.ts`/`.tsx` ajoutés ou modifiés par la branche, sortie 0 ; `npx vitest run --project=node` sur
`army-impact-map`, `ci-guardrails`, `v3-settings-payload` (`V3S-01` à `V3S-04`, assertions inchangées),
`supabase-migration-git-guard`, `upgrade-check` et `engine-frozen-corpus` : 6 fichiers, 41/41 ; garde Git des
migrations passée ; `git -c core.whitespace=cr-at-eol diff --check origin/main...HEAD` propre ;
`git diff --stat origin/main...HEAD -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts` (et depuis
`f1d94213`) vide. Sur Windows, `npm run verify:pr` s'est arrêté à `audit:signatures` (cache npm local illisible,
`ENOENT`, environnement) : la chaîne complète qui fait foi est celle du clone WSL ci-dessus.

### 11.6 Limites restantes (après la revue)

- **Éditeur mobile d'une ligne** (largeur téléphone) et **restauration d'un brouillon en conflit** : restent v2 sur une
  v3. Dans l'éditeur mobile, une heure totale est ignorée sans message (la charge v3 retire `h_mo`) et l'unité saisie
  s'écrit dans `description`, sans effet sur `unit_code` ; l'unité et les heures par unité se saisissent dans la
  grille.
- **Conversion et duplication de section** : « Convertir en section », « Convertir en ligne » (`PATCH /items`),
  « Dupliquer la section » et « Dupliquer vers un autre devis » (insertion directe, hors contrat d'écrivain de M4)
  sont refusés sur une v3 par le serveur, sans rien écrire ; le refus n'est pas nommé pour la v3 (avis « Conversion
  impossible » avec le message du moteur 3). Relevé à la revérification, hors des constats ; à fixer avec le
  contrat des modèles et des ouvrages (2.8) ou par un refus nommé.
- **Collage** : refusé sur une v3 tant que son contrat n'est pas fixé (unité du référentiel, heures par unité ou
  totales, statut).
- **Règles de suggestion qui proposent une unité** (`description`) : appliquées en lot sur une v3, elles l'écrivent dans
  `description`, sans effet sur `unit_code`.
- **Taux horaire d'un rôle** : seul le brouillon ouvert est recalculé ; un autre brouillon v3 du même propriétaire
  garde ses montants stockés jusqu'à sa prochaine écriture (contrat de 2.5 : chaque écrivain recalcule et vérifie).
- **Sous-détail de ligne** : « Marge € » d'une v3 est brute (avant la remise et l'arrondi commercial du pied), comme
  le dit l'aide de la colonne ; aucune marge nette par ligne.
- **F26-29** : « choisir “Aucun” ne déclenche pas d'événement » n'est pas discriminé par le parcours (`selectOption`
  déclenche toujours l'événement) ; tenu par construction.
- **F26-07, F26-27** : « rien n'est envoyé avant la réponse » est asserté par l'issue (version et lignes relues), pas
  par l'absence de requête pendant que la question est ouverte.
- Inchangés (§8.5) : pas de gestionnaire v3 des tranches de marge, liste des taux de TVA de l'entreprise non lue à la
  saisie, instabilité non reproduite de la liste des rôles.
- Migration `20261017205000` : à appliquer au Supabase partagé avant tout déploiement, sur autorisation explicite.
- `OF00` (phase `emission` de calc-v3, `next dev`) : rouge intermittent hérité de 2.9 (§10.3.1), vert au passage du §11.5.
- Course connue entre deux parcours v2 à deux workers (`bulk-edit-sync-sources`, qui bascule l'utilisateur ARMY partagé en
  mode Expert, et `numeric entry v3`, qui suppose le mode Simplifié) : §11.5 ; hors de 2.6.

### 11.7 Revue Codex de la PR #44 (18/10/2026, sur `b6a81dee`)

Deux constats d'un relecteur tiers, revérifiés dans le code puis rendus observables par un parcours rouge avant toute
correction. Les assertions existantes de `V3E07` et `V3E09` ne sont pas modifiées ; les deux parcours sont étendus.

| # | Constat | Revérification | Rouge (`350dd0ec`) | Correction |
|---|---|---|---|---|
| F1 (P1) | `useCatalogueSuggestions.ts:180` : sur une ligne v3 en ml, une suggestion de la désignation prix par le seul prix de référence de l'article, dans une autre unité (u), a `supplier_price_id` nul ; le contrôle d'unité est sauté, `unit_code` reste ml et le prix à la pièce est stocké comme prix au mètre | confirmé à la lecture : refus seulement `si selectedSupplierPriceId` ; la fiche « Associer ou remplacer l'article » juge déjà tout prix suggéré depuis `1c16ad40` (F26-26), pas la désignation | `V3E09` : suggestion non refusée ; ligne enregistrée avec l'article à la pièce, PR 800 c, offre nulle, totaux 2 080 / 416 / 2 496 c au lieu de 3 224 / 645 / 3 869 c | `0842ea4d` : sur une v3, tout prix suggéré (offre ou prix de référence) est jugé dans `unit_code` par `areSupplierUnitsCompatible` (normaliseur partagé `src/lib/units/normalize.ts`), même refus nommé que F26-26 : « Unité différente du devis : offre en u, ligne en ml. » ; rien d'autre n'est écrit |
| F2 (P2) | `[versionId]/page.tsx:202` : totaux d'en-tête d'une v3 toujours en euros, résumé dessous dans la devise de la version (USD, GBP) | confirmé à la lecture : `formatEUR` dans l'en-tête, `formatCurrency(…, currency)` dans `EstimateV3DraftSummary` | `V3E07` (brouillon passé en USD par l'API, montants inchangés) : en-tête « 560,00 € » / « 672,00 € », résumé « $560.00 » / « $672.00 » | `e589b37b` : l'en-tête est formaté avec la devise résolue (`normalizeEstimateCurrency(version.currency) ?? "EUR"`, celle du résumé) ; complété par `f6e5ae34` pour l'historique des versions de la même fiche (§11.7.1) |

Extensions des parcours (rouge `350dd0ec`) :

- `V3E09` : un troisième article du catalogue, « … tube cuivre piece », unité u, prix de référence 800 c, **sans offre**.
  La fiche le propose désactivé, refusé par son nom (preuve E2E du complément `1c16ad40` de F26-26, qui n'en avait pas ;
  déjà vert au rouge). Puis, sur la ligne en ml associée à l'article en ml, sa désignation est saisie dans la cellule
  et Entrée choisit la suggestion : attendus le refus nommé dans la liste, puis, après Tab et Ctrl+S, l'article en ml,
  son offre, le PR 1 240 c, `unit_code` ml, `description` nulle et les totaux 3 224 / 645 / 3 869 c ; seule la
  désignation saisie devient le titre, comme toute saisie de la cellule. Point de contrôle écran et API, avant et
  après rechargement.
- `V3E07` : après la lecture de la fiche en euros, `currency` passe à USD par `PATCH /api/estimates/{id}` (même contrat
  que `V3E11`) ; attendus en en-tête et dans le résumé « $560.00 » (HT) et « $672.00 » (TTC à payer).

v1/v2 (relevés à la revérification, non corrigés ; comportement v1/v2 inchangé par ces commits) :

- **F1** : le même défaut existe sur le même chemin (`applyCatalogueSuggestion`) pour une ligne v1/v2 dont `description`
  porte une unité : un prix de référence dans une autre unité y est appliqué (présent sur `main`, la correction R3 de
  2.2 ne visait que les offres). Non corrigé ici, car pas sûr : l'unité v1/v2 est le texte libre de `description`, qui
  peut encore porter une désignation écrite avant 2.2 ; étendre le refus y refuserait tout prix de référence (« ligne
  en <désignation> »), changement de comportement v1/v2 hors de cette PR et sans parcours v1/v2 qui le qualifie. À
  trancher pour les moteurs 1 et 2.
- **F2** : la fiche v1/v2 affiche en-tête et document en euros quelle que soit la devise (`formatEUR`, `EstimateDocument`
  sans `currency`), alors que son impression suit la devise de la version. Ce n'est pas l'écart en-tête / résumé de F2
  (la fiche v1/v2 est cohérente avec elle-même), le chemin est distinct et antérieur à 2.6 : non corrigé.

Preuves (WSL Ubuntu 24.04, Node 24.19.0, `e2e` 0.21.0 ; clone `~/miaouffrage-lot2-26` remis à la branche par
`git -c safe.directory='*' fetch` du dépôt Windows puis `git reset --hard FETCH_HEAD`, diff local vide, `diffSha256`
`e3b0c442…b855` ; un worker, `NODE_OPTIONS=--max-old-space-size=4096` ; une seule exécution native possédée à la fois) :

| Passage | Commande | Révision | Résultat | Archive (clone WSL) |
|---|---|---|---|---|
| Rouge | `E2E_ARMY_WORKERS=1 npm run e2e:army:local -- --grep "V3E07\|V3E09"` | `350dd0ec` | sortie 1 ; en amont pgTAP `Files=20, Tests=1854, Result: PASS`, « Behavioral RLS matrix passed. », build ; **2/2 rouges** pour la raison visée (valeurs du tableau ci-dessus) ; fiche de `V3E09` déjà verte pour l'article à la pièce | `.e2e/army/ci/2026-10-18T02-38-55-869Z-critical`, manifeste `d23939866b8d90db7cda2714d5b63380593e4747b0528afef7a9bee3622109da`, confidentialité `passed` |
| Vert | même commande | `e589b37b` | sortie 0 ; **2/2 verts** en une tentative (19,0 s) ; `V3E09` : « Unité différente du devis : offre en u, ligne en ml. » dans la liste, article en ml, son offre, PR 1 240 c, `unit_code` ml, `description` nulle, 3 224 / 645 / 3 869 c, relus après rechargement ; `V3E07` : « $560.00 » / « $672.00 » en en-tête et au résumé | `.e2e/army/ci/2026-10-18T02-42-19-279Z-critical`, manifeste `be7b05c8563dc6ebd750ee6b35bfff8c7f17a8157f001433921c55f4474b328f`, confidentialité `passed` |
| Parcours 2.6 | `E2E_ARMY_WORKERS=1 npm run e2e:army:local -- --grep "V3E\|V3P01\|V3FC"` | `e589b37b` | sortie 1 ; **16/17** : `V3E02` à `V3E13`, `V3P01`, `V3FC01`, `V3FC02` verts en une tentative ; **`V3E01` rouge** : rôle « Tuyauteur » de la ligne O2 perdu après sa saisie (liste vide à l'échec, PU 124,32 € sans main-d'œuvre, sauvegarde attendue jamais vue), signature de l'instabilité non reproduite du §8.5 ; la cellule du rôle et la fiche ne sont pas touchées par ces commits, et le locataire dédié du parcours n'a aucun article (aucune suggestion) | `.e2e/army/ci/2026-10-18T02-44-16-770Z-critical`, manifeste `f8f60ed1db077ab4a95c43d4c3af809c27dcaa9a0f750552cbb543ee7b3643e3`, confidentialité `passed` |
| `V3E01` seul | `E2E_ARMY_WORKERS=1 npm run e2e:army:local -- --grep "V3E01"` | `e589b37b` | sortie 0 ; 1/1 vert (61,6 s) ; rien modifié entre les deux passages | `.e2e/army/ci/2026-10-18T02-52-53-737Z-critical`, manifeste `e2637fab3107f06eb424db90f7630bde5b71abe6a06fc4e701b410e9803b4e31`, confidentialité `passed` |
| Suggestion v1/v2 inchangée | `E2E_ARMY_WORKERS=1 npm run e2e:army:calc-v3 -- --phase offers` | `e589b37b` | sortie 0 ; sources inchangées pendant la campagne ; **10/10** : `OZ01` à `OZ04` (dont le refus de la suggestion v2 d'une offre dans une autre unité, ligne en m2) et `PU01` à `PU05` | `.e2e/army/ci/2026-10-18T02-55-59-076Z-calc-v3`, manifeste `e2b26ba24181237d7ef6ff89da6dea3554a3824071632151c384d426f79a9e20`, confidentialité `passed` |

Windows (Node 24.19.0), arbre identique à `e589b37b` : `npm run typecheck` sortie 0 ; `npx eslint --max-warnings=0` sur
`useCatalogueSuggestions.ts`, `[versionId]/page.tsx` et `engine-v3-editor-actions.e2e.ts`, sortie 0 ; `npx vitest run
--project=jsdom` sur `EstimateEditorRow.catalogue`, `.behavior`, `.line-cells`, `EstimateEditorTable.integration` et
`CatalogueSuggestionsPopover` : 5 fichiers, 44/44 ; `npx vitest run --project=node src/test/army-impact-map.test.ts` :
10/10 ; `npm run check:architecture` : « Architecture budgets passed (1134 modules, 0 allowed runtime cycles). » ;
`git diff --check` propre ; `estimate-calculations.ts` et `estimate-v2-snapshot.ts` : aucun diff depuis `origin/main`.
Carte d'impact inchangée (les deux fichiers corrigés y mènent déjà aux parcours `engine-v3-*`).

Limites : le refus d'un prix de référence garde le libellé nommé de F26-26 (« offre en u »), comme la fiche ; le
chemin v1/v2 de la suggestion est inchangé par construction (la condition vaut l'ancienne quand la grille n'est pas
v3), prouvé par la phase `offers` ; `V3E01` a de nouveau perdu une fois le rôle saisi (§8.5), cause toujours non
établie, rien ajouté pour le faire passer ; commits non poussés.

#### 11.7.1 Revue de la correction Codex (18/10/2026, sur `b319cbfe`)

Deux constats d'une relecture des quatre commits ci-dessus, revérifiés dans le code puis, pour le défaut de
comportement, rendus observables par un parcours rouge avant la correction. Aucune assertion existante n'est
modifiée ; `V3E07` est étendu.

| # | Constat | Revérification | Rouge (`0256db8a`) | Correction |
|---|---|---|---|---|
| R1 (majeur) | F2 non fermé : sur la même fiche v3, la carte « Historique des versions » (`EstimateTimeline.tsx:211`, `:221`, `:227`) formate le HT, l'écart HT et le TTC de chaque version par `formatEUR` ; un brouillon v3 en USD y montre son entrée « Courante » en euros sous un en-tête et un résumé en dollars. La carte d'approbation (`EstimateApprovalSummaryCard.tsx:21-26`) fixe aussi EUR pour les motifs `total_ht_cents` | confirmé : la sélection de l'historique (`listEstimateProjectVersions`) ne lit pas `currency`, `EstimateProjectVersionTimelineItem` n'en a pas ; l'extension `V3E07` de `350dd0ec` ne lisait que l'en-tête et le résumé | `V3E07` : après le passage en USD, entrée « Courante » « 560,00 € », écart « +560,00 € », « 672,00 € » au lieu de « $560.00 », aucun écart, « $672.00 » (la lecture en euros avant le passage est verte) | `f6e5ae34` : l'historique lit la `currency` de chaque version ; la fiche v3 lui demande `inVersionCurrency` : chaque entrée dans sa devise résolue (`normalizeEstimateCurrency(…) ?? "EUR"`, comme l'en-tête), aucun écart HT entre deux versions voisines de devises différentes. Sans la propriété (fiche v1/v2), tout reste en euros et l'écart est calculé comme avant (`formatEUR` est `formatCurrency(…, "EUR")`) |
| R2 (mineur) | `350dd0ec` a supprimé par accident l'espace après l'identifiant de `V3E10` (« V3E10the … ») : un parcours hors périmètre renommé, une sélection bornée (`"V3E10 "`, `\bV3E10\b`) ne le prenait plus | confirmé par `git show 350dd0ec` ; seul titre touché (tous les autres gardent « V3Exx <texte> ») | — (titre, pas de comportement) | `a07ad21f` : titre d'origine rétabli, parcours inchangé ; sélectionné par `V3E10\b` au vert |

Extension de `V3E07` (rouge `0256db8a`) : la carte est lue deux fois, par entrée (HT, écart, TTC, `aria-current`).
En euros, avant le passage en USD : V2 (ce brouillon v3) « 560,00 € », écart « +560,00 € », « 672,00 € » ; V1 (l'ancre
v2 vide) « 0,00 € », sans écart — comportement existant, conservé. Après le passage en USD : V2 « $560.00 », aucun
écart, « $672.00 » ; V1 toujours « 0,00 € ».

Relevés, non corrigés (antérieurs à 2.6, communs à tous les moteurs) :

- **Carte d'approbation** : les seuils des règles d'approbation n'ont pas de devise. Le moteur de règles compare les
  centimes bruts du total HT à un seuil sans devise et écrit ses motifs en euros (`rules-engine.ts`, `formatEuroCents`),
  comme la carte (`APPROVAL_MONEY_FORMATTER`) et l'écart HT du résumé des changements
  (`estimate-approval/shared.tsx`, `formatCurrencyDelta`). Afficher le seuil en dollars affirmerait une règle en
  dollars qui n'existe pas ; afficher seulement le total en dollars rendrait la comparaison illisible. À trancher dans
  le domaine des approbations (une devise sur les règles, ou le refus d'une règle dans une autre devise).
- **Hub de l'affaire** : `VersionTimelineCard` et le résumé financier (`AffaireHubSections.tsx:96`, `:105`, `:283`)
  formatent en euros toutes les versions ; page distincte de la fiche, hors F2.

Preuves (WSL Ubuntu 24.04, Node 24.14.0 (nvm, Node 24 de `.nvmrc`), `e2e` 0.21.0 ; clone `~/miaouffrage-lot2-26`
remis à la branche par `git -c safe.directory='*' fetch` du dépôt Windows puis `git reset --hard FETCH_HEAD`, diff
local vide, `diffSha256` `e3b0c442…b855` ; un worker, `NODE_OPTIONS=--max-old-space-size=4096` ; une seule exécution
native possédée à la fois) :

| Passage | Commande | Révision | Résultat | Archive (clone WSL) |
|---|---|---|---|---|
| Rouge | `E2E_ARMY_WORKERS=1 npm run e2e:army:local -- --grep "V3E07"` | `0256db8a` | sortie 1 ; en amont pgTAP `Files=20, Tests=1854, Result: PASS`, « Behavioral RLS matrix passed. », build ; **1/1 rouge** pour la raison visée : entrée « Courante » `{"ht":"560,00 €","delta":"+560,00 €","ttc":"672,00 €"}` au lieu de `{"ht":"$560.00","delta":null,"ttc":"$672.00"}` ; lecture en euros, en-tête et résumé en dollars verts | `.e2e/army/ci/2026-10-18T03-19-12-669Z-critical`, manifeste `02b5eed72a36f93146bd8bb0d1feeebf5479d67f78a1c68f31e906f14d99f9de`, confidentialité `passed` |
| Vert | `E2E_ARMY_WORKERS=1 npm run e2e:army:local -- --grep "V3E07\|V3E10\b"` | `f6e5ae34` | sortie 0 ; pgTAP 1854 PASS, matrice RLS, build ; **2/2 verts** en une tentative (15,1 s) : `V3E07` (historique « $560.00 », aucun écart, « $672.00 », ancre « 0,00 € » ; en euros « +560,00 € ») et `V3E10` sélectionné par son titre rétabli | `.e2e/army/ci/2026-10-18T03-22-43-889Z-critical`, manifeste `6343216385f182130a6afea564323b5deb4adfc39b770085d5a714678f6ed87b`, confidentialité `passed` |
| Parcours 2.6 et hub | `E2E_ARMY_WORKERS=1 npm run e2e:army:local -- --grep "V3E\|V3P01\|V3FC\|HUB0[345]"` | `f6e5ae34` | sortie 0 ; pgTAP 1854 PASS, matrice RLS, build ; **20/20 verts**, chacun en une tentative (5 min 21 s) : `V3E01` à `V3E13`, `V3P01`, `V3FC01` (fiche v3, sélection de l'historique avec `currency`), `V3FC02`, et `HUB03` à `HUB05` (hub de l'affaire, même `listEstimateProjectVersions` sur des versions v2), plus la mise en place d'authentification ; `V3E01` vert cette fois (§8.5 inchangé) | `.e2e/army/ci/2026-10-18T03-25-41-793Z-critical`, manifeste `998dcba561acc2467343628371df5dec126342305cbe276ad8e458d23bd71b42`, confidentialité `passed` |

Windows (Node 24.19.0), arbre identique à `f6e5ae34` hors ce document : `npm run typecheck` sortie 0 ; `npx eslint
--max-warnings=0` sur `EstimateTimeline.tsx`, `[versionId]/page.tsx`, `src/lib/estimates/server.ts` et
`engine-v3-editor-actions.e2e.ts`, sortie 0 ; `npx vitest run --project=node` sur `src/lib/estimates/server.test.ts`,
`server.coverage.test.ts`, `src/lib/affaires/server.test.ts` (qui simule `listEstimateProjectVersions`) et
`src/test/army-impact-map.test.ts` : 4 fichiers, 133/133 ; `npx vitest run --project=jsdom` sur les cinq fichiers de
§11.7 : 44/44 ; `npm run check:architecture` : « Architecture budgets passed (1134 modules, 0 allowed runtime
cycles). » ; `git -c core.whitespace=cr-at-eol diff --check origin/main...HEAD` propre ; `estimate-calculations.ts` et
`estimate-v2-snapshot.ts` : aucun diff depuis `origin/main`. Carte d'impact : `src/lib/estimates/server.ts`, chargé par
le noyau partagé, envoie la PR à la suite complète, comme elle l'était déjà (`army-impact-map.json` modifié par la
branche). `origin/main` inchangé (`89627add`) : aucune fusion ; la PR #41 n'est pas fusionnée, les parcours
`bulk-edit-sync-sources` et `numeric-entry` n'ont pas été rejoués.

Limites : la fiche v1/v2 n'est couverte par aucun parcours qui lit son historique ; elle est inchangée par
construction (propriété absente, mêmes appels de formatage) ; commits non poussés.
