# Règles de calcul

> **Statut : à jour au 2026-07-29**, établi par lecture du code, pas de la documentation antérieure.
> Chaque règle est ancrée sur un `fichier:ligne`. En cas de divergence, **le code fait foi** — et ce
> document doit être corrigé.
>
> Ce document décrit **ce qui s'exécute réellement en production (moteur v1)**. Le moteur v2, écrit et
> testé mais inactif, est décrit au § 8.

---

## 1. Représentation des montants

| Règle | Implémentation |
|---|---|
| Tout montant est un **entier de centimes** | colonnes `*_cents`, type `integer` — `supabase/schema.sql:373-375` |
| Tout taux est en **points de base** (2000 = 20 %) | `tax_rate_bp`, borné `0..10000` — `supabase/schema.sql:370` |
| Plafond de stockage : **21 474 836,47 €** | `MAX_CENTS = 2_147_483_647` — `src/lib/estimate-calculations.ts:14` |
| Le dépassement **écrête sans lever d'erreur** | `capCents()` — `src/lib/estimate-calculations.ts:149-151` |
| …mais il est signalé | `exceedsMaxCents()` → `EstimateTotals.isCapped` — `:160-162`, `:470` |
| Devises acceptées | `EUR`, `USD`, `GBP` — `src/lib/money.ts:1` |

**Saisie.** L'euro accepte la virgule décimale et refuse toute précision sous le centime
(`parseEuroInputToNumber`, `src/lib/money.ts:51-70`). L'USD et la GBP exigent le **point** décimal et
refusent la virgule (`parseUsdGbpInputToNumber`, `:72-86`).

> ⚠️ **Aucune conversion de devise n'existe.** `src/lib/currency-rates.ts` est un CRUD
> d'administration : il stocke des taux `from → to` avec une date d'effet, mais n'expose **aucune
> fonction de conversion**. Le code en tire les conséquences et refuse d'injecter un prix fournisseur
> en devise étrangère (`src/lib/estimates/supplier-preselection.ts:1-25`).

### 1.1 Arrondis — hétérogènes, et c'est connu

Il n'existe pas *une* règle d'arrondi, mais **deux, mélangées** :

| Méthode | Où elle s'applique |
|---|---|
| **`bankersRound`** (demi-au-pair) `src/lib/money.ts:116-125` | PU HT (`estimate-calculations.ts:237-238`), coefficient global (`:465-467`), chaque palier de remise cascade (`:272`), ventilation FO/MO (`:900`, `:905`) |
| **`Math.round`** (demi-au-supérieur) | Coût de ligne (`:229-231`), vente de ligne (`:233-235`), **TVA** (`money.ts:109`), allocation pro rata (`:318`), remises de section (`:713`, `:730`, `:748`) |

Le commentaire de `bankersRound` invoque la doctrine DGFiP pour éviter le biais haussier. **Mais la
TVA — le seul montant réellement opposable au fisc — reste en `Math.round`.** Aucun document n'a
jamais prescrit le demi-au-supérieur : c'est un résidu historique, pas une règle.

L'épic `EST-E26` recense **11 `Math.round` subsistants** à unifier. Tant que ce n'est pas fait, ne
« harmonisez » rien sans mesurer l'impact : les goldens figent volontairement des valeurs fausses.

### 1.2 Arrondi de présentation du TTC

`applyRounding(value, mode, step)` — `estimate-calculations.ts:164-171`, avec
`mode ∈ {none, nearest, up, down}` (enum DB `estimate_rounding_mode`) et un pas en centimes.

Garde-fou : `roundedTtcCents = Math.max(candidat, saleTotalCents)` (`:527`) — **le TTC ne peut jamais
descendre sous le HT.**

---

## 2. Formule de ligne

`src/lib/estimate-calculations.ts:185-248`

