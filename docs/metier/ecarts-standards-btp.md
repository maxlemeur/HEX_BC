# Écarts face aux standards du chiffrage BTP

> **Statut : établi le 2026-07-29** par confrontation du code aux pratiques d'un logiciel de chiffrage
> BTP français. Ce document recense **ce qui manque**, et ce qui est **cassé sans être documenté**.
>
> Il n'est pas un backlog : il n'ordonne rien et n'engage aucun délai. Il dit ce qui est vrai, pour
> que les arbitrages se fassent en connaissance de cause.

---

## 1. 🔴 Défauts actifs — le code fait quelque chose de faux

Ces quatre points ne sont pas des fonctionnalités manquantes : ce sont des comportements en
production qui produisent des résultats incorrects. Aucun n'était documenté avant cet audit.

### 1.1 L'unité de mesure n'est pas un champ

`estimate_items` porte `quantity`, `unit_price_ht_cents`, `k_fo`, `h_mo`… mais **aucune colonne
`unit`**. Les tables voisines en ont une (`products`, `estimate_assembly_items`,
`supplier_pricebook`) ; la ligne de devis, non.

Conséquence directe — l'export DPGF alimente la colonne « Unite » avec la **description** :

```ts
// src/lib/estimates/dpgf-export.ts:340
unite: item.description?.trim() ?? "",
```

Une désignation saisie librement corrompt donc l'unité exportée.

**Pourquoi c'est le défaut le plus grave** : il n'existe pas de DPGF conforme sans unité. C'est une
colonne obligatoire de la pièce contractuelle. Un `m²` chiffré comme `ml` change le prix d'un ordre de
grandeur, et l'erreur est invisible à la relecture puisque la colonne *paraît* remplie.

*Correctif : colonne `unit` sur `estimate_items`, migration de reprise depuis `description` quand elle
ressemble à une unité connue, et bascule de l'export.*

### 1.2 Le sous-détail de prix est détruit à l'insertion

`estimate_assembly_items` porte exactement le sous-détail BTP attendu — `cost_type`
(`material` / `labor` / `equipment` / `subcontract`), `unit_cost_ht_cents`, `loss_coeff_bp`,
`yield_value` / `yield_unit` — **livré depuis mars 2026**.

Mais la matérialisation d'un ouvrage dans un devis
(`supabase/migrations/20260722132425_nested_estimate_assemblies.sql:561-591`) l'aplatit en lignes
ordinaires : ces colonnes n'existent pas sur `estimate_items` et sont **perdues** ; un composant
`labor` est même inséré à `unit_price_ht_cents = 0`.

**Le sous-détail n'est donc jamais opposable au maître d'œuvre.** Il n'existe que dans la
bibliothèque, c'est-à-dire nulle part où il compte.

