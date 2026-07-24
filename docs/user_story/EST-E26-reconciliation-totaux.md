# EST-E26 — Réconciliation des totaux (source unique de vérité)

> **Statut** : phases A, B et C livrées ; phase D commencée (étape 12).
> Reprendre à l'**étape 13**. Voir le tableau d'avancement ci-dessous.
> **Origine** : audit multi-agents du moteur de totaux (inventaire vérifié
> en adversarial — 40 divergences confirmées sur 6 surfaces).
> **Sévérité** : c'était la friction UX n°1 de l'audit — « le chiffre affiché
> n'est jamais celui qu'on recalcule ».

## État d'avancement

> **Mis à jour le 2026-07-24 au soir.** La version précédente de cette section
> s'arrêtait à la Phase A et affirmait deux choses devenues fausses (voir plus
> bas). Les phases **A, B et C sont désormais livrées**, ainsi que les étapes
> **11 et 12** de la phase D.
>
> ⚠️ **Les numéros de ligne cités dans tout ce document datent d'avant le
> refactor** (`estimate-calculations.ts` a pris +600 lignes, `server.ts` +700).
> **Se fier aux noms de symboles, pas aux numéros de ligne** — ils sont
> systématiquement décalés et ne seront pas re-numérotés, ils re-pourriraient au
> commit suivant.

| Phase | État | Détail |
|---|---|---|
| **A** — filet de sécurité | ✅ livrée | golden (`0574539`), colonne `calc_engine_version` (`c70267e`), `calc-context.ts` (`7362338`) |
| **B** — durcissement du contrat | ✅ livrée | étapes 4 (`6853d6f`), 5 (`ee5b242`), 6 (`c898976`) |
| **C** — moteur unifié | ✅ livrée | étapes 7 (`b99e5b8`), 8 (`8092b29`), 9 (`966db09` + `computeReadOnlyTotals` gaté ensuite), 10 (`3c529ee`), 11 (`fe5b4cb`) |
| **D** — surfaces de rendu | 🟡 commencée | étape 12 livrée (`af3091a`) ; **reprendre à l'étape 13** |
| **E** — exports | ⬜ à faire | étapes 17 à 20 |
| **F** — persistance et bascule | ⬜ à faire | étapes 21 à 23 — **c'est ici que le gate est enfin branché** |

**Deux affirmations de la version précédente étaient fausses ou périmées :**

- « La divergence `bankersRound` vs `Math.round` (§2.5) n'est PAS encore figée »
  → **elle l'est** depuis `f4b977b` (Fixture I du golden). En revanche
  l'unification elle-même reste à faire : **11 `Math.round` subsistent** dans
  `estimate-calculations.ts`.
- « `calc-context.ts` … le rebranchement des 5 appelants est destructif → phase
  B » → le rebranchement **n'a pas eu lieu** en phase B. `loadEstimateCalcContext`
  n'a toujours **aucun importeur** : c'est du code mort protégé par 480 lignes de
  tests verts, à brancher (phase F) ou à supprimer.

**Point de vigilance sur le gate.** Le garde-fou `calc_engine_version` existe et
`resolveCalcEngineVersion` est fail-safe, mais **la colonne n'est lue nulle part
en production** : chaque surface épingle une constante. Elles sont regroupées
dans `src/lib/estimates/calc-engine-version.ts` (`EDITOR_CALC_ENGINE_VERSION`,
`EXPORT_CALC_ENGINE_VERSION`) et `prepare-estimate-document-data.ts`
(`DOCUMENT_CALC_ENGINE_VERSION`) — `grep "CALC_ENGINE_VERSION: CalcEngineVersion"`
donne la liste exhaustive à basculer à l'étape 23.

⚠️ **Corollaire non résolu** : les changements de montants des étapes 4 à 6
(détection du split MO, barème du tenant, remise stockée des exports) ne sont
**pas** conditionnés par `calcEngineVersion`. Ils s'appliquent donc **déjà** aux
devis envoyés et acceptés, ce que la contrainte ci-dessous interdit. Arbitrage à
rendre avant la bascule : les remettre derrière le gate, ou assumer.

**Reste de l'état d'avancement Phase A :**

  - `0574539` — golden tests figeant le comportement ACTUEL du moteur
    (`src/lib/estimate-calculations.golden.test.ts`). ⚠️ **2 surfaces
    sur 6 sont réellement couvertes en pur** (moteur + document via
    `prepareEstimateDocumentData`) ; les 4 autres (éditeur, pages RSC, XLSX,
    PDF) ne sont pas testables sans mocks contaminants et portent un bloc
    `COUVERTURE PARTIELLE`.
  - `c70267e` — colonne `estimate_versions.calc_engine_version` via le patron
    `add column if not exists ... not null default 1` (PG11+ : remplissage par
    le catalogue, sans réécriture ni UPDATE, donc aucun trigger de ligne, et
    `updated_at` / journal d'audit des versions scellées intacts).
    `guard_estimate_versions_readonly` **non étendu** (changement de
    comportement → phase C).
  - `7362338` — `src/lib/estimates/calc-context.ts` : `loadEstimateCalcContext`,
    volontairement sans import entrant (mort-né). ~~Rebranchement en phase B.~~
    **Il n'a pas eu lieu** : le module est toujours sans importeur (cf. encadré
    ci-dessus). Le rebranchement des 5 appelants relève de la phase F.