```
coûtMO = h_mo_majoration × h_mo × taux_horaire_rôle × k_mo                    (split OFF)

coûtMO = h_mo_majoration × ( h_atelier  × taux_atelier  × k_atelier
                           + h_chantier × taux_chantier × k_chantier )         (split ON)

costLineCents = Math.round( quantity × unit_price_ht_cents × k_fo + coûtMO )
saleLineCents = Math.round( costLineCents × marginMultiplier )
puHtCents     = bankersRound( saleLineCents / quantity )
taxLineCents  = Math.round( saleLineCents × tax_rate_bp / 10000 )
```

| Champ | Signification |
|---|---|
| `k_fo` | Coefficient sur fournitures |
| `h_mo`, `k_mo` | Heures et coefficient de main-d'œuvre |
| `h_mo_majoration` | Majoration globale des heures |
| `h_mo_atelier` / `k_mo_atelier`, `h_mo_chantier` / `k_mo_chantier` | Split atelier / chantier |
| `labor_role_id` | Rôle, qui porte le taux horaire |

Le split atelier/chantier n'est actif que si le flag tenant `EST_031_LABOR_SPLIT` **et** un payload
réel sont présents (`hasActiveLaborSplitPayload`, `:123-146`).

> **Le déboursé sec existe, mais n'est jamais persisté.** `costLineCents` est recalculé à chaque appel
> puis jeté : seuls `pu_ht_cents`, `line_total_ht_cents`, `line_tax_cents`, `line_total_ttc_cents`
> sont écrits (`normalizeDraftItems`, `:1791-1802`). Il est ré-exposé en lecture par
> `src/lib/estimates/line-margin.ts:49-95`.

---

## 3. Marge

### 3.1 Deux modes

- **`fixed`** — `margin_multiplier` (numeric, borné `0..100` en base `schema.sql:366`, écrêté à
  `MAX_MARGIN_MULTIPLIER = 100` côté code `:11`).
- **`tiered`** — barème `margin_tiers` du tenant, résolu en **deux passes** : la passe 1 calcule le
  coût total à marge 1, la passe 2 applique le palier retenu (`:428-446`). Le palier sélectionné est
  le **dernier dont le seuil est ≤ coût** (`margin-tiers.ts:56-59`).

**Barème par défaut**, appliqué en repli silencieux à tout tenant qui n'en a pas
(`src/lib/estimates/margin-tiers.ts:9-13`) :

| Seuil de coût | Multiplicateur |
|---|---|
| 0 € | **× 1,60** |
| 100 000 € | **× 1,45** |
| 1 000 000 € | **× 1,40** |

> ⚠️ Ce repli n'est pas signalé à l'utilisateur : `tiers.length > 0 ? tiers : getMarginTiers()`
> (`margin-tiers.ts:46`). Un tenant sans barème chiffre à ×1,6 sans le savoir.

### 3.2 Marque, pas marge

L'indicateur affiché est un **taux de marque** :

```
markupRatio = (vente − coût) / vente
```

`src/lib/estimates/line-margin.ts:40`, `:93`. Le choix est explicite et commenté (`:33-38`) : sur un
coefficient 1,35, la **marge** vaut 35 % et la **marque** 25,9 %. Afficher l'une pour l'autre est
l'erreur la plus coûteuse du métier — voir [glossaire.md](glossaire.md).

### 3.3 ⚠️ `margin_bp` et `margin_multiplier` divergent

```ts
// src/lib/estimates/rules-engine.ts:883-895
const marginBp = toFiniteNumber(version.margin_bp, NaN);
if (Number.isFinite(marginBp) && marginBp >= 0) return marginBp;   // ← toujours vrai
// … repli sur margin_multiplier : INATTEIGNABLE
```

`margin_bp` est `not null default 0` (`schema.sql:368`). La valeur `0` satisfait donc toujours la
condition, et **le repli sur `margin_multiplier` n'est jamais atteint**. Or `margin_bp` n'est écrit
qu'à la création via l'assistant, tandis que le panneau de réglages ne modifie que
`margin_multiplier`.

**Conséquence : une règle `min_margin` voit une marge de 0 bp sur la quasi-totalité du parc et se
déclenche systématiquement.** Les tableaux de bord direction et la file d'approbation affichent la
même valeur fausse. Défaut ouvert — voir [ecarts-standards-btp.md](ecarts-standards-btp.md).

