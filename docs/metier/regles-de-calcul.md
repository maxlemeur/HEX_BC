# Règles de calcul

> **Statut : contrat des moteurs v1/v2 relu au 2026-08-12**, établi par lecture
> du code et de la migration du Lot 7. Les autres sections conservent les
> références détaillées de la photographie du 2026-07-29. En cas de divergence,
> **le code et les migrations font foi**.

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

### 3.3 Marge effective pour les règles et le pilotage

`resolveEffectiveMarginBp` (`src/lib/estimates/effective-margin.ts`) distingue
les contrats historiques et v2 :

- en v1, `margin_bp` stocké reste prioritaire ; `margin_multiplier` n'est qu'un
  repli de compatibilité lorsque cette donnée historique manque ;
- en v2, la source d'autorité est
  `calc_snapshot_context.effective_margin_multiplier`, c'est-à-dire le
  coefficient réellement appliqué par `computeEstimateBreakdown`, **uniquement
  si** `calc_snapshot_content_revision === content_revision` ;
- un brouillon v2 `fixed` non encore gelé peut utiliser son coefficient
  configuré ; un brouillon v2 `tiered` sans snapshot reste indéterminé, car ce
  coefficient ne permet pas de connaître le palier réellement appliqué.

Ce dernier cas échoue de façon conservatrice : `min_margin` évalue l'absence à
`0` et bloque, tandis que Direction et la file affichent `null` plutôt qu'une
marge inventée.

La conversion en points de base suit le taux de marque :

```text
effective_margin_bp = max(0, round((1 - 1 / coefficient) × 10 000))
```

Le gel v2 enregistre le coefficient appliqué dans le contexte de calcul, avec
le barème effectif. Si aucune tranche tenant n'existe, les tranches par défaut
utilisées par le moteur sont matérialisées avant le gel. La règle `min_margin`,
les cartes et alertes Direction et la file d'approbation lisent ensuite le même
résolveur, qui ignore tout contexte lié à une révision antérieure ; modifier le
barème courant ne réévalue pas une version déjà figée.

Le gating charge également `discount_bp` depuis la version. La règle
`max_discount` n'est donc plus neutralisée par un champ absent interprété comme
zéro.

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
| Le réglage principal reste un taux par version dans l'UI | `EstimateSettingsPanel.tsx:651`, `:677-682` |
| Défaut 2000 bp (20 %), borné `0..10000` | `schema.sql:370` |
| `tax_rate_bp` existe par ligne en base | `schema.sql:529` |
| Le moteur v1 conserve la normalisation historique au taux de version | `estimate-calculations.ts` |
| Le moteur v2 honore le taux de ligne, avec repli sur le taux de version | `computeEstimateBreakdown`, `estimate-calculations.ts` |
| **Aucun taux réduit BTP prédéfini** (5,5 / 10 / 20) : champ pourcentage libre | `EstimateSettingsPanel.tsx:677-682` |

Le multi-taux est donc gouverné par la version du moteur : il reste inopérant
pour un devis historique v1, mais il est effectif pour toute nouvelle version
v2. Les surfaces contractuelles d'une version v2 finalisée relisent la TVA
figée par ligne ; elles ne la recalculent pas avec un réglage courant.

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

`estimate_versions.calc_engine_version` gouverne le contrat de calcul. Son type
applicatif est `1 | 2` et `resolveCalcEngineVersion` retombe volontairement sur
`1` pour toute valeur absente ou invalide. La migration du Lot 7 conserve le
défaut SQL historique à `1` : elle ne transforme aucune version existante.

### 8.1 Attribution du moteur et création canonique

- `NEW_ESTIMATE_CALC_ENGINE_VERSION = 2` s'applique à toute **nouvelle** version
  créée par les chemins applicatifs.
- Les créations vierges, depuis template ou depuis import DPGF convergent dans
  `persistCanonicalEstimateV2` (`src/lib/estimates/canonical-v2-creation.ts`).
  Cette façade calcule d'abord un résultat v2 réconcilié, puis appelle la RPC
  service-role actor-scoped `persist_estimate_creation_atomic` pour persister
  projet, version, arbre, totaux et lien d'import dans une seule transaction.
  Le régime `contractor_role` fourni à la création, ou hérité de la dernière
  version d'une affaire existante, participe à ce calcul et à la transaction ;
  le mode `subcontractor` impose un pied et des lignes à TVA nulle.
- La duplication ne passe pas par cette façade :
  `duplicate_estimate_version` conserve le moteur de la source, crée un nouveau
  brouillon et ne copie pas le sceau.
- Les fonctions de création SQL historiques restent dans l'historique des
  migrations, mais leurs droits d'exécution sont révoqués par la migration du
  Lot 7. Elles ne constituent plus un chemin applicatif autorisé.

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