## ⚠️ Contrainte de déploiement BLOQUANTE

Unifier le moteur change **rétroactivement** les totaux des devis déjà
envoyés / acceptés / scellés. Rien ne se déploie sans la bascule progressive
pilotée par `calc_engine_version` : brouillons → nouvelles versions → opt-in
des `sent` non signées, **jamais** les `accepted` ni les versions scellées.

## Bug de données découvert en chemin (indépendant, à traiter à part)

`useEstimateEditorState.impl.tsx` persiste `global_coefficient = 1`
et `discount_steps = []` hors mode cascade, alors que le `total_ht_cents`
écrit juste après provient d'un snapshot calculé AVEC le coefficient : la
version stockée est auto-contradictoire.

> **Vérifié le 2026-07-24 : toujours présent, et sur DEUX sites, pas un.** Le
> motif `global_coefficient: discountMode === "cascade" ? globalCoefficient : 1`
> apparaît à la fois dans le payload persisté (`saveEstimateVersion`, avec
> `total_ht_cents: totalsSnapshot.saleTotalCents` trois lignes plus bas) **et**
> dans `nextSavedSettings`, qui réinjecte la même valeur dans l'état local — donc
> l'écran retombe sur le total sans coefficient sans même recharger.
> Les lignes `1309-1316` citées à l'origine sont désormais aux alentours de
> `1347` et `1406` : chercher le motif, pas le numéro. Corrigé par l'**étape 16**.

---

# Plan d'unification du moteur de totaux — devis

## 1. Diagnostic (cause structurelle)

1. **Deux moteurs concurrents** : `computeEstimateTotals` (pied, seul endroit où le coefficient global existe, `estimate-calculations.ts:364-370`) et `computeAllSectionTotals` → `computeEstimateLineSaleSplit` (sections + lignes, `estimate-calculations.ts:836/687`), dont le type d'entrée `ComputeAllSectionTotalsInput` (l.505-515) **ne peut pas** recevoir `globalCoefficient`, `marginMode`, `marginTiers`, `roundingMode`.
2. **Grandeurs de version appliquées à un seul niveau** : coefficient et remise sont calculés sur la somme, jamais redescendus aux lignes ; la remise est ensuite ré-allouée aux sections avec un dénominateur **avant** coefficient et un numérateur **après** (l.588-597) — allocation surestimée d'un facteur = coefficient.
3. **Paramètres optionnels = valeurs par défaut divergentes** : `isLaborSplitEnabled?` (3 sémantiques : `?? hasSplitPayload` l.197, `&& hasActiveLaborSplitPayload` l.738, `= false` l.836/1183) et `marginTiers?` (barème par défaut codé en dur l.315) rendent chaque appelant libre de produire un chiffre différent.
4. **Mélange stocké / recalculé** : le pied lit `version.total_ht_cents`, les lignes lisent `line_total_ht_cents` (brut de remise/coefficient), les sections recalculent — trois millésimes de données dans un même tableau (`prepare-estimate-document-data.ts:258/280`).
5. **Duplication au lieu de factorisation** : le même algorithme double-appel est copié dans 4 fichiers (`page.tsx:244/260`, `print/page.tsx:192/208`, `portal/page.tsx:154/174`, `pdf-generator.tsx:1708/1727`) et `resolveStoredDiscountCents` (`export-stream.ts:156`) est un fork de `computeStoredDiscountCents`.

---

## 2. Cible : une fonction d'autorité, un contrat obligatoire

### 2.1 Fonction unique

Créer `computeEstimateBreakdown` dans `src/lib/estimate-calculations.ts`. **Toutes** les surfaces (éditeur, document, PDF, portail, exports, persistance serveur) en dérivent. `computeEstimateTotals`, `computeAllSectionTotals`, `computeSectionTotals`, `computeReadOnlyTotals` deviennent des **wrappers minces** (`breakdown.totals`, `breakdown.sectionTotalsById`) puis sont dépréciés.