---

## 4. Coefficient global et remises

**Coefficient global** (`global_coefficient`, numeric `>= 0`) : multiplicateur appliqué **après** la
marge et **avant** la remise, avec un arrondi unique `bankersRound` (`:465-467`).

**Remise, deux modes :**

- **`simple`** — un montant en centimes, ou `discount_bp`, plafonné au sous-total (`:493-496`).
- **`cascade`** — `discount_steps` (`integer[]`), chaque palier borné `0..10000` bp, appliqué
  **successivement sur le sous-total courant**, avec `bankersRound` à chaque étape (`:251-296`).

Contrainte DB : en mode `simple`, `discount_steps` doit être vide (`schema.sql:7666`).

---

## 5. TVA

| Règle | Référence |
|---|---|
| **Un seul taux par version.** L'UI parle de « TVA unique » | `EstimateSettingsPanel.tsx:651`, `:677-682` |
| Défaut 2000 bp (20 %), borné `0..10000` | `schema.sql:370` |
| `tax_rate_bp` existe **par ligne** en base… | `schema.sql:529` |
| …mais est **écrasé par le taux de version** à chaque normalisation | `estimate-calculations.ts:1772` |
| …et n'est honoré **que par le moteur v2**, inactif | `:1491` |
| **Aucun taux réduit BTP prédéfini** (5,5 / 10 / 20) : champ pourcentage libre | `EstimateSettingsPanel.tsx:677-682` |

> Le multi-taux est donc **inopérant en production**, quoi qu'en dise la base. Un devis mixant
> 20 % et 10 % n'est pas chiffrable correctement aujourd'hui.

### 5.1 Autoliquidation de TVA en sous-traitance — implémentée

C'est la seule règle **fiscalement opposable** du produit, et elle est traitée avec soin.

- **Modèle** : `estimate_versions.contractor_role text not null default 'principal'`,
  `check in ('principal','subcontractor')` —
  `supabase/migrations/20260726090000_estimate_contractor_role.sql:31-46`. C'est le **rôle
  contractuel** qui est modélisé, pas la conséquence fiscale : choix délibéré, documenté dans la
  migration.
- **Moteur** : `vatReverseCharge` résout le taux effectif à **zéro en un point unique**, vu à la fois
  par le pied et par les lignes (`estimate-calculations.ts:418-425`, `:1395`).
- **Piège évité** : l'arrondi TTC est court-circuité en autoliquidation, pour ne pas fabriquer une
  TVA fantôme via `adjustedTaxCents` (`:521-527`).
- **Document** : mention « Autoliquidation », suppression de toute ligne de TVA
  (`EstimateDocument.tsx:382-386`, `:460-465`), CGV conditionnées (`pdf-terms.ts:161-164`).
- **Sceau** : `contractor_role` n'entre dans le payload canonique **que s'il diffère de
  `'principal'`** (`server.ts:2066-2068`) — sans quoi l'ajout du champ aurait invalidé les sceaux de
  tout le parc existant.
- Le choix n'est **jamais déduit** : sélecteur explicite (`EstimateSettingsPanel.tsx:604-630`).

Couverture : 6 cas dédiés dans `estimate-calculations.test.ts:1553-1640`.

**Cas non traité et assumé** : le sous-traitant en franchise en base de TVA.

---

## 6. Hiérarchie et totalisation

- **Deux types de nœuds seulement** : `estimate_item_type = ('section','line')` (`schema.sql:90`).
  Il n'existe **pas** de type « ouvrage » ni « lot » en base.
- **Profondeur** : min 1, max 4, défaut 3 ; les versions historiques valent 2
  (`src/lib/estimates/hierarchy.ts:3-6`). Stockée par version dans `max_section_depth`.
- **Libellés de niveau** : `["Lot", "Chapitre", "Sous-chapitre", "Ouvrage"]` (`hierarchy.ts:8-13`).
  ⚠️ **Purement cosmétiques** : aucune sémantique métier n'y est attachée. Un « Lot » est une section
  comme une autre.