`allocateProRata` garantit `Σ parts === montant` **au centime** par la méthode
du plus grand reste, avec départage déterministe. L'invariant
`matchesFooter` exige que la somme des lignes réconciliées corresponde au pied
v2 avant toute persistance ou tout gel.

### 8.3 Brouillon vivant et snapshot contractuel

Un brouillon v2 reste calculé en direct. Le contexte chargé par
`resolveEstimateCalculationContext` comprend l'état du split de main-d'œuvre,
les taux des rôles référencés et, en mode de marge par paliers, le barème
effectif. Il n'est pas implicitement recalculé après finalisation.

Avant la première demande d'approbation et avant l'envoi,
`freeze_estimate_v2_snapshot` enregistre par comparaison-et-échange :

- `calc_snapshot_content_revision` et `calc_snapshot_context` sur la version ;
  ce contexte contient le barème effectif et
  `effective_margin_multiplier`, coefficient réellement choisi par le
  breakdown. Il n'est autoritatif que tant que sa révision est égale à la
  `content_revision` courante ;
- `total_ht_cents`, `total_tax_cents` et `total_ttc_cents` sur la version ;
- `line_total_ht_cents`, `line_tax_cents`, `line_total_ttc_cents` et les cinq
  champs `snapshot_pu_ht_cents`, `snapshot_fo_ht_cents`,
  `snapshot_mo_ht_cents`, `snapshot_mo_atelier_ht_cents`,
  `snapshot_mo_chantier_ht_cents` sur chaque ligne.

Le gel d'approbation peut s'exécuter sans bail d'éditeur, mais refuse un bail
actif détenu par un autre utilisateur. Le gel d'envoi exige le bail de
brouillon de l'acteur. Après le gel d'approbation, le moteur de règles relit la
version afin que le cycle et ses approbations capturent la nouvelle
`content_revision`. La RPC transactionnelle `open_estimate_review_cycle` crée
ensuite le cycle, les approbations et l'événement d'audit. Une resoumission sur
une révision plus récente remplace atomiquement le cycle précédent et ses
approbations encore actives ; une reprise strictement identique est idempotente.

### 8.4 Rôles de main-d'œuvre

Pour le moteur v2, chaque `labor_role_id`, `labor_role_atelier_id` et
`labor_role_chantier_id` doit appartenir au propriétaire de l'affaire dans le
même tenant. Ce contrôle est appliqué au calcul, à la création atomique, par le
trigger d'item et à nouveau au gel ; une incohérence lève
`ESTIMATE_LABOR_ROLE_OWNER_MISMATCH`. Le moteur v1 conserve son repli historique
à un taux nul lorsqu'un rôle ne peut plus être résolu.

### 8.5 Lecture des surfaces et compatibilité historique

| État / surface | Source chiffrée |
|---|---|
| Brouillon v2 dans l'éditeur | calcul vivant avec le contexte courant |
| Fiche, impression et éditeur en lecture seule d'une v2 finalisée | snapshot stocké |
| PDF et portail client d'une v2 finalisée | snapshot stocké |
| Exports CSV/XLSX/DPGF/BDC d'une v2 finalisée | snapshot stocké |
| Version v1 historique | contrat et replis v1 conservés |

`buildStoredEstimateBreakdown` reconstruit les lignes et sections v2 uniquement
depuis les colonnes figées ; aucun taux de rôle, palier ou feature flag courant
n'entre alors dans le montant contractuel. Le sceau v3 couvre en plus la
hiérarchie, les entrées de calcul, le contexte, la révision et les cinq
snapshots. La vérification continue d'essayer les payloads v2 et v1 historiques,
donc les devis déjà scellés ne sont ni réécrits ni invalidés.

---

## 9. Tests de référence

| Fichier | Rôle |
|---|---|
| `src/lib/estimate-calculations.golden.test.ts` | Goldens distincts v1/v2 et compatibilité des résultats historiques |
| `src/lib/estimate-calculations.reconciliation.test.ts` | Invariants de réconciliation entre lignes, sections et pied |
| `src/lib/estimate-calculations.test.ts` | Unitaires de calcul, allocation et autoliquidation |
| `src/lib/estimates/version-totals.test.ts` | Contexte figé et portée propriétaire stricte des rôles en v2, repli v1 |
| `supabase/tests/database/estimate-calc-engine-governance.test.sql` | Contrats SQL de création, gel, publication, sceau et immutabilité |
| `src/lib/money.test.ts` | Parsing et formatage par devise |

---

## Voir aussi

- [glossaire.md](glossaire.md) — vocabulaire du chiffrage BTP
- [cycle-de-vie.md](cycle-de-vie.md) — statuts, immutabilité, scellement, approbations
- [ecarts-standards-btp.md](ecarts-standards-btp.md) — ce qui manque face au métier