Aggravant : deux documents historiques (`EST-E16`, l'analyse concurrentielle) affirmaient que cette
fonctionnalité *n'existait pas*. Risque réel de la réimplémenter à côté.

### 1.3 `margin_bp` fausse toutes les règles de marge

```ts
// src/lib/estimates/rules-engine.ts:883-895
const marginBp = toFiniteNumber(version.margin_bp, NaN);
if (Number.isFinite(marginBp) && marginBp >= 0) return marginBp;   // ← toujours vrai
// repli sur margin_multiplier : INATTEIGNABLE
```

`margin_bp` est `not null default 0` (`schema.sql:368`). `0` satisfait toujours la condition. Or
`margin_bp` n'est écrit qu'à la création par l'assistant, tandis que le panneau de réglages ne modifie
que `margin_multiplier`.

**Conséquence** : une règle `min_margin` voit **0 bp** sur la quasi-totalité du parc et se déclenche
systématiquement. Les tableaux de bord direction (`direction/server.ts:990`) et la file d'approbation
(`approvals/server.ts:174`) affichent la même valeur fausse.

C'est un défaut qui **fausse des décisions métier**, pas seulement un affichage.

### 1.4 La TVA est arrondie au demi-supérieur

`bankersRound` est utilisé pour le PU, le coefficient global, les remises cascade et l'allocation —
avec un commentaire invoquant la doctrine DGFiP pour éviter le biais haussier. Mais
`computeTaxCents` (`money.ts:109`) utilise `Math.round`.

Le seul montant réellement opposable au fisc est donc le seul à subir le biais que la règle
prétendait éviter. `EST-E26` recense 11 `Math.round` subsistants.

*Impact unitaire faible, mais systématique et dans un seul sens.*

---

## 2. Dette assumée — absente du code, correctement identifiée

Ces manques sont réels mais **connus et ticketés**. Ils ne sont pas des surprises.

### 2.1 Structure de prix

| Standard | État | Ticket |
|---|---|---|
| Décomposition **DS / FC / FG / B&A** et coût de revient | 🚫 Absent — modèle à un seul multiplicateur | `EST-E15` |
| **Coefficient de vente** comme concept nommé | 🚫 Seul `margin_multiplier` existe | `EST-E15-DECISIONS` |
| Remises multi-niveaux (section, ligne) | 🚫 Remise au niveau version uniquement | `EST-E15` |
| Coefficients de perte / rendement **sur lignes de devis** | 🚫 Existent en bibliothèque, pas sur `estimate_items` | `EST-E15` |

> ⚠️ **Contradiction documentaire à trancher avant d'écrire du code** : `EST-E15` prescrit des
> `coeff_*_bp` en points de base ; `EST-E15-DECISIONS` prescrit des `coeff_*` en `numeric`. Les deux
> sont dans le dépôt, aucune n'est implémentée.

> ⚠️ **Ordonnancement** : `EST-E15-DECISIONS` pose que `margin_multiplier` reste la source de vérité
> et qu'il ne faut pas lancer `EST-E15` avant que la bascule de moteur (phase F de T6) soit faite.
> L'épic, lui, est classé P0. Arbitrage ouvert.

### 2.2 Métré

| Standard | État | Ticket |
|---|---|---|
| **Carnet de métrés** (`n × L × l × h`, par zone, déductions signées) | 🚫 Aucune table, aucun champ de dimension | `EST-E17` |
| **Formules dans les quantités** | 🚫 Aucun parseur | `EST-E17` |

### 2.3 Exécution et facturation — le « demi-produit »

C'est le bloc le plus lourd : le produit sait chiffrer, mais s'arrête à la signature.

| Standard | État | Ticket |
|---|---|---|
| **Situations de travaux** (facturation à l'avancement) | 🚫 | `EST-E18` |
| **Avenants** formalisés et numérotés | 🚫 | `EST-E18` |
| **Retenue de garantie 5 %**, caution de substitution, libération à 1 an | 🚫 | `EST-E18` |
| **DGD** (décompte général définitif) | 🚫 | `EST-E18` |
| **Révision de prix** par indices BT | 🚫 (`material_indices` existe, sans moteur) | `EST-E15-DECISIONS` |
| **Compte prorata** | 🚫 | — |

### 2.4 Marchés publics

| Standard | État | Ticket |
|---|---|---|
| **Allotissement** (`lot_code`, `trade`, récap TCE, extraction de lot) | 🚫 Le « Lot » n'est qu'un libellé cosmétique | `EST-E19` |
| **Sous-traitance par ligne** (en propre vs sous-traité, marge ST) | 🚫 À ne pas confondre avec `contractor_role`, qui est un régime **fiscal** par version | `EST-E19` |
| **Sous-détail opposable** | 🔴 Existe puis est détruit — voir § 1.2 | `EST-E16` |
| **Mémoire technique**, DC1 / DC2, attestations | 🚫 | — |

### 2.5 Fiscalité

| Standard | État |
|---|---|
| **Autoliquidation sous-traitance** | ✅ **Implémentée intégralement**, avec soin |
| **Taux réduits 5,5 % / 10 %** prédéfinis | 🚫 Champ pourcentage libre |
| **Récapitulatif TVA par taux** au document | 🚫 Un seul taux affiché |
| **Multi-taux par ligne** | 🔴 La colonne existe mais est **écrasée** par le taux de version (`estimate-calculations.ts:1772`) ; honorée seulement par le moteur v2, inactif |
| **CERFA 1301-SD** | 🚫 |
| Sous-traitant en **franchise en base** | 🚫 Cas ouvert, assumé par `EST-E27` |

> ⚠️ **Contradiction à connaître** : `EST-E20` / `EST-351` exigent un récapitulatif TVA **par taux**
> avec mention de l'art. 279-0 bis. `EST-E27`, **livré**, impose au contraire un document **sans
> aucune ligne de TVA** en autoliquidation. Implémenter `EST-351` tel quel casserait une conformité
> fiscale existante. Les deux règles doivent être conditionnées par `contractor_role`.

---

## 3. Angles morts — absents du code **et** de toute la documentation

Ces points n'apparaissaient dans aucun ticket, aucune décision, ni dans l'analyse concurrentielle de
3 522 lignes censée lister les manques.

1. **Aucun cycle de vie d'affaire.** `estimate_projects` n'a qu'un booléen `is_archived` ; le statut
   affiché est celui du devis. Ni prospect / à chiffrer / remis / gagné / perdu, ni date de remise, ni
   motif de perte.
   → **Un logiciel de chiffrage sans taux de transformation ne se pilote pas.** C'est la lacune
   fonctionnelle la plus structurante après l'unité.

2. **Aucune conversion de devise**, alors que trois devises sont acceptées à la saisie et que les prix
   fournisseurs portent un code devise libre. `currency-rates.ts` stocke des taux sans jamais les
   appliquer. Le code en a conscience et refuse d'injecter un prix en devise étrangère — le garde-fou
   tient, mais la fonctionnalité est en trompe-l'œil.

3. **Aucune notion de délai, planning ou phasage.** Les heures de main-d'œuvre sont saisies, mais rien
   ne les relie à une durée de chantier.

4. **Aucun statut d'option / variante commerciale / PSE** au niveau de la ligne, pourtant standard en
   marché public.

5. **Aucun acompte ni échéancier structuré** — seulement une clause CGV textuelle
   (`pdf-terms.ts:39`).

6. **Aucune pénalité de retard calculée** (mentionnée en CGV, jamais modélisée).

7. **Aucune pièce réglementaire de chantier** : garantie décennale, PPSPS, attestations d'assurance.

---

## 4. Comportements implémentés mais non documentés

Ni bugs ni manques : des règles réelles que personne n'avait écrites. Elles sont désormais couvertes
par [regles-de-calcul.md](regles-de-calcul.md) et [cycle-de-vie.md](cycle-de-vie.md), et listées ici
pour mémoire.

| Règle | Où | Pourquoi elle compte |
|---|---|---|
| Écrêtage à **21,4 M€** avec drapeau `isCapped` | `estimate-calculations.ts:14`, `:470` | Un total **minoré** peut partir au client |
| Barème de marge par défaut **×1,6 / ×1,45 / ×1,4** | `margin-tiers.ts:9-13` | S'applique en repli **silencieux** à tout tenant sans barème |
| Invalidation des approbations à la moindre édition | `rules-engine.ts:1490-1544` | Gouvernance forte, invisible pour l'utilisateur |
| Refus d'un `UPDATE` sans changement de statut hors brouillon | `20260727020000:16-18` | Contre-intuitif |
| Application takeoff **one-shot** + état `partial_apply` | `takeoff/server.ts:7546-7558`, `:7726-7801` | Irréversible |
| Verrou de brouillon **TTL 30 min**, forçage admin | `locks.ts:45`, `:302-304` | |
| Niveaux A/B/C = **profondeur**, convertie en confiance 0,92 / 0,68 / 0,42 | `line-truth.ts:327-333` | Lecture métier ambiguë |
| **19 drapeaux de gating**, 11 bloquants | `gating.ts:42-55` | Définit ce qui empêche un envoi |
| Seuil de fraîcheur des prix **90 j** — mais une échelle 30/90 concurrente existe | `stale-prices.ts:1`, `:43-60` | Deux vérités |
| Prix de référence produit **synchronisé par trigger** depuis les commandes confirmées | `20260714090000_sync_reference_price…` | Modifie des prix catalogue **sans action utilisateur** |

---

## 5. Dette technique de calcul

| Point | État |
|---|---|
| **Deux moteurs complets** coexistent dans `estimate-calculations.ts` (1 968 lignes) | La v1 s'exécute, la v2 est du code dormant |
| `EDITOR_CALC_ENGINE_VERSION = 1` épinglé dans l'éditeur | Dernier verrou avant bascule |
| `EXPORT_CALC_ENGINE_VERSION` | **Constante morte**, zéro usage |
| `invariants.matchesFooter` | Structurellement `false` en production |
| Branche morte : `discountMode === "simple"` avec `discount_steps` non vide | État rendu impossible par `schema.sql:7666` |
| Bug `global_coefficient` forcé à 1 hors mode cascade | Décrit par `EST-E26`, non corrigé |

---

## Voir aussi

- [regles-de-calcul.md](regles-de-calcul.md) · [glossaire.md](glossaire.md) · [cycle-de-vie.md](cycle-de-vie.md)
- [../backlog/](../backlog/) — tickets ouverts
- [../AUDIT-DOCUMENTATION-2026-07-29.md](../AUDIT-DOCUMENTATION-2026-07-29.md) — audit d'où sortent ces constats