- **Nœuds mixtes autorisés** : une section peut porter à la fois des sous-sections et des lignes, et
  les lignes existent à n'importe quel niveau (`:1121-1148`).
- **Intégrité** : une `section` doit avoir **tous** ses champs de prix à `null`, une `line` doit les
  avoir **tous** non-null (`schema.sql:549-575`).

**Totalisation ascendante** : parcours en post-ordre itératif ; chaque section agrège ses lignes
directes **et** les accumulateurs de ses sous-sections (`:1088-1153`). La remise globale est
réallouée proportionnellement au sous-total de section, puis répartie FO → MO → atelier/chantier
(`convertSectionSubtotalToTotals`, `:698-806`).

**Catégories** : `estimate_categories`, seedées à `["Materiaux", "Main d'oeuvre", "Sous-traitance"]`
(`server.ts:1809-1813`).

**Exclusions** : champ texte libre `estimate_versions.exclusions`, ≤ 5 000 caractères, verrouillé hors
brouillon par trigger (`20260715235315_add_estimate_exclusions.sql`).

> ⚠️ **Il n'existe aucune colonne `unit` sur `estimate_items`.** L'unité de mesure — pilier d'un DPGF —
> n'est pas modélisée sur la ligne de devis. L'export DPGF remplit la colonne « Unite » avec la
> **description** (`src/lib/estimates/dpgf-export.ts:340`). Voir
> [ecarts-standards-btp.md](ecarts-standards-btp.md).

---

## 7. Ouvrages réutilisables (assemblages)

`estimate_assemblies` + `estimate_assembly_items` + `estimate_assembly_members` (imbrication, avec
garde anti-cycle et contrôle de profondeur au trigger —
`20260722132425_nested_estimate_assemblies.sql`).

**Le sous-détail de prix existe au niveau bibliothèque** —
`20260307173000_est383_generated_ouvrage_subdetails.sql:17-27` :

| Champ | Valeurs |
|---|---|
| `cost_type` | `material`, `labor`, `equipment`, `subcontract` |
| `unit_cost_ht_cents` | Coût unitaire du composant |
| `loss_coeff_bp` | Coefficient de perte, `0..100000` |
| `yield_value` / `yield_unit` | Rendement |

Agrégats exposés : `material_cost_cents`, `labor_cost_cents`, `equipment_cost_cents`,
`subcontract_cost_cents`, `calculated_ds_cents`, `pose_only_cents`, `supplied_installed_cents`
(`assembly-library.ts:135-141`).

> 🔴 **Ce sous-détail est détruit à l'insertion dans un devis.** La matérialisation
> (`20260722132425_nested_estimate_assemblies.sql:561-591`) aplatit l'ouvrage en lignes ordinaires :
> `cost_type`, `loss_coeff_bp` et `yield_value` n'existent pas sur `estimate_items` et sont perdus ;
> un composant `labor` est inséré à `unit_price_ht_cents = 0`. **Le sous-détail n'est donc jamais
> opposable au maître d'œuvre.**

L'insertion est une **copie**, pas un lien vif : modifier l'ouvrage en bibliothèque ne rétroagit pas
sur les devis.

---

## 8. Les deux moteurs de calcul

`estimate_versions.calc_engine_version` (`smallint not null default 1`) gouverne quel moteur
s'applique. Type `1 | 2`, résolveur *fail-safe* `resolveCalcEngineVersion`
(`src/lib/estimates/calc-engine-version.ts:40-48`) : toute valeur inattendue retombe sur `1`.

### 8.1 État réel au 2026-07-29

| Surface | Moteur |
|---|---|
| Fiche version `[versionId]/page.tsx:461` | lit la colonne |
| Impression `print/page.tsx:361` | lit la colonne |
| Portail client `portal/[token]/page.tsx:288` | lit la colonne |
| Exports `export-stream.ts:394` | lit la colonne |
| Contexte de calcul `calc-context.ts:269` | lit la colonne |
| PDF `pdf-generator.tsx:1814` | lit la colonne |
| **Éditeur** `useEstimateVisibility.ts:189`, `useEstimateEditorState.impl.tsx:1127` | **épingle `EDITOR_CALC_ENGINE_VERSION = 1`** |