```ts
export type EstimateComputationInput = {
  items: EstimateItemRecord[];
  // --- grandeurs de VERSION : TOUTES OBLIGATOIRES, plus aucun `?` ---
  marginMultiplier: number;
  marginMode: MarginMode;
  marginTiers: MarginTier[];          // plus de getMarginTiers() implicite
  globalCoefficient: number;          // entre enfin dans les sections/lignes
  discountMode: DiscountMode;
  discountCents: number;
  discountStepsBp: number[];
  taxRateBp: number;                  // fallback ligne uniquement
  roundingMode: RoundingMode;
  roundingStepCents: number;
  // --- contexte tenant : OBLIGATOIRE ---
  isLaborSplitEnabled: boolean;       // plus de `?`, plus de `?? hasSplitPayload`
  laborRateById: Map<string, number>;
  laborRateAtelierById: Map<string, number>;
  laborRateChantierById: Map<string, number>;
};

export type EstimateBreakdown = {
  totals: EstimateTotals;                                  // le pied
  lineById: Map<string, EstimateLineBreakdown>;            // par ligne
  sectionById: Map<string, SectionTotals>;                 // par section (récursif)
  rootLineIds: string[];                                   // lignes hors section
  invariants: { sumAllocatedHtCents: number; matchesFooter: boolean };
};

export type EstimateLineBreakdown = {
  costLineCents: number;
  saleGrossCents: number;      // avant coefficient, avant remise
  coefficientShareCents: number;
  discountShareCents: number;
  saleNetHtCents: number;      // Σ saleNetHtCents === totals.saleTotalCents (exact)
  foNetCents: number; moNetCents: number;
  moAtelierNetCents: number; moChantierNetCents: number;
  puNetHtCents: number;        // saleNetHtCents / quantity
  taxCents: number;
};
```

### 2.2 Ordre canonique unique (une seule passe descendante)

```
1. coût ligne                       (Math.round après somme FO+MO — inchangé)
2. Σ coûts → résolution du palier   (marginMode/marginTiers OBLIGATOIRES)
3. vente brute ligne                = round(coût × margeAppliquée)
4. Σ ventes brutes                  = saleSubtotalBeforeCoefficientCents
5. × coefficient global             = bankersRound(Σ × coef)  ← inchangé, arrondi UNIQUE
6. remise (simple / steps[0] / cascade) sur la base POST-coefficient  ← inchangé
7. ALLOCATION DESCENDANTE (nouveau) : coefficient puis remise redescendus
   sur chaque ligne par « plus grand reste », puis sections = Σ de leurs lignes
8. TVA par ligne (item.tax_rate_bp ?? version.tax_rate_bp) sur saleNetHtCents
9. arrondi TTC → roundingAdjustmentCents exposé
```

### 2.3 Brique nouvelle : allocation exacte

```ts
/** Répartit `amount` sur `weights` en garantissant Σ parts === amount (plus grand reste). */
export function allocateProRata(amount: number, weights: number[]): number[];
```
C'est la clause qui rend l'invariant `Σ lignes = Σ sections = pied` **vrai au centime**, là où les `Math.round` indépendants de `convertSectionSubtotalToTotals` (l.593, 610, 626, 663) dérivent.

### 2.4 Invariant contractuel

`computeEstimateBreakdown` termine par :
```ts
const sum = Σ line.saleNetHtCents;
if (sum !== totals.saleTotalCents) { /* dev/test: throw ; prod: log + rebase du reliquat sur la plus grosse ligne */ }
```

### 2.5 Convention d'arrondi

`bankersRound` **partout** (coût ligne, vente ligne, PU, coefficient, remise, TVA, allocations). `Math.round` supprimé de `estimate-calculations.ts:209/213/593/610/626/663` et de `computeTaxCents` (`money.ts:109`). ⚠️ visible : ±1 c sur les cas médians.

### 2.6 Versionnement du moteur (obligatoire avant tout déploiement)

Ajouter `estimate_versions.calc_engine_version smallint not null default 1`. Le breakdown lit ce champ : `1` = comportement actuel figé, `2` = comportement unifié. Backfill : toutes les lignes existantes → `1`. Les nouvelles versions et les brouillons opt-in → `2`. Sans ça, l'étape 5 change rétroactivement des devis envoyés/acceptés.

---

## 3. Étapes ordonnées

> 🔴 = change un comportement visible utilisateur. 🟢 = refactor à iso-comportement.

### Phase A — Filet de sécurité (aucun changement fonctionnel)

**1. ✅ LIVRÉE (0574539) — 🟢 Tests de caractérisation (golden)** — nouveau `src/lib/estimate-calculations.golden.test.ts`.
Figer les sorties ACTUELLES des 6 surfaces pour 8 devis fixtures (coef 1 / 1,10 ; remise simple / cascade / steps résiduels ; marge fixe / paliers ; split on / off / payload résiduel ; ligne racine ; multi-TVA). Chaque golden enregistre `{pied, Σsections, Σlignes, PDF, XLSX}` — y compris les valeurs FAUSSES. Sans ce filet, aucune étape suivante n'est évaluable.

**2. ✅ LIVRÉE (c70267e) — 🟢 Migration `calc_engine_version`** — nouveau `supabase/migrations/*_estimate_calc_engine_version.sql` + `src/types/database.ts`.
`alter table estimate_versions add column calc_engine_version smallint not null default 1;` Backfill explicite à 1. Nouveau helper `resolveCalcEngineVersion(version)`.