**Aucune version n'est en moteur 2 en production.** L'éditeur est le dernier verrou avant bascule.
`EXPORT_CALC_ENGINE_VERSION` (`calc-engine-version.ts:31`) est devenue une **constante morte**.

### 8.2 Ordre canonique du moteur v2

`computeEstimateBreakdown` (`:1383-1587`) est la **fonction d'autorité** :

```
1. coût de ligne                      Math.round(FO + MO)
2. Σ des coûts → résolution du palier de marge
3. vente brute de ligne               Math.round(coût × marge)
4. Σ des ventes brutes
5. × coefficient global               bankersRound  ← arrondi unique
6. remise sur base POST-coefficient
7. ALLOCATION DESCENDANTE             allocateProRata
8. TVA par ligne sur le net           item.tax_rate_bp ?? version.tax_rate_bp
9. arrondi TTC                        → roundingAdjustmentCents exposé
```

`allocateProRata` (`:314-355`) garantit `Σ parts === montant` **au centime** : méthode du plus grand
reste (Hamilton), départage déterministe par index croissant, rebasage final du résidu flottant sur
la part de plus gros poids. Testé sur **10 000 tirages** (`estimate-calculations.test.ts:1538`).

**Invariant** : `invariants.matchesFooter = (calcEngineVersion === 2 && sumAllocatedHtCents === totals.saleTotalCents)`
(`:1583-1585`). Il est donc **structurellement `false` partout en production**.

### 8.3 Ce que fait le moteur v1

`computeReadOnlyTotals` dérive le pied des **colonnes figées** `total_ht_cents` / `total_tax_cents` /
`total_ttc_cents` (`:1929-1947`), pendant que les sections sont **recalculées** et que les lignes
lisent `line_total_ht_cents` (brut de coefficient et de remise). **Trois millésimes de données
coexistent donc dans un même tableau** — c'est exactement la divergence que T6 (`EST-E26`) corrige.

### 8.4 ⚠️ Avant de modifier `estimate-calculations.ts`

Unifier le moteur change **rétroactivement** les totaux de devis déjà envoyés, acceptés et scellés,
c'est-à-dire des **montants contractuels** et des **sceaux d'intégrité**.

Règles de prudence :

1. Les goldens de `estimate-calculations.golden.test.ts` figent volontairement des **valeurs fausses**.
   Toute modification d'un snapshot doit être justifiée par un commentaire pointant la divergence
   corrigée.
2. La bascule doit être progressive : brouillons → nouvelles versions → opt-in des `sent` non signées.
   **Jamais** les `accepted` ni les versions scellées.
3. Les étapes 5-6 de la phase B touchent déjà les chemins d'**écriture** serveur
   (`recalculateEstimateVersionTotals`, `insertAssemblyIntoVersion`) et modifient donc des
   `total_ht_cents` **stockés**, sans être conditionnées par `calcEngineVersion`. Arbitrage ouvert.

---

## 9. Tests de référence

| Fichier | Rôle |
|---|---|
| `src/lib/estimate-calculations.golden.test.ts` | Caractérisation : fige le comportement **actuel**, y compris ses erreurs, chaque divergence annotée `fichier:ligne` |
| `src/lib/estimate-calculations.reconciliation.test.ts` | Invariants T6, dont un test *property-based* sur 300 devis |
| `src/lib/estimate-calculations.test.ts` | Unitaires, dont 10 000 tirages sur `allocateProRata` et 6 cas d'autoliquidation |
| `src/lib/money.test.ts` | Parsing et formatage par devise |

---

## Voir aussi

- [glossaire.md](glossaire.md) — vocabulaire du chiffrage BTP
- [cycle-de-vie.md](cycle-de-vie.md) — statuts, immutabilité, scellement, approbations
- [ecarts-standards-btp.md](ecarts-standards-btp.md) — ce qui manque face au métier