**3. ✅ LIVRÉE (7362338 — ⚠️ toujours SANS importeur) — 🟢 Contexte de calcul unique côté serveur** — nouveau `src/lib/estimates/calc-context.ts`.
`loadEstimateCalcContext(supabase, versionId)` → `{ version, items, marginTiers (tenant), isLaborSplitEnabled (EST_031_LABOR_SPLIT), laborRateById, laborRateAtelierById, laborRateChantierById, calcEngineVersion }`. Un seul endroit qui lit le flag tenant et le barème, remplaçant `page.tsx:189`, `print/page.tsx:145`, `portal/page.tsx:106`, `server.ts:2988`, `pdf-generator.tsx:1689`.

### Phase B — Durcissement du contrat (le compilateur devient l'auditeur)

**4. ✅ LIVRÉE (6853d6f) — 🔴 Unifier la détection du payload split.**
- Supprimer `isLaborSplitEnabled(item)` local dans `export-stream.ts:136`, `dpgf-export.ts:206`, `bdc-export.ts:155` (les trois testent `h_mo_atelier !== null`, la canonique `> 0` — divergence documentée : ligne à 1 300,00 € rendue à 0,00 €).
- Seule survivante : `hasActiveLaborSplitPayload` (`estimate-calculations.ts:117`).
- Effet visible : les lignes à `h_mo_atelier = 0` persisté (cf. `editor-items.ts:89`) repassent en branche legacy dans les exports.

**5. ✅ LIVRÉE (ee5b242) — 🔴 Rendre `isLaborSplitEnabled` obligatoire et non ambigu.**
- `estimate-calculations.ts:197` : supprimer `isLaborSplitEnabled ?? hasSplitPayload` → `isLaborSplitEnabled && hasActiveLaborSplitPayload(item)` (aligné sur l.738). Le type passe de `boolean | undefined` à `boolean` requis dans `computeEstimateLineValues`, `computeEstimateTotals` (l.300), `computeAllSectionTotals` (l.842), `computeReadOnlyTotals` (l.1183), `normalizeDraftItems` (l.1144).
- `tsc` liste alors les 12 appelants fautifs. Les corriger en injectant la valeur du contexte (étape 3) :
  `page.tsx:244/260`, `print/page.tsx:192/208`, `portal/page.tsx:154/174`, `pdf-generator.tsx:1708/1727/1753`, `server.ts:3011`, `server.ts:6191`, `export-stream.ts:393`, `useEstimateEditorState.impl.tsx:290`.
- `useEstimateEditorState.impl.tsx:290` : supprimer `const isLaborSplitEnabled = false;` → `useFeatureFlag("EST_031_LABOR_SPLIT")`.
- `pdf-generator.tsx:1753` : supprimer `isLaborSplitEnabled: false` en dur.
- Effet visible majeur (cas documenté : 2 640,00 € manquants à l'écran, 612,00 € d'écart PDF/écran par ligne).

**6. ✅ LIVRÉE (c898976 — ⚠️ le repli par défaut subsiste dans resolveMarginMultiplier) — 🔴 Rendre `marginTiers` et `marginMode` obligatoires.**
- `estimate-calculations.ts:315` : supprimer `marginTiers ?? getMarginTiers()`. `getMarginTiers()` reste exporté uniquement comme *seed* de configuration tenant, plus comme fallback silencieux.
- Injecter les paliers du tenant dans les 8 appels qui les omettent (`page.tsx:244/260`, `print/page.tsx:192/208`, `portal/page.tsx:154/174`, `pdf-generator.tsx:1708/1727`).
- Effet visible : cas documenté 1,6 → 1,35, soit −15 000,00 € sur un devis à 80 000,00 €, mais **cohérent** avec la persistance.

### Phase C — Le moteur unifié

**7. ✅ LIVRÉE (b99e5b8) — 🟢 `allocateProRata`** — `estimate-calculations.ts`, nouvelle fonction + tests unitaires purs (invariant Σ = amount sur 10 000 tirages aléatoires).

**8. ✅ LIVRÉE (8092b29) — 🔴 `computeEstimateBreakdown`** — `estimate-calculations.ts`, nouvelle fonction en dessous de `computeEstimateTotals`.
Réutilise la passe 1/passe 2 existante (l.327-363), puis :
- coefficient sur la somme (l.364-370, inchangé) ;
- `coefficientShares = allocateProRata(saleSubtotalCents, ventesBrutes)` ;
- remise (l.372-407, inchangée) puis `discountShares = allocateProRata(safeDiscount, coefficientShares)` ;
- `saleNetHtCents = coefficientShare − discountShare` ;
- FO/MO par ligne rebasés **sur `saleNetHtCents`** via `computeEstimateLineSaleSplit` puis prorata (unifie le rebasage aujourd'hui présent seulement dans `prepare-estimate-document-data.ts:283`) ;
- sections = agrégation récursive des lignes filles ; `rootLineIds` collectés séparément ;
- TVA : `Σ computeTaxCents(saleNetHtCents, item.tax_rate_bp ?? taxRateBp)` — supprime la double branche `coefficient === 1 ? ... : ...` de l.410 (cas documenté : 400,00 € vs 300,00 € de TVA entre pied et export).
- **Gate `calcEngineVersion`** : si `1`, la fonction délègue à l'ancien chemin et marque `invariants.matchesFooter = false`.

**9. ✅ LIVRÉE (966db09 puis computeReadOnlyTotals gaté) — 🟢 `computeAllSectionTotals` / `computeSectionTotals` / `computeReadOnlyTotals` deviennent des wrappers** — `estimate-calculations.ts:803/836/1180`.
`ComputeAllSectionTotalsInput` (l.505-515) gagne `globalCoefficient`, `marginMode`, `marginTiers`, `discountMode`, `discountStepsBp` **obligatoires** ; `convertSectionSubtotalToTotals` (l.577-685) et le dénominateur pré-coefficient (l.881-892) sont **supprimés** au profit de l'agrégation du breakdown. `computeReadOnlyTotals` cesse de renvoyer les colonnes figées quand `calcEngineVersion = 2`.

**10. ✅ LIVRÉE (3c529ee) — 🟢 Supprimer le doublon de remise** — `export-stream.ts:156-171` (`resolveStoredDiscountCents`) supprimé, remplacé par `computeStoredDiscountCents` (`estimate-calculations.ts:1072`). Un seul usage à migrer (l.391).

**11. ✅ LIVRÉE (fe5b4cb — sémantique d'affichage volontairement divergente, lire le commit) — 🟢 Supprimer le contournement affaires** — `src/lib/affaires/server.ts:2324` : `marginMultiplier: marginMultiplier * globalCoefficient` → `computeEstimateBreakdown({ marginMultiplier, globalCoefficient })`. Corrige l'écart d'arrondi (~4,00 € / 400 lignes). ⚠️ **La bascule 65 % → 50 % annoncée ici n'a PAS été retenue** : `global_coefficient` est un vrai markup payé par le client, donc « Vente HT » reste nette (= total du devis) et la marge reste la marge nette réelle. Coefficient et remise sont désormais exposés et affichés à part, pour cesser d'être lus comme de la marge. Voir le message de `fe5b4cb`.

### Phase D — Les surfaces de rendu

**12. ✅ LIVRÉE (af3091a) — 🔴 Document partagé** — `src/components/estimate-document/prepare-estimate-document-data.ts`.
- l.31-43 : `PrepareEstimateDocumentDataInput` reçoit `breakdown: EstimateBreakdown` au lieu de `marginMultiplier`/`discountCents`/`isLaborSplitEnabled`.
- l.258 : supprimer l'appel `computeAllSectionTotals` → `breakdown.sectionById`.
- l.272-296 : supprimer `computeEstimateLineSaleSplit` + le rebasage `storedTotal` → `breakdown.lineById`. Les lignes deviennent **nettes** de remise et de coefficient : le tableau s'additionne.
- l.174 : les `rootLineIds` sont désormais agrégés dans une pseudo-section « Hors chapitre » ou exclus explicitement du prorata (choix produit à trancher — aujourd'hui ils diluent le prorata sans jamais être sous-totalisés).

**13. 🔴 Pied du document dérivé, pas injecté** — `src/components/EstimateDocument.tsx:26-53`, `41-43`, `413/422/431`.
Remplacer les props `totalHtCents/totalTaxCents/totalTtcCents` par `breakdown`. Ajouter dans le tableau les lignes manquantes, sous les sous-totaux :
`Sous-total HT (avant coefficient)` / `Coefficient global ×N` / `Remise −X` / `Total HT`. C'est ce qui rend le document auditable (aujourd'hui la remise n'existe que dans l'encart `EstimateDocument.tsx:340-347`).

**14. 🟢 Dédupliquer les 3 pages serveur + le PDF.**
Supprimer les doubles appels `computeEstimateTotals` de `page.tsx:244/260`, `print/page.tsx:192/208`, `portal/page.tsx:154/174`, `pdf-generator.tsx:1708/1727` → un seul `buildEstimateRenderModel(ctx)` dans `calc-context.ts`. Supprimer le code mort `Number.isFinite(version.total_ht_cents ?? NaN) ? ... : computedTotals.*` (`page.tsx:274`, `print/page.tsx:222`, `portal/page.tsx:190`) : la colonne est non nullable (`database.ts:1029`).
En prime, corriger les écarts de props entre les 3 pages : `page.tsx:149` ajouter `currency` au SELECT et `page.tsx:389` remplacer `formatEUR` par `formatCurrency` 🔴 ; passer `layout`/`terms` au portail comme en impression 🔴 (le preset `decision_summary` est aujourd'hui ignoré côté client).

**15. 🔴 Éditeur.**
- `useEstimateEditorState.impl.tsx:1092` → `computeEstimateBreakdown`, exposé dans le state.
- `impl.tsx:719/2321` : `discountCents: settings.discount_cents` (valeur figée) → `breakdown.totals.discountCents`.
- `EstimateEditorTable.tsx:1981-1995` : supprimer `grandTotals` maison ; le pied lit `breakdown.totals` (inclut donc les lignes racine aujourd'hui exclues par le filtre `item_type !== "section"` l.1987).
- `useEstimateVisibility.ts:174` : les sous-totaux lisent `breakdown.sectionById` ; le filtrage `quickFilteredItems` (`EstimateEditorTable.tsx:850-874`) ne doit **plus** alimenter le calcul — filtrer l'affichage, pas l'assiette. Ajouter un libellé distinct « Total filtré » si l'on veut conserver l'information.
- Supprimer l'usage de `totalsOutOfSync` comme faux indicateur de cohérence (`impl.tsx:328`, `EstimateEditorAlerts.tsx:174-193`) — il reste le drapeau d'échec de persistance, mais on ajoute `breakdown.invariants.matchesFooter` comme vrai détecteur.

**16. 🔴 Sauvegarde cohérente** — `useEstimateEditorState.impl.tsx` (deux sites : le payload persisté ET `nextSavedSettings` ; chercher le motif, pas le numéro de ligne).
- Supprimer `global_coefficient: discountMode === "cascade" ? globalCoefficient : 1`. Le coefficient est une grandeur **indépendante** du mode de remise ; il est persisté tel qu'affiché. (Aujourd'hui : total persisté 115 000,00 € avec un coefficient persisté 1 → l'écran retombe à 100 000,00 € seul.)
- Symétriquement, `estimate-calculations.ts:382` : en mode `simple`, **vider** `discount_steps` à la bascule côté UI plutôt que laisser `steps[0]` écraser silencieusement le montant en euros saisi (écart documenté 280,00 € sans indicateur).

### Phase E — Exports

**17. 🔴 XLSX** — `src/lib/estimates/export-stream.ts`.
- l.199-235 : `buildLineRows` dérive de `breakdown.lineById` (donc coefficient + remise inclus, taux horaires cohérents avec le total) au lieu de recalculer via `computeEstimateLineValues` avec les taux **courants** de `labor_roles` (écart documenté 650,00 € après changement de taux).
- l.355-365 : la feuille « Resume » gagne `Sous-total lignes HT`, `Coefficient global`, `Remise`, `Total HT après remise`. La ligne `Parametres` (l.362) cesse d'être la seule trace de la remise.
- l.391-398 : `computeReadOnlyTotals` → `breakdown`.

**18. 🔴 BDC** — `src/lib/estimates/bdc-export.ts`.
- l.484-510 : renommer la colonne « Total HT EUR » en **« Coût de revient HT EUR »** (elle n'a jamais contenu un prix de vente) ; `moTotalCents` déduit par soustraction (l.484) → `breakdown.lineById[id].moNetCents`.
- l.325-333 / 631-639 : ajouter la colonne `Majoration MO` et corriger les notes « Formule indicative » (écarts documentés 75,00 € et 9,60 € par ligne), ou les supprimer.

**19. 🔴 DPGF** — `src/lib/estimates/dpgf-export.ts`.
- l.335 : renommer « Prix unitaire HT EUR » en **« PU d'achat FO HT EUR »** (c'est `unit_price_ht_cents`, un prix d'achat, homonyme du PU de vente de l'XLSX).
- l.428-439 : ajouter au bloc Metadata `Coefficient global`, `Remise`, `Total HT` — sinon un ré-import perd 30 000,00 € sur un devis à 230 000,00 € sans trace.

**20. 🟢 Export éditeur** — `src/lib/estimates/editor-export.ts:27-46/131-167/407-410`.
Ajouter `global_coefficient` et `discount_steps_bp` à `EstimateRecapExportRow` ; cesser de reconstruire `discount_bp` par division (l.143), qui ne restitue pas les paliers en cascade.

### Phase F — Persistance et déploiement

**21. 🔴 Recalcul serveur autoritaire** — `src/lib/estimates/server.ts:3011-3061` → `computeEstimateBreakdown(ctx)`.
`server.ts:6191-6199` (`normalizeDraftItems` avec `discount_bp: 0`) : conserver `line_total_ht_cents` comme **valeur brute avant coefficient/remise** (le commentaire est juste), mais **ajouter** `line_net_ht_cents` persisté depuis le breakdown, pour que les surfaces qui lisent le stocké (PDF, export éditeur) soient réconciliables sans recalcul.

**22. 🟢 Invalidation du cache PDF** — `pdf-generator.tsx:1600`.
Intégrer `calc_engine_version` à la clé de cache : sans ça, un devis migré resservira un PDF calculé par le moteur v1.

**23. 🔴 Bascule contrôlée**. Feature flag `EST_0xx_UNIFIED_TOTALS`. Ordre : brouillons uniquement → nouvelles versions → migration opt-in des versions `sent` non signées, jamais des versions `accepted`/scellées.

---

## 4. Risques de régression

| Risque | Détail | Parade |
|---|---|---|
| **Sceau / valeur contractuelle** | Un devis `sent`/`accepted` dont le total change après déploiement est une modification de document contractuel. Les étapes 5, 6, 8 changent `total_ht_cents` de plusieurs % (jusqu'à +23 % sur le cas marginTiers). | `calc_engine_version` (étape 2) figé à `1` pour tout ce qui n'est pas `draft`. Aucun recalcul serveur ne doit écrire sur une version scellée : ajouter un garde-fou dans `server.ts:3050` et un test dans `workflow-write-security-regressions.test.ts`. |
| **PDF déjà générés** | Un PDF stocké porte 115 000,00 € alors que la base repassera à 100 000,00 € (bug `global_coefficient = 1`, étape 16). Le PDF est le document envoyé au client. | Ne jamais régénérer un PDF de version scellée. Détecter les versions incohérentes avant migration (requête : `total_ht_cents != round(Σ line_total_ht_cents × global_coefficient) − remise`) et les traiter manuellement. |
| **Exports consommés en aval** | Renommer les colonnes BDC/DPGF (étapes 18-19) casse les macros Excel et les ré-imports clients. | Conserver l'ancien intitulé une version, en ajoutant la nouvelle colonne à côté ; annoncer la suppression. |
| **Explosion de `tsc`** | Les étapes 5 et 6 rendent obligatoires des champs aujourd'hui optionnels : ~20 sites d'appel cassent d'un coup. | C'est l'objectif. Faire 5 et 6 dans des commits séparés, chacun vert. Ne PAS ajouter de `?? false` / `?? getMarginTiers()` pour faire compiler — c'est exactement le bug qu'on supprime. |
| **Tests existants qui encodent le bug** | `estimate-calculations.test.ts`, `EstimateDocument.test.ts`, `export-stream.test.ts`, `bdc-export.test.ts`, `dpgf-export.test.ts` contiennent des attentes calées sur les valeurs fausses. | Les goldens de l'étape 1 servent de diff explicite : chaque golden modifié doit être justifié par un commentaire pointant la divergence corrigée. Interdire la modification silencieuse d'une valeur attendue. |
| **Changement d'arrondi (2.5)** | `bankersRound` partout produit des ±1 c sur des milliers de lignes. | Étape séparée, en dernier, avec un test de tolérance `|Δ| ≤ nbLignes` centimes sur le corpus golden. |
| **Perf éditeur** | `computeEstimateBreakdown` calcule tout le devis à chaque frappe, là où `computeAllSectionTotals` était optimisé pour le rendu. | Mémoïser sur `(items, settings)`, réutiliser la structure `childrenByParent` déjà construite (l.860-875), et mesurer sur un devis de 2 000 lignes avant/après. |
| **Marge affichée dans les affaires** | Étape 11 : 65 % → 50 %. Un pilotage commercial peut s'appuyer sur ce chiffre. | Prévenir explicitement ; le chiffre actuel est faux (le coefficient était compté comme de la marge). |

---

## 5. Tests de régression à écrire

Fichiers : `src/lib/estimate-calculations.reconciliation.test.ts` (nouveau), plus des cas dans `EstimateDocument.test.ts`, `export-stream.test.ts`, `bdc-export.test.ts`, `useEstimateEditorState` et un test e2e PDF.

### T1 — Invariant universel (property-based)
Pour 500 devis générés (1-50 lignes, coef ∈ [0,5 ; 2], remise simple/cascade, marge fixe/paliers, split on/off, lignes racine) :
```
Σ breakdown.lineById[*].saleNetHtCents === breakdown.totals.saleTotalCents   // exact, au centime
Σ sections.totalHtCents + Σ rootLines.saleNetHtCents === totals.saleTotalCents
Σ lineById[*].taxCents === totals.taxCents
```

### T2 — Coefficient dans les sections
1 section, 1 ligne, coût 100 000 c, marge 1,5, coefficient 1,10, remise 0.
Attendu : `section.totalHtCents = 165 000` et `totals.saleTotalCents = 165 000`.
(Avant : 150 000 vs 165 000 → 150,00 € d'écart, 9,1 %.)

### T3 — Remise : assiette post-coefficient, allocation exacte
2 sections A et B, 1 ligne chacune à 100 000 c de vente, marge 1,0, coefficient 1,20, cascade 10 %.
Attendu : `saleSubtotalCents = 240 000`, `discountCents = 24 000`, `saleTotalCents = 216 000`, `A = B = 108 000`, `A + B = 216 000`.
(Avant : A = B = 88 000, somme 176 000 → 400,00 € d'écart, taux effectif 12 % au lieu de 10 %.)

### T4 — Allocation avec restes non divisibles
3 lignes à 3 333 c de vente, coefficient 1,10, remise 0.
`saleSubtotalCents = bankersRound(9 999 × 1,10) = 10 999`. Attendu : parts `{3 667, 3 666, 3 666}`, somme **exactement** 10 999. Aucune part négative, aucune part > total.

### T5 — `isLaborSplitEnabled` : une seule sémantique
Ligne : `h_mo = 10 h @ 50,00 €/h` (legacy) **et** `h_mo_atelier = 4 h @ 60,00 €/h` + `h_mo_chantier = 6 h @ 40,00 €/h`, marge 1,30, FO 0.
- flag `false` → 650,00 € **sur les 4 surfaces** (pied, section, ligne, export).
- flag `true` → 624,00 € sur les 4 surfaces.
Assertion clé : `pied === section === ligne` dans les deux cas. (Avant : 650,00 € en section vs 624,00 € au pied.)

### T6 — `marginTiers` : le barème du tenant gagne
`margin_mode = 'tiered'`, barème tenant `[seuil 0 → 1,35]`, coût 80 000 c.
Attendu sur les 6 surfaces : `appliedMarginMultiplier = 1,35`, HT = 108 000 c. Aucune surface ne doit renvoyer 128 000 c (barème par défaut 1,6).

### T7 — TVA multi-taux, pied vs export
2 lignes à 100 000 c de vente, ligne A à 2000 bp, ligne B à 1000 bp, version à 2000 bp, coefficient 1.
Attendu : `totals.taxCents = 30 000` (20 000 + 10 000) **et** feuille XLSX = 30 000.
(Avant : 40 000 au pied vs 30 000 à l'export → 100,00 € d'écart.)
Variante : coefficient 1,00 → 1,01 ne doit pas faire varier la TVA autrement que du fait du coefficient (suppression de la double branche l.410).

### T8 — Lignes racine
1 section « Lot 1 » à 80 000 c + 1 ligne racine à 20 000 c, remise 10 000 c, coefficient 1.
Attendu : `sections + rootLines = 90 000 = totals.saleTotalCents`. Le pied de l'éditeur (`EstimateEditorTable`) et le document affichent la même valeur.
(Avant : 72 000 + 20 000 = 92 000 lu par le client vs 90 000 au pied.)

### T9 — Le filtre de recherche ne change pas le total du devis
Devis 200 000,00 €, section « Peinture » 30 000,00 €. Saisir « peinture » dans la recherche : `grandTotals.htTotal` doit rester 200 000,00 € (un éventuel « Total filtré » affiche 30 000,00 € sous un libellé distinct).

### T10 — Sauvegarde idempotente
Coefficient 1,15, sous-total 100 000,00 €, mode « Simple », remise 0. Sauvegarder puis recharger.
Attendu : `global_coefficient = 1,15` en base, `total_ht_cents = 11 500 000`, et le total affiché **identique avant/après sauvegarde**. Assertion : `computeEstimateBreakdown(stateAvantSave).totals === computeEstimateBreakdown(stateApresReload).totals`.

### T11 — Remise simple vs `discount_steps` résiduels
Sous-total 220 000 c, `discount_mode = 'simple'`, `discount_cents = 50 000`, `discount_steps = [1000]`.
Attendu après étape 16 : `discountCents = 50 000` (le montant saisi gagne) **et** `discount_steps` vidé à la sauvegarde. Test de non-régression sur l'ancien comportement (22 000 c) explicitement supprimé avec justification.

### T12 — Réconciliation PDF (e2e)
Devis fixture : 2 chapitres, 6 lignes, coefficient 1,10, cascade 10 %, split ON, marge par paliers.
Extraire le texte du PDF généré et asserter : `Σ lignes imprimées === Σ sous-totaux de chapitre === Total HT du cartouche`, et présence des lignes `Coefficient global ×1,10` et `Remise −X`.

### T13 — Stabilité des taux horaires
Ligne 100 h @ 45,00 €/h, marge 1,30, `line_total_ht_cents = 585 000`. Passer le rôle à 50,00 €/h **sans toucher au devis**.
Attendu : la colonne « Total HT » de l'XLSX et le Résumé affichent la **même** valeur (celle du breakdown persisté). (Avant : 6 500,00 € vs 5 850,00 € dans le même classeur.)

### T14 — Versions scellées immuables
Version `accepted` avec `calc_engine_version = 1`. Après déploiement de tout le plan : `computeEstimateBreakdown` renvoie les mêmes `total_ht/tax/ttc` qu'avant, et aucune écriture n'est émise sur `estimate_versions`/`estimate_items`. Test à ajouter dans `workflow-write-security-regressions.test.ts`.

---

**Ordre de merge recommandé** : 1-3 (filet) → 4-6 (contrat, 3 PR distinctes) → 7-11 (moteur) → 12-16 (rendu + éditeur) → 17-20 (exports) → 21-23 (persistance/bascule). Chaque phase est déployable seule, avec les goldens verts ou les diffs justifiés.